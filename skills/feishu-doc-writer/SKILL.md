---
name: feishu-doc-writer
description: Create, read, update, and organize Feishu cloud docs and wiki pages with a portable PowerShell workflow that uses environment variables or a local config file for credentials. Use when Codex needs to write to Feishu docx/wiki, create pages under a wiki node, read raw doc content, or separate public execution logic from machine-local Feishu secrets.
---

# Feishu Doc Writer

Use this skill when Feishu document operations should be reusable across machines and should not embed local secrets in the skill itself.

## Overview

Prefer the bundled PowerShell script instead of re-writing REST calls. The public version is intentionally portable:

- no real app credentials in the repository
- no hard-coded machine-specific absolute path
- credentials can come from explicit parameters, environment variables, or a local config file
- UTF-8 JSON handling is built in for Chinese content

## Credential Resolution

Use one of these inputs, in this priority order:

1. explicit `-AppId` and `-AppSecret`
2. environment variables `FEISHU_APP_ID` and `FEISHU_APP_SECRET`
3. `-ConfigPath`
4. environment variable `FEISHU_DOC_WRITER_CONFIG`

The public repo must not contain real values for any of these.

Read [references/config-and-secrets.md](references/config-and-secrets.md) before wiring a new machine.

## Workflow

### 1. Resolve the target

If the user gives a wiki link, extract the wiki token and run:

- `pwsh -File scripts/feishu_docx.ps1 -Action get-wiki-node -WikiToken <token>`

This returns the `space_id`, `node_token`, and backing `obj_token`.

### 2. Decide whether to create or edit

- Use `create-wiki-docx` to create a new page under a wiki node.
- Use `get-docx`, `get-docx-raw`, or `list-docx-blocks` to inspect an existing page.

### 3. Read before destructive writes

Before replacing content:

- read `raw_content`
- inspect root blocks if structure matters
- only then call `clear-docx-root-children`

Do not overwrite a page silently.

### 4. Write in batches

Feishu limits one append request to at most 50 child blocks. For long content:

- split the content into chunks of 50 lines or fewer
- append chunk by chunk
- read the page back after the final chunk

### 5. Keep secrets out of public storage

Keep public code in the repository and keep machine-local secrets outside it:

- local config file
- environment variables
- a private companion repo
- a restricted Feishu cloud document

Read [references/public-private-split.md](references/public-private-split.md) for the intended split.

## Resources

Use these files as needed:

- `scripts/feishu_docx.ps1`
- `references/config-and-secrets.md`
- `references/operations.md`
- `references/public-private-split.md`
