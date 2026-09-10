# gpt-image-mcp 开发规范

## 项目概述

基于 TypeScript 的本地 stdio MCP 服务，调用 OpenAI GPT Image API 完成文生图、图片编辑和参考风格创作。图片保存在本机，通过绝对路径和 file URI 返回。

## 技术栈

- 运行时：Node.js >= 22，ES Modules
- 语言：TypeScript（严格模式）
- MCP SDK：`@modelcontextprotocol/server`
- API 客户端：`openai` SDK
- 图片处理：`sharp`
- 参数校验：`zod`
- 测试：Node.js 内置 `node:test`，无外部测试框架

## 目录结构

```
src/
  index.ts       CLI 入口（--help / --check / MCP 模式）
  server.ts      MCP 服务与工具注册
  images.ts      Schema 定义、ImageService（生成/编辑/落盘）
  config.ts      环境变量读取与校验
  client.ts      OpenAI API 客户端创建
  input.ts       本地图片读取与格式校验
  storage.ts     图片保存（日期目录 + 俏皮文件名）
  diagnostics.ts 端点检查逻辑
test/
  service.test.ts  核心功能测试（通过模拟 HTTP 响应，不需要真实 API 密钥）
  stdio.test.ts    子进程 stdio 集成测试
scripts/
  verify-package.mjs  打包安装验证（白名单、CLI 入口、MCP 握手）
```

## 开发命令

```sh
npm run typecheck      # 类型检查
npm test               # 运行测试
npm run build          # 编译 TypeScript
npm run check          # typecheck + test + build（一步到位）
npm run test:package   # 打包安装验证
npm run dev            # 通过 tsx 直接运行源码
```

## Git 规范

- Commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
- 格式：`type(scope): 中文描述`
- 常用 type：`feat`、`fix`、`refactor`、`ci`、`docs`、`test`、`chore`、`perf`
- 签名行：`WainZeng`
- 禁止 `git add -A` 或 `git add .`，逐个指定文件

## 编码约定

- 所有面向用户的输出使用中文（代码标识符和技术术语保留英文）
- MCP 工具输入通过 Zod schema 校验，schema 即文档
- API 调用不自动重试（`maxRetries: 0`），避免重复计费
- 错误信息不回显上游原始消息，防止凭证泄漏
- `stdout` 专用于 MCP 协议，日志和错误只写 `stderr`
- 图片保存使用独占创建（`wx` flag），不覆盖已有文件

## 测试约定

- 测试通过模拟 `globalThis.fetch` 拦截 HTTP 请求，不需要真实 API 密钥
- `fixture()` 函数创建隔离的临时目录和完整的 MCP 客户端/服务端
- 每个测试验证 API 调用次数，确保无重试和无多余请求
- 新增参数必须有对应的传递验证测试

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | 必填 | API 密钥 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API 根地址 |
| `IMAGE_GEN_MODEL` | `gpt-image-2.5-sunburst` | 图片模型名 |
| `IMAGE_GEN_OUTPUT_DIR` | `~/gpt-image-mcp/images` | 输出根目录 |
| `IMAGE_GEN_TIMEOUT_MS` | `300000` | 请求超时（毫秒） |
| `IMAGE_GEN_RESPONSE_FORMAT` | `b64_json` | 返回方式：`b64_json` 或 `url` |
| `IMAGE_GEN_DEFAULT_SIZE` | `auto` | 全局默认分辨率，如 `1024x1024` |
| `IMAGE_GEN_DEFAULT_QUALITY` | `auto` | 全局默认质量：`low`/`medium`/`high`/`xhigh`/`max` |

## CI/CD

- GitHub Actions：push to main 跑全矩阵（Linux×2 + Windows×2 + macOS×1），PR 仅 Linux
- 推送 `v*` tag 自动发布到 npm（需配置 `NPM_TOKEN` secret）
- 每次 CI 运行 `npm audit --omit=dev` 检查依赖安全
