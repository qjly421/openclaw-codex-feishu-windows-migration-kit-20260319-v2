# Windows 3090 迁移部署指南

本指南面向另一台 Windows 机器，尤其是你提到的 3090 机器。

先说结论：

- 3090 不是这套 Feishu 网关本身的前置条件
- 3090 只影响你在 `<WORKSPACE_ROOT>` 里跑的训练、推理或本地模型任务
- 这套网关本身主要依赖 Node.js、Codex CLI、飞书应用配置和稳定的开机恢复机制

## 1. 迁移前准备

建议目标机器满足：

1. Windows 10/11
2. Node.js LTS 已安装
3. 目标飞书自建应用已创建并发布
4. 机器能访问 `open.feishu.cn`
5. 如果要无人值守恢复，最好准备：
   - BIOS 来电自启
   - Windows 自动登录或等效启动链路
   - 校园网/办公网自动联网方案

## 2. 复制本迁移包

把整个迁移包拷到新机器，例如：

- `<KIT_ROOT> = D:\codex-feishu-migration-kit`

推荐把实际网关目录放成：

- `<GATEWAY_ROOT> = D:\codex-feishu`

你可以直接把本包里的 `gateway` 目录复制或改名为 `<GATEWAY_ROOT>`。

## 3. 安装 Node.js

如果目标机器还没有 Node.js：

1. 安装 Node.js LTS
2. 安装完成后打开 PowerShell
3. 确认下面两个命令可用：
   - `node -v`
   - `npm -v`

## 4. 安装 Codex CLI

本包里的 `gateway/install_codex_cli_windows.ps1` 会先检查 `node`、`npm` 和 `codex`，再决定是否安装。

推荐命令：

1. 进入网关目录
2. 执行：
   - `powershell -ExecutionPolicy Bypass -File .\install_codex_cli_windows.ps1`

也可以手动安装：

- `npm install -g @openai/codex`

安装依据：

- 本机已安装的官方 `@openai/codex` README 明确给出了上面的安装命令
- 官方文档入口：`https://developers.openai.com/codex`
- IDE 安装入口：`https://developers.openai.com/codex/ide`

安装后：

1. 执行 `codex --version`
2. 执行 `codex`
3. 按提示选择登录方式

说明：

- 官方文档当前对 Codex CLI 的 Windows 支持说明仍偏 experimental
- 但这套网关已经按 Windows PowerShell 脚本和计划任务模式实际整理过
- 如果你在目标机器上发现原生 Windows CLI 行为不稳定，再考虑切到 WSL 工作区

## 5. 安装网关依赖

进入 `<GATEWAY_ROOT>` 后执行：

- `npm install`

这一步会安装飞书 Node SDK 依赖。

## 6. 创建运行态目录和真实配置

建议新机器使用：

- `<RUNTIME_ROOT> = C:\Users\<user>\.codex-feishu-gateway`

手工创建目录后，把下面任一模板复制为真实配置文件：

- `gateway\feishu_gateway.example.json`
- `gateway\feishu_gateway.current-sanitized.json`

建议真实配置文件路径：

- `<CONFIG_PATH> = C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json`

## 7. 必填配置项

至少替换这些字段：

- `appId`
- `appSecret`
- `workspace`
- `codexBin`
- `codexSessionsRoot`
- `stateFile`
- `usageLedgerFile`
- `mediaRoot`
- `startupNotifyChatIds`

推荐起步值：

- `codexBin = "codex"`
- `groupSessionScope = "group_sender"`
- `groupAssistantMode = "hybrid"`
- `progressUpdates = true`

如果要尽量贴近当前现场：

- `planCardsEnabled = true`
- `cardCallbackEnabled = false`
- `cardLongConnectionEnabled = true`

## 8. 飞书侧需要的配置和权限

飞书应用侧至少确认下面几项：

1. 已启用 Bot 能力
2. 已发布到可用范围
3. 事件订阅使用长连接
4. 已订阅 `im.message.receive_v1`
5. 已开通消息收发权限
6. 如果需要图片/文件收发，要补对应权限
7. 如果需要 reaction 指示器，也要有相应权限

如果你还要用卡片按钮：

1. 可以走 HTTP 回调模式
2. 也可以研究当前代码里的长连接卡片动作模式
3. 如果走 HTTP 回调，需要公网可达的 callback 地址
4. 这时还要配置 `verificationToken` 和 `encryptKey`

## 9. 前台验证

在 `<GATEWAY_ROOT>` 里先做两步验证，不要一上来就装计划任务。

第一步，认证测试：

- `node .\codex_feishu_gateway.mjs auth-test --config <CONFIG_PATH>`

第二步，前台运行：

- `node .\codex_feishu_gateway.mjs watch --config <CONFIG_PATH>`

然后去飞书测试：

1. `/status`
2. 一条普通文本
3. 一张图片或一个文件
4. 一条带本地绝对路径附件语法的回复

附件语法示例：

- `[feishu-attachment] C:\absolute\path\to\file.pdf`

## 10. 安装计划任务

前台验证通过后，再安装计划任务：

- `powershell -ExecutionPolicy Bypass -File .\install_codex_feishu_task.ps1 -GatewayRoot <GATEWAY_ROOT> -ConfigPath <CONFIG_PATH>`

该脚本会安装 3 个任务：

1. `CodexFeishuGateway`
   - 登录后拉起

2. `CodexFeishuGatewayBoot`
   - 开机后拉起

3. `CodexFeishuGatewayHealth`
   - 周期性巡检与自动重启

## 11. 运行后要重点看哪些日志

日志主要会落到 `<RUNTIME_ROOT>`。

建议重点看：

- `watch.stdout.log`
- `watch.stderr.log`
- `watch.supervisor.status.json`
- `watch.health.log`
- `watch.health.restart.json`

## 12. 当前代码里与稳定性直接相关的点

迁移时建议知道这几个行为：

1. 启动脚本支持等待网络
2. 状态文件里会写 `launchMode = direct_node_launch`
3. 健康检查默认会检查 stale active run
4. 如果记录的 `codexPid` 已消失，会触发重启
5. 网关主程序增加了“首个 JSON 事件 watchdog”
6. 默认 60 秒内完全无事件输出，会把本次 `resume/start` 判定为 stalled

## 13. 迁移到 3090 机器时的额外建议

如果这台 3090 机器不只是跑网关，还要跑本地训练或推理：

1. 把 Python、CUDA、项目依赖装在 `<WORKSPACE_ROOT>` 对应环境里
2. 不要把这些训练环境塞到网关目录
3. 网关目录尽量保持只负责飞书桥接和 Codex 调度
4. 如果训练任务很重，建议额外关注：
   - 磁盘空间
   - 临时目录权限
   - 是否会抢占 `codex` 的工作目录锁

## 14. 常见故障排查

### 14.1 `codex` 命令不存在

先检查：

- `node -v`
- `npm -v`
- `codex --version`

如果 `codex` 还不存在：

- 重新执行 `powershell -ExecutionPolicy Bypass -File .\install_codex_cli_windows.ps1`

### 14.2 飞书能收到消息，但不回

先查：

- `watch.stdout.log`
- `watch.stderr.log`
- `watch.health.log`
- 配置里的 `workspace`
- 本机单独运行 `codex` 是否正常

### 14.3 附件发不回去

先查：

1. 路径是不是绝对路径
2. 文件是不是真的存在
3. 文件是不是被别的进程占用
4. `mediaRoot` 是否可写
5. 飞书应用是否具备文件/图片上传权限

### 14.4 开机后没有自动恢复

先查：

1. BIOS 是否支持来电自启
2. Windows 是否真的执行了自动登录或启动链路
3. 三个计划任务是否安装成功
4. 网络是不是在启动时过晚就绪

## 15. 最短落地路径

如果你只想最快在新机器跑起来，按下面顺序：

1. 安装 Node.js
2. 安装 Codex CLI
3. 复制 `gateway` 目录到 `<GATEWAY_ROOT>`
4. 在 `<GATEWAY_ROOT>` 执行 `npm install`
5. 创建 `<CONFIG_PATH>`
6. 填好飞书配置和路径
7. 跑 `auth-test`
8. 跑 `watch`
9. 飞书验证通过后装计划任务
