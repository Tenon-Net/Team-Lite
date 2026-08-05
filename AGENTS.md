# AGENTS.md — Team-Lite

> Instructions for AI coding agents working in this repository.
> Product intent and constraints come first; implementation details second.

## 1. What we are building

**Team-Lite** is a **small multi-agent orchestration product**, not a full AI desktop suite.

### Core loop (must remain the product center)

```text
User goal
  → Leader Agent (plan / split / assign)
  → Worker Agents (execute tasks)
  → Results back to Leader (aggregate / continue or finish)
```

### In scope (v1)

- Create / open a **team**
- One **Leader** agent (planning, assignment, tracking)
- One or more **Worker** agents (execution only unless promoted)
- Submit a **top-level goal** and observe **task status + logs**
- Minimal configuration needed to run the above (which runtimes, credentials)

### Explicitly out of scope (do not build unless the human reopens scope)

- Full chat workbench as the main product
- “Support every CLI agent under the sun” auto-discovery
- MCP marketplace, IM channels, cron/remote control as product pillars
- Desktop pet / gimmicks / marketing surfaces
- Full ZBBody / AionUi feature parity
- Shipping a heavy Electron + full AionCore stack **by default** just because upstream has it

If a request is not required for the core loop, **refuse scope creep** and propose deferral.

## 2. Why this repo exists

Upstream **ZBBody / AionUi** (local reference trees) is a large “all-in-one” product:

- Heavy dependencies and slow startup
- Many features beyond team orchestration
- Confusing config paths (e.g. Claude Code **subscription login** vs team path requiring **Anthropic/CPA API providers**)

Team-Lite is a **new product boundary**:

| | Upstream ZBBody | Team-Lite |
|--|-----------------|-----------|
| Goal | Full AI workspace | Team orchestration only |
| Repo | Reference / parts library | **Primary codebase** |
| Strategy | Occasional read / cherry-pick | Design for thin runtime |

**Do not** turn this repo into a slimmed copy of the entire upstream monorepo by bulk-deleting UI.
**Do** reimplement or port **only** what the core loop needs, with clear interfaces.

## 3. Relationship to upstream (zzbody)

Typical local layout (may vary by machine):

```text
C:\Project\HuHuHu\
  team-lite\          ← THIS repo (product)
  zzbody\
    zbbody-new\       ← UI reference (git)
    AionCore\         ← backend reference (git)
```

Rules:

1. **Primary work happens in `team-lite`.**
2. Upstream trees are **read-mostly references**. Do not “fix” Team-Lite by rewriting upstream into the product unless the human explicitly asks.
3. When reusing ideas: prefer **copying small, understood slices** (protocol, state machine, API shape) over wholesale directory copies.
4. Never assume upstream start scripts, Electron packaging, or full provider matrix must exist here.
5. If upstream and Team-Lite diverge, **Team-Lite product decisions win** inside this repo.

### Known upstream footgun (document, don’t reintroduce blindly)

Team provisioning for Claude may **require an enabled Anthropic/CPA API provider**, even when the user only has **Claude Code subscription login**.  
For Team-Lite, prefer designs where:

- Subscription / local CLI auth can run Workers without forcing a separate CPA provider, **or**
- Config UX clearly separates: *CLI login* vs *API provider*, and only requires what the chosen runtime needs.

## 4. Architecture principles

### 4.1 Thin by default

- Prefer **one process** or a **small fixed process set** over Electron + full backend + many side services.
- Optional capabilities load **on demand**, not at boot.
- Dependencies must justify themselves against the core loop.

### 4.2 Orchestration is the product

Model the domain explicitly:

- `Team`
- `Member` (role: `leader` | `worker`)
- `Goal` / `Run`
- `Task` (assignment, status, owner, artifacts)
- `Event` / log stream (for UI and debugging)

Avoid baking orchestration logic only into opaque prompt text with no durable state.

### 4.3 Agents are plugins

- Leader and Workers talk through a **narrow runtime interface** (start task, cancel, stream events, return result).
- v1: support **few** runtimes well (e.g. 1–2 of: Claude Code CLI, Codex CLI, HTTP OpenAI-compatible API).
- Do not add a new agent integration “because upstream has it.”

### 4.4 Config minimalism

- Settings exist only to make Leader/Workers runnable.
- No second product (generic multi-provider model mall) unless required by the chosen runtimes.

### 4.5 Observable and debuggable

- Every assignment and worker result should be inspectable (status + log).
- Failures must surface **first actionable error**, not only a generic exit code.

## 5. Suggested stack (default bias — change only with reason)

Until the human decides otherwise, bias toward:

| Layer | Bias | Avoid initially |
|-------|------|-----------------|
| UI | Simple Web (local) or CLI | Full Electron suite |
| Orchestrator | Single service (TS or Rust — pick one and stick) | Full AionCore workspace as mandatory runtime |
| Storage | SQLite or filesystem JSON for v1 | Multi-DB / cloud-only |
| Agents | Subprocess CLI or HTTP | Embedding every ACP binary |

If choosing between “reuse upstream binary” and “thin reimplementation,” prefer **thin reimplementation** for v1 unless a specific upstream module is clearly cheaper to isolate.

## 6. Working agreements for agents

### Always

- Keep changes **scoped to Team-Lite goals**.
- Prefer small PRs / commits with clear intent.
- Document new public interfaces and domain terms in this file or `docs/` when they stabilize.
- When unsure whether a feature is in scope, **ask** or mark as `later` rather than implementing.

### Never (unless human explicitly orders)

- Reintroduce full ZBBody feature surface.
- Commit / push secrets, API keys, tokens, cookies.
- Force-push shared branches or rewrite published history without approval.
- “Fix” upstream reference repos as part of Team-Lite work without being asked.
- Add heavy dependencies for convenience (new UI kit, new agent matrix, telemetry) without need.

### Secrets

- Local env files / OS keychain only.
- Remind the human to configure credentials in app settings or `.env` — never write real keys into the repo.

## 7. Repo layout (target)

As the project grows, prefer something like:

```text
team-lite/
  AGENTS.md                 ← this file
  README.md
  docs/
    product-scope.md        ← optional expanded scope
    domain.md               ← terms & state machines
  apps/
    web/                    ← minimal UI (if any)
    cli/                    ← optional
  packages/
    core/                   ← orchestration domain + services
    agent-runtime/          ← Leader/Worker adapters
    storage/                ← persistence
  scripts/
```

v0 may be flatter; **do not** create a huge monorepo skeleton before there is a working core loop.

## 8. Definition of done (v1 slice)

A slice is done when:

1. Human can define a team with Leader + ≥1 Worker.
2. Human can submit a goal.
3. Leader produces assignable tasks (structured, not only chat prose).
4. Workers execute and report status/results.
5. Human can see progress without reading only raw terminal spam.
6. Cold path is **noticeably lighter** than full ZBBody dev startup (qualitative OK for early v1; quantify later).

## 9. Syncing with upstream knowledge

When the human wants ideas from ZBBody:

1. Search reference trees under `zzbody/` (or paths they provide).
2. Summarize the **behavior and data model**, not only file names.
3. Propose a **Team-Lite-shaped** design that preserves intent with less surface area.
4. Port the minimum code; rewrite when coupling is high.

Useful upstream concepts to study (names may differ by version):

- Team / teammate roles (leader vs worker)
- Task assignment and conversation-per-member patterns
- Runtime status / warmup / failure surfaces

Do **not** port provider resolution rules that force CPA for every Claude team member without an explicit Team-Lite decision.

## 10. Branching & git (this repo)

- Default integration branch: `main` (create when initializing git).
- Feature work: short-lived branches (`feat/...`, `fix/...`).
- Do not commit unless the human asks (if their global policy says so, follow that).
- No force-push to shared main without approval.

Reference upstream branches (not this repo):

- UI reference often on `main` or `refactor/local-dev`
- AionCore reference often on `aioncore` or `refactor/local-dev`

## 11. Language & UX

- Product UI copy: **Chinese** unless the human asks otherwise.
- Code identifiers: English.
- Agent replies to the human: clear Chinese, concise; avoid dumping unrelated upstream docs.

## 12. Decisions

Resolved via a grilling session. Full reasoning lives in `docs/adr/`; upstream facts in
`docs/upstream-findings.md`; domain terms in `CONTEXT.md`.

| Topic | Status | Notes |
|-------|--------|-------|
| UI: Web vs CLI vs thin desktop | **Decided** | Local web (Vite + React 19 + Arco). Port upstream `pages/team` as-is. No Electron → ADR 0004 |
| Orchestrator language (TS vs Rust) | **Decided** | Rust — we are porting `aionui-team` |
| First Worker runtimes | **Decided** | claude / codex / grok, all via ACP. All three installed locally → ADR 0003 |
| Auth: subscription CLI vs API keys | **Decided** | CLI's own login only. Provider table dropped → ADR 0003 |
| Persistence | **Decided** | SQLite |
| Execution model | **Decided** | Persistent ACP sessions + mailbox + event loop, per upstream → ADR 0001 |
| Port granularity | **Decided** | Selective port (~46k lines), not full vendor (110k) → ADR 0002 |
| Review / rework modelling | **Decided** | `TaskStatus` unchanged. Lead creates a fix task linked via `blocked_by` → `CONTEXT.md` |
| Lead self-staffing | **Decided** | Keep the full assistant catalog and all 10 MCP tools unchanged → ADR 0004 |
| Orchestration framework | **Decided** | No CrewAI / LangGraph. Both are built around API calls and offer nothing for persistent CLI agents over ACP |

### Still open

| Topic | Notes |
|-------|-------|
| Concurrency semantics | Porting `aionui-team` wholesale brings `work_coordinator/` (~1.8k) and `team_run/` (~0.6k) along. Never weighed on its own — see ADR 0001 § 后果. First candidate if we ever need to slim down |
| git init | Repo not initialised yet. §10 calls for `main` as the integration branch |

---

## Quick checklist for any non-trivial change

- [ ] Does this serve Leader → assign → Workers → results?
- [ ] Does it add weight (deps, boot path, config) without clear payoff?
- [ ] Could it be deferred without blocking the core loop?
- [ ] Are secrets safe?
- [ ] Would an upstream-only feature be better left in the reference tree?

If the first box is “no,” stop and realign with the human.
