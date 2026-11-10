---
name: gpt-image-workflow
description: Guides an agent through creating, editing and iterating on images with the separately installed gpt-image-mcp MCP server (tools generate_image, edit_image, check_endpoint). Use when the user asks to generate an image from text, edit or restyle a local image, replace a background, make a masked local edit, create a new image from a style reference, or diagnose the image endpoint. Covers prerequisites, cost and privacy notes, source vs. style-reference images, iteration, and timeout handling. Requires the user's own MCP setup and an OpenAI-compatible image API key.
summary: Workflow skill for the gpt-image-mcp MCP server - text-to-image, image editing, style-reference creation and iteration, with cost, privacy and timeout safeguards. The MCP server and API key are set up separately by you.
version: 1.0.0
license: MIT
compatibility: Requires the gpt-image-mcp MCP server (Node.js 22+) configured in an MCP client that can run local stdio servers, plus an OpenAI or OpenAI-compatible API key with image-model access and quota. Image API calls are billed by your provider.
tags: [image-generation, image-editing, mcp, gpt-image, openai]
keywords: [gpt-image, generate_image, edit_image, check_endpoint, text-to-image, image-to-image, mask, style-reference]
use_cases: [Generate an illustration or logo concept from a text prompt, Replace the background of a local photo, Create a new image in the style of a reference image, Iterate on a generated image with targeted edits]
docs_url: https://github.com/zK0G0w/gpt-image-mcp
---

# GPT Image workflow

This skill tells you when and how to call the tools of the `gpt-image-mcp` MCP server: `generate_image`, `edit_image` and `check_endpoint`. It does not install or run the server, and it does not bring an API key. The user configures both.

## 1. Before the first call

1. **Find the tools.** Look for `generate_image`, `edit_image` and `check_endpoint` in your tool list. Clients may prefix the names (for example `mcp__image-gen__generate_image`); use the exact names you see.
2. **If the tools are missing**, stop and tell the user what is needed. Do not claim you installed anything, do not invent an alternative image API, and do not ask the user to paste an API key into the chat. Point them to [references/setup.md](references/setup.md) (also summarised in the project README: https://github.com/zK0G0w/gpt-image-mcp). In short, they need:
   - Node.js 22 or later on the machine that runs the MCP client.
   - An OpenAI or OpenAI-compatible API key that has access to the chosen image model and available quota. `OPENAI_API_KEY` is the only required setting; `OPENAI_BASE_URL` and `IMAGE_GEN_MODEL` are needed for non-default providers or models.
   - An MCP server entry (`npx -y gpt-image-mcp`) in their client, then a client restart or reload.
   - A client tool timeout of at least 360 seconds, because the server's own API timeout defaults to 300 seconds.
3. **State the cost and privacy facts once per session**, briefly, before the first real call:
   - Every `generate_image` and `edit_image` call can be billed by the user's API provider; higher `quality` and larger `size` usually cost more and take longer.
   - The prompt and any input images are sent to the provider the user configured.
   - Results are saved on the machine that runs the MCP server, and the tools return a local `path` and a `file://` `uri`. Neither is a web link, and the client may not display the image.

## 2. Choose the tool

| Situation | Tool |
| --- | --- |
| New image from a description, no input image | `generate_image` |
| Any task that starts from one or more local images: edit, change background, restyle, combine, or use as a style or composition reference | `edit_image` |
| First-time setup, or the user suspects an endpoint, key or base URL problem | `check_endpoint` (arguments `{}`) |

- `check_endpoint` only requests the provider's model list. It sends no image request. It always reports `generation` and `editing` as `unverified`, so a healthy result proves neither. Some providers have no model list or do not list alias models, so `unavailable` or `modelListed: false` does not mean images are unsupported. Do not run it before every image call.
- The only real test of image capability is an actual call. If the user wants a smoke test, propose one `generate_image` and one `edit_image` call with `quality: "low"` and a small `size`, and say these calls may be billed.
- Both image tools take **local files only**. If the user gives a URL, or an image that only exists in the chat, you need a local copy first. Ask for a local path, or save it yourself only if you can and the user agrees. Never pass a URL in `images` or `mask`.

## 3. Text-to-image (`generate_image`)

1. Ask only for what is missing and changes the result: subject, style or medium, composition and aspect, mood and colors, where the image will be used, and any text that must appear.
2. Write one self-contained prompt (1 to 32000 characters): subject and setting, style or medium, composition or camera angle, lighting and palette, and explicit exclusions. If the image must contain text, quote the exact words, and check the result because rendered text can be wrong.
3. Choose parameters. Leave a parameter out to take the default:

| Parameter | Guidance |
| --- | --- |
| `size` | `auto` (default), or `WIDTHxHEIGHT` such as `1024x1024`, `1536x1024`, `1024x1536`, `3840x2160`. Width and height must be multiples of 16, the aspect ratio at most 3:1, and total pixels between 655360 and 8294400. The server may have a different default through `IMAGE_GEN_DEFAULT_SIZE`. |
| `quality` | `auto` (default), `low`, `medium`, `high`, `xhigh`, `max`. Use `low` or `medium` for drafts and raise it only for the final version. The server may default differently through `IMAGE_GEN_DEFAULT_QUALITY`. |
| `format` | `png` (default), `jpeg`, `webp`. |
| `background` | `auto` (default), `transparent`, `opaque`. `transparent` needs `png` or `webp`. |
| `output_compression` | Integer 0 to 100; only for `jpeg` and `webp`. |
| `moderation` | `auto` (default) or `low`. Leave it as `auto` unless the user explicitly asks to change it. |

4. Make **one call**. Each call produces exactly one image. Do not fire several calls in a row or in parallel to "get options" unless the user asked for that and accepted the cost.
5. Report the result (see section 6).

## 4. Editing and reference-based creation (`edit_image`)

**Source image vs. style reference.** `images` is an ordered list of 1 to 16 local files, and the prompt refers to them as "image 1", "image 2" in that order. The server does not know which one is the subject and which one is only a reference; the prompt must say so. Put the image to be edited first, because a `mask` applies to the first image. Spell out each role and what must stay unchanged, for example:

> Image 1 is the photo to edit: keep the person, pose and composition exactly as they are. Image 2 is a style reference only: take its color palette and brush strokes, and do not copy its subject. Change the background to a rainy night street.

Rules for the inputs:

- Paths must be absolute local paths or start with `~/`; relative paths are rejected.
- PNG, JPEG and WebP only, detected from the file content rather than the extension. Each file must be under 50 MiB and all input images together at most 100 MiB.
- Before sending, confirm with the user that the images may be sent to their provider if they look private or sensitive (IDs, documents, photos of other people).
- The server never modifies or overwrites an input file. The result is always a new file, so tell the user if the original is untouched and a new path was created. Do not move or replace the original unless asked.

Optional parameters (besides the common ones in section 3; `moderation` does not exist for editing):

| Parameter | Guidance |
| --- | --- |
| `input_fidelity` | `high` to keep the original subject and details as closely as possible, `low` to allow more change. Omit it by default. Some providers or models may reject it; if the error points at this parameter, tell the user and retry without it. |
| `mask` | Local path of a PNG with an alpha channel and the same width and height as the first image. Fully transparent areas mark what should be edited. It guides the model; the edge is not pixel-exact. This server cannot create masks, so use one the user supplies or one you can make with your own tools, and say which. |

Invalid inputs (relative path, unreadable file, unsupported format, wrong mask size) are rejected before any API request is made, so fixing them costs nothing.

## 5. Iterating

- Every iteration is a new paid call that creates a new file. Keep a short list of the paths produced in the session and label them (v1, v2, ...), so the user can pick a version.
- To tweak a result that is mostly right, call `edit_image` with the previous result's `path` as image 1 and one narrow instruction ("same image, change only the sky to sunset"). Change one thing at a time and say what to keep.
- If the composition itself is wrong, revise the prompt and call `generate_image` again instead of stacking edits.
- To keep a consistent style across images, pass an earlier result you both like as a style reference (image 2) and describe its role.
- Raise `quality` or `size` only for the version the user has approved.
- After each result, show it and ask what to change. Do not loop on your own to "improve" an image. Do not delete earlier outputs unless asked.

## 6. Reporting results

On success the tool returns `images[0]` with `path`, `uri`, `mimeType`, `bytes`, `width`, `height`, plus `model`. Report:

- the `path` (and `uri` if useful), size in pixels, format and the model used;
- the settings you chose (`size`, `quality`, `format`) and, for edits, which image played which role;
- whether you looked at the image. If you can open local image files, inspect the result and say what you saw. If you cannot, say that you could not view it and that the user should open the file. Never describe an image you have not seen, and never invent a URL.

If the MCP server runs on another machine or in a sandbox, the path may not exist on the user's computer; say so rather than assuming it can be opened.

## 7. Failures

| What you see | What to do |
| --- | --- |
| Tools missing, or the server does not start (for example a missing `OPENAI_API_KEY`) | Section 1: explain the prerequisites and the setup guide. Do not claim to fix it yourself. |
| "The image API call failed (status: ..., code: ...)" | The message deliberately omits the provider's raw text. 401 or 403: check the key and model access. 404: check `OPENAI_BASE_URL` and the model name. 429: rate limit or quota. 400 with an unknown-parameter code: the provider rejects an optional parameter; drop it (and, if `IMAGE_GEN_RESPONSE_FORMAT=url` is set, suggest the default `b64_json`). Tell the user before retrying. |
| "timed out", "request was cancelled", or "Unable to reach the image API" during an image call (a dropped connection) | The upstream request may still be running or may already be billed. **Do not retry automatically.** Tell the user, suggest checking their provider's usage page, and retry only after they agree, preferably with lower `quality` or `size`. If it keeps failing, `check_endpoint` can help locate a network or base URL problem. |
| "generated but could not be saved" | The image was produced and billed but not stored. Calling again generates and bills again. Ask the user to fix the output directory (`IMAGE_GEN_OUTPUT_DIR`) permissions or disk space first. |
| "returned no image data" | The configured model may not support image generation; check `IMAGE_GEN_MODEL`. |
| Input errors (absolute path, unreadable file, format, mask size, size limits) | Fix the input and call again; nothing was sent. |

The server disables automatic retries on purpose to avoid duplicate charges. Follow the same rule.

## 8. Boundaries

- Never ask for, print or store the user's API key, and do not read configuration files only to look for it.
- The user is responsible for having the rights to the input images and for how the outputs are used. Do not use this to imitate a real person's identity or to produce content the provider's policy forbids.
- Do not promise results that the tool schema does not support: one image per call, no URL inputs, no batch mode, and no guaranteed pixel-exact masks.
