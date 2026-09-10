import { open } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { toFile } from "openai";
import { localPath } from "./config.js";

/** 单个输入文件的大小上限，单位为字节；达到上限也会被拒绝。 */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/**
 * 读取本机参考图或遮罩，并按文件内容识别格式，不信任文件扩展名。
 * @param value 本机绝对路径或主目录路径，不接受远程 URL。
 * @returns 原始字节、图片元数据和供 SDK 上传的文件对象；不会修改源文件。
 * @throws 文件不可读、为空、过大，或元数据无法解析、格式不受支持时抛出错误。
 */
export async function readImage(value: string) {
  const filePath = localPath(value);
  const file = await open(filePath, "r");
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size >= MAX_IMAGE_BYTES) {
      throw new Error("输入必须是非空图片文件，且小于 50 MiB。");
    }
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  // 文件可能在 stat 后被其他程序写入，读取后再次检查实际字节数。
  if (bytes.length >= MAX_IMAGE_BYTES) throw new Error("输入图片必须小于 50 MiB。");
  const metadata = await sharp(bytes).metadata().catch(() => {
    throw new Error("无法解析输入图片，请检查文件是否损坏以及实际格式是否受支持。");
  });
  if (!["png", "jpeg", "webp"].includes(metadata.format)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 图片，请检查文件实际格式。");
  }
  const mimeType = `image/${metadata.format}`;
  return { bytes, metadata, upload: await toFile(bytes, path.basename(filePath), { type: mimeType }) };
}
