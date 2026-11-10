[中文](https://github.com/zK0G0w/gpt-image-mcp/blob/main/README-zh.md) | **English**

# gpt-image-mcp

A local `stdio` MCP server written in TypeScript. It calls GPT Image for text-to-image generation, image editing and reference-style creation. Images are saved on your machine, and the server returns absolute paths and file URIs.

## Install and configure

Requires Node.js 22 or later, and an API key for OpenAI or a compatible provider that has access to the chosen model and available quota. Linux, macOS and Windows are supported. No manual install is needed; `npx` downloads and runs it.

MCP configuration (works with Claude Code, Claude Desktop, Cursor and other MCP clients):

```json
{
  "mcpServers": {
    "image-gen": {
      "command": "npx",
      "args": ["-y", "gpt-image-mcp"],
      "env": {
        "OPENAI_API_KEY": "your API key",
        "OPENAI_BASE_URL": "https://your-provider/v1",
        "IMAGE_GEN_MODEL": "image model name from your provider",
        "IMAGE_GEN_OUTPUT_DIR": "~/pictures"
      }
    }
  }
}
```

Only `OPENAI_API_KEY` is required; the rest is optional. See [Configuration](#configuration) below.

The first start downloads dependencies; later starts use the cache. Set the client's tool execution timeout to at least 360 seconds; the server's own API timeout defaults to 300 seconds.

## Companion Skill

The repository also ships an agent skill, [`skills/gpt-image-workflow`](https://github.com/zK0G0w/gpt-image-mcp/tree/main/skills/gpt-image-workflow), that teaches an agent when and how to use these tools (prompting, source vs. style-reference images, iteration, cost and timeout handling). The skill does not install or run this MCP server; you still configure the server and your API key yourself. It is released under the same MIT license as this repository. The skill is not part of the npm package; get it from the GitHub repository.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | OpenAI API key, injected through the client's environment variables |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | The official endpoint is used when unset or empty. A bare domain gets `/v1` appended; an existing path is kept as is |
| `IMAGE_GEN_MODEL` | `gpt-image-2.5-sunburst` | Model shared by generation and editing. Provider model aliases are allowed; your account must have access |
| `IMAGE_GEN_OUTPUT_DIR` | `gpt-image-mcp/images` under the user's home directory | Output root, an absolute local path or `~/`. `yyyy/MM/dd` subdirectories are created by local date |
| `IMAGE_GEN_TIMEOUT_MS` | `300000` | API request timeout in milliseconds; an integer of at least 1000 |
| `IMAGE_GEN_RESPONSE_FORMAT` | `b64_json` | How the API returns images: `b64_json` (Base64 data) or `url` (a download link that the server fetches and saves). With the default `b64_json` the parameter is not sent to the API; it is only sent explicitly when set to `url`. Some proxies do not support it for newer models (such as `gpt-image-2.5-sunburst`); if you see an `unknown_parameter` error, keep the default |
| `IMAGE_GEN_DEFAULT_SIZE` | `auto` | Global default size as `WIDTHxHEIGHT` (for example `1024x1024`). Unset or empty means `auto`, and the API decides. Width and height must be multiples of 16, the aspect ratio at most 3:1, and total pixels between 655360 and 8294400. A single call can still override it with `size` |
| `IMAGE_GEN_DEFAULT_QUALITY` | `auto` | Global default quality: `auto`, `low`, `medium`, `high`, `xhigh` or `max`. Unset or empty means `auto`, and the API decides. A single call can still override it with `quality` |

`OPENAI_BASE_URL` takes the API base URL; unset, empty or whitespace-only values use the official endpoint. `/v1` is appended only when the address has no path; an existing path is kept as configured so proxy prefixes and other versions are not broken. Trailing slashes are removed and `/v1` is never appended twice.

| You enter | API base URL actually used |
| --- | --- |
| (unset) | `https://api.openai.com/v1` |
| `https://gateway.example` | `https://gateway.example/v1` |
| `https://gateway.example/` | `https://gateway.example/v1` |
| `https://gateway.example/v1/` | `https://gateway.example/v1` |
| `https://gateway.example/proxy/v1/` | `https://gateway.example/proxy/v1` |
| `https://gateway.example/proxy/` | `https://gateway.example/proxy` |

The server appends `/images/generations`, `/images/edits` or `/models` to the base URL, so do not enter a full image endpoint URL. If a custom path needs `/v1`, write it explicitly, for example `/proxy/v1`. HTTP and HTTPS are supported; a local proxy can use `http://localhost:8080`, and HTTPS is recommended for remote endpoints. The address must not contain credentials, a query string or a URL fragment.

Your key, prompts and input images are sent to the provider you configure. The server does not follow HTTP redirects, so enter the final API base URL directly.

A compatible provider must support the OpenAI Image API's JSON generation, multipart image editing, and the `data[].b64_json` or `data[].url` response shape. The server detects both response formats automatically. Some proxies do not support the `response_format` parameter for newer models; keeping the default `IMAGE_GEN_RESPONSE_FORMAT` works around that. Providers that only offer a chat interface or asynchronous task IDs are not supported.

## Endpoint check and real capability verification

On startup the server only validates local configuration; it never probes the network or generates test images. To check the endpoint, call `check_endpoint` from your MCP client with `{}`, or run this after setting the environment variables:

```sh
gpt-image-mcp --check
```

The check waits at most 30 seconds, never retries, and only requests `GET /models`; it does not call the image generation or editing endpoints. Result fields:

| Field | Meaning |
| --- | --- |
| `configuration` | `valid` means the local configuration is well-formed; it does not mean the key is authorized |
| `modelsEndpoint` | `available`: the model list response has the expected shape; `unavailable`: the request failed; `unexpected_response`: the response is not a model list |
| `modelListed` | Whether the configured model appears in the returned list; `null` when it cannot be determined |
| `generation` / `editing` | Always `unverified`; a successful model list is never treated as proof of image capability |
| `httpStatus` / `message` | HTTP status and an explanation; the key and raw upstream error messages are never echoed |

Some image services do not offer `/models` or do not list alias models, so a failed check or an unlisted model does not rule out image generation. The CLI exits with 0 when the model list is healthy and 1 otherwise; the exit code does not mean image capabilities passed or failed.

Real compatibility verification means running `generate_image` and `edit_image` once each and checking that the image is returned and saved. These calls may be billed, so start with `quality: "low"`. A passing generation does not replace testing the edit endpoint, and does not guarantee that every parameter combination is supported by the provider.

## File naming and paths

Images are saved as `output-root/yyyy/MM/dd/file-name`. The date is the local time of your computer at save time, with the month and day zero-padded; UTC dates are not used. Saving after midnight goes into a new directory automatically.

File names come from a built-in playful word list: "adjective + animal + action + wonder + random suffix". No language model is called to name files:

```text
cozy-otter-paints-moonlight-7d3a9b2c.png
sassy-capybara-juggles-marshmallows-c8e2a104.webp
dreamy-axolotl-brews-stardust-f0914abc.jpg
```

Default path examples:

```text
Linux:   /home/<user>/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png
macOS:   /Users/<user>/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png
Windows: C:\Users\<user>\gpt-image-mcp\images\2026\09\10\cozy-otter-paints-moonlight-7d3a9b2c.png
```

The output root stays fixed and images are archived by date. File names use only lowercase ASCII letters, hyphens and a random suffix, which avoids reserved characters and case collisions. Files are always created exclusively, so a name collision picks a new name and an existing image is never overwritten. Directories containing non-ASCII characters or spaces are supported; `uri` uses standard URL encoding. Images produced by older versions stay where they are and are not migrated.

In the result, `path` is a local path and `uri` is a `file://` URI; neither is a public download URL. The calling client must be able to access the file system of the machine running the server, and whether the image is displayed inline depends on the client. For image-to-image, use the `path` returned by a previous call directly.

## Tools

### `generate_image`

```json
{
  "prompt": "An otter painting under the moonlight, warm hand-drawn illustration, soft brush strokes",
  "size": "1024x1024",
  "quality": "medium",
  "format": "png"
}
```

### `edit_image`

```json
{
  "prompt": "Keep the subject and composition of image 1, take the palette and brush strokes from image 2, and change the background to a rainy night street",
  "images": ["/absolute/path/original.png", "/absolute/path/style-reference.webp"],
  "quality": "high"
}
```

For local edits, add `mask` with the local path of a mask. The mask must be a PNG with an alpha channel and the same dimensions as the first source image; fully transparent areas mark the parts you want edited. The mask is guidance for the model and does not guarantee pixel-exact boundaries.

| Parameter | Default and range |
| --- | --- |
| `prompt` | Required, 1 to 32000 characters after trimming whitespace |
| `size` | Default `auto`, or `WIDTHxHEIGHT` (for example `1024x1024`, `1536x1024`, `3840x2160`). Width and height must be multiples of 16, the aspect ratio at most 3:1, and total pixels between 655360 and 8294400 |
| `quality` | Default `auto`, or `low`, `medium`, `high`, `xhigh`, `max` |
| `format` | Default `png`, or `jpeg`, `webp` |
| `background` | Default `auto`, or `transparent`, `opaque`; transparent requires `png` or `webp` |
| `moderation` | Generation only. Default `auto`, or `low`; content moderation level |
| `output_compression` | Optional integer 0 to 100; only applies to `jpeg` and `webp` |
| `input_fidelity` | Editing only. Optional `high` or `low`; how closely details of the source images are preserved |
| `images` | Required for editing: 1 to 16 local PNG, JPEG or WebP files; each under 50 MiB, at most 100 MiB in total |
| `mask` | Optional for editing: local PNG mask path; under 50 MiB |

Input image paths must be absolute local paths or start with `~/`. Each call produces one new image and never modifies the input files.

On success the result carries both MCP text and `structuredContent` with identical content:

```json
{
  "images": [{
    "path": "/Users/<user>/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png",
    "uri": "file:///Users/<user>/gpt-image-mcp/images/2026/09/10/cozy-otter-paints-moonlight-7d3a9b2c.png",
    "mimeType": "image/png",
    "bytes": 123456,
    "width": 1024,
    "height": 1024
  }],
  "model": "gpt-image-2.5-sunburst"
}
```

Failures return `isError: true` with an explanation. Automatic retries are disabled. A timeout or disconnect does not mean the upstream did not run the request, and calling again may be billed again. If generation succeeds but saving locally fails, this is reported explicitly and the generation endpoint is not called again. Client cancellation is passed on to the API request, but it cannot guarantee that billing for work already started upstream is cancelled.

For real acceptance testing, run one text-to-image and one image-to-image call with `quality: "low"` to confirm model access, network, image results and how your client displays them.

## License

[MIT](LICENSE)
