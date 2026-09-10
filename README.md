# gpt-image-mcp

基于 TypeScript 的本地 `stdio` MCP 服务，调用 GPT Image 完成文生图、图片编辑和参考风格创作，图片保存在本机，返回绝对路径及文件 URI。

## 安装与配置

需要 Node.js 22 或更高版本，以及具有所选模型调用权限和可用额度的 OpenAI 或兼容服务商 API 密钥。支持 Linux、macOS 和 Windows。无需手动安装，通过 `npx` 自动下载运行。

MCP 配置（适用于 Claude Code、Claude Desktop、Cursor 等支持 MCP 的客户端）：

```json
{
  "mcpServers": {
    "image-gen": {
      "command": "npx",
      "args": ["-y", "gpt-image-mcp"],
      "env": {
        "OPENAI_API_KEY": "你的 API 密钥",
        "OPENAI_BASE_URL": "https://你的服务商/v1",
        "IMAGE_GEN_MODEL": "服务商提供的图片模型名称",
        "IMAGE_GEN_OUTPUT_DIR": "~/pictures"
      }
    }
  }
}
```

仅 `OPENAI_API_KEY` 必填，其余按需配置。详见下方[配置](#配置)章节。

首次启动会自动下载依赖，之后使用缓存。工具执行超时建议设为至少 360 秒；服务自身的 API 超时默认为 300 秒。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 必填 | OpenAI API 密钥，通过客户端环境变量注入 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 未填写或留空时使用官方端点；仅填写域名时自动补 `/v1`，已有路径保留 |
| `IMAGE_GEN_MODEL` | `gpt-image-2.5-sunburst` | 文生图和编辑共用的模型，允许兼容服务商的模型别名，需账号有权限 |
| `IMAGE_GEN_OUTPUT_DIR` | 用户主目录下的 `gpt-image-mcp/images` | 输出根目录，支持本机绝对路径或 `~/`；自动按本地日期创建 `yyyy/MM/dd` 子目录 |
| `IMAGE_GEN_TIMEOUT_MS` | `300000` | API 请求超时，单位毫秒，必须为不小于 1000 的整数 |
| `IMAGE_GEN_RESPONSE_FORMAT` | `b64_json` | API 返回图片的方式：`b64_json`（返回 Base64 数据）或 `url`（返回下载地址，服务自动下载保存）。默认 `b64_json` 时不向 API 发送此参数，仅配置 `url` 时才显式发送。部分代理对新模型（如 `gpt-image-2.5-sunburst`）可能不支持此参数，遇到 `unknown_parameter` 错误时请保持默认值 |
| `IMAGE_GEN_DEFAULT_SIZE` | `auto` | 全局默认分辨率，格式为 `WIDTHxHEIGHT`（如 `1024x1024`）。不填或留空时使用 `auto`，由 API 自行决定。宽高需为 16 的倍数，比例不超过 3:1，总像素 655360~8294400。单次调用仍可通过 `size` 参数覆盖 |
| `IMAGE_GEN_DEFAULT_QUALITY` | `auto` | 全局默认质量：`auto`、`low`、`medium`、`high`、`xhigh`、`max`。不填或留空时使用 `auto`，由 API 自行决定。单次调用仍可通过 `quality` 参数覆盖 |

`OPENAI_BASE_URL` 填写 API 根地址；未配置、空字符串或纯空格均使用官方端点。只有地址不包含路径时自动补 `/v1`，已有路径则按用户配置保留，避免破坏代理前缀或其他版本。尾部斜杠会去除，不会重复追加 `/v1`。

| 用户填写 | 实际使用的 API 根地址 |
| --- | --- |
| 不填 | `https://api.openai.com/v1` |
| `https://gateway.example` | `https://gateway.example/v1` |
| `https://gateway.example/` | `https://gateway.example/v1` |
| `https://gateway.example/v1/` | `https://gateway.example/v1` |
| `https://gateway.example/proxy/v1/` | `https://gateway.example/proxy/v1` |
| `https://gateway.example/proxy/` | `https://gateway.example/proxy` |

服务在根地址后追加 `/images/generations`、`/images/edits` 或 `/models`，不要填写完整生图接口地址。自定义路径如果需要 `/v1`，请明确填成 `/proxy/v1`。支持 HTTP 和 HTTPS，本地代理可用 `http://localhost:8080`；远程端点建议使用 HTTPS。地址不能包含账号密码、查询参数或 URL 片段。

Key、提示词和输入图片会发送到你配置的服务商。服务不会跟随 HTTP 重定向，请直接填写最终 API 根地址。

兼容服务商必须支持 OpenAI Image API 的 JSON 文生图、multipart 图片编辑，以及 `data[].b64_json` 或 `data[].url` 返回结构。服务会自动识别两种返回格式并正确处理。部分代理对新模型不支持 `response_format` 参数，保持 `IMAGE_GEN_RESPONSE_FORMAT` 默认值即可正常使用。仅兼容聊天接口或异步任务 ID 的服务不在当前兼容范围内。

## 端点检查与实际能力验证

服务启动时只校验本地配置，不自动联网探测或生成测试图片。需要检查时，在 MCP 客户端调用 `check_endpoint`，参数为 `{}`；也可以在配置好环境变量后运行：

```sh
gpt-image-mcp --check
```

诊断最多等待 30 秒，不自动重试，只请求 `GET /models`，不会调用图片生成或编辑接口。结果说明：

| 字段 | 含义 |
| --- | --- |
| `configuration` | `valid` 表示本地配置格式合法，不代表密钥已获授权 |
| `modelsEndpoint` | `available` 表示模型列表响应结构正确；`unavailable` 表示请求失败；`unexpected_response` 表示返回内容不符合列表结构 |
| `modelListed` | 当前模型是否出现在本次返回的列表中，无法确定时为 `null` |
| `generation` / `editing` | 本项检查始终返回 `unverified`，不会将模型列表成功当成图片能力证明 |
| `httpStatus` / `message` | HTTP 状态码和说明，不回显密钥或上游原始错误消息 |

有些图片服务不提供 `/models`，或不会列出别名模型，所以检查失败和模型未列出都不会禁止生图。CLI 在模型列表正常时退出码为 0，其余情况为 1；退出码不代表图片能力通过或失败。

真正的兼容性验证需要分别执行一次 `generate_image` 和 `edit_image`，检查图片返回和落盘是否成功。这些调用可能计费，建议先使用 `quality: "low"`。文生图通过不能替代编辑接口测试，也不能保证所有参数组合均被服务商支持。

## 文件命名与路径

图片按 `输出根目录/yyyy/MM/dd/文件名` 保存，年月日取自实际保存时用户电脑的本地时间，月份和日期补齐两位，不采用 UTC 日期。跨天保存自动进入新目录。

文件名使用自建俏皮词表，组合“形容词 + 小动物 + 动作 + 奇妙事物 + 随机短码”，不额外调用语言模型取名：

```text
cozy-otter-paints-moonlight-7d3a9b2c.png
sassy-capybara-juggles-marshmallows-c8e2a104.webp
dreamy-axolotl-brews-stardust-f0914abc.jpg
```

默认路径示例：

```text
Linux:   /home/用户名/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png
macOS:   /Users/用户名/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png
Windows: C:\Users\用户名\gpt-image-mcp\images\2026\09\10\cozy-otter-paints-moonlight-7d3a9b2c.png
```

输出根目录保持固定，按日期归档；图片文件名使用 ASCII 小写字母、连字符和随机短码，避免系统保留字符与大小写差异。每次使用独占方式创建文件，名称碰撞会重新取名，绝不覆盖已有图片。支持中文和空格目录；`uri` 使用标准 URL 编码。旧版本生成的图片保留原位，不会自动迁移。

结果中的 `path` 是本机路径，`uri` 是 `file://` URI，均不是公网下载地址。调用客户端必须能访问服务所在机器的文件系统；是否内联显示图片取决于客户端。图生图可以直接使用上一次返回的 `path`。

## 工具

### `generate_image`

```json
{
  "prompt": "一只水獭在月光下画画，暖色手绘插画，柔和笔触",
  "size": "1024x1024",
  "quality": "medium",
  "format": "png"
}
```

### `edit_image`

```json
{
  "prompt": "保留图一主体和构图，参考图二的配色与笔触，将背景改为雨夜街道",
  "images": ["/绝对路径/原图.png", "/绝对路径/风格参考.webp"],
  "quality": "high"
}
```

局部编辑可增加 `mask`，填写本机遮罩路径。遮罩必须是含透明通道的 PNG，尺寸与第一张原图一致；完全透明区域表示希望编辑的部分。遮罩是模型的编辑指引，不保证像素级边界精确。

| 参数 | 默认值与范围 |
| --- | --- |
| `prompt` | 必填，去除首尾空白后 1～32000 字符 |
| `size` | 默认 `auto`，也可选 `WIDTHxHEIGHT`（如 `1024x1024`、`1536x1024`、`3840x2160`）。宽高需为 16 的倍数，比例不超过 3:1，总像素 655360～8294400 |
| `quality` | 默认 `auto`，也可选 `low`、`medium`、`high`、`xhigh`、`max` |
| `format` | 默认 `png`，也可选 `jpeg`、`webp` |
| `background` | 默认 `auto`，也可选 `transparent`、`opaque`；透明背景需配合 `png` 或 `webp` 格式 |
| `moderation` | 仅文生图，默认 `auto`，也可选 `low`；内容安全审核级别 |
| `output_compression` | 可选 0～100 整数，仅 `jpeg` 和 `webp` 格式生效 |
| `input_fidelity` | 仅编辑，可选 `high` 或 `low`；控制对原图细节的保留程度 |
| `images` | 编辑必填，1～16 张本机 PNG、JPEG 或 WebP；单图小于 50 MiB，参考图合计不超过 100 MiB |
| `mask` | 编辑可选，本机 PNG 遮罩路径；单文件小于 50 MiB |

输入图片路径必须为本机绝对路径或以 `~/` 开头。每次生成一张新图片，不修改输入文件。

成功时同时返回 MCP 文本和 `structuredContent`，内容一致：

```json
{
  "images": [{
    "path": "/Users/用户名/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png",
    "uri": "file:///Users/%E7%94%A8%E6%88%B7%E5%90%8D/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png",
    "mimeType": "image/png",
    "bytes": 123456,
    "width": 1024,
    "height": 1024
  }],
  "model": "gpt-image-2.5-sunburst"
}
```

失败返回 `isError: true` 和错误说明。服务关闭自动重试；超时或断线不代表上游没有执行，重新调用可能再次计费。图片生成成功但本地保存失败时会明确提示，不会重新调用生成接口。客户端取消会传递给 API 请求，但无法保证取消上游已开始的计费。

真实验收建议用 `quality: "low"` 各执行一次文生图和图生图，确认账号模型权限、网络、图片效果与客户端展示行为。
