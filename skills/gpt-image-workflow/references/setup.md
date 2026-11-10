# Setting up gpt-image-mcp

The `gpt-image-workflow` skill only guides an agent. The MCP server it drives is a separate npm package that runs on the user's own machine. Nothing here is installed or configured automatically, and the skill never needs the API key.

Project: https://github.com/zK0G0w/gpt-image-mcp (README: configuration, tools, troubleshooting)

## Prerequisites

- Node.js 22 or later (Linux, macOS or Windows).
- An MCP client that can run local `stdio` servers and lets the user set environment variables for them.
- An API key for OpenAI or an OpenAI-compatible provider that has access to the chosen image model and available quota. The provider bills image calls to the key's owner.
- A provider that supports the OpenAI Image API: JSON image generation, multipart image editing, and `data[].b64_json` or `data[].url` in the response. Providers that only offer chat completions or asynchronous task IDs are not supported.

## MCP server entry

Add this to the client's MCP server configuration. Each client keeps it in its own place (a JSON file, a settings screen or a CLI command); see the client's MCP documentation. The standard `mcpServers` block is:

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

The user types their own key into the client's configuration. Restart or reload the client afterwards. The first start downloads dependencies through `npx`. Set the client's tool execution timeout to at least 360 seconds.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | The only required setting. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL, not a full endpoint. A bare domain gets `/v1`; an existing path is kept. No credentials, query string or fragment. Redirects are not followed. |
| `IMAGE_GEN_MODEL` | `gpt-image-2.5-sunburst` | Shared by generation and editing; the account needs access. Provider aliases are allowed. |
| `IMAGE_GEN_OUTPUT_DIR` | `~/gpt-image-mcp/images` | Absolute path or `~/`; images go into `yyyy/MM/dd` subfolders. |
| `IMAGE_GEN_TIMEOUT_MS` | `300000` | Integer of at least 1000. |
| `IMAGE_GEN_RESPONSE_FORMAT` | `b64_json` | `b64_json` or `url`. Keep the default unless the provider returns download links; some proxies reject the parameter. |
| `IMAGE_GEN_DEFAULT_SIZE` | `auto` | `WIDTHxHEIGHT`, for example `1024x1024`. A call can override it. |
| `IMAGE_GEN_DEFAULT_QUALITY` | `auto` | `auto`, `low`, `medium`, `high`, `xhigh` or `max`. A call can override it. |

## Verifying the setup

1. Ask the agent to call `check_endpoint`, or run `gpt-image-mcp --check` in a terminal with the same environment variables. It only requests the model list and always reports image generation and editing as `unverified`.
2. To confirm that images really work, run one `generate_image` and one `edit_image` call with `quality: "low"`. These calls may be billed.
3. Check that the returned `path` exists on the machine that runs the server.
