# Codex Feishu Framework

这个仓库现在不再只是一次性的 Windows 迁移包。

它的正式定位是：

- Feishu + Codex 本地网关的 public 框架仓库
- 可公开复用的 Codex skills 仓库
- Windows / macOS 多设备部署与更新入口
- 后续 private 研究仓库的公共底座

## 仓库包含什么

- `gateway/`
  - Feishu 网关源码
  - Windows / macOS 启动脚本
  - 健康检查与自恢复脚本
  - 使用统计与辅助脚本
- `skills/`
  - 可直接复制到本地 Codex skills 目录的公共 skills
- `docs/`
  - 架构说明
  - 同步流程
  - 部署说明
  - public / private 边界说明
- `templates/`
  - private 配套仓库模板

## 快速开始

### 网关

1. 安装 Node.js LTS。
2. 进入 `gateway/`。
3. 运行 `npm install`。
4. 复制 `gateway/feishu_gateway.example.json` 生成真实本机配置。
   如果是 macOS，优先用 `gateway/feishu_gateway.example.macos.json`，或者直接运行 `bash ./gateway/bootstrap_codex_feishu_macos.sh`，让脚本按 Mac 路径自动生成配置。
5. 先做认证验证：

```bash
node ./codex_feishu_gateway.mjs auth-test --config <config-path>
```

6. 再启动网关：

```bash
node ./codex_feishu_gateway.mjs watch --config <config-path>
```

### Skills

把 `skills/` 下的目录复制到本机 Codex skill 目录：

- Windows: `%USERPROFILE%\.codex\skills\`
- macOS: `~/.codex/skills/`

推荐优先安装：

- `skills/codex-feishu-gateway`
- `skills/feishu-doc-writer`
- `skills/github-repo-sync`
- `skills/long-task-orchestrator`

## 现有机器怎么更新

这一节是给“已经跑起来的机器”用的。目标是让另一台机器只看 README 就知道怎么升级。

### 1. 先拉最新代码

如果那台机器直接跑这个 Git 仓库：

```bash
git pull --ff-only origin main
```

如果那台机器不是直接跑 Git 仓库，而是跑手工复制出来的目录，就把最新版本的这两个目录同步过去：

- `gateway/`
- `skills/`

### 2. 只在需要时更新依赖

如果 `gateway/package.json` 或 `gateway/package-lock.json` 变了，再执行：

```bash
cd gateway
npm install
```

如果这两个文件没变，一般不需要重新装 Node 依赖。

### 3. 对照示例配置补新项，不要覆盖真实密钥

更新时重点对照：

- `gateway/feishu_gateway.example.json`
- `gateway/feishu_gateway.example.macos.json`（macOS）
- `gateway/README-codex-feishu-gateway.md`
- `gateway/README-codex-feishu-windows.md`

不要把真实配置文件整份覆盖掉。只补新增字段和行为变化。

如果一台旧 Mac 还在用 `~/.codex/feishu_gateway.json` 这套老布局，先执行一次 `bash ./gateway/bootstrap_codex_feishu_macos.sh --skip-launchagent`，把运行目录迁到 `~/.codex-feishu-gateway/`，再走常规更新流程。

这次更新最需要注意的是：

- `progressCommandUpdates = false`
  - 保留 progress 推送
  - 关闭 `Running command` 和 `Command finished` 这类命令回显
- `/stop`
  - 只中断当前 chat 正在执行的任务
  - 不会自动清空后面已经排队的普通消息
- plan 卡片审批流
  - approve 开始执行后，原卡片会变成绿色执行态
  - 绿色执行态卡片不再保留旧的三个按钮

### 4. 如果那台机器本地复制过 skills，也要同步更新

至少同步：

- `skills/codex-feishu-gateway`

如果那台机器还在用本仓库里的其他公共 skill，也一起更新对应目录。

### 5. 只在空闲窗口重启

代码和配置写到磁盘后，不会自动影响已经在跑的 gateway 进程。

要真正生效，还是要在空闲窗口重启。

如果机器使用的是：

- Windows 计划任务
  - 在空闲时重启当前 gateway 进程，或重新触发任务
- macOS `launchd`
  - 在空闲时重启 LaunchAgent
- 前台 `watch`
  - 停掉旧进程，再启动一次 `watch`

如果安装路径没有变，一般不需要重新安装计划任务或 LaunchAgent。

### 6. 重启后怎么验

最少验这几项：

1. `/status`
2. `/progress`
3. 发一个会进入 plan mode 的任务
4. approve 后确认原卡片变绿
5. 确认绿色执行态卡片不再显示旧按钮
6. 跑一个长任务后测试 `/stop`
7. 确认后续排队消息仍按顺序执行
8. 如果 `progressCommandUpdates = false`，确认飞书里只看到 progress，不再看到 command 回显

## 仓库定位

这个仓库只放 public-safe 内容：

- 网关代码
- 可复用 skills
- 脱敏配置模板
- 部署文档
- 架构说明
- Agent 同步规则

科研代码、敏感配置、私有流程建议放到单独的 private 配套仓库。

## 主要文档入口

- `README.md`
- `docs/ARCHITECTURE-ZH.md`
- `docs/AGENT-SYNC-WORKFLOW-ZH.md`
- `docs/PUBLIC-PRIVATE-BOUNDARY-ZH.md`
- `docs/WINDOWS-3090-DEPLOYMENT-ZH.md`

## 命名说明

仓库 slug 还保留着早期迁移包历史，但项目现在应该按下面的名字理解：

- `Codex Feishu Framework`
