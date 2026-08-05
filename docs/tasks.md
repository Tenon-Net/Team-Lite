# 任务拆解

面向**由其他 Agent 独立执行**的任务清单。每个任务是一个冷启动 Agent 一次能做完的量。

**可直接复制粘贴的派活提示词在 `agent-prompts.md`。** 本文件是任务的单一事实来源，
提示词只做指路，不复述卡片内容。

## 给执行 Agent 的通用前置（每个任务都适用）

**动手前必读**（按顺序）：
1. `AGENTS.md` — 产品边界与工作纪律，尤其 §1 in/out of scope、§12 决策表
2. `CONTEXT.md` — 术语表。**代码里的命名必须用这里的词**
3. `docs/upstream-findings.md` — 上游机制勘察结论，避免重复摸索 110k 行代码
4. 本任务卡片指名的 ADR

**参考仓只读，不要改**：
- `C:\Project\HuHuHu\zzbody\AionCore` — Rust 后端
- `C:\Project\HuHuHu\zzbody\zbbody-new` — UI

**通用纪律**：
- 搬运类任务：**优先原样搬，不要顺手重构**。跟上游长得越像，以后读 diff 移植 bugfix 越省力（ADR 0002）
- 任何一处偏离上游的改动，追加到 `UPSTREAM.md` 的「已知的永久性分歧」表
- 遇到本卡片没覆盖的决策，**停下来问人**，不要自行拍板（AGENTS.md §6）
- 不要提交 commit，除非人明确要求

---

## 依赖图

```
A1 骨架
 ├─→ A2 api-types ─┐
 ├─→ A3 prompts ───┤
 └─→ A4 搬 team ───┴─→ C3 编译通过 ─→ D1 app 组装 ─→ D2 种子 ─→ F1 验收
                    ↑                      ↑
     B1 broadcaster ┤                      │
     B2 team store  ┤                E1 web 骨架
     B3 conv store  ┤                 ├─→ E2 ipcBridge
     B4 meta store  ┤                 ├─→ E3 搬 team UI
     B5 去 auth     ┤                 ├─→ E4 搬 conv utils
     B6 IWorkerTask ┤                 └─→ E5 删 provider UI
     B7 turn runner ┤
     C1 provisioning┤
     C2 service     ┘

M0 独立，且必须最先做
```

**可并行**：
- **B1 / B2 / B3 / B4 / B6** 互不依赖（都只依赖 A1 骨架 + 需要类型时的 A2）。
  但 B1–B4 同写 `crates/store`：**必须按文件 ownership 并行**（见 `agent-prompts.md` 第 4 批），
  禁止四人同时改 `lib.rs` / 同一文件。
- **B5** 依赖 A4；**B7** 依赖 B1 + B3 + B6；**C1** 依赖 A4 + B4 + B6；**C2** 依赖 C1。
- E1–E5 与整个 Rust 侧并行（E 内部：E2→E3 连带类型/hooks，E4 可与 E3 同批，E5 依赖 E3+E4）。

---

# M0 — ACP Spike

> **必须最先做。地基未验证之前不要开始搬运任务。**
> 若 M0 失败，ADR 0003 需重写，后续任务全部作废重议。

## M0-1 · 验证三个 CLI 能通过 ACP 跑通

**依赖**：无
**产出**：`spike/acp-probe/`（独立小 crate，**不进正式代码树**）+ 一份结论记录

**做什么**
用 `agent-client-protocol = "0.11.1"`（上游同款，见 `upstream-findings.md` §4）写一个最小客户端：
起 ACP 会话 → 发一个 prompt（如「列出当前目录的文件」）→ 打印流式输出 → 退出。

对三个本机 CLI 各跑一次：
```
claude -> C:/Users/Administrator/.local/bin/claude
codex  -> C:/Users/Administrator/AppData/Roaming/npm/codex
grok   -> C:/Users/Administrator/.grok/bin/grok
```

启动方式参考上游 `aionui-ai-agent/src/factory/acp.rs`（claude 走 `npx @zed-industries/claude-code-acp`
桥接，grok/codex 的接法从同一文件的 `is_grok_agent` 等分支反推）。

**验收**
- [ ] claude 通，**且全程未配置任何 API key / provider 环境变量**
- [ ] grok 通（预期走 `~/.grok` 自己的登录态）
- [ ] codex 通
- [ ] 三者的 `auth_methods` / `available_modes` / 权限模型差异写进
      `docs/upstream-findings.md` 新增一节（必须落盘，不能只在聊天报告里）

**失败时**：不要试图绕过。如实报告哪个 CLI 卡在哪一步，交回给人决策。
最关键的失败模式是「claude 不配 provider 就起不来」——那会直接推翻 ADR 0003。

---

# Phase A — 骨架与搬运

## A1 · 仓库骨架

**依赖**：M0 通过
**产出**：可 `cargo build` 的空 workspace（无业务代码）

**做什么**
- `git init`，默认分支 `main`（AGENTS.md §10）
- 建 cargo workspace，成员：`crates/{api-types,team-prompts,team,acp,store,app}`（先都是空 lib）
- 建 `vendor/aioncore-baseline/`（空目录 + `.gitkeep`）
- `.gitignore`：`target/`、`node_modules/`、`*.db`、`.env`
- Rust edition 与 toolchain 对齐上游（见 `AionCore/rust-toolchain.toml`）

**验收**：`cargo build` 通过，无 warning

---

## A2 · 搬 api-types 的 team 子集

**依赖**：A1
**产出**：`crates/api-types/`

**做什么**
从 `AionCore/crates/aionui-api-types/src/` 搬三个文件到 `crates/api-types/src/`：
`team.rs`(1608) + `team_tools.rs`(587) + `team_mcp.rs`(95)。

补齐它们引用的最小类型集（`WebSocketMessage` 等，从同目录其他文件里挑）。
**删掉引用不到的类型直到编译过**——不要为了凑编译把整个 api-types 搬进来。

同时把搬运的原始文件复制一份到 `vendor/aioncore-baseline/api-types/`。

**约束**：`api-types` 不得依赖 axum / tower 或任何 HTTP 框架（上游 AGENTS.md 的约定，沿用）

**验收**：`cargo build -p api-types` 通过；`vendor/aioncore-baseline/api-types/` 与搬入内容逐字节一致

---

## A3 · 搬 team-prompts

**依赖**：A1
**产出**：`crates/team-prompts/`

**做什么**
把 `AionCore/crates/aionui-team-prompts/`(645 行) 原样搬到 `crates/team-prompts/`，
只改 crate 名和 `Cargo.toml` 依赖路径。同时复制到 `vendor/aioncore-baseline/team-prompts/`。

**验收**：`cargo build -p team-prompts` 通过；内部单测全绿

---

## A4 · 搬 aionui-team 全量

**依赖**：A1、A2、A3
**产出**：`crates/team/`（**此时不要求编译通过**）

**做什么**
把 `AionCore/crates/aionui-team/src/` 全部 24,572 行搬到 `crates/team/src/`，包含
`work_coordinator/` 和 `team_run/`（ADR 0001 § 后果：它们是保真搬运的连带结果，本期不删）。

只改 import 路径（`aionui_api_types` → `api_types` 等），**业务逻辑一行不动**。
把 `tests/` 下 8 个集成测试一起搬。同时复制原始文件到 `vendor/aioncore-baseline/team/`。

编译会因为缺 `store` / `acp` / broadcaster 而失败——**这是预期的**，C3 负责收口。

**验收**
- [ ] 文件数与行数与上游一致（Windows 上用 PowerShell 统计 `*.rs` 行数，对得上 24,572）
- [ ] `vendor/aioncore-baseline/team/` 与搬入内容逐字节一致
- [ ] 除 import 路径外无其他 diff（用 `git diff --no-index` 或 `diff -ru` 自查并贴差异摘要）

---

# Phase B — 依赖替身

> **B1 / B2 / B3 / B4 / B6** 逻辑互不依赖，可并行；**B5 / B7** 有依赖，见各卡片。
> 每个都要先读 `upstream-findings.md` §2 的符号清单表，明确自己要实现的 trait 边界。
> `crates/store` 并行时按文件 ownership（`agent-prompts.md` 第 4 批），避免撞车。

## B1 · broadcaster

**依赖**：A1
**产出**：`crates/store/src/broadcaster.rs`（约 50 行）；若 store 尚无骨架则顺带建 `Cargo.toml` + `lib.rs` 预留 mod

实现 `EventBroadcaster` trait（team crate 唯一用到的 realtime 符号），
底层用 `tokio::sync::broadcast`。上游原实现见 `AionCore/crates/aionui-realtime/`。

**验收**：单测——多订阅者都能收到广播；订阅者掉线不影响其他订阅者

---

## B2 · team store（三表）

**依赖**：A1、A2
**产出**：`crates/store/src/team_repo.rs`（约 500 行）

实现 `ITeamRepository`，SQLite 三张表：`team` / `team_task` / `mailbox_message`。
Row 类型定义抄 `AionCore/crates/aionui-db/src/models/`（`TeamRow` / `TeamTaskRow` / `MailboxMessageRow`）,
字段必须完全一致——`crates/team` 里的 `from_row` 依赖它们。

关键方法（从 `crates/team/src/mailbox.rs` 和 `task_board.rs` 的调用点反推完整清单）：
`write_message` / `read_unread_and_mark` / `peek_unread` / `mark_read_batch` / `get_history` /
`delete_mailbox_by_team` 等。

**验收**
- [ ] store 侧单测：DDL、写入/未读/标记已读/按 team 删除等语义
- [ ] **不要求**本任务内跑通 `crates/team` 单测（team 在 C3 前故意编不过）
- [ ] 用真实实现替换 `MockTeamRepo` 跑 team 的 mailbox/task_board 单测 → **挪到 C3**

---

## B3 · conversation / message store

**依赖**：A1、A2
**产出**：`crates/store/src/conversation_repo.rs`（约 600 行）

两张表：`conversation` / `message`。
`upstream-findings.md` §2 列了 conversation 域 7 个调用；**落在 repo 的只有 4 个**：
`get` / `get_message_by_msg_id` / `insert_raw_message` / `mint_msg_id`。
其余（`run_agent_turn` / `cancel` / `create` / `wait_until_unclaimed`）由 **B7** 实现。

**不要**搬 `aionui-conversation` 的 service 层——那是 B7 的薄版职责。

**验收**：单测覆盖消息写入、按 msg_id 查重、按 conversation 拉历史

---

## B4 · agent_metadata / assistant store

**依赖**：A1、A2
**产出**：`crates/store/src/metadata_repo.rs`（约 300 行）

三张表：`agent_metadata` / `assistant_definition` / `assistant_overlay`。
Row 结构抄 `aionui-db/src/models/agent_metadata.rs:13` 和 `assistant.rs:42`。

实现 `IAgentMetadataRepository` + `IAssistantDefinitionRepository` + `IAssistantOverlayRepository`
的**读侧**方法（ADR 0004：保留 assistant catalog）。

**不要**实现 `IProviderRepository`（ADR 0003 已删掉这一层）。
若装配还需要少量 assistant 服务逻辑：最小实现并记入 `UPSTREAM.md`，**不要**搬 `aionui-assistant` 全量。

**验收**：能插入并读回一条 agent_metadata；`assistant_definition` 的 `agent_id` 外键能解析到 agent_metadata

---

## B5 · 去掉多用户与 auth

**依赖**：A4
**产出**：`crates/team/` 的相关改动

`crates/team` 只用到 `aionui_auth::CurrentUser` 一个符号。把它替换成单用户常量
（沿用上游 `system_default_user` 这个值，见 `types.rs` 测试里的 `TeamRow.user_id`）。

**验收**：`crates/team` 内不再有任何 `aionui_auth` 引用；改动追加到 `UPSTREAM.md` 分歧表

---

## B6 · IWorkerTaskManager 薄实现

**依赖**：A1、M0-1 的 spike 代码
**产出**：`crates/acp/` 的 manager 部分（约 600 行）

`crates/team` 用到 `ai-agent` 的 6 个符号（`upstream-findings.md` §2），核心是 `IWorkerTaskManager` trait。
把 M0 spike 的会话拉起逻辑固化：进程管理、会话新建/resume、生命周期、关闭。

`AgentInstance` / `AgentStreamEvent` / `AgentError` / `BuildTaskOptions` 这几个类型
按 `crates/team` 的使用方式定义最小版本，**不要照搬上游 41.5k 行的完整定义**。

**验收**：能起一个 claude ACP 会话、拿到 session id、正常关闭；进程无残留（`process_registry` 的行为参考上游）

---

## B7 · ACP turn runner

**依赖**：B1、B3、B6
**产出**：`crates/acp/` 的 turn runner 部分（约 1,200–1,800 行）
**这是新写代码里最大最难的一块，建议派给能力最强的 Agent。**

实现 `crates/team/src/ports.rs` 里的 `AgentTurnExecutionPort` 和 `AgentTurnCancellationPort`。
上游对应实现是 `AionCore/crates/aionui-app/src/router/team_conversation_adapters.rs`（**全文只有 378 行，
必读**），它转调 conversation service；我们直连 ACP。

要覆盖的行为（压缩自上游 `stream_relay.rs`(2591) + `turn_orchestrator.rs`(593) + `stream_persistence.rs`(649)）：
- 发 prompt，消费流式 `session/update` 通知
- 流式内容落库（走 B3 的 message store）+ 广播（走 B1 的 broadcaster）
- ACP 权限请求回调
- turn 取消（`session/cancel`）
- `on_started` 回调必须按 `ports.rs` 的契约触发——`event_loop.rs` 依赖它做 late-start 补取消
- 返回 `AgentTurnOutcome { conversation_id, turn_id, status, response_text, runtime }`

**验收**：能对一个 claude 会话跑完一个 turn，流式内容进了 message 表，`AgentTurnOutcome` 字段完整；
取消一个进行中的 turn 能干净返回

---

# Phase C — 拆耦合

## C1 · 重写 provisioning

**依赖**：A4、B4、B6
**产出**：`crates/team/src/provisioning.rs`（1,330 → 约 300 行）

**必读 ADR 0003。**

- **删掉** `provisioning.rs:587-596` 那个 `AgentType::Acp if backend == "claude"` 的强制 provider 分支
  （CPA 强绑坑），让 claude 走 grok 的可选语义
- **删掉** `AgentType::Aionrs` 整条路径与 `resolve_provider_for_model` / `resolve_claude_provider_for_model`
- 「建会话」从「创建 conversation」简化为「起 ACP 会话 + 记录 workspace」
- 保留 assistant_id 的解析路径（ADR 0004）

**验收**
- [ ] `crates/team` 内不再有任何 `IProviderRepository` 引用
- [ ] 不配任何 provider 也能走完建团流程
- [ ] 改动追加到 `UPSTREAM.md` 分歧表

---

## C2 · service.rs 去 provider

**依赖**：A4、B4、C1
**产出**：`crates/team/src/service.rs` 的改动

去掉 `IProviderRepository` 依赖，**保留** 3 个 assistant repo（ADR 0004）。
`service.rs` 有 3,669 行，只改依赖装配与受影响的调用点，**其余逻辑不动**。

**验收**：`service.rs` 内无 provider 引用；assistant catalog 相关的 MCP 工具
（`team_list_assistants` / `team_describe_assistant` / `team_spawn_agent`）路径完整

---

## C3 · 让 crates/team 编译通过

**依赖**：A4、B1-B7、C1、C2
**产出**：`cargo build -p team` 通过

收口任务。把所有替身接上，解决剩余编译错误。

**红线：不要为了让编译通过而改业务逻辑。** 遇到「必须改逻辑才编得过」的情况，
说明某个替身的接口做错了，回去改替身，不要改 `crates/team`。

横切：`aionui-common` 的 `AgentType` / `generate_id` / `now_ms` / `TimestampMs` 等做**最小本地拷贝**，
禁止引入整个 common crate。

**验收**
- [ ] `cargo build -p team` 通过
- [ ] `cargo test -p team --lib` 内部单测全绿（含 B2 延后的 MockTeamRepo 替换验证）
- [ ] `git diff --no-index`（或 `diff -ru`）对比 `vendor/aioncore-baseline/team/` 与
      `crates/team/src/` 的差异**全部**能在 `UPSTREAM.md` 分歧表里找到对应条目

---

# Phase D — 组装

## D1 · app 组装

**依赖**：C3
**产出**：`crates/app/`（约 400 行）+ 与 UI 的本地联调约定

axum 路由 + 依赖装配。路由从 `crates/team/src/routes.rs`(569 行) 的 `domain_routes()` 挂载。
加 WebSocket 端点供 UI 订阅事件（对接 B1 的 broadcaster）。

约定并写清：后端监听地址/端口；Vite `/api` 与 WS 代理目标（可与 E1 占位配置对齐）。

**验收**：`cargo run` 起得来，`/api/teams` 返回空列表，WebSocket 能连上；联调约定已写

---

## D2 · 运行时种子数据

**依赖**：D1、M0-1 的结论
**产出**：三条 `agent_metadata` 种子 + 对应 assistant 定义

按 M0 验证出来的实际启动参数，写入 claude / codex / grok 三条种子
（`command` / `args` / `env` / `auth_methods` / `available_modes` / `yolo_id` / `enabled`）。

**验收**
- [ ] 三条种子可经 API/DB 读回，并能用来拉起会话
- [ ] UI 成员选择器可见并拉起 → 依赖 E 侧就绪时验证；未就绪则标到 F1，不阻塞 D2 关卡

---

# Phase E — UI

> 与 Rust 侧完全并行，只依赖 A1。E 内部有顺序：E1 → E2 → E3（含 types/hooks）→ E4 → E5。
> **必读 ADR 0004。**

## E1 · web 骨架

**依赖**：A1
**产出**：`apps/web/`

Vite + React 19 + `@arco-design/web-react` + `@icon-park/react`。
**不要 Electron**（上游 UI 已全 HTTP 化，`ipcBridge.ts:10` 的注释是证据）。
预留 dev proxy：`/api`（及 WS）→ 后端占位端口（默认 `127.0.0.1:3000`，与 D1 对齐）。

**验收**：`vite dev` 起得来，浏览器打开是空白页不报错；proxy 配置存在

---

## E2 · 精简 ipcBridge

**依赖**：E1
**产出**：`apps/web/src/adapter/ipcBridge.ts`

上游原文件 2,303 行，全是 `httpGet` / `httpPost('/api/...')` 映射。
**只保留 team / conversation / agent 相关端点**，删掉 channel / office / cron / mcp / extension /
shell / file / system 的映射。

**验收**：文件内不再有已删域的端点；`apps/web` 在当前骨架下能编过（尚未搬 team 页时允许页面为空）

---

## E3 · 搬 team UI + 外部类型/hooks

**依赖**：E1、E2
**产出**：
- `apps/web/src/pages/team/`（48 文件 9,873 行）
- `common/types/team/*`、`adapter/teamMapper`（§6 约 31 处引用，**必搬**）
- `hooks/agent/*`、`AcpModelSelector`、`useModelProviderList` 等（§6 约 8 处，搬并可精简）

从 `zbbody-new/packages/desktop/src/renderer/pages/team/` 原样搬 pages。
外部依赖处理见 `upstream-findings.md` §6 的表格——**不要只搬 pages 漏 types/hooks**。

**原样搬，不要顺手重构**——UI 侧是 bugfix 的主战场（`upstream-findings.md` §7），
跟上游长得越像越好。

**验收**
- [ ] 文件数/行数与 pages/team 对齐；types/mapper/hooks 已就位
- [ ] 列出仍无法解析的 import（留给 E4/E5）
- [ ] `UPSTREAM.md` 记下 UI fork 点 `11b72ca`
- [ ] **不要求**本任务单独 tsc 全绿（E4/E5 之后再收口编译）

---

## E4 · 搬 conversation utils

**依赖**：E1（建议与 E3 同批或紧随其后）
**产出**：`apps/web/src/pages/conversation/utils/`

只搬 team 引用到的（上游被引用 13 次），主要是 `conversationCache`、
`conversationAssistantIdentity`。**不搬整个 conversation 页面。**

**验收**：E3 因 conversation utils 缺失而产生的 import 已解析；其余未解析项仍列出

---

## E5 · 删掉 provider 相关 UI

**依赖**：E3、E4
**产出**：UI 侧改动

删掉 4 处 CPA 坑的 UI 侧对应物：`claudeProviderRoute`、`useAionrsModelSelection`
（各被引用 2 次），以及 `pages/cron/cronUtils`、`AuthContext`（cron 不要，单用户）。

`teamCreateModelResolver.ts` 里的 provider 解析逻辑要一并清理——但**小心**，
这个文件是最近 bugfix 的重灾区（`a3375f5` +137 行），删之前先读懂它在解析什么。

**验收**：UI 内无 provider / cron / 多用户引用；`apps/web` 编译通过；改动追加到 `UPSTREAM.md` 分歧表

---

# Phase F — 验收

## F1 · M1 十步验收

**依赖**：D2、E5（含 D1 联调约定已落地）
**产出**：验收报告 + 完整日志

按 `docs/roadmap.md` 的 M1 验收脚本手动走一遍，10 步全过。

**已知风险**（roadmap 里已记）：第 5-7 步的收敛高度依赖 Lead prompt 调优。
**若卡在这里，单独计时并如实报告**，不要把 prompt 调优的时间混进工程进度。

---

## 派活建议

| 批次 | 任务 | 说明 |
|---|---|---|
| 第 1 批（串行） | M0-1 | 地基验证，必须先过；结论写入 findings |
| 第 2 批（串行） | A1 | 仅 M0 通过后；骨架 |
| 第 3 批 | A2 ∥ A3 ∥ E1+E2，然后 A4 | A4 依赖 A2+A3 |
| 第 4 批 | B1 / B2 / B3 / B4 / B6 / E3+E4 | store 按文件 ownership 并行 |
| 第 5 批 | B7 / B5+C1+C2 / E5 | B7 最难且依赖 B1+B3+B6 |
| 第 6 批（串行） | C3 | 收口，必须一个人做 |
| 第 7 批（串行） | D1 → D2 → F1 | 含 API/WS 联调；F1 要 UI |
