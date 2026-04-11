# Auth Model

Use three separate layers when reasoning about GitHub access.

## Layer 1: Caller policy

This is the right place for per-person or per-agent restrictions.

Examples:

- allow only specific `sender_open_id` values to trigger `push`
- allow only a dedicated maintenance chat to trigger repo writes
- allow only specific public repos for general bots
- keep private research repos out of the default write allowlist

This layer belongs in the gateway, wrapper script, or automation policy logic.

## Layer 2: GitHub authentication mechanism

This decides which machine identity GitHub sees.

Common modes for this skill:

- GitHub CLI browser or device-code login
- SSH key pair for git transport
- fine-grained personal access token for constrained automation

Important:

- a temporary device-code session is not the same thing as a long-lived SSH transport
- tokens should not be pasted into shared chats or written into public docs
- one GitHub identity should not silently become the shared write path for every caller

## Layer 3: Repository and branch permissions

These are the actual GitHub-side controls on the target repo.

Examples:

- whether the authenticated user may push to the repository at all
- whether the target branch is protected
- whether pull requests are required
- whether the repo is public or private

Even with valid auth, writes still fail if the repo or branch policy blocks them.

## Recommended split

For a multi-agent or multi-machine setup, use this default strategy:

1. prefer device-code or browser login for initial operator-approved access
2. prefer SSH for stable git transport after the key is explicitly registered
3. restrict which repos and branches each agent may touch
4. keep public framework repos and private research repos separated
5. log every write action with machine, repo, branch, and caller context
