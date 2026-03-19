# 架构说明

## 1. 总体目标

这套系统的目标是把一台 Windows 机器做成可通过飞书远程驱动的本地 Codex 执行节点。

适用场景：

- 机器断电后需要自动恢复
- 开机后希望自动通知指定飞书会话
- 需要在飞书里继续同一个 Codex 会话
- 需要支持附件回传
- 需要支持 `/plan`、`/approve`、`/cancel`
- 需要群聊公共上下文，同时又不想让不同发言人共用同一个执行会话

## 2. 核心组件

1. 飞书应用
   - 提供 Bot 能力
   - 通过长连接接收 `im.message.receive_v1`
   - 可选支持卡片动作

2. 网关主程序
   - 文件：`gateway/codex_feishu_gateway.mjs`
   - 作用：接收飞书消息、映射会话、拉起 Codex、回传文本和附件

3. 启动脚本
   - 文件：`gateway/start_codex_feishu_gateway.ps1`
   - 作用：等待网络、拉起 `node.exe`、写入状态文件、记录启动方式
   - 当前启动方式是 `direct_node_launch`

4. 健康检查脚本
   - 文件：`gateway/check_codex_feishu_gateway_health.ps1`
   - 作用：每隔几分钟巡检一次，发现网关消失或会话卡死时自动重启

5. 计划任务安装脚本
   - 文件：`gateway/install_codex_feishu_task.ps1`
   - 默认安装 3 个任务：
   - `CodexFeishuGateway`
   - `CodexFeishuGatewayBoot`
   - `CodexFeishuGatewayHealth`

6. 运行态目录
   - 不在本包内
   - 应放在 `<RUNTIME_ROOT>`
   - 保存状态文件、日志、附件缓存、用量台账

## 3. 消息处理链路

1. 用户在飞书中发送消息
2. 飞书通过长连接把事件投递给网关
3. 网关根据聊天类型和配置计算 `sessionKey`
4. 同一个 `sessionKey` 内串行，不同 `sessionKey` 之间可并行
5. 网关执行 `codex exec` 或 `codex exec resume`
6. Codex 输出文本、计划、进度或附件路径
7. 网关把结果回发到飞书

关键结论：

- 这套代码不是全局单队列
- 主要是按 `sessionKey` 做排队
- 在 `groupSessionScope = group_sender` 时，群聊里的不同发言人天然拆分到不同会话

## 4. 会话映射

私聊：

- 一个聊天通常对应一个 `sessionKey`

群聊：

- 当 `groupSessionScope = group_sender` 时
- `sessionKey` 形如 `<FEISHU_CHAT_ID>:sender:<FEISHU_OPEN_ID>`
- 这意味着同一个群里的不同发言人不会共用同一个执行队列

## 5. 群聊模式

当前现场使用的是：

- `groupAssistantMode = hybrid`

含义：

- 在群里优先做公共回答
- 同时保留每个发言人的独立执行上下文
- 允许保留公共群记忆、重点问题和最近消息摘要

## 6. 计划模式与卡片

主流程支持：

- `/plan`
- `/approve`
- `/cancel`
- `/progress`
- `/run`

卡片相关有两种路径：

1. 显示卡片但按钮不生效
   - `planCardsEnabled = true`
   - `cardCallbackEnabled = false`
   - `cardLongConnectionEnabled = false`

2. 卡片按钮可交互
   - HTTP 回调模式：`cardCallbackEnabled = true`
   - 或长连接卡片动作模式：`cardLongConnectionEnabled = true`

当前现场整理出的配置特征是：

- `planCardsEnabled = true`
- `cardCallbackEnabled = false`
- `cardLongConnectionEnabled = true`

## 7. 启动通知

系统支持开机自检后向指定飞书会话发送启动通知。

关键点：

- `startupNotifyChatIds` 指定通知目标
- `startupNotifyDeduplicatePerBoot = true` 用于避免同一次开机里的重复通知
- 当前代码支持把启动通知做成一次真实 Codex 回复，而不是纯网关硬编码文本

## 8. 附件收发

入站：

- 网关可下载飞书图片和文件到本地

出站：

- Codex 回复中追加一行绝对路径即可触发上传
- 例如 `[feishu-attachment] C:\path\to\file.pdf`

依赖条件：

- 路径必须是绝对路径
- 文件必须存在
- 目标飞书应用要有相应文件/图片权限
- 日志和运行态目录要可写

## 9. 可用性设计

这套结构为了应对断电、网络晚到、旧会话卡死等现场问题，补了几层兜底：

1. 启动脚本支持等待网络
2. 计划任务既有登录触发，也有开机触发
3. 健康检查任务定期巡检
4. 会清理 `activeRuns` 里的 stale run
5. 如果某个 `codexPid` 已不存在，会触发回收
6. 当前代码还加入了首个事件 watchdog

首个事件 watchdog 的意义：

- `gateway/codex_feishu_gateway.mjs` 里默认 `codexFirstEventTimeoutMs = 60000`
- 如果 `codex resume/start` 拉起后长时间没有任何 JSON 事件输出
- 会主动判定为 stalled 并中止，避免同一个会话被卡死很久

## 10. 关键脚本对照

- `gateway/codex_feishu_gateway.mjs`
  - 主消息网关
- `gateway/start_codex_feishu_gateway.ps1`
  - 入口启动脚本
- `gateway/check_codex_feishu_gateway_health.ps1`
  - 巡检与自动重启
- `gateway/install_codex_feishu_task.ps1`
  - 计划任务安装
- `gateway/report_feishu_group_usage.mjs`
  - 群聊使用情况统计
- `gateway/report_feishu_usage_ledger.mjs`
  - 用量台账统计

## 11. 迁移建议

迁移时不要复制现场运行态目录，而是：

1. 复制 `gateway/` 代码
2. 在新机器重新安装 Node.js 和 Codex CLI
3. 在新机器重新创建真实配置文件
4. 用新的飞书应用密钥、聊天 ID、运行态目录和工作区路径替换占位符
5. 先前台验证，再安装计划任务
