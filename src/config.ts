import { homedir } from "node:os";
import path from "node:path";

/**
 * 展开用户主目录并规范化本机路径，避免 MCP 客户端的启动目录影响文件位置。
 * @param value 本机绝对路径，或以 ~/、~\ 开头的主目录路径。
 * @returns 使用当前操作系统路径分隔符的绝对路径。
 * @throws 输入为相对路径时抛出错误。
 */
export function localPath(value: string): string {
  const expanded = value === "~" ? homedir()
    : /^~[/\\]/.test(value) ? path.join(homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) {
    throw new Error("请使用本机绝对路径，或以 ~/ 开头的路径。");
  }
  return path.normalize(expanded);
}

/**
 * 从环境变量读取并校验配置，不访问网络，也不创建输出目录。
 * @param env 配置来源；默认使用进程环境变量，密钥不会写入日志。
 * @returns 规范化的端点、模型、请求超时（毫秒）和本地输出根目录。
 * @throws 缺少密钥、端点格式非法、超时不合法或输出目录为相对路径时抛出错误。
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("请通过 OPENAI_API_KEY 配置 OpenAI API 密钥。");
  const model = env.IMAGE_GEN_MODEL?.trim() || "gpt-image-2.5-sunburst";
  // 兼容服务商对 GPT Image 的模型别名，不根据名称猜测图片能力。
  const baseURL = normalizeBaseURL(env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1");
  const timeout = Number(env.IMAGE_GEN_TIMEOUT_MS || 300_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1000) {
    throw new Error("IMAGE_GEN_TIMEOUT_MS 必须是大于或等于 1000 的整数，单位为毫秒。");
  }
  const outputDir = env.IMAGE_GEN_OUTPUT_DIR?.trim();
  const responseFormat = (env.IMAGE_GEN_RESPONSE_FORMAT?.trim() || "b64_json") as "b64_json" | "url";
  if (responseFormat !== "b64_json" && responseFormat !== "url") {
    throw new Error("IMAGE_GEN_RESPONSE_FORMAT 仅支持 b64_json 或 url。");
  }
  const defaultSize = parseDefaultSize(env.IMAGE_GEN_DEFAULT_SIZE?.trim());
  const validQualities = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
  const defaultQuality = (env.IMAGE_GEN_DEFAULT_QUALITY?.trim() || "auto") as typeof validQualities[number];
  if (!validQualities.includes(defaultQuality)) {
    throw new Error(`IMAGE_GEN_DEFAULT_QUALITY 仅支持 ${validQualities.join("、")}。`);
  }
  return {
    apiKey, baseURL, model, timeout, responseFormat, defaultSize, defaultQuality,
    outputDir: outputDir ? localPath(outputDir) : path.join(homedir(), "gpt-image-mcp", "images"),
  };
}

/** 校验 IMAGE_GEN_DEFAULT_SIZE：空值返回 "auto"，否则必须满足 WIDTHxHEIGHT 约束。 */
function parseDefaultSize(value: string | undefined): string {
  if (!value) return "auto";
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error("IMAGE_GEN_DEFAULT_SIZE 格式必须为 WIDTHxHEIGHT（如 1024x1024）。");
  const w = Number(match[1]), h = Number(match[2]);
  if (w % 16 !== 0 || h % 16 !== 0 || w <= 0 || h <= 0
    || Math.max(w, h) / Math.min(w, h) > 3
    || w * h < 655_360 || w * h > 8_294_400) {
    throw new Error("IMAGE_GEN_DEFAULT_SIZE 宽高需为 16 的倍数，比例不超过 3:1，总像素 655360~8294400。");
  }
  return value;
}

/** 仅为无路径地址补 /v1；显式路径代表用户选择，不能猜测并改写。 */
function normalizeBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OPENAI_BASE_URL 必须是完整的 HTTP 或 HTTPS API 根地址。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("OPENAI_BASE_URL 仅支持 HTTP/HTTPS，且不能包含账号密码、查询参数或片段；密钥请通过 OPENAI_API_KEY 配置。");
  }
  // 只填域名时补齐常见的 /v1；已有路径按显式配置保留，不改写代理前缀或其他版本。
  if (!url.pathname.replace(/\/+$/, "")) url.pathname = "/v1";
  return url.href.replace(/\/+$/, "");
}

/** 已通过本地校验的运行配置；apiKey 属于凭证，不应作为 MCP 结果返回。 */
export type Config = ReturnType<typeof readConfig>;
