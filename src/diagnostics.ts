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
        message: "端点已响应，但返回内容不是兼容的模型列表。请确认 API 根地址；图片能力尚未验证。" };
    }
    const listed = models.data.data.some((model) => model.id === config.model);
    return { ...baseline, modelsEndpoint: "available", modelListed: listed, httpStatus: response.status,
      message: `${listed ? "当前模型出现在返回的列表中。" : "当前模型未出现在返回的列表中；可能是别名或服务商未列出。"}模型列表响应正常不代表支持图片生成或编辑。请分别调用 generate_image 和 edit_image 实测，这些调用可能计费。` };
  } catch (error) {
    // 列表接口可能独立鉴权或根本不存在，这些失败不能作为禁止生图的依据。
    const status = error instanceof OpenAI.APIError ? error.status ?? null : null;
    let message = "模型列表请求失败，请检查网络和端点配置；未发送任何图片生成请求。";
    if (error instanceof OpenAI.APIConnectionTimeoutError) message = "模型列表请求超时；图片能力仍未验证。";
    else if (signal?.aborted) message = "端点检查已取消。";
    else if (status === 401 || status === 403) message = "模型列表接口拒绝访问，请检查密钥及权限；不能据此确定图片接口是否可用。";
    else if (status === 404 || status === 405) message = "此端点没有可用的模型列表接口；部分图片服务不提供该接口，不代表不支持生图。";
    else if (status === 429) message = "模型列表接口返回限流或额度错误，请检查服务商配置后重试；未自动重试。";
    return { ...baseline, modelsEndpoint: "unavailable", httpStatus: status, message };
  }
}
