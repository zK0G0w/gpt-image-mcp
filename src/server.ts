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
    let message = "Image processing failed. Check the input files and the service configuration.";
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      message = "The image API call timed out; the request may still be processing upstream, and calling again may be billed again.";
    } else if (error instanceof OpenAI.APIConnectionError) {
      message = "Unable to reach the image API. Check the network connection.";
    } else if (error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
      message = "The image request was cancelled; a generation already submitted upstream may still be billed.";
    } else if (error instanceof OpenAI.APIError) {
      // 仅回传状态和错误码，避免服务商的原始错误包含凭证或请求内容。
      message = `The image API call failed (status: ${error.status ?? "unknown"}, code: ${error.code ?? "unknown"}). Check the key, model access, quota or input.`;
    } else if (error instanceof Error && !error.message.includes("ENOENT") && !error.message.includes("EACCES")) {
      message = error.message;
    } else {
      message = "Unable to read the local image. Check that the file exists and the service has read permission.";
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
  const server = new McpServer({ name: "gpt-image-mcp", version: "0.3.1" });
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  server.registerTool("check_endpoint", {
    title: "Check endpoint",
    description: "Request the model list of the current endpoint and check the response format and whether the configured model is listed. No generation or edit request is sent; even if the check passes, image capabilities must still be verified with real calls.",
    inputSchema: z.object({}).strict(), outputSchema: diagnosticSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, (_, context) => toolResult(() => checkEndpoint(client, config, context.mcpReq.signal)));
  server.registerTool("generate_image", {
    title: "Generate image",
    description: "Generate one image from a prompt with GPT Image, save it on the local machine and return its absolute path and file URI. Calls incur API charges.",
    inputSchema: generateSchema, outputSchema, annotations,
  }, (input, context) => toolResult(() => service.generate(input, context.mcpReq.signal)));
  server.registerTool("edit_image", {
    title: "Edit or create from references",
    description: "Read local images and edit them, replace the background, or create a new image from their style and composition. State the role of each input image and what must be kept; pass a mask to guide local edits. Saves a new file and returns its absolute path without overwriting the original. Calls incur API charges.",
    inputSchema: editSchema, outputSchema, annotations,
  }, (input, context) => toolResult(() => service.edit(input, context.mcpReq.signal)));
  return server;
}
