# Local Defaults

The public version of this skill does not hard-code one operator machine.

- git binary:
  - auto-discover `git` on `PATH`
  - override with `GITHUB_SKILL_GIT_PATH` or `-GitPath`
- GitHub CLI:
  - auto-discover `gh` on `PATH`
  - override with `GITHUB_SKILL_GH_PATH` or `-GhPath`
- repo working tree:
  - use `-RepoPath` or `GITHUB_SKILL_REPO_PATH`
  - if omitted, the script uses the current working directory
- current remote:
  - read from the configured git remote in the target repo
- current branch:
  - read from the checked-out branch unless `-Branch` is supplied
- SSH config:
  - `~/.ssh/config`
- SSH public key:
  - `~/.ssh/id_ed25519.pub`
- SSH private key:
  - `~/.ssh/id_ed25519`
- SSH key title:
  - `codex-github-key`

Examples:

- Windows:
  - `C:\Users\<user>\.ssh\id_ed25519.pub`
  - `D:\repos\<project>`
- macOS or Linux:
  - `~/.ssh/id_ed25519.pub`
  - `~/repos/<project>`

When porting the skill to another machine, use overrides instead of editing the script source first.
