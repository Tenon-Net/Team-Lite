# CONTEXT

Team-Lite 的术语表（ubiquitous language）。

**这份文件只定义术语。** 不写实现细节、不写决策理由、不当 spec 用。
决策理由见 `docs/adr/`，上游机制见 `docs/upstream-findings.md`。

---

## Team

一组协作的 Agent 成员，绑定一个 workspace 目录。团队是长期存在的，不随一次协作结束而消失。

## Member（成员）

团队里的一个 Agent。每个成员有一个角色（[[Lead]] 或 [[Teammate]]）和一个 [[Runtime]]。
上游代码中称作 slot，`slot_id` 是成员在团队内的唯一标识。

## Lead

负责规划、派活、汇总的成员。**一个团队只有一个 Lead。**

## Teammate

执行成员。一个团队可以有多个。

> 本项目的典型配置是 grok 承担执行、codex 承担 review。
> **这是 prompt 层面的分工，不是新角色**——两者在模型里都是 Teammate。

## Goal

人提给团队的一个顶层目标，触发一次协作。Lead 收到 Goal 后把它拆成若干 [[Task]]。

## Task

Lead 拆出的结构化任务，不是聊天散文。有 owner（某个成员）和 `blocked_by` 依赖关系。

状态：`pending` / `in_progress` / `completed` / `deleted`

## Turn

一个成员被唤醒后执行的一轮。**一个成员同时只有一个活跃 Turn。**

## Mailbox

成员之间的异步消息通道。消息在成员被唤醒时成批投递。

消息类型：`message` / `idle_notification` / `shutdown_request`

## Settled

描述成员的一种状态集合：处于 `idle`、`completed`、`error` 三者之一时，该成员为 settled。

**全员 settled 是唤醒 [[Lead]] 的触发条件**——这是一次协作从「大家在干活」收敛到
「Lead 该看结果了」的判定点。

## Runtime（运行时）

一个可被拉起的本机 CLI Agent（claude / codex / grok），通过 ACP（Agent Client Protocol）通信。

运行时注册在 agent_metadata 表里，**一行数据 = 一个运行时**。新增运行时不需要改代码。

## Assistant

一个可被 [[Lead]] 挑选的成员模板：名字、描述、技能、默认模型与权限。指向某个 [[Runtime]]。

Lead 扩编时挑的是 Assistant，不是 Runtime。

## Rework（返工）

**不是一个状态。**

[[Teammate]] 做的 review 不通过时，[[Lead]] 新建一个修正 [[Task]]，用 `blocked_by`
挂在 review 任务上，形成链条。

> 刻意记在这里：`TaskStatus` 只有四个值，不要往里加 `rejected` / `rework`。
> 返工是靠任务链表达的，不是靠状态位。
