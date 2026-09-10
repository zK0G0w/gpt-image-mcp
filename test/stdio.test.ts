import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

test("真实 stdio 子进程可完成握手并发现工具", async (t) => {
  const client = new Client({ name: "标准输入输出测试", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", entry],
    env: { OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: "http://127.0.0.1:1/v1" },
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.listTools();
  assert.equal(result.tools.length, 3);
});

test("缺少密钥时启动失败，stdout 不混入错误日志", () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", entry], {
    env: { ...process.env, OPENAI_API_KEY: "" }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /OPENAI_API_KEY/);
});

test("帮助命令不需要密钥，未知参数不会意外启动 MCP", () => {
  const options = { env: { ...process.env, OPENAI_API_KEY: "" }, encoding: "utf8", timeout: 10000 } as const;
  const help = spawnSync(process.execPath, ["--import", "tsx", entry, "--help"], options);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /OPENAI_BASE_URL/);
  const unknown = spawnSync(process.execPath, ["--import", "tsx", entry, "--unknown"], options);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /不支持的命令参数/);
  assert.equal(unknown.stdout, "");
});

test("诊断命令连接失败时返回未验证报告并正常退出", () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", entry, "--check"], {
    env: { ...process.env, OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: "http://127.0.0.1:1/v1", IMAGE_GEN_TIMEOUT_MS: "1000" },
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(child.status, 1);
  const result = JSON.parse(child.stdout);
  assert.equal(result.modelsEndpoint, "unavailable");
  assert.equal(result.generation, "unverified");
  assert.equal(result.editing, "unverified");
  assert.doesNotMatch(child.stdout + child.stderr, /test-key/);
});
