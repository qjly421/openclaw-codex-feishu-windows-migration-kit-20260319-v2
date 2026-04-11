# Operations

All examples assume PowerShell on Windows.

## 1. Inspect the local GitHub setup

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action inspect-local-setup`

Use this first on a new machine.

## 2. Check whether GitHub CLI is logged in

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action gh-auth-status`

## 3. Resolve the authenticated GitHub user

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action gh-user`

## 4. Show the machine SSH public key

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action show-ssh-public-key`

## 5. Upload the SSH key after `gh auth login`

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action upload-ssh-key -SshKeyTitle "codex-github-key"`

## 6. Inspect git remote and repo status

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action git-remote`

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action repo-status`

## 7. Switch the remote to SSH

If the current remote is an HTTPS GitHub URL:

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action set-ssh-remote`

If you want to force a specific remote URL:

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action set-ssh-remote -RemoteSshUrl git@github.com:owner/repo.git`

## 8. Test SSH transport

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action test-ssh`

## 9. Pull and push the current branch

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action pull-current-branch`

`powershell -ExecutionPolicy Bypass -File scripts/github_repo_sync.ps1 -Action push-current-branch`

Run `repo-status` before pushing.

## 10. Override machine-specific defaults

Examples:

- `-GitPath C:\path\to\git.exe`
- `-GhPath C:\path\to\gh.exe`
- `-RepoPath D:\repo`
- `-SshPublicKeyPath C:\Users\<user>\.ssh\id_ed25519.pub`

Or set environment variables before invoking the script:

- `GITHUB_SKILL_GIT_PATH`
- `GITHUB_SKILL_GH_PATH`
- `GITHUB_SKILL_REPO_PATH`
- `GITHUB_SKILL_SSH_PUB_PATH`
- `GITHUB_SKILL_SSH_KEY_PATH`
- `GITHUB_SKILL_SSH_CONFIG_PATH`

These overrides are the normal way to reuse the skill on a different machine.
