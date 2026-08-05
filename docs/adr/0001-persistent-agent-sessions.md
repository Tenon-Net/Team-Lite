---
status: accepted
---

# 成员使用常驻 ACP 会话，而非一次性任务进程

每个 [[Member]] 是一个常驻的 ACP 长连接进程 + 一个事件循环，通过 mailbox 异步收发消息，
沿用上游 AionUi 的语义。选择它而不是「每个任务起一个一次性 CLI 进程」，是因为
Team-Lite 的目标是**功能对齐 zzbody**，而常驻会话是 Lead 能对跑到一半的 Teammate
追加指令、Teammate 之间能直接对话的前提。

## 考虑过的替代方案

**一次性任务进程**（`claude -p "<task>"` 跑完即退）能省掉 mailbox、唤醒循环、slot 状态机、
崩溃恢复、并发去重——上游那套约 1.5k 行可以整个不要，DAG runner 大约 200 行就够。
代价是失去「中途追加指令」和「Worker 互相对话」。

否决理由是产品定位：要对齐 zzbody，不是重新设计一个更窄的产品。

## 一个容易搞错的事实

**跨任务记忆与「进程是否常驻」是正交的。** 上游自己就有
`agent_session_flow.rs:149` 的 `open_session_resume(session_id)` 和
`factory/acp.rs:264` 的 session id 持久化——记忆来自「存一个 session id 然后 resume」，
CLI 在磁盘上持久化会话，进程退出不丢。

所以本 ADR 买到的**不是**记忆，只是「中途可干预」和「成员间可直连」。
如果将来发现这两点用不上，回退到一次性进程是可行的，且不会丢记忆能力。

## 后果

常驻会话的成本高度依赖并发语义的宽严：

- **最小实现**（`mailbox` + `event_loop` + `scheduler`）约 1.5k 行——一个成员同时只跑一个 turn，
  新消息进队列等下一轮，取消 = 杀进程
- **上游完整语义**额外需要 `work_coordinator/`(~1.8k) + `team_run/`(~0.6k)——并发 turn、
  因果归属到 TeamRun、租约与代际、late-start 补取消

**本项目取上游完整语义**，因为 ADR 0002 决定整体搬运 `aionui-team` 全量 24,572 行，
而这两个模块就在该目录内，随之而来。这不是单独权衡过的选择，而是「保真搬运」的连带结果。

若将来要瘦身，`work_coordinator/` 是第一个候选——它是 team crate 里复杂度最高、
与产品价值关联最弱的部分（上游为它写了 1,747 行测试）。删它需要同时改 `session.rs` 和
`event_loop.rs` 的调用点。
