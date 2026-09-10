import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import OpenAI from "openai";
import { z } from "zod";
import type { Config } from "./config.js";
import { createApiClient } from "./client.js";
import { checkEndpoint, diagnosticSchema } from "./diagnostics.js";
import { editSchema, generateSchema, ImageService } from "./images.js";

/** 返回已落盘文件的元数据，避免将大段 Base64 放入模型上下文。 */
const outputSchema = z.object({
  images: z.array(z.object({
    path: z.string(), uri: z.string(), mimeType: z.string(),
    bytes: z.number(), width: z.number(), height: z.number(),
  })),
  model: z.string(),
});

/** 统一 MCP 的结构化及文本结果，并将已知业务错误转为可供客户端展示的说明。 */
async function toolResult<T extends Record<string, unknown>>(operation: () => Promise<T>): Promise<CallToolResult> {
  try {
    const result = await operation();
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    let message = "图片处理失败，请检查输入文件及服务配置。";
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      message = "图片 API 调用超时；请求可能仍在上游处理中，重新调用可能再次计费。";
    } else if (error instanceof OpenAI.APIConnectionError) {
      message = "无法连接图片 API，请检查网络连接。";
    } else if (error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
      message = "图片请求已取消；已提交到上游的生成任务可能仍会计费。";
    } else if (error instanceof OpenAI.APIError) {
      // 仅回传状态和错误码，避免服务商的原始错误包含凭证或请求内容。
      message = `图片 API 调用失败（状态码：${error.status ?? "未知"}，错误码：${error.code ?? "未知"}）。请检查密钥、模型权限、额度或输入内容。`;
    } else if (error instanceof Error && !error.message.includes("ENOENT") && !error.message.includes("EACCES")) {
      message = error.message;
    } else {
      message = "无法读取本地图片，请检查文件是否存在以及服务是否有读取权限。";
    }
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

/**
 * 注册端点检查、文生图和编辑工具，创建过程不访问网络。
 * @param config 已校验的用户配置。
 * @param client 可选注入的 API 客户端；默认根据 config 独立创建。
 * @returns 尚未连接传输层的 MCP 服务，由入口负责连接 stdio。
 */
export function createServer(config: Config, client = createApiClient(config)) {
  const service = new ImageService(client, config);
  const server = new McpServer({ name: "gpt-image-mcp", version: "0.3.0" });
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  server.registerTool("check_endpoint", {
    title: "端点检查",
    description: "请求当前端点的模型列表，检查响应格式和模型是否在列表中。不会发送生图或编辑请求；即使检查通过，图片能力仍需实际调用验证。",
    inputSchema: z.object({}).strict(), outputSchema: diagnosticSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, (_, context) => toolResult(() => checkEndpoint(client, config, context.mcpReq.signal)));
  server.registerTool("generate_image", {
    title: "文生图",
    description: "根据提示词调用 GPT Image 生成一张图片，保存到本机并返回绝对路径和文件 URI。调用会产生 API 费用。",
    inputSchema: generateSchema, outputSchema, annotations,
  }, (input, context) => toolResult(() => service.generate(input, context.mcpReq.signal)));
  server.registerTool("edit_image", {
    title: "编辑与参考创作",
    description: "读取本机图片，按提示词编辑、替换背景，或参考风格和构图生成新图。请明确各参考图的作用和需要保留的内容；可传遮罩引导局部编辑。保存新文件并返回绝对路径，不覆盖原图。调用会产生 API 费用。",
    inputSchema: editSchema, outputSchema, annotations,
  }, (input, context) => toolResult(() => service.edit(input, context.mcpReq.signal)));
  return server;
}
