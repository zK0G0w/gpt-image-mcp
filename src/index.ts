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
    process.stdout.write("gpt-image-mcp\n\nUsage:\n  gpt-image-mcp          Start the local stdio MCP server\n  gpt-image-mcp --check  Check the model list endpoint without sending image requests\n  gpt-image-mcp --help   Show this help\n\nConfiguration (environment variables): OPENAI_API_KEY、OPENAI_BASE_URL、IMAGE_GEN_MODEL、IMAGE_GEN_OUTPUT_DIR、IMAGE_GEN_TIMEOUT_MS、IMAGE_GEN_RESPONSE_FORMAT、IMAGE_GEN_DEFAULT_SIZE、IMAGE_GEN_DEFAULT_QUALITY\n");
  } else if (args.length === 1 && args[0] === "--check") {
    const config = readConfig();
    const result = await checkEndpoint(createApiClient(config), config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.modelsEndpoint === "available" ? 0 : 1;
  } else if (args.length === 0) {
    const server = createServer(readConfig());
    await server.connect(new StdioServerTransport());
  } else {
    throw new Error("Unsupported argument. Run gpt-image-mcp --help for usage.");
  }
} catch (error) {
  // stdout 专用于 MCP 协议消息，启动错误只能写入 stderr。
  console.error(error instanceof Error ? error.message : "Failed to start the MCP server.");
  process.exitCode = 1;
}
