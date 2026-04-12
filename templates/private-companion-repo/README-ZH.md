# Private 配套仓库模板

这个模板不是让你现在就把敏感代码塞进 public 仓库。

它的作用是给后续 private 仓库预留一套清晰接口。

## 推荐仓库名

- `openclaw-research-private`
- 或 `openclaw-research-tasks-private`

## 这个 private 仓库应该放什么

- 科研任务代码
- 私有 skill
- 实验脚本
- 项目专用 docs
- 敏感配置模板
- 数据接入说明

## 推荐目录

```text
private-research-repo/
  tasks/
  skills-private/
  scripts/
  docs-private/
  configs/
  outputs/
```

## 和 public 仓库怎么配合

推荐关系是：

1. public 仓库提供公共框架
2. private 仓库提供课题层和敏感层
3. 每台机器本地再挂真实配置和运行态

Agent 同步顺序：

1. 先拉 public
2. 再拉 private
3. 最后装载本机真实配置

## private 里哪些内容不要再复制

不要在 private 仓库里复制这些 public 内容：

- 通用网关本体
- 通用启动脚本
- 公共 README
- 公共 skills

否则后面 public 和 private 会很快分叉，维护成本会升高。

## private 里建议保留的扩展接口

推荐在 private 仓库里约定下面几个位置：

- `skills-private/`
  - 私有科研 skill
- `tasks/`
  - 具体项目代码
- `configs/`
  - 不入 public 的配置模板
- `docs-private/`
  - 只对你自己或小范围协作者可见的流程说明

## 一句话原则

public 解决“框架复用”，private 解决“任务差异化”。
