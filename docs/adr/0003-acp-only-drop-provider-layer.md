---
status: accepted
---

# 成员只走 ACP，删掉 provider 层与 Aionrs 运行时

[[Member]] 只能是本机 CLI Agent（claude / codex / grok），通过 ACP 通信。
删掉 `AgentType::Aionrs`（API key 直连模型）整条路径、provider 表及其 4 个 repo。
认证完全交给 CLI 自身的登录态——你用 claude 订阅登录就能跑，Team-Lite 不管也不问。

## 这顺带修掉了 CPA 强绑坑

上游建团时对 claude 强制要求一个 enabled 的 Anthropic/CPA provider，
即使用户只有 Claude Code 订阅登录（CLI 自带 OAuth）也会直接报错。

根因不是架构约束，**是同一个产品里两种写法不一致**：

```rust
// acp_launch_policy.rs:668  grok = 可选 provider
let Some(provider_id) = config.provider_id.as_deref()... else {
    return Ok(None);        // 没绑就用 CLI 自己的登录态（~/.grok）
};

// provisioning.rs:590  claude = 强制 provider
self.resolve_claude_provider_for_model(model).await?
    .ok_or_else(|| TeamError::InvalidRequest(
        "no enabled Anthropic/CPA provider supports Claude team model"))?
```

「provider 解析」被塞进了「创建会话」这一步——单聊 ACP 路径不吃这个约束，团队路径吃。
删掉 `provisioning.rs:587-596` 那个 match 分支即可，**模式是上游自带的（grok 那条），不是发明的**。

> ⚠️ 此结论只经代码论证，**未实机验证**。列为 M0 spike 的验收项。
> 若 M0 发现 claude 不配 provider 就是起不来，本 ADR 需重写。

## 运行时不需要新的插件机制

上游已经插件化了：`AgentMetadataRow`（`aionui-db/src/models/agent_metadata.rs:13`）
就是运行时注册表，字段含 `command` / `args` / `env` / `auth_methods` / `available_modes` / `yolo_id`。
**加一个运行时 = 插一行数据。** v1 预置 claude / codex / grok 三条种子。

`auth_methods` 是 ACP 协议里 agent 自己宣告的认证方式——这才是「订阅登录 vs API key」
应该被处理的位置，而不是产品层的 provider 表。

## 后果

- **失去「用 API key 直连一个便宜模型当 Worker」的能力。** 若将来需要，得重新引入 provider 表
  （加密存储 + 模型列表 + UI 配置页），代价不小
- 成员能力受限于本机装了什么 CLI
- UI 侧要一并删掉 `claudeProviderRoute` 和 `useAionrsModelSelection`（CPA 坑的 UI 侧对应物）
- 每次从上游合 diff 时会持续看到 provider 相关改动，全部跳过——已记入 `../../UPSTREAM.md` 的永久性分歧表
