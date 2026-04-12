# 架构说明

## 1. 项目现在的定位

这套系统现在分成两层：

- `gateway/`：Feishu 和 Codex 的本地执行网关
- `skills/`：可跨设备复用的 Codex skill 层

它已经不是单纯的“把某台 Windows 机器迁过去”。
它现在更像一个公共框架仓库，负责承载：

- Feishu 消息入口
- Codex 会话调度
- 附件收发
- 启动和自恢复
- 长任务后台运行规范
- 公开 skill 分发

## 2. 核心组件

### `gateway/`

这一层负责把 Feishu 消息变成对本地 Codex 的调用。

核心文件：

- `gateway/codex_feishu_gateway.mjs`
- `gateway/start_codex_feishu_gateway.ps1`
- `gateway/check_codex_feishu_gateway_health.ps1`
- `gateway/install_codex_feishu_task.ps1`
- `gateway/run_codex_feishu_gateway_supervisor.ps1`

主要能力：

- Feishu 长连接收消息
- 聊天到 Codex 会话的映射
- 计划模式和普通模式透传
- 入站附件下载
- 出站 `[feishu-attachment]` 上传
- 启动通知
- 健康检查和自动重启
- 成员导出和统计脚本
- 定时报送脚本入口

### `skills/`

这一层负责跨设备复用行为规范，而不是只靠某台机器的脚本约定。

当前 public 技能：

- `skills/codex-feishu-gateway`
- `skills/long-task-orchestrator`

其中：

- `codex-feishu-gateway` 负责部署、迁移、排障网关
- `long-task-orchestrator` 负责长任务后台化、ETA、里程碑汇报、完成提醒和可恢复状态

## 3. 消息处理路径

标准链路如下：

1. 用户在 Feishu 发消息
2. 网关接收 `im.message.receive_v1`
3. 网关根据聊天类型和配置生成 `sessionKey`
4. 同一个 `sessionKey` 串行执行，不同 `sessionKey` 并行执行
5. 网关调用本地 Codex
6. Codex 返回文本、规划结果、附件路径或长任务状态
7. 网关把结果回发到 Feishu

## 4. 长任务处理路径

长任务不应该只靠网关前台阻塞等待。

现在公开建议的路径是：

1. 先由 skill 判断是否进入长任务模式
2. 给出粗略 ETA
3. 启动后台进程
4. 落盘 `status.json`、日志和可恢复结果
5. 按里程碑而不是固定小时数汇报
6. 结束时发送完成或失败通知

这部分规范放在：

- `skills/long-task-orchestrator/`

## 5. 运行态与仓库内容的边界

仓库里放的是可复用框架。
运行时状态不进仓库。

典型运行态内容：

- `.codex-feishu-gateway/`
- 日志
- 媒体缓存
- 状态文件
- 本机真实配置
- 长任务运行目录

这些都应保持本机或 private 层，不应进入 public 仓库。

## 6. public 与 private 的分工

### public

适合放：

- 网关代码
- 公开 skills
- 脱敏配置模板
- 部署文档
- 公开通用脚本

### private

适合放：

- 科研代码
- 任务专用脚本
- 私有 skill
- 敏感配置
- 数据接口
- 实验输出

详细边界见：

- `docs/PUBLIC-PRIVATE-BOUNDARY-ZH.md`

## 7. 建议的长期形态

长期推荐形态不是一个仓库包打天下，而是：

- public 框架仓库
- private 科研仓库
- 每台机器本地运行态目录

Agent 的同步顺序应当是：

1. 先同步 public 框架
2. 再同步 private 任务层
3. 最后挂上本机真实配置和运行态目录

对应说明见：

- `docs/AGENT-SYNC-WORKFLOW-ZH.md`
- `templates/private-companion-repo/README-ZH.md`
