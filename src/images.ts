import OpenAI from "openai";
import sharp from "sharp";
import { z } from "zod";
import type { Config } from "./config.js";
import { readImage } from "./input.js";
import { saveImage } from "./storage.js";

/** MCP 文生图输入契约；默认值由工具层校验时补齐，未知参数直接拒绝。 */
export const generateSchema = z.object({
  prompt: z.string().trim().min(1).max(32000).describe("图片内容、风格、构图等要求。"),
  size: z.enum(["auto", "1024x1024", "1536x1024", "1024x1536"]).default("auto").describe("输出尺寸：自动、正方形、横图或竖图。"),
  quality: z.enum(["auto", "low", "medium", "high"]).default("auto").describe("生成质量，越高通常越慢且费用越高。"),
  format: z.enum(["png", "jpeg", "webp"]).default("png").describe("保存的图片格式。"),
}).strict();

/** 编辑沿用生成参数；图片顺序与提示词中的图一、图二保持一致。 */
export const editSchema = generateSchema.extend({
  images: z.array(z.string().min(1)).min(1).max(16).describe("本机原图或参考图的绝对路径，可使用 ~/；按提示词引用的顺序排列。"),
  mask: z.string().min(1).optional().describe("可选 PNG 遮罩的本机绝对路径，需含透明通道且尺寸与第一张原图一致；透明区域用于引导编辑。"),
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
    }, { signal });
    return this.persist(response, input.format);
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
      image: images.map((image) => image.upload), mask: mask?.upload,
    }, { signal });
    return this.persist(response, input.format);
  }

  /** 验证返回图片的实际格式后落盘；当前仅接受同步返回的 Base64 图片数据。 */
  private async persist(response: OpenAI.Images.ImagesResponse, format: "png" | "jpeg" | "webp") {
    const base64 = response.data?.[0]?.b64_json;
    if (!base64) throw new Error("图片 API 未返回图片数据，请检查所配置模型是否支持图片生成。");
    const bytes = Buffer.from(base64, "base64");
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
