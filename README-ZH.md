# Codex Feishu Framework

这个仓库现在不再只作为一次性的 Windows 迁移包使用。

它的正式定位是：

- Feishu + Codex 本地网关的 public 框架仓库
- 可公开复用的 skills 分发仓库
- Windows / macOS 多设备部署和迁移入口
- 后续 private 科研任务仓库的公共底座

当前仓库 slug 还保留了最初的迁移历史，但项目展示名现在统一为：

- `Codex Feishu Framework`
- private 配套仓库：`openclaw-research-private`

## 现在包含什么

- `gateway/`
  - Feishu 网关主程序
  - Windows / macOS 启动脚本
  - 计划任务 / launchd 安装脚本
  - 健康检查和自恢复脚本
  - 统计脚本
  - 聊天成员导出脚本
  - 定时报送示例脚本

- `skills/`
  - `codex-feishu-gateway`
  - `long-task-orchestrator`

- `docs/`
  - 架构说明
  - public/private 分层说明
  - Agent 同步工作流
  - 迁移和部署文档

- `templates/`
  - private 配套仓库模板

## 相比最初迁移包，这次补上的能力

- 同步了当前现场正在运行的网关版本，而不是只保留旧迁移包快照
- 增加了 `skills/` 目录，开始把 public skill 作为正式仓库内容管理
- 补上了长任务后台运行、ETA、里程碑汇报、可恢复状态这套公开规范
- 补上了 public/private 仓库分层设计，方便后续科研代码改为 private
- 增加了聊天成员导出和定时报送脚本入口
- 把“迁移包”升级成了“可持续维护的公共框架仓库”

## 推荐的仓库分层

### public 仓库

放这些内容：

- 网关源码和启动脚本
- 可公开复用的 skills
- 脱敏配置模板
- 部署文档
- 架构说明
- Agent 同步规则

### private 仓库

放这些内容：

- 科研任务代码
- 专用实验脚本
- 私有 skills
- 敏感配置
- 数据接口和实验输出
- 只面向你自己或小范围协作者的工作流

详细边界见：

- `docs/PUBLIC-PRIVATE-BOUNDARY-ZH.md`
- `templates/private-companion-repo/README-ZH.md`

## 仓库结构

- `gateway/`
  - 网关本体和 Windows 运行脚本
- `skills/`
  - 公开可复用的 Codex skill
- `docs/`
  - 架构、同步、边界、部署说明
- `templates/`
  - private 配套仓库的模板

说明：

- `skills/` 是新的正式公共 skill 目录
- `gateway/skill/` 仍然保留，主要用于兼容旧迁移包结构

## 快速开始

### 1. 启动网关

进入 `gateway/` 后：

1. 安装 Node.js LTS
2. 运行 `npm install`
3. 复制 `feishu_gateway.example.json` 生成真实配置
4. 先做前台验证：
   - Windows：`node .\codex_feishu_gateway.mjs auth-test --config <配置路径>`
   - Windows：`node .\codex_feishu_gateway.mjs watch --config <配置路径>`
   - macOS：`node ./codex_feishu_gateway.mjs auth-test --config <配置路径>`
   - macOS：`bash ./run_codex_feishu_gateway.sh`
5. 再安装后台启动：
   - Windows：`powershell -ExecutionPolicy Bypass -File .\install_codex_feishu_task.ps1 -GatewayRoot <目录> -ConfigPath <配置路径>`
   - macOS：`bash ./bootstrap_codex_feishu_macos.sh`

### 2. 安装 public skills

把 `skills/` 里的目录复制到本机 Codex skill 目录，例如：

- Windows：`%USERPROFILE%\\.codex\\skills\\`
- macOS：`~/.codex/skills/`

推荐先装：

- `skills/codex-feishu-gateway`
- `skills/long-task-orchestrator`

### 3. 接 private 仓库

当你开始把科研任务拆到 private 时：

1. 保持本仓库继续作为 public 底座
2. 按 `templates/private-companion-repo/README-ZH.md` 新建 private 配套仓库
3. 让 Agent 先同步 public，再叠加 private

## 文档入口

- `docs/ARCHITECTURE-ZH.md`
- `docs/AGENT-SYNC-WORKFLOW-ZH.md`
- `docs/PUBLIC-PRIVATE-BOUNDARY-ZH.md`
- `docs/WINDOWS-3090-DEPLOYMENT-ZH.md`
- `gateway/README-codex-feishu-macos.md`

## 当前阶段的建议

现在先把这个 public 仓库作为你所有设备共享的公共框架源。

后面一旦开始放科研代码，就单独开 private 配套仓库，不要把实验代码、敏感配置和运行态直接混进 public 仓库。
