# Team-Lite — 单一交接与开工说明书

**你是在本仓库继续开发的 AI coding agent。**  
**只读本文件即可开工，不需要人类再贴额外提示词。**  
读完后立刻按「§2 启动清单」执行，然后按「§3 当前最高优先任务」推进。不要空转复述文档。

| 元数据 | 值 |
|--------|-----|
| 文档角色 | 会话主指令 + 换机交接 + 任务队列 |
| 仓库 | https://github.com/Tenon-Net/Team-Lite.git |
| 默认分支 | `main` |
| 文档更新时基线 commit | 以 `git log -1 --oneline` 为准；写本版时约 `1a15466`（含本文件）+ 父提交 `0bda182` |
| 语言 | 对人用**中文**；代码标识符**英文**；UI 文案默认中文 |

同目录还有 `AGENTS.md`、`CONTEXT.md`、`docs/*`——**细节冲突时以本文件「产品边界 + 决策摘要」为准**；术语命名对齐 `CONTEXT.md`（若存在）。

---

## §1 你是谁、在建什么

### 1.1 产品

**Team-Lite** = 小型多 Agent **编排**产品，不是全功能 AI 工作台 / Electron 套件。

**唯一产品中心（核心环）：**

```text
用户目标
  → Leader（规划 / 拆分 / 指派）
  → Worker(s) 执行
  → 结果回 Leader（汇总 / 继续或结束）
```

任何改动先判断：是否服务上述环？否则拒绝或标 `later`。

### 1.2 范围内（v1）

- 创建 / 打开 **team**
- 一个 **Leader** + ≥1 **Worker**
- 提交顶层 **goal**，观察 **任务状态 + 日志**
- 最少配置即可跑（本机 CLI 登录：grok / codex / 可选 claude）

### 1.3 范围外（禁止擅自做）

- 完整 chat workbench 当主产品
- 支持「所有 CLI」自动发现
- MCP 市场、IM、cron、远程控制当产品支柱
- 桌宠 / 营销皮
- 与完整 ZBBody/AionUi 功能对等
- 默认捆绑重 Electron + 全量 AionCore
- 恢复 **CPA / provider 表强绑** claude（ADR 0003 已删）

### 1.4 仓库关系

- **本仓库 = 主产品代码**
- 上游参考（可能不在本机）：`zbbody-new`（UI）、`AionCore`（Rust）——只读参考，不「修上游」当 Team-Lite 工作
- 分歧与同步：`UPSTREAM.md`、`vendor/aioncore-baseline/`

### 1.5 技术栈与布局

```text
team-lite/
  HANDOFF.md          ← 你正在读的主指令
  AGENTS.md / CONTEXT.md / UPSTREAM.md
  docs/               roadmap、tasks、adr、local-dev、findings…
  crates/
    app/              二进制 team-lite：axum 组装
    team/             编排域（选择性搬运 aionui-team）
    acp/              短生命周期 ACP turn
    store/            Memory 仓储 + broadcast（重启丢数据）
    api-types/ team-prompts/ team-common/ team-auth/
  apps/web/           Vite + React 19 + Arco
  spike/acp-probe/    M0 探针（非正式运行时）
  vendor/aioncore-baseline/
```

- 后端默认：`127.0.0.1:3000`（`TEAM_LITE_ADDR`）
- 前端：`5173`，代理 `/api`、`/ws` → 3000
- 单用户：`CurrentUser::system_default()`，无登录头

### 1.6 已拍板决策（摘要）

| 主题 | 决定 |
|------|------|
| UI | 本地 Web，无 Electron |
| 编排语言 | Rust（选择性 port aionui-team） |
| Worker 运行时 | claude / codex / grok，经 ACP |
| 鉴权 | CLI 自有登录；**无**强制 API provider 表 |
| 持久化目标 | SQLite；**当前实现仍是 Memory** |
| 执行模型 | 持久 session 意图 + mailbox + 事件循环；**turn 实现多为每 turn 新起 CLI** |
| 框架 | 不用 CrewAI / LangGraph |

---

## §2 启动清单（每次会话按序做）

复制执行，失败再排障。

### 2.1 仓库与身份

```bash
# 若尚未 clone：
# git clone https://github.com/Tenon-Net/Team-Lite.git && cd Team-Lite

git status --short --branch
git pull origin main
git log -3 --oneline
# 建议配置本机提交身份（仓库历史可能出现 Team-Lite@local）：
# git config user.name "…" && git config user.email "…"
```

### 2.2 后端

```bash
cargo build -p app
cargo test -p team --lib
# 期望大量通过（曾 ~405）；若红，先修再加功能

# PowerShell 示例：
$env:RUST_LOG="info"
$env:TEAM_LITE_ADDR="127.0.0.1:3000"
# $env:TEAM_LITE_DATA = "$env:TEMP/team-lite-dev"   # 可选
cargo run -p app
```

冒烟：

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/teams
```

### 2.3 前端（需要 UI 时）

```bash
cd apps/web
npm install
npm run build    # 应通过
npm run dev      # http://127.0.0.1:5173  → / 列表，/team/:id TeamPage
```

### 2.4 进程纪律

- **只**停止本仓库的 `team-lite` / `cargo run -p app`。
- **禁止**无请示地 `kill` 用户本机的 `grok` / 其他 IDE 进程。
- ACP 短 turn 会自起子进程并清理；日志里可能有结束子进程信息，属现状。

### 2.5 换机必改（否则 seed/launch 失败）

1. `crates/app/src/seed.rs` — 各 runtime 的 `command` / `args`（曾写死 Windows Administrator 路径）
2. `crates/acp/src/launch.rs` — PATH / 回退可执行文件路径
3. 建团 `workspace` 使用本机可写绝对路径

---

## §3 当前最高优先任务（默认 backlog）

**你没有接到人类新指令时，按下列顺序做。做完一项打勾/更新 §9。**

### P0 — 编排可验收（先做）

1. **真实 goal 的 API smoke（非 PONG）**  
   - ensure session 后向 Lead 发一条真实目标  
   - 记录：是否出现结构化任务（task board / MCP `team_task_*`）、run-state、mailbox  
   - 输出：简短验收笔记（可写 `docs/smoke-notes.md` 或更新 §9）
2. **理清 ACP session 模型**  
   - 现状：warmup attach **与** 每 turn 新起进程 **并存**  
   - 目标：减少挂死/重复进程；评估「复用 session vs 短 turn」并实现最小改动  
3. **Lead 不建任务时**  
   - 只调 prompt / 工具说明，**单独立项**，勿与工程重构混在一个大 PR

### P1 — UI 核心可见

1. TeamPage：能看到消息进出（薄 AcpChat 已支持发送+轮询，补 runtime 状态）
2. 逐步去掉 `// @ts-nocheck`（按文件，不一次全开）
3. 可选：WebSocket 替代纯轮询

### P2 — 产品化

1. Memory → **SQLite**（决策已定）
2. Claude 作 Lead（本机订阅可用时）
3. 按 roadmap **M1 十步**手跑 + 留日志

### 明确不做

完整 ZBBody、Electron 默认、provider 商城、CPA 强绑、无批准 force-push main。

---

## §4 已完成水位（勿重复建设）

| 项 | 状态 |
|----|------|
| Cargo workspace + team 域编译/单测 | 完成 |
| C1/C2 去掉业务层 IProviderRepository | 完成 |
| D1 axum：team routes + `/health` + `/ws` | 完成 |
| D2 种子 asst-claude/grok/codex | 完成 |
| E 侧 web 骨架 + team 页搬运 + stub 收口编译 | 中间完成 |
| Conversation API：GET/PATCH + messages | 完成 |
| 薄 AcpChat（发送 + 轮询） | 完成 |
| AcpTurnPort 从 conversation.extra 读 backend/workspace | 完成 |
| Smoke：grok Lead 短回复落库 | 通过（2026-08-05） |
| Smoke：codex Worker 短回复落库 | 通过（2026-08-05） |
| M1 十步完整验收 | **未完成** |
| 持久化 / turn 与 warmup 统一 | **未完成** |

---

## §5 API 契约（实机已用）

### 5.1 建团 `POST /api/teams`

**禁止**在 agents 元素里传 `backend`（`deny_unknown_fields` → 400）。用 `assistant_id`。

```json
{
  "name": "demo",
  "workspace": "C:/path/to/writable/workspace",
  "agents": [
    { "name": "Lead", "role": "lead", "model": "default", "assistant_id": "asst-grok" },
    { "name": "Worker", "role": "teammate", "model": "default", "assistant_id": "asst-codex" }
  ]
}
```

种子：`asst-claude` | `asst-grok` | `asst-codex`。

### 5.2 会话与消息

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/teams/{id}/session` | ensure session / warmup |
| POST | `/api/teams/{id}/agents/{slot_id}/messages` | body `{"content":"..."}` |
| GET | `/api/teams` | 列表 |
| GET | `/api/teams/{id}` | 详情 |
| GET | `/api/conversations/{id}` | 会话（extra 为 JSON 对象） |
| GET | `/api/conversations/{id}/messages?limit=100` | 消息页 |
| PATCH | `/api/conversations/{id}` | 更新（含 merge_extra） |
| GET | `/ws` | 事件；无订阅时日志 warn 可忽略 |

### 5.3 推荐 API smoke 脚本（PowerShell）

```powershell
# 后端已在 3000 监听；JSON 文件请无 BOM
$ws = (Resolve-Path .).Path -replace '\\','/'
@"
{"name":"smoke","workspace":"$ws","agents":[{"name":"Lead","role":"lead","model":"default","assistant_id":"asst-grok"},{"name":"Worker","role":"teammate","model":"default","assistant_id":"asst-codex"}]}
"@ | Set-Content -Encoding utf8NoBOM .\tmp-create.json
$j = (curl.exe -s -X POST http://127.0.0.1:3000/api/teams -H "Content-Type: application/json" --data-binary "@tmp-create.json") | ConvertFrom-Json
$tid = $j.data.id
$lead = $j.data.assistants | Where-Object role -eq 'lead' | Select-Object -First 1
curl.exe -s -X POST "http://127.0.0.1:3000/api/teams/$tid/session"
Start-Sleep 10
@"
{"content":"Reply with exactly one word: PONG. Do not call tools."}
"@ | Set-Content -Encoding utf8NoBOM .\tmp-msg.json
curl.exe -s -X POST "http://127.0.0.1:3000/api/teams/$tid/agents/$($lead.slot_id)/messages" -H "Content-Type: application/json" --data-binary "@tmp-msg.json"
# 轮询 messages 直到 count>=2 或超时
curl.exe -s "http://127.0.0.1:3000/api/conversations/$($lead.conversation_id)/messages?limit=20"
```

`tmp-*.json` 已在 `.gitignore`，勿提交。

---

## §6 关键代码入口

| 目的 | 路径 |
|------|------|
| 进程入口 / 路由组装 | `crates/app/src/main.rs`, `lib.rs` |
| Conversation HTTP | `crates/app/src/conversation_routes.rs` |
| 种子 | `crates/app/src/seed.rs` |
| Team HTTP | `crates/team/src/routes.rs` |
| 建团 / 成员会话 | `crates/team/src/service.rs`, `provisioning.rs` |
| 事件环 / 调 turn | `crates/team/src/event_loop.rs` |
| ACP turn 适配 | `crates/team/src/acp_turn_adapter.rs` |
| 短 turn 实现 | `crates/acp/src/turn.rs`, `launch.rs` |
| 前端列表 / 路由 | `apps/web/src/App.tsx`, `main.tsx` |
| 团队页 | `apps/web/src/pages/team/` |
| 薄聊天 | `apps/web/src/pages/conversation/platforms/acp/AcpChat.tsx` |
| HTTP/WS 客户端 | `apps/web/src/common/adapter/ipcBridge.ts`, `httpBridge.ts` |

**不可回退的修复：** `AcpTurnPort` 必须从 `conversation.extra` 解析 `backend`/`workspace`，禁止只写死默认 data_dir。

---

## §7 工作协议（强制）

1. **范围**：核心环优先；scope creep 拒绝或标 later。  
2. **分支**：`feat/…`、`fix/…`；小步提交；**不** force-push `main`。  
3. **提交**：仅在人类要求或本文件任务明确允许时 commit；**不**提交密钥、`.env`、本机隐私路径配置。  
4. **验证**：改完至少跑相关  
   - `cargo test -p team --lib` 和/或 `cargo build -p app`  
   - UI：`cd apps/web && npm run build`  
   - 行为：§5.3 类 smoke  
   **禁止**无证据声称「已完成」。  
5. **上游**：只读参考；Team-Lite 决策优先。  
6. **进程**：不杀用户 grok；只管 team-lite。  
7. **UI 文案**：中文；代码英文。  
8. **会话结束前**：更新本文 **§9**，并视情况 `git push origin main`（若人类要求推送）。

---

## §8 已知坑

| 坑 | 处理 |
|----|------|
| agents 带 `backend` 建团 400 | 删字段，用 assistant_id |
| 重启丢数据 | Memory store，预期内；P2 做 SQLite |
| turn 挂死 | 查 workspace 是否真实目录、CLI 是否登录、是否重复僵尸进程；先只重启 team-lite |
| broadcast no receivers | 无浏览器连 WS，可忽略 |
| TeamPage 编译 | 大量 nocheck/stub；`npm run build` 应仍绿 |
| codex 回复夹杂 model metadata 噪声 | 已知；可后处理展示，不阻塞 smoke |
| git 无 user | 用本机 config 或一次性 `-c user.name=…` |

---

## §9 进度板（交接时改这里）

**状态日期：** 2026-08-05  

**已 push：** `main` @ GitHub Tenon-Net/Team-Lite  

**刚完成：**  
- 初版可跑产品 + HANDOFF  
- grok Lead / codex Worker 短 turn 落库  

**进行中 / 下一棒默认：**  
- [ ] P0 真实 goal API smoke + 任务板是否出现  
- [ ] P0 turn/session 模型整理  
- [ ] P1 TeamPage 消息与状态可见性  

**阻塞：** 无全局阻塞；claude Lead 依赖本机订阅（可选）。

**给人类的一句话：**  
工程路径已通，下一棒做「真目标下的编排验收」和 session 模型，而不是继续堆 UI 皮肤。

---

## §10 你读完后的立即动作

1. 执行 **§2.1–2.2**（能 build / test 则 test）。  
2. 若后端未起，起 `cargo run -p app`，跑 **§5.3** 确认本机 CLI 仍通。  
3. 打开 **§3 P0 第 1 项** 开始干活。  
4. 不要等待额外系统提示；不要先写长篇「我将如何…」而不动手。  
5. 人类若另有明确指令，**人类指令优先于 §3 默认 backlog**。

---

*本文件即开工指令。更新水位时请改 §9 与文首元数据，并保持「只读本文件即可继续」这一性质。*
