import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "image-gen 安装验证-"));
const npmCLI = process.env.npm_execpath;
if (!npmCLI) throw new Error("请通过 npm run test:package 执行安装包验证。");

/** 通过当前 npm 的 JS 入口执行命令，避免依赖平台特定的 .cmd 或 shell 解析。 */
function npm(args, cwd) {
  const result = spawnSync(process.execPath, [npmCLI, ...args], {
    cwd, encoding: "utf8", timeout: 300000,
    env: { ...process.env, OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/v1" },
  });
  assert.equal(result.status, 0, `npm ${args[0]} 失败：${result.stderr || result.error || result.stdout}`);
  return result.stdout;
}

try {
  // 白名单约束实际打包内容，防止把真实 .env、测试或工作目录文件一并分发。
  const [packed] = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root));
  const files = packed.files.map((file) => file.path);
  assert.ok(files.includes("dist/index.js"));
  assert.ok(files.includes(".env.example"));
  assert.ok(files.every((file) => file.startsWith("dist/") || ["package.json", "README.md", "LICENSE", ".env.example"].includes(file)));
  await writeFile(path.join(temporary, "package.json"), JSON.stringify({ private: true }));
  // 从压缩包独立安装，保证成功启动不依赖源码目录中的开发依赖。
  npm(["install", "--no-audit", "--no-fund", path.join(temporary, packed.filename)], temporary);
  const entry = path.join(temporary, "node_modules", "gpt-image-mcp", "dist", "index.js");
  assert.ok((await readFile(entry, "utf8")).startsWith("#!/usr/bin/env node\n"));
  const help = npm(["exec", "--offline", "--", "gpt-image-mcp", "--help"], temporary);
  assert.match(help, /gpt-image-mcp/);

  const client = new Client({ name: "安装包验证", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [entry], cwd: temporary,
      env: { OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: "http://127.0.0.1:1/v1" }, stderr: "pipe",
    }));
    assert.equal(client.getServerVersion()?.name, "gpt-image-mcp");
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ["check_endpoint", "edit_image", "generate_image"]);
  } finally {
    await client.close();
  }
  process.stdout.write("安装包验证通过：文件白名单、独立安装、命令入口和 MCP 握手均正常。\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
