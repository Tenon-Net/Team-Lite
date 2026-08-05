# Team-Lite ACP probe

This is an independent Rust spike for ACP `0.11.1`. It starts one process at a time, performs `initialize`, `session/new`, and `session/prompt`, prints `session/update` text as it arrives, records `auth_methods` and `available_modes`, then kills the complete Windows process tree.

Run from the Team-Lite repository root so the ACP session workspace is the repository:

```powershell
cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent claude
cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent codex
cargo run --manifest-path spike/acp-probe/Cargo.toml -- --agent grok
cargo run --manifest-path spike/acp-probe/Cargo.toml
```

Launch configurations mirror the read-only AionCore factory findings:

| Agent | ACP launch | Underlying installed CLI |
| --- | --- | --- |
| Claude | `C:/Program Files/nodejs/npx.cmd -y @agentclientprotocol/claude-agent-acp@0.39.0` | `C:/Users/Administrator/.local/bin/claude` |
| Codex | `C:/Program Files/nodejs/npx.cmd -y @zed-industries/codex-acp@0.14.0` | `C:/Users/Administrator/AppData/Roaming/npm/codex` |
| Grok | `C:/Users/Administrator/.grok/bin/grok agent stdio` | `C:/Users/Administrator/.grok/bin/grok` |

Reports are written to `results/<agent>.json`. Relevant auth/provider environment variables are recorded only as present/absent booleans; their values are never written. The Claude launch adds no API key, provider variable, CLI flag, or config file. It inherits the machine environment exactly as the other probes do.

The prompt is intentionally read-only and asks for an exact response without tools, so any permission request is logged and answered with its first advertised option. This makes the permission behavior observable without modifying the repository.
