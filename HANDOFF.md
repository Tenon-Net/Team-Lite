# Team-Lite — Agent 交接文档

> **给下一位 Agent / 换机开发用。** 读完本文件 + 文末「必读清单」即可继续干活。  
> 最后更新：2026-08-05 · 基线提交：`0bda182`（`main`）· 远端：https://github.com/Tenon-Net/Team-Lite.git

---

## 0. 30 秒定位

| 项 | 内容 |
|----|------|
| 产品 | **Team-Lite**：小多 Agent 编排（Lead 规划 → Worker 执行 → 结果回汇），**不是**全功能 AI 桌面套件 |
| 仓库 | 本目录是**主产品代码**；上游 ZBBody/AionCore 仅参考 |
| 栈 | Rust workspace（编排 + axum）+ `apps/web`（Vite + React 19 + Arco） |
| 默认端口 | 后端 `127.0.0.1:3000`，前端 Vite `5173`（代理 `/api`、`/ws`） |
| 当前水位 | **建团 / ensure session / 发消息 / ACP 短 turn / 消息落库** 已通；**M1 完整十步未验收** |

**核心环（产品中心，任何改动先问：是否服务它？）**

```text
User goal → Leader（plan/split/assign）→ Workers 执行 → 结果回 Leader → 继续或结束
```

---

## 1. 换机冷启动

### 1.1 依赖

- Rust（见 `rust-toolchain.toml`）
- Node.js + npm（`apps/web`）
- （可选实机 Agent）本机已登录的 CLI：
  - **grok**（Lead/Worker smoke 已验证）
  - **codex**（Worker smoke 已验证）
  - **claude**（M0 曾因订阅/登录未通，工程上可先用 grok 当 Lead）

路径因机器而异；种子里写死了部分 Windows 路径（见 §5），**换机必改** `crates/app/src/seed.rs`。

### 1.2 拉代码

```bash
git clone https://github.com/Tenon-Net/Team-Lite.git
cd Team-Lite
git checkout main
git pull
# 建议：git config user.name / user.email（仓库首提使用了 Team-Lite@local，勿假定身份）
```

### 1.3 后端

```bash
cargo build -p app
cargo test -p team --lib          # 期望 ~405 通过（以当前 main 为准）
$env:RUST_LOG="info"              # PowerShell
$env:TEAM_LITE_ADDR="127.0.0.1:3000"
# 可选：独立数据目录，避免和别的实例混用
# $env:TEAM_LITE_DATA="$env:TEMP/team-lite-dev"
cargo run -p app
```

冒烟：

```bash
curl -s http://127.0.0.1:3000/health          # ok
curl -s http://127.0.0.1:3000/api/teams       # {"success":true,"data":[...]}
```

### 1.4 前端

```bash
cd apps/web
npm install
npm run dev
# 浏览器 http://127.0.0.1:5173
# / → 团队列表；/team/:id → TeamPage（仍有 stub）
npm run build    # 应通过（tsc + vite）
```

### 1.5 进程纪律（重要）

- 重启后端时**只**结束本仓库的 `team-lite` / `cargo run -p app`，**不要** `Stop-Process grok`（用户本机 Grok CLI 可能正在用）。
- ACP turn 会**短生命周期**再起 agent 子进程；结束后可能有清理子进程的日志，属当前设计。

---

## 2. 已完成什么（可依赖）

### 2.1 工程批次（对照 `docs/tasks.md`）

| 阶段 | 状态 | 说明 |
|------|------|------|
| M0 ACP spike | 部分 | 结论在 findings；claude 曾 waiver；codex/grok 可通 |
| A/B/C 骨架+替身+team 编译 | 完成 | `cargo test -p team --lib` 绿 |
| C1/C2 去 provider | 完成 | 无业务层 `IProviderRepository` 注入；CLI 登录 |
| D1 app 组装 | 完成 | axum + team routes + `/ws` |
| D2 种子 | 完成 | claude/codex/grok + asst-*（路径见 seed） |
| E1–E5 UI | 中间态 | 能编能开；team 页大量 `@ts-nocheck` + stub |
| F1 | 部分 | conversation API + 薄 AcpChat；**十步验收未完成** |

### 2.2 已验证 API 行为（2026-08-05 smoke）

1. `POST /api/teams` 建团（**agents 勿传 `backend` 字段**，`deny_unknown_fields` 会 400；backend 由 `assistant_id` 解析）
2. `POST /api/teams/:id/session` ensure → 成员 attach（日志 success_count）
3. `POST /api/teams/:id/agents/:slot_id/messages` body `{"content":"..."}` → accepted
4. `GET /api/conversations/:id` → type=acp、extra.workspace/backend
5. `GET /api/conversations/:id/messages` → 用户消息 + **助手回复落库**
6. Lead **grok** 短回复（如 `PONG`）通；Worker **codex** 短回复通（可能夹杂模型 metadata 噪声）

建团 body 示例：

```json
{
  "name": "demo",
  "workspace": "C:/path/to/workspace",
  "agents": [
    { "name": "Lead", "role": "lead", "model": "default", "assistant_id": "asst-grok" },
    { "name": "Worker", "role": "teammate", "model": "default", "assistant_id": "asst-codex" }
  ]
}
```

种子 assistant_id：`asst-claude` / `asst-grok` / `asst-codex`。

### 2.3 关键修复（接手时别回退）

- **`AcpTurnPort`**（`crates/team/src/acp_turn_adapter.rs`）：从 `conversation.extra` 解析 `backend` / `workspace`，不要写死只用默认 data_dir。
- **无 CPA 强绑**：`provisioning` / `service` 不注入 provider 表（ADR 0003）。
- **Conversation HTTP**（`crates/app/src/conversation_routes.rs`）：GET/PATCH conversation + list messages，UI 依赖这些。

---

## 3. 架构速览

```text
apps/web          Vite UI → /api、/ws 代理到 3000
crates/app        二进制 team-lite：组装 Memory* store、种子、team_routes、conversation_routes、WS
crates/team       编排域（从 aionui-team 选择性搬运）：session、mailbox、task_board、event_loop、MCP tools…
crates/acp        短生命周期 ACP turn（spawn → handshake → prompt → stream → kill）
crates/store      Memory 实现 + EventBroadcaster（v1 非 SQLite 落盘）
crates/api-types  team DTO
crates/team-prompts / team-common / team-auth
spike/acp-probe   M0 探针（可参考，非正式运行时）
vendor/aioncore-baseline  上游对照基线（同步用）
```

**执行模型（ADR 0001）**：团队 session + mailbox + 每 slot 事件循环；turn 当前实现偏 **B7 短会话**（每次 turn 新起 CLI），与 warmup attach 并存——**这是下一阶段最值得理清的设计点**。

---

## 4. 明确未完成 / 已知坑

| 项 | 说明 |
|----|------|
| M1 十步 | Lead 规划 → 结构化任务板 → multi-agent 修正闭环 **未跑通验收** |
| UI | `pages/team` 多文件 `// @ts-nocheck`；cron/provider/aionrs 多 stub；AcpChat 为薄实现（发消息+轮询） |
| 持久化 | Memory store，**重启丢团** |
| Turn vs warmup | 短 turn 与长 attach 双轨，易重复起进程、偶发挂死；换机后若 turn 卡住先查 workspace 路径与 CLI 登录 |
| Claude Lead | 未作为默认实机路径；用 grok Lead 可继续工程 |
| 建团 JSON | 禁止 agents[].backend；用 assistant_id |
| 广播无订阅 | 无浏览器连 `/ws` 时日志 `broadcast failed: no active receivers` 可忽略 |
| 提交作者 | 首提可能是 `Team-Lite <team-lite@local>`，请配置自己的 git identity |

---

## 5. 换机必改清单

1. **`crates/app/src/seed.rs`**：`command`/`args` 指向本机 grok/npx/claude 路径（Windows 曾写死 Administrator 路径）。
2. **`LaunchConfig`**（`crates/acp/src/launch.rs`）：PATH 解析 + 回退路径，换机验证 `which`。
3. **workspace 路径**：建团时的 `workspace` 用本机可写目录。
4. **不要提交** `.env`、真实 API key、本机绝对路径的私货配置。

---

## 6. 建议下一步（按优先级）

严格服务核心环；细节也可对照 `docs/roadmap.md` M1、`docs/tasks.md` F1。

### P0 — 编排可验收

1. **API 级 goal smoke**：ensure 后给 Lead 一个真实目标（非 PONG），观察：
   - 是否有 MCP tool 调用（`team_task_create` 等）
   - `team_task` / run-state / mailbox 是否出现结构化任务  
2. 若 Lead 不建任务 → **prompt 调优单独立项**（roadmap 已警告，勿与工程混算工期）。
3. **理清 session**：是否复用 warmup 的 ACP 连接，还是继续每 turn 新起（现实现）。

### P1 — UI 可用

1. TeamPage：消息列表 + 发送 + runtime 状态（少 stub）。
2. 逐步去掉 `@ts-nocheck`，按文件修。
3. WS 订阅替代纯轮询（可选）。

### P2 — 产品化

1. SQLite 持久化（决策表已定 SQLite，实现可仍是 Memory）。
2. Claude Lead 实机（订阅可用时）。
3. M1 十步手跑 + 日志归档。

### 不要做

- 搬完整 ZBBody / Electron / MCP 市场 / 桌宠  
- 恢复 provider 商城或 claude 强制 CPA  
- 为编译通过乱改 `crates/team` 业务逻辑  
- 无批准 force-push `main`

---

## 7. 常用命令速查

```bash
# 测试 / 构建
cargo test -p team --lib
cargo build -p app
cd apps/web && npm run build

# 分支
git checkout -b feat/your-topic
# … 改完 …
git push -u origin HEAD
```

建团 + 发消息（PowerShell 示例见 `docs/local-dev.md`；curl 注意 JSON 文件无 BOM）。

---

## 8. 必读清单（按顺序）

1. **本文件** `HANDOFF.md`
2. `AGENTS.md` — 范围、红线、§12 决策表  
3. `CONTEXT.md` — 术语（代码命名必须对齐）  
4. `docs/local-dev.md` — 联调端口与路由  
5. `docs/roadmap.md` — M1 十步验收定义  
6. `docs/tasks.md` — 任务拆解  
7. `UPSTREAM.md` — 与上游永久分歧  
8. `docs/e3-unresolved-imports.md` — UI 洞与 stub  

可选：`docs/adr/0001`–`0004`，`docs/upstream-findings.md`。

---

## 9. 给 Agent 的工作协议

1. **先读** §0–§2 与 `AGENTS.md`，再改代码。  
2. **小步提交**；功能分支；不 force-push `main`。  
3. **验证再声称完成**：跑相关 `cargo test` / `npm run build` / API smoke。  
4. 改 CLI 路径只动 seed/launch，**不要**提交用户密钥。  
5. 杀进程只针对 **team-lite**，尊重用户本机 grok/codex。  
6. 不确定是否 in-scope → 问人或标 `later`，禁止 scope creep。  
7. 更新本 `HANDOFF.md` 的「最后更新 / 基线 commit / 已完成 / 未完成」再交下一棒。

---

## 10. 一句话给下一棒

> 仓库已是可跑的 Team-Lite：Rust 编排 + 本地 Web；**grok Lead / codex Worker 短 turn 已实测落库**。下一棒优先做 **真实 goal 下的任务板/多轮闭环** 与 **turn-session 模型整理**，UI 只补核心可见性，不要回头搬完整上游桌面。
