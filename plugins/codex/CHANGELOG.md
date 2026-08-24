# Changelog

## 1.0.0

- Initial Grok Build port of the Codex companion plugin
- Slash commands: setup, rescue, review, adversarial-review, status, result, cancel
- Thin `codex:codex-rescue` forwarder agent
- Optional stop-time review gate via Stop hook
- Job state under `GROK_PLUGIN_DATA` (falls back to `CLAUDE_PLUGIN_DATA`)
- Deferred: `/codex:transfer` (Claude session import)
