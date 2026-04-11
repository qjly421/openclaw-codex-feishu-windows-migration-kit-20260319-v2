# Skills 目录说明

这里是这个 public 仓库里的正式公共 skill 目录。

## 当前纳入的 public skills

- `codex-feishu-gateway`
- `feishu-doc-writer`
- `github-repo-sync`
- `long-task-orchestrator`

## 安装方式

把这里的技能目录复制到目标机器的 Codex skills 目录，例如：

- Windows：`%USERPROFILE%\\.codex\\skills\\`

复制后重启 Codex，使技能被重新加载。

## 说明

- `skills/` 是新的正式公共分发位置
- `gateway/skill/` 仍保留，主要为了兼容旧迁移包结构

## 设计原则

放进这里的 skill 应该满足：

- 不依赖你的真实密钥
- 不依赖你的运行态目录
- 可以跨设备复用
- 文档和 references 足够完整

如果某个 skill 带有明显的科研任务私有性，就不要放进这里，转而放到 private 配套仓库。
