import OpenAI from "openai";
import sharp from "sharp";
import { z } from "zod";
import type { Config } from "./config.js";
import { readImage } from "./input.js";
import { saveImage } from "./storage.js";

/** 校验 WIDTHxHEIGHT 格式：宽高均为 16 的倍数，比例不超过 3:1，总像素 655360~8294400。 */
const sizeSchema = z.string().default("auto").describe(
  "输出尺寸：auto 或 WIDTHxHEIGHT（如 1024x1024、1536x1024、3840x2160）。宽高需为 16 的倍数，比例不超过 3:1。",
).refine((v) => {
  if (v === "auto") return true;
  const match = /^(\d+)x(\d+)$/.exec(v);
  if (!match) return false;
  const w = Number(match[1]), h = Number(match[2]);
  return w % 16 === 0 && h % 16 === 0 && w > 0 && h > 0
    && Math.max(w, h) / Math.min(w, h) <= 3
    && w * h >= 655_360 && w * h <= 8_294_400;
}, { message: "尺寸需为 auto 或 WIDTHxHEIGHT，宽高为 16 的倍数，比例不超过 3:1，总像素 655360~8294400。" });

/** MCP 文生图输入契约；默认值由工具层校验时补齐，未知参数直接拒绝。 */
export const generateSchema = z.object({
  prompt: z.string().trim().min(1).max(32000).describe("图片内容、风格、构图等要求。"),
  size: sizeSchema,
  quality: z.enum(["auto", "low", "medium", "high", "xhigh", "max"]).default("auto").describe("生成质量，越高通常越慢且费用越高。"),
  format: z.enum(["png", "jpeg", "webp"]).default("png").describe("保存的图片格式。"),
  background: z.enum(["auto", "transparent", "opaque"]).default("auto").describe("背景模式；transparent 需配合 png 或 webp 格式。"),
  moderation: z.enum(["auto", "low"]).default("auto").describe("内容安全审核级别。"),
  output_compression: z.number().int().min(0).max(100).optional().describe("输出压缩率（0-100），仅 jpeg 和 webp 格式生效。"),
}).strict();

/** 文生图独有字段（moderation），编辑接口不支持。 */
const baseEditSchema = generateSchema.omit({ moderation: true });

/** 编辑沿用生成参数（不含 moderation）；图片顺序与提示词中的图一、图二保持一致。 */
export const editSchema = baseEditSchema.extend({
  images: z.array(z.string().min(1)).min(1).max(16).describe("本机原图或参考图的绝对路径，可使用 ~/；按提示词引用的顺序排列。"),
  mask: z.string().min(1).optional().describe("可选 PNG 遮罩的本机绝对路径，需含透明通道且尺寸与第一张原图一致；透明区域用于引导编辑。"),
  input_fidelity: z.enum(["high", "low"]).optional().describe("编辑时对原图细节的保留程度，high 尽量保留原图主体。"),
});

/**
 * 协调图片 API 调用、本地输入校验和结果保存。
 * 每次请求生成一张新图片；不重写原图、不自动重试，也不保存用户密钥。
 * 输入参数由 MCP 层先按对应 schema 校验，调用成功后才返回实际落盘位置。
 */
export class ImageService {
  /**
   * @param client 属于当前用户配置的 API 客户端，允许测试注入模拟客户端。
   * @param config 已校验的模型和输出目录配置。
   */
  constructor(private readonly client: OpenAI, private readonly config: Config) {}

  /**
   * 根据提示词生成一张图片并保存，调用上游可能计费。
   * @param input 已通过 generateSchema 校验并补齐默认值的参数。
   * @param signal 可选取消信号；不能保证撤销上游已开始的生成或计费。
   * @returns 已保存图片的位置、实际尺寸、大小和所用模型。
   * @throws 上游请求失败、结果不可解析或本地保存失败时抛出错误。
   */
  async generate(input: z.infer<typeof generateSchema>, signal?: AbortSignal) {
    const response = await this.client.images.generate({
      model: this.config.model, prompt: input.prompt, size: input.size,
      quality: input.quality, output_format: input.format, n: 1,
      response_format: this.config.responseFormat,
      background: input.background,
      moderation: input.moderation,
      ...(input.output_compression != null && { output_compression: input.output_compression }),
    }, { signal });
    return this.persist(response, input.format, signal);
  }

  /**
   * 校验参考图和遮罩后执行编辑，结果另存为新图片。
   * @param input 已通过 editSchema 校验的参数，至少包含一张本地图片。
   * @param signal 可选取消信号，在读取参考图之间及 API 请求期间生效。
   * @returns 编辑后新文件的位置和元数据，原图内容保持不变。
   * @throws 输入文件、遮罩不合法、参考图合计超过 100 MiB 或调用、保存失败时抛出错误。
   */
  async edit(input: z.infer<typeof editSchema>, signal?: AbortSignal) {
    const images = [];
    let totalBytes = 0;
    for (const imagePath of input.images) {
      signal?.throwIfAborted();
      const image = await readImage(imagePath);
      totalBytes += image.bytes.length;
      // 限制单次请求的内存占用，多张参考图按输入顺序传给模型。
      if (totalBytes > 100 * 1024 * 1024) throw new Error("参考图片总大小不能超过 100 MiB。");
      images.push(image);
    }
    const mask = input.mask ? await readImage(input.mask) : undefined;
    if (mask) {
      // API 将遮罩应用于第一张参考图，尺寸检查必须使用同一张图。
      const first = images[0]!.metadata;
      if (mask.metadata.format !== "png" || !mask.metadata.hasAlpha
        || mask.metadata.width !== first.width || mask.metadata.height !== first.height) {
        throw new Error("遮罩必须是带透明通道的 PNG，且尺寸与第一张原图一致。");
      }
    }
    const response = await this.client.images.edit({
      model: this.config.model, prompt: input.prompt, size: input.size,
      quality: input.quality, output_format: input.format, n: 1,
      response_format: this.config.responseFormat,
      background: input.background,
      image: images.map((image) => image.upload), mask: mask?.upload,
      ...(input.input_fidelity != null && { input_fidelity: input.input_fidelity }),
      ...(input.output_compression != null && { output_compression: input.output_compression }),
    }, { signal });
    return this.persist(response, input.format, signal);
  }

  /** 从 API 响应中提取图片字节：优先 b64_json，其次下载 url。 */
  private async extractBytes(response: OpenAI.Images.ImagesResponse, signal?: AbortSignal): Promise<Buffer> {
    const item = response.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
    if (item?.url) {
      const res = await fetch(item.url, { signal, redirect: "follow" });
      if (!res.ok) throw new Error(`下载图片失败（状态码：${res.status}）。`);
      return Buffer.from(await res.arrayBuffer());
    }
    throw new Error("图片 API 未返回图片数据，请检查所配置模型是否支持图片生成。");
  }

  /** 验证返回图片的实际格式后落盘，支持 b64_json 和 url 两种返回方式。 */
  private async persist(response: OpenAI.Images.ImagesResponse, format: "png" | "jpeg" | "webp", signal?: AbortSignal) {
    const bytes = await this.extractBytes(response, signal);
    const metadata = await sharp(bytes).metadata().catch(() => {
      throw new Error("API 返回的图片数据无法解析，未保存结果。");
    });
    if (metadata.format !== format) throw new Error("API 返回的图片格式与请求不一致，未保存结果。");
    let saved;
    try {
      saved = await saveImage(this.config.outputDir, bytes, format);
    } catch {
      // 保存失败时不重新调用生成接口，避免再次计费。
      throw new Error("图片已生成，但保存失败。请检查输出目录权限和磁盘空间；重新调用会再次生成并可能计费。");
    }
    return {
      images: [{ ...saved, width: metadata.width, height: metadata.height }],
      model: this.config.model,
    };
  }
}
