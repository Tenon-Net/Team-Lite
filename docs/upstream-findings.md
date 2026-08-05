# 上游勘察结论

对 `zzbody/AionCore`（Rust 后端）和 `zzbody/zbbody-new`（Electron UI）的一次完整勘察记录。

**这份文件的目的是避免重复勘察。** 上游依赖闭包 110k 行 Rust，重新摸一遍的成本很高。
下面所有行号都是勘察时的实际位置，上游更新后可能漂移，但结构性结论应当稳定。

勘察时的上游状态：`AionCore@2a69f63`、`zbbody-new@11b72ca`（分支 `refactor/local-dev`）。

---

## 1. 团队协作实际怎么跑

### 数据形态

- `Team` 是 SQLite 一行，`agents` 字段是一整块 JSON 数组（`aionui-team/src/types.rs:161`）。
  **成员没有独立表。**
- `TeamAgent { slot_id, name, role, conversation_id, backend, model, assistant_id, status }`
  ——每个成员强绑一个 conversation。
- 角色只有 `Lead` / `Teammate` 两种（`types.rs:13`）。
- `TeamTask { subject, description, status, owner, blocked_by[], blocks[] }`
  ——一个扁平任务板，带依赖边（`types.rs:269`）。
  状态只有 `pending / in_progress / completed / deleted`（`types.rs:235`），**没有返工状态**。

### Leader 怎么分活：靠 MCP 工具，不靠代码调度

内建 MCP server 给 agent 暴露 10 个工具（`mcp/tools.rs`）：

```
team_send_message      team_task_create     team_task_list
team_spawn_agent (Lead-only)                team_task_update
team_members           team_rename_agent    team_shutdown_agent
team_list_assistants   team_describe_assistant
```

**规划和分活的逻辑全在 Lead 的 prompt + 工具调用里**，后端只提供工具和持久化。
这是个重要的架构判断：编排的「智能」部分不在代码里。

`team_spawn_agent` 是 assistant-first 的——schema 里刻意不给 `model` / `backend`
（`mcp/tools.rs:57-64`），Lead 只能传 `assistant_id`。

### 驱动机制：mailbox + 每成员一个事件循环

`Mailbox` 是 SQLite 表（`mailbox.rs`），消息类型只有三种：
`message` / `idle_notification` / `shutdown_request`。

每个 slot 一个 tokio task（`event_loop.rs:138`）：

```
Notify 唤醒
  → prepare_next_batch
  → 把未读邮件拼成 prompt（WakePayload = agent + tasks + unread_messages）
  → AgentTurnExecutionPort::run_agent_turn
  → finalize_turn
```

冷启动时额外注入 role prompt（`AgentSlot.needs_role_prompt`，`scheduler/mod.rs:109`）。

**收敛条件**：全员 settled（`idle` / `completed` / `error`）→ 给 Lead 发 `IdleNotification`
唤醒它（`scheduler/mod.rs:68`）。这就是「回传」的实现——不是 Worker 主动汇报给 Leader，
而是调度器发现大家都停了，把 Leader 叫醒。

---

## 2. 耦合面比看起来窄得多

依赖闭包总量 109,667 行，但 team crate 实际用到的符号很少，且大多是 trait
（上游 ARCHITECTURE.md 明确要求「同层通过 trait 抽象交互」，缝已经在那儿了）：

| 依赖 crate | 行数 | team 实际用到的 | 可替换性 |
|---|---|---|---|
| `aionui-ai-agent` | 41,565 | `IWorkerTaskManager`(trait)、`AgentInstance`、`AgentStreamEvent`、`AgentError`、`BuildTaskOptions`、`ActiveLeaseRegistry` | **高** |
| `aionui-db` | 15,677 | `ITeamRepository`、`IConversationRepository`、`IAgentMetadataRepository`、`IAssistantDefinitionRepository`、`IAssistantOverlayRepository` + 8 个 Row | 中 |
| `aionui-api-types` | 13,497 | 只需 `team.rs`(1608) + `team_tools.rs`(587) + `team_mcp.rs`(95) = 2,290 | **高** |
| `aionui-runtime` | 6,735 | 子进程拉起（`Builder::agent` / `Builder::clean_cli`） | 中 |
| `aionui-auth` | 3,132 | 只有 `CurrentUser` | **高** |
| `aionui-common` | 2,169 | `AgentType`、`generate_id`、`now_ms`、`TimestampMs` 等 | 高 |
| `aionui-realtime` | 1,675 | 只有 `EventBroadcaster`(trait) | **高** |
| `aionui-team-prompts` | 645 | 全部 | 直接搬 |

### team 对 conversation 域只用 7 个方法

`AgentTurnExecutionPort` 的真实现**不在 team crate 里**，在
`aionui-app/src/router/team_conversation_adapters.rs`（全文 378 行）。team 只依赖 port。

这 378 行调用的 conversation 方法只有：

```
conversation_service.run_agent_turn()                    ← 核心
conversation_service.runtime_state().wait_until_unclaimed()
conversation_service.cancel()
conversation_service.create()
conversation_service.insert_raw_message()
ConversationService::mint_msg_id()
conversation_repo.get() / get_message_by_msg_id()
```

conversation 域生产代码约 14.8k 行（`aionui-conversation`，22,602 行里 7,818 是测试），
team 只需要这一小撮。核心的 `run_agent_turn` 对应上游的
`stream_relay.rs`(2591) + `turn_orchestrator.rs`(593) + `stream_persistence.rs`(649)。

### session.rs 意外地干净，service.rs 才脏

- `session.rs`(3081)：外部只依赖 4 个 trait + 纯 DTO，**没碰 conversation repo、没碰 provider repo**
- `service.rs`(3669)：依赖 5 个 db repo（含 3 个 assistant + 1 个 provider）+ 24 个 DTO
- `provisioning.rs`(1330)：conversation + provider 耦合的集中营

---

## 3. 重量集中在哪（可以甩掉的部分）

| 模块 | 行数 | 为什么存在 |
|---|---|---|
| `work_coordinator/` | ~1,800 | WorkIntent / WorkBatch / EnqueueLease / session_generation / CausalBinding / SlotPhase。为「并发 turn + 因果归属」服务 |
| `team_run/` | ~600 | TeamRun 因果树，把每次执行归因到某条 run |
| `scheduler/crash_recovery.rs` + wake 看门狗 + finalize 去重 | ~400 | 崩溃恢复与重复事件防护 |
| `scheduler/tests.rs` | 1,747 | 上游为并发正确性写的测试量，侧面说明这层的复杂度 |

**判断**：这一整层只为「用户随时插话 + 同 slot 并发 turn + 进程崩溃 + 取消整条 run」服务。
常驻会话本身的最小成本只有 `mailbox.rs`(288) + `event_loop.rs`(423) + `scheduler/*`(~800) ≈ 1.5k 行。
**常驻会话可以花 1.5k 行，也可以花 10k 行，差别不在「常驻」，在允许多少并发语义。**

---

## 4. 运行时已经插件化了，不用另设计

`AgentMetadataRow`（`aionui-db/src/models/agent_metadata.rs:13`）就是运行时注册表：

```rust
{ id, name, icon, description,
  backend, agent_type, agent_source, agent_source_info,
  enabled,
  command, args, env, native_skills_dirs,
  behavior_policy, yolo_id,
  agent_capabilities, auth_methods, config_options, available_modes }
```

**加一个运行时 = 插一行数据。** 不需要设计新的插件机制。

`auth_methods` 是 ACP 协议里 agent 自己宣告的认证方式——这才是「订阅登录 vs API key」
应该被处理的位置。

`AgentType` 只有两条真路径：
- `Acp` — 所有 CLI Agent 走这条，用 `backend` 字符串区分 claude / codex / grok
- `Aionrs` — 原生 API 直连，吃 provider 表

`Gemini` / `Codex` 两个枚举值已是 legacy，只为读旧数据（`aionui-common/src/enums.rs:15-26`）。

上游用官方库跑 ACP：`agent-client-protocol = "0.11.1"`
（`aionui-ai-agent/Cargo.toml:44`，开了 `unstable_session_resume` 等 feature）。
JSON-RPC、会话生命周期、流式通知、权限回调它都包了，**不需要自己实现协议**。

---

## 5. CPA 强绑坑：成因与修法

同一个产品里两种写法，claude 那条写得不一致：

```rust
// acp_launch_policy.rs:668  —— grok 的 provider 是「可选」
let Some(provider_id) = config.provider_id.as_deref()... else {
    return Ok(None);        // 没绑 provider 就用 CLI 自己的登录态（~/.grok）
};

// provisioning.rs:590  —— claude 在 team 路径下是「强制」
AgentType::Acp if backend.eq_ignore_ascii_case("claude") => {
    self.resolve_claude_provider_for_model(model).await?
        .ok_or_else(|| TeamError::InvalidRequest(format!(
            "no enabled Anthropic/CPA provider supports Claude team model: {model}")))?
        .id
}
```

**结论**：这不是架构约束，是 claude 分支的写法跟 grok 不一致。
根因是「provider 解析」被塞进了「创建会话」这一步——单聊 ACP 路径不吃这个约束，团队路径吃。

**修法**：删掉 `provisioning.rs:587-596` 这个 match 分支，让 claude 走 grok 的语义
（有 provider 就用，没有就让 CLI 用自己的登录态）。约 5 行改动，**模式是上游自带的，不是发明的**。

> 未实机验证。列为 M0 spike 的验收项。

---

## 6. UI：已经全 HTTP 化，Electron 只是壳

`packages/desktop/src/common/adapter/ipcBridge.ts:10` 的注释：

> *This file replaces the original IPC bridge calls with HTTP REST and WebSocket*

全文 2303 行都是 `httpGet` / `httpPost('/api/...')` 映射。那些「依赖 electron」的 team 文件，
实际只是 import 了 `ipcBridge`，底下走 HTTP。

上游已有无 Electron 的 web 模式：

```json
"@aionui/web-host": "WebUI host package - spawns backend and
 reverse-proxies to it; serves static files (no Electron dependency)"
```

**team UI = 48 个文件 9,873 行**，React 19 + Arco Design。外部依赖可控：

| 引用 | 次数 | 处理 |
|---|---|---|
| `common/types/team/*`、`adapter/teamMapper` | 31 | 搬 |
| `@arco-design/web-react` + `@icon-park/react` | 35 | 收下这两个依赖 |
| `pages/conversation/utils/*` | 13 | 搬（保留 conversation 域的决策本来就要） |
| `hooks/agent/*`、`AcpModelSelector`、`useModelProviderList` | 8 | 搬，精简 |
| `claudeProviderRoute`、`useAionrsModelSelection` | 4 | **删**（CPA 坑的 UI 侧对应物） |
| `pages/cron/cronUtils`、`AuthContext` | 7 | 删（cron 不要，单用户） |

---

## 7. team 逻辑是两层的——这条最容易踩坑

最近三个 `fix(team)` commit **全部只改 TypeScript，一行 Rust 都没动**：

```
11b72ca fix(team): confirm-only leader context rebuild and safer relay modes
a3375f5 fix(team): persist and reapply agent connection profile models
9d19413 fix(chat): stabilize context relay successor create and naming
```

涉及文件：`teamCreateModelResolver.ts`(+204)、`useTeamSession.ts`(+279)、`TeamPage.tsx`(+245)、
`TeamPermissionContext.tsx`、`collectSettledSyncTargets.ts`、`TeamWorkOverview/`、`TeamTabs.tsx`。

**「团队怎么用」的相当一部分逻辑住在 UI 里**——模型解析、权限、settled 同步目标收集、run 视图。
只搬 Rust 的 `aionui-team` 搬到的是骨架，这些血肉在 UI 仓。

---

## 8. 可借鉴 vs 必须甩掉

**可借鉴（已采纳）**
- mailbox 作为异步、可持久、可回放的回传通道
- task board 带 `blocked_by`（返工链就靠它表达）
- MCP 工具作为 Lead 的分活手段——对本机 CLI Agent 天然可用
- 「全员 settled → 唤醒 Lead」的收敛条件
- wake payload 的拼装方式（agent + tasks + unread）
- agent_metadata 作为运行时注册表
- grok 的「provider 可选」语义

**必须甩掉**
- `work_coordinator/` + `team_run/` 整套因果层
- provider 强制解析（CPA 强绑）与 `Aionrs` 运行时
- 20 crate 的四层分层与 `AppServices` 依赖注入中心
- Electron 外壳与 102 个 runtime 依赖
- channel / office / cron / mcp 市场 / extension / shell / file / system 等域
- 多用户与 auth 中间件

---

## 9. M0-1 实机 ACP 探针结果（2026-08-04）

探针代码：`spike/acp-probe/`（`agent-client-protocol` **0.11.1**，独立于 `crates/`）。
报告 JSON：`results/{claude,codex,grok}.json`（同内容副本在 `spike/acp-probe/results/`）。

运行方式（仓库根目录）：

```powershell
cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent claude
cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent codex
cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent grok
```

### 总表

| CLI | 结果 | 失败步骤 | 说明 |
|---|---|---|---|
| **codex** | **pass** | — | 流式返回 `ACP probe pass.`；`stop_reason=end_turn` |
| **grok** | **pass** | — | 流式返回 `ACP probe pass.`；走 `grok agent stdio` |
| **claude** | **fail** | `session/prompt` | `initialize` / `session/new` 成功；prompt 返回 `Authentication required` |

### 实测启动命令（D2 种子候选）

| Agent | executable | args | 底层 CLI |
|---|---|---|---|
| claude | `C:/Program Files/nodejs/npx.cmd` | `-y` `@agentclientprotocol/claude-agent-acp@0.39.0` | `C:/Users/Administrator/.local/bin/claude` (2.1.221) |
| codex | `C:/Program Files/nodejs/npx.cmd` | `-y` `@zed-industries/codex-acp@0.14.0` | `C:/Users/Administrator/AppData/Roaming/npm/codex` |
| grok | `C:/Users/Administrator/.grok/bin/grok` | `agent` `stdio` | 同左 |

### auth_methods / available_modes / 权限模型

**claude**
- `auth_methods`: `[]`（空数组）
- `available_modes`: `default` / `acceptEdits` / `plan` / `dontAsk` / `bypassPermissions`（`currentModeId=default`）
- 权限：探针未收到 permission request；stderr 提示 `permissions.defaultMode "auto"` 对模型 `haiku` 不可用，回退 `default`
- 关键：本机 `claude auth status` → `loggedIn: false`, `authMethod: none`
- **未**设置 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / provider 类环境变量（探针记录均为 false）

**codex**
- `auth_methods`: `chatgpt`（ChatGPT 订阅登录）、`codex-api-key`（`CODEX_API_KEY`）、`openai-api-key`（`OPENAI_API_KEY`）
- `available_modes`: `read-only` / `auto`(Default) / `full-access`（实测 `currentModeId=full-access`）
- 权限：无 permission request；有一条模型 metadata 警告（`gpt-5.6-luna` fallback），不影响 turn

**grok**
- `auth_methods`: `xai.api_key`、`cached_token`（`~/.grok/auth.json`）、`grok.com`
- `available_modes`: `null`（协议未宣告 modes）
- 权限：无 permission request；`GROK_HOME` 环境变量存在；`XAI_API_KEY` 未设置 → 实际走本地缓存/登录态

### 对 ADR 0003 的含义

1. **codex / grok**：在无 Team-Lite provider 表、无 AionUI provider 环境变量的情况下，ACP 一轮 prompt **已实机通过**。
2. **claude**：失败信息是 ACP `Authentication required`，**不是**上游 CPA 文案  
   `no enabled Anthropic/CPA provider supports Claude team model`。  
   同期 `claude auth status` 显示 **未登录**。因此：
   - **不能**据此推翻「去掉 provisioning 强制 provider」的代码修法；
   - **能**确定：本机在跑通 Lead=claude 之前必须先完成 **Claude Code 自身登录**（`claude login` / 订阅态），与「配 Anthropic API provider」是两件事。
3. 建议：人完成 `claude login` 后重跑  
   `cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent claude`  
   若登录后仍 fail，再重议 ADR 0003。

### 探针实现备注

- 进程清理在 Windows 上偶发 `taskkill` 对已退出子进程报错（中文控制台乱码），不影响 JSON 报告落盘。
- 写报告前需 `create_dir_all("results")`（已修）。
