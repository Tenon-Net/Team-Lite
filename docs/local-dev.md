# 本地联调约定（D1）

Team-Lite 前后端本地开发默认约定。E1 Vite proxy 已与此对齐。

## 后端（`crates/app` → 二进制 `team-lite`）

| 项 | 默认 | 环境变量 |
|---|---|---|
| 监听 | `127.0.0.1:3000` | `TEAM_LITE_ADDR` |
| 数据目录 | `%TEMP%/team-lite-<pid>/` | `TEAM_LITE_DATA` |
| 日志 | `info` | `RUST_LOG` |

启动：

```powershell
cargo run -p app
# 或
.\target\debug\team-lite.exe
```

### 关键 HTTP

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活探测，返回 `ok` |
| GET | `/api/teams` | 团队列表（`{ success, data }`） |
| POST | `/api/teams` | 建团；body 见下 |
| WS | `/ws` | 事件广播（JSON 文本帧） |

建团 body（注意：`TeamAgentInput` 反序列化 **不要** 传 `backend` 字段，`deny_unknown_fields` 会 400；backend 由 `assistant_id` 种子解析）：

```json
{
  "name": "demo-team",
  "workspace": "C:/path/to/workspace",
  "agents": [
    { "name": "Lead", "role": "lead", "model": "default", "assistant_id": "asst-grok" },
    { "name": "Worker", "role": "teammate", "model": "default", "assistant_id": "asst-codex" }
  ]
}
```

种子 assistant_id：`asst-claude` / `asst-grok` / `asst-codex`（D2 启动时写入 memory store）。

当前用户：单用户 `CurrentUser::system_default()`，无需登录头。

## 前端（`apps/web`）

| 项 | 默认 |
|---|---|
| Vite | `http://127.0.0.1:5173` |
| API proxy | `/api` → `http://127.0.0.1:3000` |
| WS proxy | `/ws` → `ws://127.0.0.1:3000/ws` |
| 覆盖后端 | `VITE_BACKEND_ORIGIN`（写在 `vite.config.ts`） |

```powershell
cd apps/web
npm run dev
```

浏览器走同源 `/api` 与 `/ws` 即可，无需在前端硬编码 3000。

### UI 路由

| 路径 | 页面 |
|---|---|
| `/` | 团队列表（`ipcBridge.team.list`） |
| `/team/:id` | `TeamPage`（E3 原样 + E5 stub 依赖） |

注意：TeamPage 依赖大量 stub（ACP chat / provider / cron 等），能打开但会话流/模型选择尚未完整。

## 冒烟检查

```powershell
curl.exe -s http://127.0.0.1:3000/health
curl.exe -s http://127.0.0.1:3000/api/teams
```

期望：`ok` 与 `{"success":true,"data":[...]}`。
