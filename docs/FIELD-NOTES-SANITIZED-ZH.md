# 现场说明脱敏版

本文件是参照桌面现场记录 `codex-feishu.txt`、当前网关代码目录和运行方式整理出来的脱敏摘要。

目的：

- 帮你在另一台机器复现这套方案
- 保留关键架构和现场经验
- 去掉当前机器、当前用户和当前飞书应用的私有信息

## 1. 占位符说明

- `<GATEWAY_ROOT>`: 网关代码目录
- `<RUNTIME_ROOT>`: 网关运行态目录
- `<WORKSPACE_ROOT>`: Codex 实际工作的项目目录
- `<CODEX_HOME>`: Codex 本地目录
- `<CODEX_BIN>`: Codex 可执行文件
- `<MEDIA_ROOT>`: 飞书附件缓存目录
- `<FEISHU_APP_ID>`: 飞书应用 App ID
- `<FEISHU_APP_SECRET>`: 飞书应用密钥
- `<FEISHU_CHAT_ID>`: 飞书会话 ID
- `<FEISHU_OPEN_ID>`: 飞书用户 Open ID

## 2. 当前方案想解决什么问题

现场记录反复指向的是同一类需求：

1. Windows 机器断电或重启后要能自动恢复
2. 网络可能不是刚开机就可用
3. 网关上线后要主动通知指定飞书会话
4. 附件要能从飞书进来，也要能从本地回发到飞书
5. 复杂任务希望先走计划模式，再执行
6. 群聊里不同发言人不要共享同一个 Codex 执行上下文

## 3. 当前现场目录结构的脱敏表达

原机器上可以抽象成下面三层：

1. `<GATEWAY_ROOT>`
   - 存放源码、启动脚本、计划任务安装脚本

2. `<RUNTIME_ROOT>`
   - 存放真实配置、状态文件、日志、附件缓存、用量台账

3. `<CODEX_HOME>`
   - 存放 Codex 历史与 sessions

迁移时建议保持这个结构分离，不要把运行态和源码目录混在一起。

## 4. 当前现场配置画像

参照现场记录整理出的关键配置特征如下：

- `workspace = <WORKSPACE_ROOT>`
- `codexBin = <CODEX_BIN>`
- `groupSessionScope = group_sender`
- `groupAssistantMode = hybrid`
- `progressUpdates = true`
- `planCardsEnabled = true`
- `cardCallbackEnabled = false`
- `cardLongConnectionEnabled = true`
- `startupNotifyChatIds` 已配置
- `startupNotifyDeduplicatePerBoot = true`
- `codexTimeoutMs = 3600000`
- 源机器曾使用高权限 `codexArgs`

说明：

- 本包中的 `feishu_gateway.example.json` 是相对保守的通用模板
- 本包新增的 `feishu_gateway.current-sanitized.json` 更接近当前现场用法
- 如果新机器不需要高权限执行，可把 `codexArgs` 保持为空

## 5. 从现场记录提炼出的关键结论

1. 现场代码不是全局单队列
   - 真实行为是按 `sessionKey` 排队

2. 群聊里设置 `groupSessionScope = group_sender` 后
   - 队列粒度是“群 + 发言人”

3. 之前出现过“已读但不回”的问题
   - 核心不是飞书没收到消息
   - 而是旧 thread 的 `resume` 可能卡住

4. 之前的健康检查更擅长处理“进程消失”的 stale run
   - 不擅长处理“进程还活着但完全不产出事件”的假活锁

5. 当前代码已经补上首个 JSON 事件 watchdog
   - 默认 60 秒内没有事件就判定为 stalled
   - 这能避免同一个 `sessionKey` 被假活锁长时间占住

6. 当前更稳定的 Windows 启动方式不是旧式隐藏 PowerShell supervisor
   - 而是 `start_codex_feishu_gateway.ps1` 直接拉起 `node.exe`
   - 状态文件里会记录 `launchMode = direct_node_launch`

7. 健康检查仍然保留
   - 用于兜底处理网关消失、会话卡死、需要自动重启等情况

## 6. 当前现场的任务调度模型

计划任务侧至少包含三类职责：

- 登录后拉起
- 开机后拉起
- 周期性健康检查

这样做的原因是：

- 单靠一个登录触发不足以应对断电恢复
- 单靠一个长驻 supervisor 也不足以应对假活锁
- 周期性健康检查更适合做兜底回收

## 7. 本包为什么不包含现场运行态

下面这些内容都故意不打包：

1. 真实 `feishu_gateway.json`
2. 真实聊天 ID、Open ID、消息 ID
3. 真实日志
4. 真实 `history.jsonl`
5. 真实 `sessions`
6. 真实附件缓存

原因不是“这些东西没用”，而是：

- 它们包含当前机器和当前用户的私有信息
- 它们还会把旧 thread、旧状态、旧运行痕迹一起带到新机器
- 迁移到新机器时，重新生成干净运行态更安全

## 8. 迁移时最值得保留的经验

1. 代码和运行态分开
2. 配置文件单独放在 `<RUNTIME_ROOT>`
3. 启动前先验证 `codex` 本机能正常工作
4. 先前台 `auth-test`，再前台 `watch`
5. 测通后再安装计划任务
6. 如果新机器上还要跑本地训练/推理任务，再考虑 3090、CUDA、Python 环境

## 9. 建议的新机器默认值

如果目标机器主要做这套网关，建议：

- `<GATEWAY_ROOT>` 放到独立磁盘目录，例如 `D:\codex-feishu`
- `<RUNTIME_ROOT>` 放到当前用户目录下，例如 `C:\Users\<user>\.codex-feishu-gateway`
- `<WORKSPACE_ROOT>` 指向实际要让 Codex 工作的项目目录
- `<CODEX_BIN>` 先用 `codex`
- 先保持 `groupSessionScope = group_sender`
- 先保持 `groupAssistantMode = hybrid`

## 10. 一句话版本

这套系统不是简单的“飞书机器人”，而是一套面向 Windows 断电恢复、网络晚到、会话续跑、计划审批和附件回传场景设计的本地 Codex 网关；迁移时最重要的是复制代码和脚本，重新填写新机器配置，而不是复制旧机器运行态。
