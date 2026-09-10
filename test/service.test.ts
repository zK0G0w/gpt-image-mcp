import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import sharp from "sharp";
import { localPath, readConfig } from "../src/config.js";
import { createApiClient } from "../src/client.js";
import { diagnosticSchema } from "../src/diagnostics.js";
import { createServer } from "../src/server.js";
import { playfulName, saveImage } from "../src/storage.js";

const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "transparent" } }).png().toBuffer();

async function fixture(t: TestContext, fetch: typeof globalThis.fetch, env: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "image-gen-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = readConfig({ OPENAI_API_KEY: "test-key", IMAGE_GEN_OUTPUT_DIR: path.join(directory, "画室 with spaces"), ...env });
  const originalFetch = globalThis.fetch;
  // SDK 使用本地 data URL 探测 FormData 支持，不计入上游 API 调用次数。
  t.mock.method(globalThis, "fetch", (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
    String(url).startsWith("data:") ? originalFetch(url, init) : fetch(url, init));
  const api = createApiClient(config);
  const server = createServer(config, api);
  const client = new Client({ name: "测试客户端", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return { client, directory, config };
}

function imageResponse(bytes = png) {
  return Response.json({ created: 1, data: [{ b64_json: bytes.toString("base64") }] });
}

test("配置使用本机主目录，拒绝相对路径和无效配置", () => {
  assert.equal(localPath("~/画室 with spaces"), path.join(homedir(), "画室 with spaces"));
  assert.equal(readConfig({ OPENAI_API_KEY: "测试" }).outputDir, path.join(homedir(), "gpt-image-mcp", "images"));
  assert.equal(readConfig({ OPENAI_API_KEY: "测试" }).responseFormat, "b64_json");
  assert.equal(readConfig({ OPENAI_API_KEY: "测试", IMAGE_GEN_RESPONSE_FORMAT: "url" }).responseFormat, "url");
  assert.throws(() => localPath("./images"), /绝对路径/);
  assert.throws(() => readConfig({}), /OPENAI_API_KEY/);
  assert.throws(() => readConfig({ OPENAI_API_KEY: "测试", IMAGE_GEN_TIMEOUT_MS: "abc" }), /整数/);
  assert.throws(() => readConfig({ OPENAI_API_KEY: "测试", IMAGE_GEN_RESPONSE_FORMAT: "invalid" }), /b64_json/);
});

test("俏皮名称在 POSIX 和 Windows 下均为安全文件名", () => {
  const names = Array.from({ length: 1000 }, playfulName);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^[a-z]+-[a-z]+-[a-z]+-[a-z]+-[0-9a-f]{8}$/);
    assert.equal(path.posix.basename(`${name}.png`), `${name}.png`);
    assert.equal(path.win32.basename(`${name}.png`), `${name}.png`);
  }
});

test("并发保存不覆盖图片，文件 URI 可还原中文及空格路径", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 10, 12) });
  const directory = await mkdtemp(path.join(tmpdir(), "画室 with spaces-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = await Promise.all(Array.from({ length: 20 }, () => saveImage(directory, png, "png")));
  const datedDirectory = path.join(directory, "2026", "09", "10");
  assert.equal((await readdir(datedDirectory)).length, 20);
  for (const image of saved) {
    assert.equal(path.dirname(image.path), datedDirectory);
    assert.equal(fileURLToPath(image.uri), image.path);
    assert.deepEqual(await readFile(image.path), png);
  }
});

test("保存目录按本地日期补零，并在跨年后切换目录", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "image-gen-date-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = new Date(2025, 11, 31, 23, 59, 59);
  const after = new Date(2026, 0, 1, 0, 0, 1);
  t.mock.timers.enable({ apis: ["Date"], now: before });
  const first = await saveImage(directory, png, "png");
  t.mock.timers.setTime(after.getTime());
  const second = await saveImage(directory, png, "png");
  assert.equal(path.dirname(first.path), path.join(directory, "2025", "12", "31"));
  assert.equal(path.dirname(second.path), path.join(directory, "2026", "01", "01"));
  assert.deepEqual(await readFile(first.path), png);
  assert.deepEqual(await readFile(second.path), png);
});

test("MCP 发现三个工具，文生图发送 JSON 并返回真实落盘路径", async (t) => {
  let count = 0;
  const { client } = await fixture(t, async (url, init) => {
    count++;
    assert.match(String(url), /\/images\/generations$/);
    assert.equal(init?.method, "POST");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.prompt, "水獭在月光下画画");
    assert.equal(request.output_format, "png");
    assert.equal(request.response_format, undefined);
    assert.equal(request.background, "auto");
    assert.equal(request.moderation, "auto");
    assert.equal(request.n, 1);
    return imageResponse();
  });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["check_endpoint", "edit_image", "generate_image"]);
  const result = await client.callTool({ name: "generate_image", arguments: { prompt: "水獭在月光下画画" } });
  assert.ok(!result.isError);
  const output = JSON.parse(JSON.stringify(result.structuredContent));
  assert.equal(output.images[0].width, 8);
  assert.deepEqual(await readFile(output.images[0].path), png);
  assert.equal(count, 1);
});

test("图生图按顺序上传多张参考图与遮罩，不修改原图", async (t) => {
  let count = 0;
  const { client, directory } = await fixture(t, async (url, init) => {
    count++;
    assert.match(String(url), /\/images\/edits$/);
    const request = new Request("https://example.test", init);
    const form = await request.formData();
    const images = form.getAll("image[]");
    assert.equal(images.length, 2);
    assert.ok(images[0] instanceof File);
    assert.equal(images[0].name, "原图.png");
    assert.ok(images[1] instanceof File);
    assert.equal(images[1].name, "参考图.png");
    assert.ok(form.get("mask") instanceof File);
    assert.equal(form.get("prompt"), "保留图一主体，参考图二的配色");
    return imageResponse();
  });
  const original = path.join(directory, "原图.png");
  const reference = path.join(directory, "参考图.png");
  const mask = path.join(directory, "遮罩.png");
  await Promise.all([original, reference, mask].map((file) => writeFile(file, png)));
  const result = await client.callTool({ name: "edit_image", arguments: {
    prompt: "保留图一主体，参考图二的配色", images: [original, reference], mask,
  } });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(count, 1);
  assert.deepEqual(await readFile(original), png);
});

test("参数、文件和遮罩错误在调用上游前返回", async (t) => {
  let count = 0;
  const { client, directory } = await fixture(t, async () => { count++; return imageResponse(); });
  const original = path.join(directory, "原图.png");
  const badMask = path.join(directory, "遮罩.png");
  await writeFile(original, png);
  await writeFile(badMask, await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer());
  const cases = [
    { name: "generate_image", arguments: { prompt: " " } },
    { name: "edit_image", arguments: { prompt: "修改", images: [] } },
    { name: "edit_image", arguments: { prompt: "修改", images: ["relative.png"] } },
    { name: "edit_image", arguments: { prompt: "修改", images: [path.join(directory, "不存在.png")] } },
    { name: "edit_image", arguments: { prompt: "修改", images: [original], mask: badMask } },
  ];
  for (const request of cases) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true);
  }
  assert.equal(count, 0);
});

test("API 限流不重试，错误结果不暴露上游原始消息", async (t) => {
  let count = 0;
  const { client, config } = await fixture(t, async () => {
    count++;
    return Response.json({ error: { message: "敏感上游信息", type: "rate_limit_error", code: "rate_limit_exceeded" } }, { status: 429 });
  });
  const result = await client.callTool({ name: "generate_image", arguments: { prompt: "画画" } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /429/);
  assert.doesNotMatch(JSON.stringify(result), /敏感上游信息/);
  assert.equal(count, 1);
  await assert.rejects(readdir(config.outputDir), { code: "ENOENT" });
});

test("保存失败不重复生成，明确提示已有 API 调用", async (t) => {
  let count = 0;
  const { client, config } = await fixture(t, async () => { count++; return imageResponse(); });
  await writeFile(config.outputDir, "占用目录位置");
  const result = await client.callTool({ name: "generate_image", arguments: { prompt: "画画" } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /图片已生成，但保存失败/);
  assert.equal(count, 1);
});

test("JPEG 与 WebP 输出保持扩展名、媒体类型和内容一致", async (t) => {
  for (const format of ["jpeg", "webp"] as const) {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    const { client } = await fixture(t, async () => imageResponse(bytes));
    const result = await client.callTool({ name: "generate_image", arguments: { prompt: "画画", format } });
    assert.ok(!result.isError);
    const output = JSON.parse(JSON.stringify(result.structuredContent));
    assert.equal(output.images[0].mimeType, `image/${format}`);
    assert.equal(path.extname(output.images[0].path), format === "jpeg" ? ".jpg" : ".webp");
    assert.deepEqual(await readFile(output.images[0].path), bytes);
  }
});

test("自定义端点保留根路径、处理尾斜杠并支持模型别名", () => {
  const env = { OPENAI_API_KEY: "test-key" };
  assert.equal(readConfig(env).baseURL, "https://api.openai.com/v1");
  const config = readConfig({ ...env, OPENAI_BASE_URL: " https://gateway.example/proxy/v1/// ", IMAGE_GEN_MODEL: "my-image-alias" });
  assert.equal(config.baseURL, "https://gateway.example/proxy/v1");
  assert.equal(config.model, "my-image-alias");
  assert.equal(readConfig({ ...env, OPENAI_BASE_URL: "http://localhost:8080" }).baseURL, "http://localhost:8080/v1");
  for (const invalid of ["not-a-url", "ftp://example.com", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/v1#secret"]) {
    assert.throws(() => readConfig({ ...env, OPENAI_BASE_URL: invalid }), /OPENAI_BASE_URL/);
  }
});

test("端点未填写时使用官方地址，根地址自动补 v1，显式路径保持不变", () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, "https://api.openai.com/v1"],
    ["", "https://api.openai.com/v1"],
    ["   ", "https://api.openai.com/v1"],
    ["https://api.openai.com", "https://api.openai.com/v1"],
    ["https://gateway.example", "https://gateway.example/v1"],
    ["https://gateway.example///", "https://gateway.example/v1"],
    ["https://gateway.example/v1", "https://gateway.example/v1"],
    ["https://gateway.example/v1/", "https://gateway.example/v1"],
    ["https://gateway.example/proxy/v1/", "https://gateway.example/proxy/v1"],
    ["https://gateway.example/proxy/", "https://gateway.example/proxy"],
    ["https://gateway.example/v2/", "https://gateway.example/v2"],
    ["http://[::1]:8080/", "http://[::1]:8080/v1"],
  ];
  for (const [value, expected] of cases) {
    assert.equal(readConfig({ OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: value }).baseURL, expected);
  }
});

test("只填域名时三个工具均使用补齐后的 v1 路径", async (t) => {
  const urls: string[] = [];
  const { client, directory } = await fixture(t, async (url) => {
    urls.push(String(url));
    return String(url).endsWith("/models") ? Response.json({ data: [] }) : imageResponse();
  }, { OPENAI_BASE_URL: "https://gateway.example/" });
  const original = path.join(directory, "原图.png");
  await writeFile(original, png);
  for (const request of [
    { name: "check_endpoint", arguments: {} },
    { name: "generate_image", arguments: { prompt: "画画" } },
    { name: "edit_image", arguments: { prompt: "改画", images: [original] } },
  ]) {
    assert.ok(!(await client.callTool(request)).isError);
  }
  assert.deepEqual(urls, ["https://gateway.example/v1/models", "https://gateway.example/v1/images/generations", "https://gateway.example/v1/images/edits"]);
});

test("文生图和编辑均发送到自定义端点并使用所配置密钥和模型", async (t) => {
  const urls: string[] = [];
  const { client, directory } = await fixture(t, async (url, init) => {
    urls.push(String(url));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer custom-key");
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("generations")) {
      assert.equal(JSON.parse(String(init?.body)).model, "custom-image-model");
    } else {
      const form = await new Request("https://example.test", init).formData();
      assert.equal(form.get("model"), "custom-image-model");
    }
    return imageResponse();
  }, { OPENAI_API_KEY: "custom-key", OPENAI_BASE_URL: "https://gateway.example/proxy/v1/", IMAGE_GEN_MODEL: "custom-image-model" });
  const original = path.join(directory, "原图.png");
  await writeFile(original, png);
  const generated = await client.callTool({ name: "generate_image", arguments: { prompt: "画画" } });
  const edited = await client.callTool({ name: "edit_image", arguments: { prompt: "改画", images: [original] } });
  assert.ok(!generated.isError && !edited.isError);
  assert.deepEqual(urls, ["https://gateway.example/proxy/v1/images/generations", "https://gateway.example/proxy/v1/images/edits"]);
});

test("端点检查只读取模型列表，不声称图片能力已经验证", async (t) => {
  const urls: string[] = [];
  const { client, config } = await fixture(t, async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.method, "GET");
    return Response.json({ object: "list", data: [{ id: "my-image-alias" }] });
  }, { OPENAI_BASE_URL: "https://gateway.example/proxy/v1", IMAGE_GEN_MODEL: "my-image-alias" });
  assert.equal(urls.length, 0);
  const result = await client.callTool({ name: "check_endpoint", arguments: {} });
  assert.ok(!result.isError);
  const report = diagnosticSchema.parse(result.structuredContent);
  assert.equal(report.modelsEndpoint, "available");
  assert.equal(report.modelListed, true);
  assert.equal(report.generation, "unverified");
  assert.equal(report.editing, "unverified");
  assert.deepEqual(urls, ["https://gateway.example/proxy/v1/models"]);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
  await assert.rejects(readdir(config.outputDir), { code: "ENOENT" });
});

test("模型未列出或检查失败不会被误判为图片接口不支持", async (t) => {
  const cases = [
    { status: 200, body: { data: [{ id: "another-model" }] }, expected: "available", listed: false },
    { status: 200, body: { html: "这不是模型列表" }, expected: "unexpected_response", listed: null },
    { status: 401, body: { error: { message: "敏感上游信息" } }, expected: "unavailable", listed: null },
    { status: 404, body: { error: { message: "敏感上游信息" } }, expected: "unavailable", listed: null },
    { status: 429, body: { error: { message: "敏感上游信息" } }, expected: "unavailable", listed: null },
  ];
  for (const item of cases) {
    let count = 0;
    const { client } = await fixture(t, async () => {
      count++;
      return Response.json(item.body, { status: item.status });
    });
    const result = await client.callTool({ name: "check_endpoint", arguments: {} });
    const report = diagnosticSchema.parse(result.structuredContent);
    assert.equal(report.modelsEndpoint, item.expected);
    assert.equal(report.modelListed, item.listed);
    assert.equal(report.generation, "unverified");
    assert.equal(report.editing, "unverified");
    assert.doesNotMatch(JSON.stringify(result), /敏感上游信息/);
    assert.equal(count, 1);
  }
});

test("模型列表不存在时仍允许实际文生图", async (t) => {
  const { client } = await fixture(t, async (url) => String(url).endsWith("/models")
    ? Response.json({ error: { message: "未提供列表" } }, { status: 404 }) : imageResponse());
  const check = await client.callTool({ name: "check_endpoint", arguments: {} });
  assert.equal(diagnosticSchema.parse(check.structuredContent).modelsEndpoint, "unavailable");
  const generated = await client.callTool({ name: "generate_image", arguments: { prompt: "画画" } });
  assert.ok(!generated.isError);
});

test("response_format 为 url 时下载图片并正常落盘", async (t) => {
  let count = 0;
  const { client } = await fixture(t, async (url, init) => {
    const urlStr = String(url);
    if (urlStr.endsWith("/images/generations")) {
      count++;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.response_format, "url");
      return Response.json({ created: 1, data: [{ url: "https://example.test/image.png" }] });
    }
    if (urlStr === "https://example.test/image.png") {
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    }
    return new Response("", { status: 404 });
  }, { IMAGE_GEN_RESPONSE_FORMAT: "url" });
  const result = await client.callTool({ name: "generate_image", arguments: { prompt: "画画" } });
  assert.ok(!result.isError);
  const output = JSON.parse(JSON.stringify(result.structuredContent));
  assert.deepEqual(await readFile(output.images[0].path), png);
  assert.equal(count, 1);
});

test("自定义尺寸通过校验并传递给 API", async (t) => {
  let receivedSize = "";
  const { client } = await fixture(t, async (url, init) => {
    if (String(url).endsWith("/images/generations")) {
      receivedSize = JSON.parse(String(init?.body)).size;
      return imageResponse();
    }
    return new Response("", { status: 404 });
  });
  const result = await client.callTool({ name: "generate_image", arguments: { prompt: "画画", size: "3840x2160" } });
  assert.ok(!result.isError);
  assert.equal(receivedSize, "3840x2160");
});

test("非法尺寸在调用上游前被拒绝", async (t) => {
  let count = 0;
  const { client } = await fixture(t, async () => { count++; return imageResponse(); });
  const invalid = ["100x100", "1024x1025", "10000x10000", "abc", "1024"];
  for (const size of invalid) {
    const result = await client.callTool({ name: "generate_image", arguments: { prompt: "画画", size } });
    assert.equal(result.isError, true);
  }
  assert.equal(count, 0);
});

test("文生图传递 moderation 和 output_compression 参数", async (t) => {
  let request: Record<string, unknown> = {};
  const jpeg = await sharp(png).toFormat("jpeg").toBuffer();
  const { client } = await fixture(t, async (url, init) => {
    if (String(url).endsWith("/images/generations")) {
      request = JSON.parse(String(init?.body));
      return Response.json({ created: 1, data: [{ b64_json: jpeg.toString("base64") }] });
    }
    return new Response("", { status: 404 });
  });
  const result = await client.callTool({ name: "generate_image", arguments: {
    prompt: "画画", format: "jpeg", moderation: "low", output_compression: 80,
  } });
  assert.ok(!result.isError);
  assert.equal(request.moderation, "low");
  assert.equal(request.output_compression, 80);
});

test("编辑传递 input_fidelity 参数且不含 moderation", async (t) => {
  let form: FormData | null = null;
  const { client, directory } = await fixture(t, async (url, init) => {
    if (String(url).endsWith("/images/edits")) {
      form = await new Request("https://example.test", init).formData();
      return imageResponse();
    }
    return new Response("", { status: 404 });
  });
  const original = path.join(directory, "原图.png");
  await writeFile(original, png);
  const result = await client.callTool({ name: "edit_image", arguments: {
    prompt: "改画", images: [original], input_fidelity: "high",
  } });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(form!.get("input_fidelity"), "high");
  assert.equal(form!.get("moderation"), null);
});
