# Agensi listing draft: GPT Image Workflow (free)

Draft copy for the Agensi submission form (https://www.agensi.io/dashboard/submit). Field limits come from https://www.agensi.io/docs/submit-on-the-website (checked 2026/11/10). This file is not part of the ZIP and not part of the npm package.

## ZIP

`gpt-image-workflow-1.0.0.zip`, built from `skills/gpt-image-workflow/` (see "Packaging" at the end). Contents: `SKILL.md` and `references/setup.md`. The license is declared in the `SKILL.md` frontmatter (`license: MIT`); the full text is the repository's `LICENSE`.

## Name (max 60 characters, must be unique on Agensi)

GPT Image Workflow for gpt-image-mcp

## Summary (max 300 characters)

Workflow skill for the gpt-image-mcp MCP server: text-to-image, image editing, style-reference creation and iteration, with cost, privacy and timeout safeguards. You set up the MCP server and your own API key separately; image API charges are billed by your provider.

## Description (Markdown)

**What it does**

This skill teaches your agent how to get real work done with the open-source [gpt-image-mcp](https://github.com/zK0G0w/gpt-image-mcp) MCP server (`generate_image`, `edit_image`, `check_endpoint`):

- Picks the right tool: text-to-image, editing or style-reference creation from local images, or an endpoint check.
- Separates the **source image** from **style references**, and writes prompts that say which image is which and what must stay unchanged.
- Chooses sensible `size`, `quality`, `format` and `background` values, and drafts at low quality before the final render.
- Handles masks for local edits and iterates on earlier results without overwriting them.
- Warns before the first call about cost and privacy, and reports the saved file path, size and settings afterwards.
- Handles timeouts and dropped connections safely: no automatic retries, because the provider may still be processing and a retry may be billed again.

**How it works**

The skill is plain instructions (`SKILL.md` plus one setup reference). It contains no scripts and no executables. Your agent calls the MCP tools you have configured; the skill decides when and how.

**Where it stops**

- It does **not** include or install the MCP server, and Agensi does not host it. You configure `npx -y gpt-image-mcp` in your own MCP client (setup guide included).
- You need your own API key for OpenAI or an OpenAI-compatible provider, with access to an image model and available quota. **Image API charges are billed to you by your provider.**
- Prompts and input images are sent to the provider you configure.
- Results are saved as files on the machine that runs the MCP server (local path and `file://` URI). Your client may not display them inline.
- `check_endpoint` only checks the provider's model list. It cannot prove that generation or editing works.
- Inputs must be local PNG, JPEG or WebP files; URLs are not accepted. One image per call.

**License**

Released under the MIT license, the same license as the gpt-image-mcp repository (full text: https://github.com/zK0G0w/gpt-image-mcp/blob/main/LICENSE).

## See it in action

Condensed from a real run (Claude Code, `gpt-image-mcp` 0.3.0, `quality: "low"`, `size: "1024x1024"`; the agent was given the skill text directly rather than through Agensi delivery).

> **User:** Make a cozy illustration of an otter painting under the moonlight. Then put the same scene on a rainy night city street.
>
> **Agent:** Before I start: each image call is billed by your configured API provider, and your prompt (and later the input image) is sent to that provider. Results are saved on this machine. I'll draft at low quality first.
>
> *Calls `generate_image` with a single self-contained prompt (subject, flat hand-drawn style, soft brush strokes, moonlight, "no text"), `size: "1024x1024"`, `quality: "low"`, `format: "png"`.*
>
> **Agent:** Saved `<output-dir>/2026/11/10/wobbly-capybara-juggles-marshmallows-ce473144.png` (1024x1024, PNG, ~1.7 MB, model `gpt-image-2.5-sunburst`). I opened the file: an otter paints at an easel by a moonlit lake, with a lantern and a sleeping second otter. Shall I continue with the street background?
>
> **User:** Yes.
>
> *Calls `edit_image` with `images: [<previous path>]` and the prompt "Image 1 is the picture to edit: keep the otter, the easel, the lantern and the overall composition exactly as they are. Change only the background scenery (lake and mountains) into a rainy night city street with wet reflections." (`quality: "low"`).*
>
> **Agent:** New file `<output-dir>/2026/11/10/jolly-panda-conjures-marshmallows-e96adbb8.png` (1024x1024). The original is untouched. The otter, easel and lantern are unchanged; the background is now a wet street with lamp posts, and the painting on the easel picked up the same scene. Want a higher-quality final render of this version?

## Compatibility note

Requires the gpt-image-mcp MCP server (Node.js 22+) configured in an MCP client that can run local stdio servers, plus an OpenAI or OpenAI-compatible API key with image-model access and quota.

## Pricing

Free.

## Categories (up to 3; pick from Agensi's list in the form, not verified here)

Image / design / creative tooling, plus a developer-tools or MCP-related category if one exists.

## Tags

image-generation, image-editing, mcp, gpt-image, openai

## Use cases

- Generate an illustration or logo concept from a text prompt
- Replace the background of a local photo
- Create a new image in the style of a reference image
- Iterate on a generated image with targeted edits

## Permissions / "Needs access to" (check against what the form detects from the ZIP)

- Services: the `gpt-image-mcp` MCP server (https://github.com/zK0G0w/gpt-image-mcp), configured by the buyer; an OpenAI-compatible image API provider chosen by the buyer.
- Network: indirect, through the MCP server to the buyer's provider. The skill itself runs no network code.
- Files: reads local images the buyer names; the MCP server writes new images under the buyer's output directory. The skill ships no scripts.

## Limitations

- Needs a separately configured MCP server and API key; the skill alone cannot generate images.
- Billed API calls; timeouts may still be billed upstream.
- No URL inputs, no batch mode, one image per call, masks guide but are not pixel-exact.
- Not verified on the Agensi platform itself (delivery to a buyer's agent through Agensi MCP): to be confirmed after approval.

## FAQ

**Does this install the MCP server for me?** No. It explains the prerequisites and points to the setup guide. You add the server to your MCP client and enter your own API key.

**Who pays for the images?** You do, through your API provider. The skill reminds the agent to mention cost before the first call.

**Why doesn't `check_endpoint` prove that image generation works?** It only requests the model list. Some providers have no model list at all. Only a real `generate_image` and `edit_image` call, preferably at `quality: "low"`, shows that images work.

**Why did my agent not retry after a timeout?** The provider may still be processing the first request, and a retry may be billed again. The skill asks the agent to check with you first.

**Can I use my own provider or model?** Yes, if it supports the OpenAI Image API (JSON generation, multipart editing, `b64_json` or `url` responses). Set `OPENAI_BASE_URL` and `IMAGE_GEN_MODEL` in the MCP configuration.

## Docs link

https://github.com/zK0G0w/gpt-image-mcp

## Packaging

```sh
mkdir -p release
git archive --format=zip --prefix=gpt-image-workflow/ -o release/gpt-image-workflow-1.0.0.zip HEAD:skills/gpt-image-workflow SKILL.md references/setup.md
unzip -l release/gpt-image-workflow-1.0.0.zip   # expect: SKILL.md, references/setup.md
```

Run it from the repository root. `git archive` packs only committed files, so commit skill changes first; `release/` is git-ignored. Anyone can also get the skill by downloading the `skills/gpt-image-workflow/` folder from the GitHub repository; it is intentionally not part of the npm package (`files` in `package.json` is unchanged).
