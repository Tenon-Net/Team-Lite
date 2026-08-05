# E3 未解析 import 清单

搬入时间：E3 批量复制 `pages/team`（48 文件 / ~9208 行）+ `common/types/team` + `hooks/agent`。  
**本任务不要求 tsc 全绿**（E4/E5 收口）。UI fork：`zbbody-new@11b72ca`。

## 已就位

| 路径 | 说明 |
|---|---|
| `apps/web/src/pages/team/**` | 上游 pages/team 原样 |
| `apps/web/src/common/types/team/*` | teamTypes + database |
| `apps/web/src/common/adapter/{ipcBridge,httpBridge,teamMapper}.ts` | E2 slim + upstream teamMapper |
| `apps/web/src/renderer/hooks/agent/*` | useAcp* / useModel* 等 10 个 |
| Vite/TS `@` 别名 | 见 `vite.config.ts` / `tsconfig.app.json` |

## 仍无法解析（按域）

### conversation utils / platforms（→ E4 / E5）

- `@/renderer/pages/conversation/utils/conversationCache`
- `@/renderer/pages/conversation/utils/conversationAssistantIdentity`
- `@/renderer/pages/conversation/utils/conversationCreateError`
- `@/renderer/pages/conversation/utils/conversationRuntime`
- `@/renderer/pages/conversation/utils/claudeProviderRoute`（**E5 删除目标**）
- `@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector`
- `@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection`（**E5 删除目标**）
- `@/renderer/pages/conversation/platforms/useConversationCommandQueue`
- `@/renderer/pages/conversation/components/ChatLayout`
- `@/renderer/pages/conversation/Workspace/types`
- `@/renderer/pages/conversation/hooks/useActiveLease`

### provider / cron / multi-user（→ E5 删除）

- `@/renderer/pages/cron` / `cronUtils`
- `@/common/config/storage` 中的 provider 相关类型（部分）

### 组件 / hooks / utils 尚未搬

- `@/renderer/components/agent/AcpModelSelector`
- `@/renderer/components/agent/AgentModeSelector`
- `@/renderer/components/chat/SendBox/PromptEnhancementActions`
- `@/renderer/components/chat/SendBox/PromptLibraryPicker`
- `@/renderer/components/icons`
- `@/renderer/hooks/chat/useSendBoxDraft`
- `@/renderer/hooks/config/promptLibraryModel`
- `@/renderer/hooks/context/LayoutContext`
- `@/renderer/styles/colors`
- `@/renderer/utils/chat/messagePagination`
- `@/renderer/utils/common`
- `@/renderer/utils/model/agentTypes`
- `@/common/chat/chatLib`
- `@/common/types/agent/assistantTypes`
- `@/common/types/agent/promptEnhancement`
- `@/common/types/platform/acpTypes`
- `@/common/utils`
- `@/renderer/pages/guid/utils/modelUtils`

### team 页内部相对 hooks（在 pages/team 树内，应已随搬入）

- `../../hooks/TeamPermissionContext` 等 — 若仍失败检查 `pages/team/hooks` 是否完整

## 进度（持续推进）

- [x] E4：已搬 `conversationCache` / `conversationAssistantIdentity` / `conversationCreateError` / `conversationRuntime`
- [x] E5：provider/cron/aionrs 改为 stub 或 no-op（`claudeProviderRoute`、`useAionrsModelSelection`、`cronUtils`、`CronJobManager`）
- [x] 单用户 `AuthContext`；agent hooks 只保留 3 个 stub
- [x] `pages/team` **纳入 tsc include**；源文件加 `// @ts-nocheck`（中间态，避免 400+ 类型洞阻塞壳层）
- [x] `npm run build`（tsc -b + vite）**全绿**（2026-08-05）

## 下一步（F1 前）

1. 去掉 team 上的 `@ts-nocheck`，按真实类型补齐（或收窄 TeamPage 入口）
2. 挂路由打开 `TeamPage`，接 D1 后端联调
3. F1 十步验收  

不要为了收口把整个 conversation 页面搬进来。
