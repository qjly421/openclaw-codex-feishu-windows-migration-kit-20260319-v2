# Public Private Split

Use this split to keep the skill portable and safe.

## Public repository

Keep only reusable execution logic here:

- skill metadata
- portable scripts
- config contract
- generic workflow documentation
- error handling and batching logic

## Private or restricted storage

Keep machine-local or tenant-local details outside the public repo:

- real app credentials
- local absolute paths
- per-sender allowlists
- per-group allowlists
- allowed `space_id` or `parent_node_token` policies
- operational notes that should not be broadly published

Suitable locations:

- local config file
- environment variables
- private companion repo
- restricted Feishu cloud document

## Recommended rollout

1. Copy the public skill to the target machine.
2. Add local credentials outside the repo.
3. Run `get-wiki-node` and `get-docx-raw` first as read-only checks.
4. Only then enable write actions.
