import OpenAI from "openai";
import { z } from "zod";
import type { Config } from "./config.js";

/** 诊断结果契约：模型列表的连通状态与尚未验证的图片能力分开返回。 */
export const diagnosticSchema = z.object({
  configuration: z.literal("valid"),
  modelsEndpoint: z.enum(["available", "unavailable", "unexpected_response"]),
  model: z.string(),
  modelListed: z.boolean().nullable(),
  generation: z.literal("unverified"),
  editing: z.literal("unverified"),
  httpStatus: z.number().nullable(),
  message: z.string(),
});

/**
 * 仅检查模型列表接口，不能据此推断文生图或编辑接口的可用性。
 * @param client 当前端点的 API 客户端。
 * @param config 用于匹配模型名称及限制超时；诊断最多等待 30 秒。
 * @param signal 可选取消信号。
 * @returns 模型列表检查报告；请求失败也转换为报告，不回显上游原始错误。
 */
export async function checkEndpoint(client: OpenAI, config: Config, signal?: AbortSignal): Promise<z.infer<typeof diagnosticSchema>> {
  const baseline = {
    configuration: "valid", model: config.model, modelListed: null,
    generation: "unverified", editing: "unverified", httpStatus: null,
  } as const;
  try {
    const response = await client.models.list({
      timeout: Math.min(config.timeout, 30_000), signal,
    }).asResponse();
    // 校验原始响应，避免 SDK 把缺失的 data 自动转成空列表而误报兼容。
    const models = z.object({ data: z.array(z.object({ id: z.string() })) })
      .safeParse(await response.json().catch(() => null));
    if (!models.success) {
      return { ...baseline, modelsEndpoint: "unexpected_response", httpStatus: response.status,
        message: "The endpoint responded, but the body is not a compatible model list. Check the API base URL; image capabilities are not verified." };
    }
    const listed = models.data.data.some((model) => model.id === config.model);
    return { ...baseline, modelsEndpoint: "available", modelListed: listed, httpStatus: response.status,
      message: `${listed ? "The configured model appears in the returned list. " : "The configured model does not appear in the returned list; it may be an alias or not listed by the provider. "}A healthy model list does not prove that image generation or editing works. Call generate_image and edit_image separately to verify; these calls may be billed.` };
  } catch (error) {
    // 列表接口可能独立鉴权或根本不存在，这些失败不能作为禁止生图的依据。
    const status = error instanceof OpenAI.APIError ? error.status ?? null : null;
    let message = "The model list request failed. Check the network and endpoint configuration; no image request was sent.";
    if (error instanceof OpenAI.APIConnectionTimeoutError) message = "The model list request timed out; image capabilities are still unverified.";
    else if (signal?.aborted) message = "The endpoint check was cancelled.";
    else if (status === 401 || status === 403) message = "The model list endpoint denied access. Check the key and permissions; this does not tell whether the image endpoints work.";
    else if (status === 404 || status === 405) message = "This endpoint has no usable model list; some image providers do not offer one, which does not mean image generation is unsupported.";
    else if (status === 429) message = "The model list endpoint returned a rate-limit or quota error. Check the provider configuration and retry; nothing was retried automatically.";
    return { ...baseline, modelsEndpoint: "unavailable", httpStatus: status, message };
  }
}
