# Roadmap

里程碑与验收标准。**可派给 Agent 执行的细粒度任务清单在 `tasks.md`。**

目标用例：**claude 规划 → grok 执行 → codex review/修正 → Lead 判断 → 完成**

三个 CLI 本机已装：
```
claude -> C:/Users/Administrator/.local/bin/claude
codex  -> C:/Users/Administrator/AppData/Roaming/npm/codex
grok   -> C:/Users/Administrator/.grok/bin/grok
gemini -> 未安装
```

---

## M0 — ACP Spike

**半天，约 200 行，不进正式代码。最大风险前置。**

在搬 46k 行之前，先证明地基成立。用 `agent-client-protocol = "0.11.1"`
（上游同款，见 `docs/upstream-findings.md` §4）直连本机三个 CLI，各发一个 prompt 拿到流式输出。

### 验收

- [ ] **claude 通，且全程未配置任何 API key / provider**
      ← 这是 CPA 坑修法的实机证明，`docs/upstream-findings.md` §5 只在代码上论证过，未实机验证
- [ ] **grok 通**（预期走 `~/.grok` 自己的登录态）
- [ ] **codex 通**
- [ ] 记录三者的 `auth_methods` / `available_modes` / 权限模型差异

### 不通怎么办

**回头重议方案，不要带着未验证的地基往下搬。** 可能的失败模式：

- 某个 CLI 没有 ACP 桥 → 该运行时降级或换接法
- claude 不配 provider 就起不来 → CPA 结论错误，ADR 0003 需重写
- `agent-client-protocol` 0.11.1 与某个 CLI 版本不兼容 → 查上游开的 feature flag

---

## M1 — 完整三段闭环

搬运 + 新写全部落地，跑通目标用例。

### 验收脚本（手动走一遍，保留日志）

1. 建团：claude(Lead) + grok(Teammate) + codex(Teammate)
2. 发一个 goal
3. 任务板出现 ≥1 条**结构化**任务（不是聊天散文），owner = grok
4. grok 执行：状态 `working` → `completed`，结果回传
5. codex 收到 review 任务，回传意见
6. Lead 被唤醒，判断不通过 → 新建修正任务，`blocked_by` 指向 review 任务
7. grok 修正 → codex 复查 → 通过
8. Lead 汇总，协作结束
9. UI 上可回看三个成员的**完整对话**，任务板依赖关系可见
10. **全程未配置任何 API key**

### 已知风险

第 5-7 步的收敛**高度依赖 Lead prompt 调优**。可能出现「代码全对但 Lead 不按预期行事」，
比如它不建 review 任务、或者 review 不过时直接自己改而不派回去。

**应对**：把 prompt 调优单独计时，与工程进度分开记账。避免出现「M1 卡了两周，其中一周半在调 prompt」
却看不出来的情况。

---

## M2 — 补齐

- 崩溃恢复（`crash_detection.rs` / `scheduler/crash_recovery.rs` 对应能力）
- wake 超时看门狗（上游 `WAKE_TIMEOUT_MS = 60_000`）
- assistant 目录 UI
- 上游自带的 8 个集成测试跑通：
  `e2e_team_flow.rs` / `e2e_smoke.rs` / `scheduler_integration.rs` / `task_board_integration.rs` /
  `mailbox_integration.rs` / `mcp_server_integration.rs` / `prompts_events_integration.rs` /
  `session_service_integration.rs`

---

## M3 — 固化

- 删净 provider 残留（Rust 侧 + UI 侧的 `claudeProviderRoute` / `useAionrsModelSelection`）
- `vendor/aioncore-baseline/` 落地，`UPSTREAM.md` 的记录表启用
- 更新 `AGENTS.md` §12 决策表
- 量化轻量性：记录冷启动耗时，与 `zbbody-new` 的 `npm run dev` 对比

---

## 工作量分解

### 搬运（几乎不改）~29.5k 行

| 来源 | 行数 |
|---|---|
| `aionui-team` | 24,572 |
| `aionui-team-prompts` | 645 |
| `aionui-api-types` 的 team 子集（`team.rs` 1608 + `team_tools.rs` 587 + `team_mcp.rs` 95） | 2,290 |
| assistant catalog 读侧（从 `aionui-assistant` 6,884 里挑） | ~2,000 |

### 新写 ~3.3k 行

| 模块 | 行数 | 说明 |
|---|---|---|
| ACP turn runner | ~1,200–1,800 | 起/复用 ACP 会话、发 prompt、消费流式 `session/update` 落库 + 广播、权限回调、取消。压缩自上游 `stream_relay.rs`(2591) + `turn_orchestrator.rs`(593) + `stream_persistence.rs`(649) |
| store | ~1,400 | SQLite：team / task / mailbox / conversation / message / agent_metadata / assistant_definition / assistant_overlay |
| app 组装 | ~400 | axum 路由 + 依赖装配 |
| broadcaster | ~50 | 替代 `aionui-realtime`，tokio broadcast |

### 改（本质是删）

- `service.rs`(3669)：去掉 `IProviderRepository`，**保留** 3 个 assistant repo
- `provisioning.rs`(1330) → ~300：删 provider 解析分支，建会话变成「起 ACP 会话 + 记 workspace」

### UI ~13k 行

`pages/team` 48 文件 9,873 行 + conversation utils ~1,500 + assistant 页 ~1,000 + 精简 ipcBridge ~600

**合计约 46k 行**（Rust ~33k / TS ~13k），其中真正自己写的约 4k。
对照：整包 vendor 是 110k 行 Rust + 全套 UI。

---

## 目标仓库结构

```
team-lite/
  AGENTS.md
  CONTEXT.md                       术语表
  UPSTREAM.md                      同步契约
  docs/
    upstream-findings.md           上游勘察结论
    roadmap.md                     本文件
    adr/                           4 篇架构决策记录
  vendor/
    aioncore-baseline/             搬运时的 Rust 原始文件
  crates/
    team/                          搬自 aionui-team，尽量不改
    team-prompts/                  搬自 aionui-team-prompts
    api-types/                     搬 team 子集
    acp/                           新写：IWorkerTaskManager + turn runner
    store/                         新写：SQLite 各表
    app/                           新写：axum 组装
  apps/web/
    pages/team/                    搬 48 文件
    pages/conversation/            只搬 team 用到的 utils
    adapter/ipcBridge.ts           精简版
```

启动：`cargo run` + `vite`，浏览器打开。不要 Electron。
