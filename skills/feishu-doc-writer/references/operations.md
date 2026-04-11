# Operations

All examples use PowerShell 7 style `pwsh`, but the script also works in Windows PowerShell if the environment is compatible.

## Resolve a wiki node

`pwsh -File scripts/feishu_docx.ps1 -Action get-wiki-node -WikiToken <wiki-token>`

Use the returned:

- `space_id` for wiki page creation
- `node_token` for the target wiki node
- `obj_token` as the docx `document_id` when the node already points to a docx page

## Create a new docx page

`pwsh -File scripts/feishu_docx.ps1 -Action create-wiki-docx -SpaceId <space-id> -ParentNodeToken <parent-node-token> -Title "Page title"`

## Read raw content

`pwsh -File scripts/feishu_docx.ps1 -Action get-docx-raw -DocumentId <document-id>`

## Append paragraphs

`pwsh -File scripts/feishu_docx.ps1 -Action append-paragraphs -DocumentId <document-id> -ContentFile <utf8-text-file>`

Each line becomes one paragraph block.

## Replace root content safely

Use this sequence:

1. `get-docx-raw`
2. `clear-docx-root-children`
3. `append-paragraphs`
4. `get-docx-raw`

## Rename a wiki node

`pwsh -File scripts/feishu_docx.ps1 -Action update-wiki-title -SpaceId <space-id> -NodeToken <node-token> -Title "New title"`

## Delete a temporary docx file

`pwsh -File scripts/feishu_docx.ps1 -Action delete-drive-file -FileToken <file-token> -FileType docx`

Delete may still fail for wiki-backed pages depending on effective owner or container permissions. In that case, rename the page as a temp artifact instead.
