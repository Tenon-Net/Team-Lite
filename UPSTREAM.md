# UPSTREAM

Team-Lite 与上游 ZBBody / AionUi 的同步契约。

上游机制的勘察结论在 `docs/upstream-findings.md`，这份文件只管**怎么跟上游同步**。

---

## Fork 点

| 上游 | 路径 | Fork 点 | 分支 |
|---|---|---|---|
| UI | `zzbody/zbbody-new` | `11b72ca` | `refactor/local-dev` |
| 后端 | `zzbody/AionCore` | `2a69f63` | `refactor/local-dev` |

---

## 为什么需要两套机制

两边的 git 状态**不对称**，这是设计同步流程时最关键的约束：

```
zbbody-new  : 真实 git 历史，team 相关 commit 可以逐条读
AionCore    : 只有 1 个 commit —— "chore: export AionCore snapshot for zbbody-new"
              ↑ 这是快照导出，不是上游仓
```

**后果**：Rust 侧的 bugfix 根本 cherry-pick 不了。对方修了 Rust bug，你拿到的是一个新快照，
只能整目录 diff。所以 Rust 侧必须自己存一份 baseline，否则分不清
「这处不同是上游新改的」还是「我当初故意改的」。

另一个必须记住的事实：**最近三个 `fix(team)` 全在 UI 侧 TS，一行 Rust 未动**
（详见 `docs/upstream-findings.md` §7）。跟 bugfix 时**先看 UI 侧**。

---

## UI 侧同步：直接用 git

```bash
# 列出 fork 点之后所有 team 相关 commit
git -C ../zbbody-new log 11b72ca..HEAD -- packages/desktop/src/renderer/pages/team

# 顺带看 team 逻辑外溢到的地方
git -C ../zbbody-new log 11b72ca..HEAD -- \
  packages/desktop/src/renderer/pages/conversation/utils \
  packages/desktop/src/common/types/team \
  packages/desktop/src/common/adapter/teamMapper.ts

# 看单个 commit 的完整改动
git -C ../zbbody-new show <sha>
```

应用完一批后，把上面表格里的 UI Fork 点更新到新 sha，并在下面的记录表追加一行。

---

## Rust 侧同步：baseline 三方 diff

`vendor/aioncore-baseline/` 存放**搬运时的原始文件**——只存搬过来的那些
（约 30k 行，几百 KB），不是整个 AionCore。

上游给出新快照时：

```bash
# 1. 得到真正的上游改动（不含你自己的修改）
diff -ru vendor/aioncore-baseline/ ../AionCore/crates/aionui-team/src/

# 2. 人工挑与 Team-Lite 相关的 hunk，应用到 crates/
#    跳过：provider / Aionrs / channel / office / cron 等已删域相关的改动

# 3. 用新快照覆盖 baseline
# 4. 在下面的记录表追加一行
```

### 挑 hunk 时的判断标准

**要**：mailbox、scheduler、event_loop、task_board、mcp 工具、prompts、types、session 的修复

**不要**：
- 任何 `IProviderRepository` / `resolve_*_provider_*` 相关（这层已删）
- `AgentType::Aionrs` 分支
- 多用户 / auth 中间件相关
- 已删域（channel / office / cron / extension / shell / file / system）的连带改动

**存疑就记进下面的「待定 hunk」，不要凭感觉合入。**

---

## 已应用 hunk 记录

| 日期 | 来源 | 上游 sha / 快照 | 涉及文件 | 说明 |
|---|---|---|---|---|
| _(待追加)_ | | | | |

## 待定 hunk（看不懂或拿不准的，先记下别合）

| 日期 | 来源 | 涉及文件 | 为什么拿不准 |
|---|---|---|---|
| _(待追加)_ | | | | |

---

## 已知的永久性分歧

这些是 Team-Lite 故意跟上游不一样的地方。**每次 diff 都会看到，不要试图"修复"它们。**

| 分歧 | 位置 | 原因 |
|---|---|---|
| 删掉 claude 的强制 provider 解析 | `provisioning.rs` 原 587–596 对应处 | 修 CPA 强绑坑 → ADR 0003 |
| `TeamAgentProvisioner` / `TeamSessionService` 去掉 `IProviderRepository` | `provisioning.rs` / `service.rs` / `spawn_support.rs` | C1/C2：CLI 登录，无 provider 表查找 |
| 删掉 `resolve_*_provider_*` 与 claude provider 选择单测 | `provisioning.rs` | 同上 |
| 删掉 `AgentType::Aionrs` 作为一等路径（保留软退化） | provisioning / service | 只走 ACP → ADR 0003 |
| `IProviderRepository` 仍留在 `store` trait 定义 | `store` | 避免大范围删模型；业务层不再注入 |
| 删掉多用户，`CurrentUser` 变常量 | 全局 | 单用户产品 |
| 事件广播换成 tokio broadcast | 替代 `aionui-realtime` | 只用到 `EventBroadcaster` 一个 trait |
| turn 执行直连 ACP | 替代 `team_conversation_adapters.rs` | 不搬 conversation service 全量 |
| 本地 HTTP 默认端口 3000 + Vite proxy | `docs/local-dev.md` / `apps/web/vite.config.ts` | 无 Electron 后端端口注入 |
| slim `ipcBridge` 只保留 team/conversation/agent | `apps/web/src/common/adapter/` | E2；无 channel/office/cron/mcp… |
| UI 路径别名 `@/` 映射到 `apps/web/src` | vite + tsconfig | 无 Electron monorepo 路径 |
| pages/team 原样 fork（E3） | `apps/web/src/pages/team` | 未解析 import 见 `docs/e3-unresolved-imports.md` |
| E5：cron / provider UI 改 stub 或 no-op | `claudeProviderRoute`、`useAionrsModelSelection`、`cronUtils`、`AuthContext` | ADR 0003/0004；team 源文件暂 `@ts-nocheck` 收口编译 |
| E5：agent hooks 只保留 stub | `useAcpConfigOptions` / `useModelProviderList` / `usePresetAssistantInfo` | 不搬 provider 商城全量 hooks |
