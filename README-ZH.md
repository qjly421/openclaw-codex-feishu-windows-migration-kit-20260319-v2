# Codex-Feishu Windows 迁移包

这是基于当前可运行的 Feishu + Codex 网关整理出的脱敏迁移包，适合迁移到另一台 Windows 机器。

本包的目标不是导出运行态数据，而是导出一套可复用的代码、脚本、配置模板和迁移说明。

包含内容：

- `gateway/`: 可分享的网关源码、PowerShell 启动脚本、计划任务安装脚本、统计脚本
- `gateway/feishu_gateway.example.json`: 通用示例配置
- `gateway/feishu_gateway.current-sanitized.json`: 参照当前现场配置整理出的脱敏模板
- `gateway/install_codex_cli_windows.ps1`: Windows 上安装/检查 Codex CLI 的辅助脚本
- `docs/ARCHITECTURE-ZH.md`: 架构说明
- `docs/FIELD-NOTES-SANITIZED-ZH.md`: 基于现场记录整理的脱敏说明
- `docs/WINDOWS-3090-DEPLOYMENT-ZH.md`: 迁移到另一台 Windows 3090 机器的操作步骤

已经脱敏或排除的内容：

- 实际 `appId`、`appSecret`
- 实际 Feishu 群 ID、用户 Open ID、消息 ID
- 实际 `feishu_gateway.json`
- 运行态目录 `.codex-feishu-gateway/`
- Codex 历史会话 `.codex/history.jsonl` 与 `.codex/sessions/`
- 本机用户名、真实桌面路径、真实工作区路径

占位符约定：

- `<FEISHU_APP_ID>`
- `<FEISHU_APP_SECRET>`
- `<FEISHU_CHAT_ID>`
- `<FEISHU_OPEN_ID>`
- `<GATEWAY_ROOT>`
- `<RUNTIME_ROOT>`
- `<WORKSPACE_ROOT>`
- `<CODEX_HOME>`
- `<CODEX_BIN>`
- `<MEDIA_ROOT>`

建议使用顺序：

1. 先看 `docs/WINDOWS-3090-DEPLOYMENT-ZH.md`
2. 再按需看 `docs/ARCHITECTURE-ZH.md`
3. 如果想尽量贴近当前现场，再参考 `gateway/feishu_gateway.current-sanitized.json`

最快启动步骤：

1. 在目标 Windows 机器安装 Node.js LTS
2. 进入 `gateway/`，运行 `.\install_codex_cli_windows.ps1`
3. 运行 `npm install`
4. 复制 `feishu_gateway.current-sanitized.json` 或 `feishu_gateway.example.json` 为真实配置文件
5. 把占位符替换成目标机器和目标飞书应用的真实值
6. 先执行 `node .\codex_feishu_gateway.mjs auth-test --config <配置路径>`
7. 再执行 `node .\codex_feishu_gateway.mjs watch --config <配置路径>`
8. 最后执行 `powershell -ExecutionPolicy Bypass -File .\install_codex_feishu_task.ps1 -GatewayRoot <网关目录> -ConfigPath <配置路径>`

说明：

- 3090 并不是这个网关本身的必需条件。3090 只影响你在 `<WORKSPACE_ROOT>` 里运行的本地模型、训练或推理任务。
- 网关本身主要依赖 Node.js、Codex CLI、Feishu 应用配置、可写的运行态目录，以及稳定的开机拉起流程。
