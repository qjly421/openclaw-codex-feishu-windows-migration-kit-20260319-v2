# Windows 3090 GitHub 接入文档

零：说明

这份文档只讨论 3090 机器上的 GitHub 接入、认证、SSH 传输和仓库同步范式。

本次需求消息里出现的飞书机器人敏感信息与这份 GitHub 接入文档无关，不应写入公共版文档，也不应提交到 GitHub 公共仓库。

一、用途

这个 skill 用于直接检查、认证、切换和同步 GitHub 仓库，适用于 3090 机器上的 Codex、其他 Agent 或本地人工运维。

适用场景包括：

1. 检查本机是否已安装 `git`、`gh` 和 SSH key。
2. 检查 GitHub CLI 是否已登录，以及当前登录用户是谁。
3. 读取本机 SSH 公钥并完成 GitHub SSH 路线接入。
4. 把仓库 remote 从 HTTPS 安全切换到 SSH。
5. 在现有仓库上执行 pull、push 和日常同步。
6. 排查 GitHub 认证失败、SSH 失败、remote 错误或仓库权限问题。
7. 区分“当前机器可做日常同步”和“当前登录态能否新建 GitHub 仓库”这两类不同能力。

二、GitHub 公共版位置

当前 GitHub 公共版仓库地址：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2

公共版 skill 目录：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2/tree/main/skills/github-repo-sync

主说明文件：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2/blob/main/skills/github-repo-sync/SKILL.md

主脚本：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2/blob/main/skills/github-repo-sync/scripts/github_repo_sync.ps1

认证模型说明：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2/blob/main/skills/github-repo-sync/references/auth-model.md

操作说明：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2/blob/main/skills/github-repo-sync/references/operations.md

本地默认值说明：

https://github.com/qjly421/openclaw-codex-feishu-windows-migration-kit-20260319-v2/blob/main/skills/github-repo-sync/references/local-defaults.md

三、GitHub 公共版 SKILL.md 核心内容

1. 优先使用随 skill 提供的 PowerShell 脚本，不要每次手写零散的 `git`、`gh` 和 SSH 检查命令。
2. 公共版仓库不保存真实 GitHub token、refresh token、SSH 私钥、机器专属绝对路径或人机绑定的调用白名单。
3. 工具路径和仓库路径可以来自显式参数、环境变量或本机默认路径。
4. 在修改 remote、上传 SSH key 或 push 前，先检查本地 setup 和当前 repo 状态，不要静默修改。
5. 默认优先级是：`gh auth login` 完成操作员登录，随后使用 SSH 作为长期稳定的 git transport。
6. 日常 `pull` / `push` 与“新建 GitHub 仓库”不是同一类权限，文档里必须分开描述。
7. 公开仓库只保存可迁移的执行逻辑、路径约定、认证模型和排障方法，敏感信息应保留在本地凭据、系统 keyring、SSH 私钥、私有仓库或受限文档中。

四、工具路径与认证解析顺序

1. 显式传参：
   - `-GitPath`
   - `-GhPath`
   - `-RepoPath`
   - `-SshPublicKeyPath`
   - `-SshPrivateKeyPath`
   - `-SshConfigPath`
2. 环境变量：
   - `GITHUB_SKILL_GIT_PATH`
   - `GITHUB_SKILL_GH_PATH`
   - `GITHUB_SKILL_REPO_PATH`
   - `GITHUB_SKILL_SSH_PUB_PATH`
   - `GITHUB_SKILL_SSH_KEY_PATH`
   - `GITHUB_SKILL_SSH_CONFIG_PATH`
3. 本地默认值：
   - `git` 和 `gh` 优先从 `PATH` 自动发现
   - repo 目录默认使用当前工作目录
   - SSH 配置默认使用 `~/.ssh/config`
   - SSH 公钥默认使用 `~/.ssh/id_ed25519.pub`
   - SSH 私钥默认使用 `~/.ssh/id_ed25519`

认证优先级建议如下：

1. `gh auth login --web --git-protocol ssh`
2. 注册本机 SSH 公钥，后续日常 git transport 走 SSH
3. 只有在无头自动化确实需要时，才考虑使用受限 PAT

五、推荐接入流程

1. 先检查本机工具和仓库状态：
   - `inspect-local-setup`
2. 确认 GitHub CLI 是否已登录：
   - `gh-auth-status`
   - `gh-user`
3. 如果还没准备 SSH，先读取本机 SSH 公钥：
   - `show-ssh-public-key`
4. 把公钥注册到 GitHub 账号后，测试 SSH：
   - `test-ssh`
5. 如果目标仓库当前是 HTTPS remote，再切换到 SSH：
   - `set-ssh-remote`
6. 在 push 前先看仓库状态和当前 remote：
   - `repo-status`
   - `git-remote`
7. 先 pull 当前分支，再 push 当前分支：
   - `pull-current-branch`
   - `push-current-branch`
8. 如果要做“新建仓库”这类管理动作，单独确认当前 `gh` 登录态是否具备 `repo` / `createRepository` 相关权限，不要默认等同于 SSH 可 push。

六、常用命令

1. 检查本机 GitHub 接入状态：

`pwsh -File scripts/github_repo_sync.ps1 -Action inspect-local-setup`

2. 检查 GitHub CLI 登录状态：

`pwsh -File scripts/github_repo_sync.ps1 -Action gh-auth-status`

3. 读取当前 GitHub 登录用户：

`pwsh -File scripts/github_repo_sync.ps1 -Action gh-user`

4. 显示本机 SSH 公钥：

`pwsh -File scripts/github_repo_sync.ps1 -Action show-ssh-public-key`

5. 在 `gh` 已登录后上传 SSH key：

`pwsh -File scripts/github_repo_sync.ps1 -Action upload-ssh-key -SshKeyTitle "codex-github-key"`

6. 查看当前仓库 remote：

`pwsh -File scripts/github_repo_sync.ps1 -Action git-remote`

7. 查看当前仓库状态：

`pwsh -File scripts/github_repo_sync.ps1 -Action repo-status`

8. 把 remote 切换为 SSH：

`pwsh -File scripts/github_repo_sync.ps1 -Action set-ssh-remote`

如果要强制指定 remote：

`pwsh -File scripts/github_repo_sync.ps1 -Action set-ssh-remote -RemoteSshUrl git@github.com:owner/repo.git`

9. 测试 GitHub SSH：

`pwsh -File scripts/github_repo_sync.ps1 -Action test-ssh`

10. 拉取当前分支：

`pwsh -File scripts/github_repo_sync.ps1 -Action pull-current-branch`

11. 推送当前分支：

`pwsh -File scripts/github_repo_sync.ps1 -Action push-current-branch`

七、公共内容与敏感内容边界

1. 放在 GitHub 公共仓库的内容：
   - `SKILL.md`
   - 可移植 PowerShell 脚本
   - 通用认证模型说明
   - 通用操作说明
   - 工具路径与环境变量约定
   - SSH 接入流程和排障方法
2. 不放在 GitHub 公共仓库的内容：
   - 真实 PAT
   - GitHub refresh token
   - SSH 私钥
   - 本机专属绝对路径
   - 调用者白名单、群白名单、管理员白名单
   - 私有仓库清单或写入权限策略
   - 私有运维说明
3. 这些敏感信息应保留在：
   - 本地环境变量
   - 系统 keyring / GitHub CLI 本地凭据存储
   - 本地 `~/.ssh` 私钥
   - 私有仓库
   - 受限飞书文档

八、跨机器与跨 Agent 复用条件

满足下面条件时，其他 Agent 或其他 Codex 实例可以直接或稍作修改后复用：

1. 目标机器能访问 `github.com` 和 GitHub API。
2. 目标机器有 PowerShell 环境。
3. 目标机器有可用的 `git`。
4. 目标机器有可用的 `gh`，或者至少有 SSH key 路线。
5. 目标机器上的 GitHub 身份已经完成登录或 SSH key 注册。
6. 目标仓库对该 GitHub 身份开放了相应读写权限。
7. 目标分支没有被保护策略阻止直接 push。
8. 上层 gateway 或 wrapper 已经明确哪些人、哪些 chat、哪些 agent 可以触发 GitHub 写操作。

九、当前 3090 机器结论

基于当前 3090 机器的实际验证，结论如下：

1. `git` 已安装，可正常使用。
2. `gh` 已安装，可正常使用。
3. `gh` 已登录到 `qjly421`。
4. 本机 SSH 路线已经打通，`ssh -T git@github.com` 可认证成功。
5. 现有仓库已经可以通过 SSH 做日常 pull / push。
6. 当前更稳定的范式是：
   - 操作员先完成 `gh` 登录
   - 再注册本机 SSH 公钥
   - 日常仓库同步优先走 SSH
7. 需要特别区分的是：
   - “已能通过 SSH 推送现有仓库”
   - “当前 `gh` 登录态有权直接新建 GitHub 仓库”
   这两件事不是同一个能力。
8. 因此，3090 机器当前已经可以作为 GitHub 日常同步和仓库维护的稳定执行节点，但若涉及仓库创建、组织级设置或更高权限操作，仍需额外确认 GitHub 账号 scope 或由操作员在手机端 / 网页端完成。
