# 派活提示词

可直接复制粘贴给执行 Agent 的提示词，按批次组织。

**单一事实来源是 `docs/tasks.md`**——提示词只做「指路 + 强调风险 + 规定报告格式」，
不复述任务卡内容，避免两处不同步。

**前提**：执行 Agent 能读写 `C:\Project\HuHuHu\zzbody\team-lite\`，并能只读访问
`C:\Project\HuHuHu\zzbody\AionCore\` 和 `C:\Project\HuHuHu\zzbody\zbbody-new\`。

---

## 通用模板

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先按顺序读这四份文件，再动手：
1. AGENTS.md            产品边界与纪律
2. CONTEXT.md           术语表 —— 代码命名必须用这里的词
3. docs/upstream-findings.md   上游勘察结论，别重复摸索 110k 行代码
4. docs/tasks.md        找到你的任务卡：{任务ID}

执行 {任务ID}，完成卡片上的全部验收项。

纪律：
- 参考仓 AionCore / zbbody-new 只读，绝对不要改
- 搬运类任务原样搬，不要顺手重构
- 任何偏离上游的改动，追加到 UPSTREAM.md 的「已知的永久性分歧」表
- 卡片没覆盖的决策，停下来问我，不要自行拍板
- 不要 git commit

做完报告：
1. 验收项逐条勾选（未过的说明卡在哪）
2. 改/建了哪些文件
3. 你做的、但卡片没要求的任何决定
4. 发现的与文档不符之处（文档可能已过时，如实说）
```

---

# 第 1 批（串行）— 地基验证

## M0-1

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md（重点 §4 和 §5）、
docs/adr/0003-acp-only-drop-provider-layer.md，再动手。

执行 docs/tasks.md 的任务 M0-1：写一个最小 ACP 客户端 spike，验证本机三个 CLI
（claude / codex / grok）能通过 agent-client-protocol 0.11.1 跑通。

这是整个项目的地基验证，在它通过之前不会有任何搬运工作开始。

最关键的一项：claude 必须在**完全不配置任何 API key / provider 环境变量**的情况下跑通。
这是 ADR 0003 的核心论断，目前只经代码论证、未经实机验证。如果它跑不通，
ADR 0003 就是错的，整个方案要重议。

所以：不要为了让它跑通而偷偷配 API key、设环境变量、或改任何全局配置。
跑不通就是跑不通，如实报告卡在哪一步、报什么错。这个结果本身就是有价值的产出。

代码放 spike/acp-probe/，不要进 crates/。

做完报告：
1. 三个 CLI 各自的结果（通 / 不通 + 具体错误）
2. claude 是否真的没配任何凭据就通了
3. 三者的 auth_methods / available_modes / 权限模型差异
4. 每个 CLI 的实际启动命令与参数（后面 D2 写种子数据要用）
5. **已把上述差异追加到 docs/upstream-findings.md 的新小节**（tasks 验收要求落盘，
   不要只写在聊天报告里）
```

---

# 第 2 批（串行）— 骨架

## A1

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

**门禁：仅在 M0-1 报告为通过（或人明确放行）之后执行。** 地基未验证不要开骨架。

先读 AGENTS.md（尤其 §10 分支约定）、docs/tasks.md 的 A1 卡片。

执行 A1：建仓库骨架。git init（默认分支 main）、cargo workspace（6 个空 crate）、
vendor/aioncore-baseline/ 空目录、.gitignore、toolchain 对齐上游。

这是所有后续任务的前提，做窄一点：只要 cargo build 通过的空壳，不要写任何业务代码，
不要预先加依赖，不要建"以后可能要用"的模块。

不要 git commit，只 init。

做完报告：目录树 + cargo build 输出。
```

---

# 第 3 批 — A2 ∥ A3 ∥ E1+E2，然后 A4

## A2

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md、docs/tasks.md 的 A2 卡片。

执行 A2：从 AionCore/crates/aionui-api-types/src/ 搬 team.rs + team_tools.rs + team_mcp.rs
到 crates/api-types/。

关键约束：**删掉引用不到的类型直到编译过，不要为了凑编译把整个 api-types(13.5k 行) 搬进来。**
目标是 2,290 行 + 最小必要的公共类型。

api-types 不得依赖 axum / tower 或任何 HTTP 框架。

搬完把原始文件复制一份到 vendor/aioncore-baseline/api-types/，
这是以后跟上游做三方 diff 的基线，必须与搬入内容逐字节一致。

AionCore 只读，不要改。不要 git commit。

做完报告：最终行数、删掉了哪些类型、baseline 校验结果。
```

## A3

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、docs/tasks.md 的 A3 卡片。

执行 A3：把 AionCore/crates/aionui-team-prompts/(645 行) 原样搬到 crates/team-prompts/，
只改 crate 名和 Cargo.toml 依赖路径，业务逻辑一行不动。
同时复制到 vendor/aioncore-baseline/team-prompts/。

这是最简单的一个搬运任务，别把它做复杂。不要重构、不要"改进" prompt 文本。

AionCore 只读。不要 git commit。

做完报告：cargo build -p team-prompts 与内部单测结果、baseline 校验结果。
```

## E1 + E2

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、docs/adr/0004-keep-conversation-domain-and-upstream-ui.md、
docs/upstream-findings.md §6、docs/tasks.md 的 E1 和 E2 卡片。

连做两个任务：
- E1：apps/web/ 骨架，Vite + React 19 + @arco-design/web-react + @icon-park/react
- E2：从 zbbody-new 搬 ipcBridge.ts(2303 行) 并精简，只保留 team / conversation / agent 端点

**不要 Electron。** 上游 UI 已经全 HTTP 化，Electron 只是外壳
（证据：ipcBridge.ts:10 的注释）。

E1 预留联调：vite 配置里加 /api（及 WS）代理到后端占位端口（与 D1 约定对齐，
默认可用 127.0.0.1:3000；最终以 D1 报告为准改一处即可）。

E2 精简时要删掉的域：channel / office / cron / mcp / extension / shell / file / system。
删之前先确认没有 team 侧引用。

zbbody-new 只读。不要 git commit。

做完报告：apps/web 目录树、ipcBridge 最终行数与保留的端点清单、vite dev 启动结果、proxy 配置。
```

## A4

> A4 依赖 A2、A3 完成。可在同批次内排在它们之后。

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md、
docs/adr/0002-selective-port-over-full-vendor.md、docs/tasks.md 的 A4 卡片。

执行 A4：把 AionCore/crates/aionui-team/src/ 全部 24,572 行搬到 crates/team/src/，
外加 tests/ 下 8 个集成测试。

**只改 import 路径，业务逻辑一行不动。** 包括 work_coordinator/ 和 team_run/ 也要搬——
它们是保真搬运的连带结果，本期不删（见 ADR 0001 § 后果）。

**编译会失败，这是预期的**（缺 store / acp / broadcaster 这些替身）。
不要为了让它编译过而写桩、改逻辑、注释代码。C3 任务负责收口。

搬完复制原始文件到 vendor/aioncore-baseline/team/，必须逐字节一致。

自查：用 git diff --no-index（或 Git Bash 的 diff -ru）对比
vendor/aioncore-baseline/team/ 与 crates/team/src/，除 import 路径外应无差异。
把差异摘要贴在报告里。行数统计在 Windows 上可用：
  Get-ChildItem -Recurse -Filter *.rs crates/team/src | ...
不要依赖 find | xargs wc（本机是 PowerShell）。

AionCore 只读。不要 git commit。

做完报告：文件数与行数是否对得上 24,572、diff 自查结果、剩余编译错误的分类统计
（哪些是缺 store、哪些是缺 acp、哪些是别的）。
```

---

# 第 4 批（5-6 路并行）— 依赖替身

> B1 / B2 / B3 / B4 / B6 逻辑上互不依赖，可同时派给多个 Agent。
> 每个都要先读 `docs/upstream-findings.md` §2 的符号清单表，明确自己的 trait 边界。
>
> **`crates/store` 并行 ownership（必读，否则会互相覆盖）：**
> - 先由 **B1 Agent**（或最先开工的 store 任务）建好 `crates/store` 的 `Cargo.toml` +
>   `src/lib.rs` 骨架，用 `mod` / `pub use` 预留：`broadcaster`、`team_repo`、
>   `conversation_repo`、`metadata_repo`（空文件也可）。
> - 之后各任务 **只改自己的文件**，禁止改别人的 `*.rs`，也尽量不要再动 `lib.rs`
>   （若必须加一行 `mod`，报告里写明，收口时人工合并）：
>   - B1 → `src/broadcaster.rs` 仅
>   - B2 → `src/team_repo.rs`（及该任务自测）仅
>   - B3 → `src/conversation_repo.rs` 仅
>   - B4 → `src/metadata_repo.rs` 仅
> - B6 写 `crates/acp/`，与 store 无文件冲突。

## B1

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、docs/upstream-findings.md §2、docs/tasks.md 的 B1 卡片。

执行 B1：实现 EventBroadcaster trait，底层用 tokio::sync::broadcast，约 50 行。
这是 crates/team 唯一用到的 realtime 符号。产出路径：crates/store/src/broadcaster.rs。

若 crates/store 尚无骨架，你顺带建 Cargo.toml + lib.rs，并预留
team_repo / conversation_repo / metadata_repo 空 mod（给并行的 B2/B3/B4 用）。
建完骨架后，**只改 broadcaster.rs**。

上游原实现在 AionCore/crates/aionui-realtime/，可以参考但不要照搬 1,675 行——
我们只需要那一个 trait。

留一个单测：多订阅者都能收到广播、订阅者掉线不影响其他人。

不要 git commit。

做完报告：trait 签名、单测结果、store 骨架是否由你创建。
```

## B2

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md §2、docs/tasks.md 的 B2 卡片。

执行 B2：实现 ITeamRepository + SQLite 三张表（team / team_task / mailbox_message），约 500 行。
产出路径：crates/store/src/team_repo.rs（只改这个文件 + 自己的测试）。

**Row 类型的字段必须与上游 AionCore/crates/aionui-db/src/models/ 里的
TeamRow / TeamTaskRow / MailboxMessageRow 完全一致**——crates/team 里的 from_row
直接依赖它们，少一个字段就编不过。

方法清单从 crates/team/src/mailbox.rs 和 task_board.rs 的调用点反推，不要凭空设计。

**验收（注意）：** 此时 crates/team 故意还编不过（C3 才收口），
**不要**指望在本任务里跑通 team 内部单测。
你在 store 侧自带单测即可：DDL、写入/未读/标记已读/按 team 删除等语义。
「用真实实现替换 MockTeamRepo 跑 team 单测」是 **C3** 的验收项。

AionCore 只读。不要 git commit。

做完报告：表结构 DDL、方法清单、store 侧单测结果。
```

## B3

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md §2、
docs/adr/0004-keep-conversation-domain-and-upstream-ui.md、docs/tasks.md 的 B3 卡片。

执行 B3：conversation / message 两张表 + 持久化方法，约 600 行。
产出路径：crates/store/src/conversation_repo.rs（只改这个文件 + 自己的测试）。

**只实现落在 repo 的 4 个方法**：get / get_message_by_msg_id / insert_raw_message / mint_msg_id。
upstream-findings.md §2 列了 conversation 域 7 个调用——其中 run_agent_turn / cancel /
create / wait_until_unclaimed 属于 **B7 的 service 层**，不是你的。

**不要搬 aionui-conversation 的 service 层**（14.8k 行）——那是 B7 的薄版职责，不是你的。
你只管存储。

AionCore 只读。不要 git commit。

做完报告：表结构 DDL、方法签名、单测结果。
```

## B4

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/adr/0003-acp-only-drop-provider-layer.md、
docs/adr/0004-keep-conversation-domain-and-upstream-ui.md、docs/tasks.md 的 B4 卡片。

执行 B4：三张表（agent_metadata / assistant_definition / assistant_overlay）+ 读侧 repo，约 300 行。
产出路径：crates/store/src/metadata_repo.rs（只改这个文件 + 自己的测试）。

Row 结构抄 AionCore/crates/aionui-db/src/models/agent_metadata.rs:13 和 assistant.rs:42。

**红线：不要实现 IProviderRepository。** ADR 0003 已经删掉 provider 这一层，
这是本项目跟上游的核心分歧之一。如果你发现某处非要 provider 才能编过，
停下来报告，不要自己加回来。

agent_metadata 是运行时注册表（一行 = 一个 CLI Agent），
assistant_definition 只指向 agent_id 和 model 字符串，不指 provider。

若编译/装配还需要 assistant 的少量服务逻辑：最小实现并记入 UPSTREAM.md，
**不要**搬 aionui-assistant 全量（~6.8k）。

AionCore 只读。不要 git commit。

做完报告：表结构 DDL、确认无 provider 引用、单测结果。
```

## B6

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md §2 和 §4、docs/tasks.md 的 B6 卡片。
另外读 M0-1 留下的 spike 代码和结论报告。

执行 B6：实现 IWorkerTaskManager 薄版 + 相关类型，约 600 行。
把 M0 spike 里验证过的会话拉起逻辑固化成正式代码：进程管理、会话新建 / resume、生命周期、关闭。

**AgentInstance / AgentStreamEvent / AgentError / BuildTaskOptions 按 crates/team 的
实际使用方式定义最小版本，不要照搬上游 41.5k 行的完整定义。**
先 grep crates/team 里这些类型的用法，只实现被用到的部分。

进程不能残留——参考上游 aionui-ai-agent/src/manager/process_registry.rs 的行为。

AionCore 只读。不要 git commit。

做完报告：trait 与类型签名、能起 claude 会话并干净关闭的验证结果、进程残留检查。
```

## E3 + E4

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/adr/0004-keep-conversation-domain-and-upstream-ui.md、
docs/upstream-findings.md §6 和 §7、docs/tasks.md 的 E3 和 E4 卡片。

连做两个任务（必搬清单见 upstream-findings.md §6 表格，**缺一编译必炸**）：
- E3：从 zbbody-new/packages/desktop/src/renderer/pages/team/ 原样搬 48 个文件 9,873 行
- **E3 连带必搬（§6 写了「搬」，不要漏）：**
  - common/types/team/* + adapter/teamMapper（约 31 处引用）
  - hooks/agent/*、AcpModelSelector、useModelProviderList 等（约 8 处；可精简但不能空着）
- E4：只搬 team 引用到的 conversation utils（被引用 13 次，主要是 conversationCache
      和 conversationAssistantIdentity）

**原样搬，绝对不要顺手重构。** 理由很实在：UI 侧是上游 bugfix 的主战场——
最近三个 fix(team) 全部只改 TypeScript，一行 Rust 没动。你改得越多，
以后越读不懂上游的 diff。

E4 只搬被引用到的 utils，不要搬整个 conversation 页面。

provider 相关的引用先留着别删，那是 E5 的活。

**验收分层：** 本任务以「文件对齐 + 未解析 import 清单」为主；
全量 tsc/vite 编译通过可以放到 E5 删完 provider 之后。不要为了「编译绿」乱 stub。

zbbody-new 只读。不要 git commit。

做完报告：搬了哪些文件（含 types/mapper/hooks）、还有哪些 import 解析不了、
UPSTREAM.md 的 UI fork 点是否已记为 11b72ca。
```

---

# 第 5 批（3 路并行）— 最难的一批

## B7 —— 派最强的 Agent

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先按顺序读：
1. AGENTS.md
2. CONTEXT.md
3. docs/upstream-findings.md（§2 的 7 个方法清单是关键）
4. docs/adr/0004-keep-conversation-domain-and-upstream-ui.md
5. docs/tasks.md 的 B7 卡片
6. **AionCore/crates/aionui-app/src/router/team_conversation_adapters.rs 全文（378 行，必读）**
7. crates/team/src/ports.rs（你要实现的契约就在这里）

执行 B7：实现 AgentTurnExecutionPort 和 AgentTurnCancellationPort，约 1,200–1,800 行
（roadmap 估 1.8k，能压就压，别为凑行数灌水）。
这是本项目新写代码里最大最难的一块。

上游的对应实现是第 6 项那 378 行，它转调 conversation service；**我们直连 ACP**。
你要覆盖的行为压缩自上游三个文件共 3,833 行：
stream_relay.rs(2591) + turn_orchestrator.rs(593) + stream_persistence.rs(649)。
建议先读懂这三个文件的职责划分，再决定你的薄版怎么切。

最容易出错的一点：**on_started 回调必须严格按 ports.rs 的契约触发**——
crates/team/src/event_loop.rs 依赖它做 late-start 补取消（见该文件 217-276 行的
StartCommitResult::CancelImmediately 分支）。回调时机错了会导致取消逻辑静默失效，
而且很难测出来。

**前置（缺一不可，确认已合入主线再开始）：**
- B1 EventBroadcaster（流式要广播）
- B3 message store（流式要落库）
- B6 IWorkerTaskManager（会话生命周期）

AionCore 只读。不要 git commit。

做完报告：
1. 一个完整 turn 的验证结果（流式内容是否进了 message 表、AgentTurnOutcome 字段是否完整）
2. 取消一个进行中 turn 的验证结果
3. on_started 回调时机你是怎么保证的
4. 上游那 3,833 行里你**没有**实现的行为清单 —— 这个最重要，说清楚砍了什么
```

## B5 + C1 + C2

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

**前置：A4、B4、B6 已合入主线**（C1 依赖 B4 的 metadata + B6 的会话拉起）。

先按顺序读：
1. AGENTS.md
2. CONTEXT.md
3. docs/upstream-findings.md（§5 讲 CPA 坑的成因与修法，是本任务的核心）
4. **docs/adr/0003-acp-only-drop-provider-layer.md（必读）**
5. docs/tasks.md 的 B5、C1、C2 三张卡片

连做三个任务，它们都是「删耦合」：
- B5：CurrentUser 换成单用户常量，去掉 auth
- C1：重写 provisioning.rs（1,330 → 约 300 行）
- C2：service.rs 去掉 IProviderRepository

C1 是重点。要删的是 provisioning.rs:587-596 那个
`AgentType::Acp if backend == "claude"` 的强制 provider 分支——这就是那个
「有 Claude Code 订阅登录却还要求配 Anthropic/CPA provider」的坑。

修法不是发明的：同一个产品里 grok 走的就是「provider 可选」语义
（acp_launch_policy.rs:668 提前 return None）。让 claude 走同样的语义即可。

**C2 的红线：保留 3 个 assistant repo，只删 provider。**
ADR 0004 决定保留 assistant catalog 全套，别删过头。
service.rs 有 3,669 行，你只改依赖装配和受影响的调用点，其余逻辑不动。

每一处偏离上游的改动，都要追加到 UPSTREAM.md 的「已知的永久性分歧」表。

AionCore 只读。不要 git commit。

做完报告：
1. crates/team 内是否还有任何 IProviderRepository / aionui_auth 引用（要求为 0）
2. provisioning.rs 最终行数
3. assistant 相关的 3 个 MCP 工具路径是否完整
4. UPSTREAM.md 分歧表新增了哪几条
```

## E5

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、docs/adr/0003-acp-only-drop-provider-layer.md、
docs/upstream-findings.md §6 和 §7、docs/tasks.md 的 E5 卡片。

执行 E5：删掉 UI 侧的 provider / cron / 多用户引用。
目标：claudeProviderRoute、useAionrsModelSelection（各被引用 2 次）、
pages/cron/cronUtils、AuthContext。

**⚠️ 特别小心 teamCreateModelResolver.ts。**
这个文件是最近上游 bugfix 的重灾区（commit a3375f5 一次就改了 +137 行），
里面既有要删的 provider 解析，也有要留的模型解析逻辑。
**删之前先完整读懂它在解析什么，逐段判断。** 一刀切会删坏功能，而且很难发现。

如果对某一段拿不准该删该留，留着并在报告里列出来，不要猜。

zbbody-new 只读。不要 git commit。

做完报告：
1. 删了哪些文件 / 哪些代码段
2. teamCreateModelResolver.ts 你保留了什么、删了什么、依据是什么
3. 拿不准而保留的部分清单
4. UPSTREAM.md 分歧表新增条目
```

---

# 第 6 批（串行，一个人做）— 收口

## C3

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md、
docs/adr/0002-selective-port-over-full-vendor.md、docs/tasks.md 的 C3 卡片。

执行 C3：让 crates/team 编译通过。把 B1-B7、C1、C2 的成果接起来，解决剩余编译错误。

**这个任务有一条红线，比编译通过更重要：**

> 不要为了让编译通过而修改 crates/team 里的业务逻辑。

遇到「必须改 crates/team 的逻辑才编得过」的情况，说明**某个替身的接口做错了**。
回去改那个替身（store / acp / broadcaster），不要改 crates/team。
如果你判断确实是上游代码本身的问题，停下来问我。

横切类型：team 会用到 aionui-common 里的 AgentType / generate_id / now_ms / TimestampMs 等——
**最小本地拷贝**，禁止引入整个 common crate。ActiveLeaseRegistry 等同理。

顺带验收：B2 承诺的「真实 store 替换 MockTeamRepo 跑 mailbox/task_board 相关单测」
在本任务落地（team 终于能编了）。

最终验收有一条硬约束：
用 git diff --no-index（或 diff -ru）对比 vendor/aioncore-baseline/team/ 与 crates/team/src/
的**每一处差异**，都必须能在 UPSTREAM.md 的「已知的永久性分歧」表里找到对应条目。
对不上的差异，要么撤销，要么补进分歧表并说明理由。

不要 git commit。

做完报告：
1. cargo build -p team 与 cargo test -p team --lib 的结果
2. 你改了哪些替身来避免动 crates/team
3. **完整的 diff 清单，逐条对应到 UPSTREAM.md 的分歧表条目**
4. 有没有哪处你最终还是动了 crates/team 的逻辑（如有，逐条说明为什么）
```

---

# 第 7 批（串行）— 组装与验收

## D1

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/tasks.md 的 D1 卡片、crates/team/src/routes.rs(569 行)。

执行 D1：crates/app 的 axum 组装，约 400 行。
路由从 crates/team 的 domain_routes() 挂载，加 WebSocket 端点供 UI 订阅事件
（对接 B1 的 broadcaster）。

做窄一点：只要能起服务、挂上 team 路由、WebSocket 能连。
不要加认证中间件（单用户）、不要加 CORS 之外的中间件、不要预留扩展点。

**本地联调约定（写进 apps/web 或 README 一段即可，必须有人做）：**
- 后端默认监听地址/端口（例如 127.0.0.1:3000）
- Vite dev proxy：/api 与 WebSocket 转到该端口（或 VITE_API_BASE 文档）
若 apps/web 已有人在并行改 vite 配置，你只规定端口与路径，在报告里写清约定，
避免两套 proxy 互相打架。

不要 git commit。

做完报告：cargo run 启动输出、/api/teams 的响应、WebSocket 连接验证、联调约定。
```

## D2

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/upstream-findings.md §4、
docs/tasks.md 的 D2 卡片，以及 **M0-1 的结论报告**（里面有三个 CLI 的实际启动参数）。

执行 D2：写 claude / codex / grok 三条 agent_metadata 种子 + 对应的 assistant 定义。

参数必须用 M0-1 实测出来的，不要抄上游的（上游的可能带 provider 相关字段）。
每条种子要填：command / args / env / auth_methods / available_modes / yolo_id / enabled。

**本任务验收以 API / DB 为准**（三条种子可查、可用来拉起会话）。
「从 UI 成员选择器看到并成功拉起」依赖 E 侧与 D1 联调，若 UI 未就绪，
在报告里标明「API 已过 / UI 待 F1」，不要假装 UI 已验。

不要 git commit。

做完报告：三条种子的完整内容、API 验证结果、UI 是否已能看到（未就绪则注明）。
```

## F1

```
你在 C:\Project\HuHuHu\zzbody\team-lite 工作。

先读 AGENTS.md、CONTEXT.md、docs/roadmap.md 的 M1 验收脚本、docs/tasks.md 的 F1 卡片。

执行 F1：按 M1 的 10 步验收脚本手动走一遍完整用例
（claude 规划 → grok 执行 → codex review → Lead 判断 → 修正 → 完成），保留完整日志。

**已知风险，请特别注意：** 第 5-7 步（review → Lead 判断不通过 → 新建修正任务）
的收敛高度依赖 Lead prompt 调优。很可能出现「代码全对，但 Lead 就是不按预期行事」——
比如它不建 review 任务，或者 review 不过时自己动手改而不派回给 grok。

如果卡在这里：
- **单独计时**，把 prompt 调优的时间与工程问题的时间分开记
- 不要通过改代码来绕过 prompt 问题
- 如实报告「代码没问题，是 Lead 行为不符预期」，这跟「代码有 bug」是两回事

不要 git commit。

做完报告：
1. 10 步逐条结果
2. 全程是否真的未配置任何 API key
3. 卡住的步骤、原因归类（工程问题 / prompt 问题）
4. prompt 调优花了多长时间、改了什么
```

---

## 收活时的检查清单

每个 Agent 交活后，人工确认：

- [ ] 验收项是**逐条勾选**的，不是一句「已完成」
- [ ] 报告里说清了「做了但卡片没要求的决定」——这是最容易出问题的地方
- [ ] 搬运类任务：baseline 逐字节校验过了
- [ ] 有偏离上游的改动：`UPSTREAM.md` 分歧表已更新
- [ ] 没有擅自 git commit
- [ ] 参考仓 `AionCore` / `zbbody-new` 的 `git status` 是干净的
- [ ] 并行 store 任务是否只改了约定 ownership 内的文件
- [ ] M0 / D2 结论是否已写回 `docs/upstream-findings.md`（或种子落库），不只在聊天里
- [ ] 联调：浏览器能否打到 `/api` 与 WebSocket（D1+E 侧）
