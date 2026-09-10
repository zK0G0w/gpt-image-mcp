import { randomBytes, randomInt } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const adjectives = ["cozy", "dreamy", "jolly", "wobbly", "sparkly", "sassy", "fuzzy", "bouncy"];
const creatures = ["otter", "panda", "fox", "penguin", "capybara", "badger", "owl", "axolotl"];
const actions = ["paints", "conjures", "juggles", "sprinkles", "whisks", "doodles", "chases", "brews"];
const wonders = ["moonlight", "stardust", "rainbows", "marshmallows", "daydreams", "confetti", "clouds", "sunbeams"];

/**
 * 使用本地词表和随机短码生成文件名主体，不调用模型、不携带提示词。
 * @returns 不含目录和扩展名的跨平台名称；重名由保存时的独占创建处理。
 */
export function playfulName(): string {
  const words = [adjectives, creatures, actions, wonders].map((items) => items[randomInt(items.length)]);
  // 只使用小写 ASCII 和连字符，避开 Windows 保留名、大小写冲突和路径转义。
  return `${words.join("-")}-${randomBytes(4).toString("hex")}`;
}

/**
 * 将一张图片保存到本地日期目录，只创建新文件，不覆盖已有图片。
 * @param directory 已规范化的输出根目录绝对路径。
 * @param bytes 已由调用方校验格式的图片字节。
 * @param format 实际编码格式；jpeg 对应 .jpg 扩展名。
 * @returns 写入并关闭文件后的绝对路径、文件 URI、媒体类型和字节数。
 * @throws 创建目录、写入文件失败或连续分配重名文件时抛出错误。
 */
export async function saveImage(directory: string, bytes: Buffer, format: "png" | "jpeg" | "webp") {
  // 使用实际保存时的本地日期，避免 UTC 日期在午夜附近偏移一天。
  const now = new Date();
  const datedDirectory = path.join(directory, String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
  await mkdir(datedDirectory, { recursive: true });
  const extension = format === "jpeg" ? "jpg" : format;
  for (let attempt = 0; attempt < 5; attempt++) {
    const filePath = path.join(datedDirectory, `${playfulName()}.${extension}`);
    let file;
    try {
      // 独占创建，随机名即使碰撞也不会覆盖旧图片。
      file = await open(filePath, "wx", 0o600);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
    try {
      await file.writeFile(bytes);
      await file.close();
    } catch (error) {
      // 仅清理本次已独占创建的文件，避免写入失败后留下半成品。
      await file.close().catch(() => {});
      await unlink(filePath).catch(() => {});
      throw error;
    }
    return { path: filePath, uri: pathToFileURL(filePath).href, mimeType: `image/${format}`, bytes: bytes.length };
  }
  throw new Error("无法分配不重名的图片文件，请重新尝试。");
}
