---
status: accepted
---

# 挑着搬 ~46k 行，而非整包 vendor 110k 行

只搬 `aionui-team`(24,572) + `aionui-team-prompts`(645) + `api-types` 的 team 子集(2,290)
+ assistant catalog 读侧(~2,000)，把 `ai-agent` / `db` / `realtime` / `auth` 四个依赖换成自写的最小替身
（约 3.3k 行）。选它而不是整包 vendor 全部 9 个 crate，是因为整包会把
provider 强绑、多用户 auth、20 crate 四层分层一起带进来，而 Team-Lite 的核心诉求就是甩掉这些。

## 为什么这条路成立

`aionui-team` 对外的耦合面比 110k 这个数字暗示的窄得多——上游自己就按
「同层通过 trait 抽象交互」分了层，缝已经在那儿了：

- `ai-agent`(41,565 行) 只用到 6 个符号，核心是 `IWorkerTaskManager`(trait)
- `realtime`(1,675) 只用到 `EventBroadcaster`(trait)
- `auth`(3,132) 只用到 `CurrentUser`
- `AgentTurnExecutionPort` 的真实现**不在 team crate 里**，在
  `aionui-app/src/router/team_conversation_adapters.rs`，全文只有 378 行

完整清单见 `../upstream-findings.md` §2。

## 考虑过的替代方案

**整包 vendor**（9 个 crate 110k 行，只删顶层无关域）能一天跑起来、diff 零噪声、
同步 = 整目录覆盖、几乎不用新写代码。否决理由是它没真正变轻——
「轻量」只体现在没有 Electron，CPA 坑原样带过来，而 UI 侧的 team 逻辑照样要自己处理。

**先整包跑通再逐步瘦身**也被否决：存在「跑起来了就不瘦了」的现实风险，最终坐拥 110k 行。

## 后果

- 每次从上游合入 bugfix 时，要判断「这个 hunk 属于我搬了的部分吗」。
  同步流程与判断标准写在 `../../UPSTREAM.md`
- 因为 Rust 上游是快照仓（只有 1 个 commit，无历史可 cherry-pick），
  必须在 `vendor/aioncore-baseline/` 存一份搬运时的原始文件做三方 diff
- 前期要花力气拆 `provisioning.rs`(1330) 和 `service.rs`(3669) 的依赖——这两个文件是耦合集中营
