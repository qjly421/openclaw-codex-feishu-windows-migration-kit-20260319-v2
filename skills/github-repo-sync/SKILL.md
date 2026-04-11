---
name: github-repo-sync
description: Inspect, authenticate, and synchronize GitHub repositories for Codex and other agents, including device-code login, SSH key setup, git remote switching, branch sync, and public/private repo update workflows across machines.
---

# GitHub Repo Sync

Use this skill when Codex needs to connect a machine to GitHub, prepare repo sync for other agents, or standardize how public and private repositories are pulled, updated, and pushed across devices.

## Overview

Prefer the bundled PowerShell script over ad hoc terminal commands when inspecting local GitHub state. The script is intended to make the fragile parts repeatable:

- locating the local `git`, `gh`, repo, and SSH key paths
- checking whether `gh` is logged in
- reading the machine SSH public key and fingerprint
- switching a repo remote from HTTPS to SSH safely
- pushing or pulling the current branch once auth and transport are ready

Public defaults and override rules are documented in:

- [references/local-defaults.md](references/local-defaults.md)

Override them with explicit parameters or the environment variables below when the target machine differs:

- `GITHUB_SKILL_GIT_PATH`
- `GITHUB_SKILL_GH_PATH`
- `GITHUB_SKILL_REPO_PATH`
- `GITHUB_SKILL_SSH_PUB_PATH`
- `GITHUB_SKILL_SSH_KEY_PATH`
- `GITHUB_SKILL_SSH_CONFIG_PATH`

## Workflow

### 1. Inspect the local setup first

Run:

- `scripts/github_repo_sync.ps1 -Action inspect-local-setup`

This confirms:

- git path
- GitHub CLI path
- repo path
- current branch
- current remote URL
- SSH public key path and fingerprint

### 2. Choose the authentication mode

Default preference:

1. `gh auth login --web --git-protocol ssh`
2. SSH key for long-term git transport
3. fine-grained token only when headless automation truly requires it

Do not write live access tokens or refresh tokens into shared docs, shared configs, or public repos.

### 3. Check auth before mutating remotes

Use:

- `scripts/github_repo_sync.ps1 -Action gh-auth-status`
- `scripts/github_repo_sync.ps1 -Action gh-user`

If `gh` is not logged in, complete device-code or browser login first.

### 4. Prepare SSH transport

Use:

- `scripts/github_repo_sync.ps1 -Action show-ssh-public-key`
- `scripts/github_repo_sync.ps1 -Action upload-ssh-key`
- `scripts/github_repo_sync.ps1 -Action set-ssh-remote`
- `scripts/github_repo_sync.ps1 -Action test-ssh`

Only switch the repo to SSH after the key exists locally and GitHub accepts that key.

### 5. Sync the repository deliberately

Before pushing:

- inspect `repo-status`
- inspect `git-remote`
- confirm the current branch

Then run:

- `pull-current-branch`
- review changes
- `push-current-branch`

Do not auto-push a dirty repo without first checking whether unrelated local changes are present.

## Operations

The canonical script is:

- `scripts/github_repo_sync.ps1`

Read [references/operations.md](references/operations.md) for the common command patterns.

## Auth And Permission Model

Read [references/auth-model.md](references/auth-model.md) before broadening automation.

The important separation is:

- caller policy decides which human or bot may trigger GitHub write actions
- GitHub auth method decides which machine identity is used
- repo permissions and branch protection decide whether the target repo accepts the action

If different people or agents should have different write rights, do not rely on one shared token alone. Restrict by caller, repo, branch, and transport policy in the gateway or wrapper layer.

## Portability

This skill is portable, but only after the target machine has:

- reachable GitHub network access
- a working `git` binary
- a working GitHub CLI or an equivalent auth path
- its own SSH key or token path
- repo-level permissions for the intended repository

The skill workflow can be reused offline as a planning template even on a machine that is not yet authenticated to GitHub.
