#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createApiClient } from "./client.js";
import { readConfig } from "./config.js";
import { checkEndpoint } from "./diagnostics.js";
import { createServer } from "./server.js";

// 无参数才进入 MCP 模式；帮助和诊断是独立 CLI 模式，可以向 stdout 输出文本。
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("gpt-image-mcp\n\n用法：\n  gpt-image-mcp          启动本地 stdio MCP 服务\n  gpt-image-mcp --check  检查模型列表接口，不发送生图请求\n  gpt-image-mcp --help   显示帮助\n\n配置：OPENAI_API_KEY、OPENAI_BASE_URL、IMAGE_GEN_MODEL、IMAGE_GEN_OUTPUT_DIR、IMAGE_GEN_TIMEOUT_MS、IMAGE_GEN_RESPONSE_FORMAT\n");
  } else if (args.length === 1 && args[0] === "--check") {
    const config = readConfig();
    const result = await checkEndpoint(createApiClient(config), config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.modelsEndpoint === "available" ? 0 : 1;
  } else if (args.length === 0) {
    const server = createServer(readConfig());
    await server.connect(new StdioServerTransport());
  } else {
    throw new Error("不支持的命令参数，请使用 gpt-image-mcp --help 查看用法。");
  }
} catch (error) {
  // stdout 专用于 MCP 协议消息，启动错误只能写入 stderr。
  console.error(error instanceof Error ? error.message : "MCP 服务启动失败。");
  process.exitCode = 1;
}
