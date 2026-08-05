---
status: accepted
---

# 保留会话/消息域，并原样搬运上游 team UI

保留真正的 conversation/message 持久化（不只是 `last_message` 摘要预览），
并把上游 `pages/team` 的 48 个文件 9,873 行 React 原样搬过来，跑在本地 web（Vite + React 19 + Arco），
不要 Electron。目标是**功能对齐 zzbody**——你在界面上要能回看每个成员的完整对话，
而不只是看到状态和一句摘要。

## 为什么必须搬 UI 而不是自己写一个薄的

因为**团队逻辑是两层的**。最近三个 `fix(team)` commit 全部只改 TypeScript，一行 Rust 都没动：
`teamCreateModelResolver.ts`(+204)、`useTeamSession.ts`(+279)、`TeamPage.tsx`(+245)、
`TeamPermissionContext.tsx`、`collectSettledSyncTargets.ts`。

模型解析、权限、settled 同步目标收集、run 视图——这些「团队怎么用」的血肉住在 UI 里。
只搬 Rust 搬到的是骨架。自己重写 UI 等于放弃跟进上游一半的 bugfix。

## 为什么不用 Electron

上游 UI 已经完全 HTTP 化，Electron 只是个外壳。
`ipcBridge.ts:10` 的注释：*This file replaces the original IPC bridge calls with HTTP REST and WebSocket*，
全文 2303 行都是 `httpGet` / `httpPost('/api/...')`。上游自己就有无 Electron 的 web 模式
（`@aionui/web-host`）。

## 成本

conversation 域生产代码约 14.8k 行，但 team 对它**只用 7 个方法**
（`team_conversation_adapters.rs` 全文 378 行验证，清单见 `../upstream-findings.md` §2），
所以只需写一个约 1.8k 行的薄 ACP turn runner + 600 行消息 store，
压缩自上游 `stream_relay.rs`(2591) + `turn_orchestrator.rs`(593) + `stream_persistence.rs`(649)。

UI 侧约 13k 行 TS。外部依赖可控，收下 `@arco-design/web-react` 和 `@icon-park/react` 两个依赖，
删掉 cron、多用户 auth、以及 provider 路由相关的 4 处引用。

## 相关决策

同一逻辑下也保留了 assistant catalog 全套（`team_spawn_agent` 等 10 个 MCP 工具原样、
2 张 assistant 表、目录 UI）。虽然目标用例只有三个固定成员用不上 Lead 自动扩编，
但保留它使 MCP 工具契约与上游零 diff。

已确认 `AssistantDefinitionRow` 只指向 `agent_id` 和 `default_model_value` 字符串，
**不指 provider**——保留 assistant 不会把 ADR 0003 删掉的 provider 层拖回来。
