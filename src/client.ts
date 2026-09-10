import OpenAI from "openai";
import type { Config } from "./config.js";

/**
 * 为一份用户配置创建独立的 API 客户端，不修改进程环境变量或共享凭证。
 * @param config 已校验的端点、密钥和毫秒超时配置。
 * @returns 禁用自动重试、重定向和 SDK 日志的客户端。
 */
export function createApiClient(config: Config) {
  return new OpenAI({
    apiKey: config.apiKey, baseURL: config.baseURL, timeout: config.timeout,
    // 生成可能计费，不自动重试；不跟随重定向将凭证发送到其他地址。
    maxRetries: 0, fetchOptions: { redirect: "error" }, logLevel: "off",
  });
}
