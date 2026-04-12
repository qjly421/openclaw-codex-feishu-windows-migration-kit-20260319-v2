# Agent 同步工作流

## 1. 目标

这份工作流用来解决三件事：

- 多台机器共用同一套 public skills 和 gateway
- Codex 或 Agent 能自己下载更新、上传修改
- future private 科研代码能和 public 框架解耦

## 2. 推荐同步顺序

始终按下面顺序同步：

1. public 仓库
2. private 配套仓库
3. 本机真实配置
4. 本机运行态目录

不要把运行态目录反推回 public 仓库。

## 3. public 仓库负责什么

Agent 可以在 public 仓库里自动维护这些内容：

- `gateway/` 里的公开脚本和说明
- `skills/` 里的公开 skill
- `docs/` 里的架构和部署文档
- `templates/` 里的模板

适合自动提交的变更：

- README 改写
- 文档更新
- 通用启动脚本改进
- skill 规范增强
- 脱敏后的示例配置更新

## 4. private 仓库负责什么

private 配套仓库负责：

- 科研任务代码
- 私有 skill
- 任务数据入口
- 实验脚本
- 只给你自己或少数协作者看的工作流

Agent 在 private 仓库里的自动变更应更保守，尤其涉及：

- 数据路径
- API 密钥
- 训练脚本
- 实验输出

## 5. 机器本地不入库的内容

以下内容默认只保留本机：

- `feishu_gateway.json`
- `.codex-feishu-gateway/`
- `.codex-long-tasks/`
- 日志
- 缓存
- 附件中转目录
- 运行中的 status 文件

## 6. 推荐的 Agent 行为

### 更新 public 框架时

Agent 应优先做：

- 拉取 public 仓库更新
- 对比本机 skill 版本
- 在 macOS 上可直接调用 `gateway/update_codex_feishu_macos.sh`
- 更新说明文档
- 仅在确认不含敏感信息时提交变更

### 更新 private 任务层时

Agent 应优先做：

- 拉取 private 仓库
- 叠加 private skill 和任务脚本
- 检查是否需要本机特定路径
- 避免把敏感内容同步回 public

## 7. 推荐授权方式

如果你后面要让 Agent 自己同步仓库，优先顺序建议是：

1. GitHub fine-grained token，只授权指定仓库
2. 或 SSH key，只给对应账号/机器

不建议：

- 共享主账号密码
- 给过大的全局写权限

## 8. 日常维护建议

- public 仓库尽量保持可公开阅读和可迁移
- private 仓库只承载科研任务和敏感层
- 运行态目录永远不作为版本控制真源
- 长任务状态通过 `skills/long-task-orchestrator` 统一规范
- macOS 机器建议固定用 repo checkout + `~/.codex/skills/` 的同步模式

## 9. 一句话原则

public 负责框架，private 负责任务，本机负责真实配置和运行态。
