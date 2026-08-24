# Codex plugin for Grok Build

Use Codex from inside [Grok Build](https://x.ai/) for code reviews or to delegate tasks to Codex.

This is a Grok host port of the OpenAI [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc). It reuses the same Codex companion runtime (Apache-2.0) and adapts the slash commands, rescue agent, and hooks for Grok.

## What You Get

- `/codex:review` for a normal read-only Codex review
- `/codex:adversarial-review` for a steerable challenge review
- `/codex:rescue`, `/codex:status`, `/codex:result`, and `/codex:cancel` to delegate work and manage background jobs
- `/codex:setup` to check Codex install/auth and optionally enable the stop-time review gate

> Note: `/codex:transfer` (Claude session → Codex thread) is intentionally deferred. Grok transcript import is not wired in v1.

## Requirements

- **Grok Build** with plugins enabled
- **Node.js 18.18 or later**
- Local **Codex CLI** (`npm install -g @openai/codex`)
- **ChatGPT subscription (incl. Free) or OpenAI API key** for Codex usage limits

## Install / update

### From GitHub (recommended)

```bash
# 1) Add this repo as a Grok marketplace source (once)
grok plugin marketplace add https://github.com/opendream/codex-plugin-grok.git
# shorthand also works: grok plugin marketplace add opendream/codex-plugin-grok

# 2) Install + enable the plugin
grok plugin install codex --trust
grok plugin enable codex
```

Reload plugins (`r` in the Plugins tab) **or start a new Grok session**, then:

```bash
/codex:setup
```

If Codex CLI is missing and npm is available, setup can offer to install it. Otherwise:

```bash
npm install -g @openai/codex
codex login
```

You should then see `/codex:*` slash commands and the `codex:codex-rescue` subagent.

**Update to latest GitHub main:**

```bash
grok plugin update codex
# or full reinstall:
# grok plugin uninstall codex
# grok plugin install codex --trust
```

Editing a local git checkout alone does **not** refresh `~/.grok/installed-plugins` — always `update` / reinstall after you push.

### From a local clone (dev)

```bash
git clone https://github.com/opendream/codex-plugin-grok.git ~/Workspaces/codex-plugin-grok
grok plugin marketplace add ~/Workspaces/codex-plugin-grok
grok plugin install codex --trust
grok plugin enable codex
```

Or install the plugin path directly:

```bash
grok plugin install ~/Workspaces/codex-plugin-grok/plugins/codex --trust
grok plugin enable codex
```

### Uninstall / remove marketplace

```bash
grok plugin uninstall codex
grok plugin marketplace remove codex-plugin-grok
# if you added via URL, the source name may be the repo name shown by:
#   grok plugin marketplace list
```

### Smoke check

```bash
/codex:setup
/codex:rescue say hi
```

## Usage

```bash
/codex:review
/codex:review --base main
/codex:review --background
/codex:review --model sol --effort max
/codex:adversarial-review
/codex:adversarial-review --base main challenge whether this was the right caching design
/codex:rescue investigate why the tests started failing
/codex:rescue --resume apply the top fix from the last run
/codex:rescue --model spark fix the issue quickly
/codex:rescue --background investigate the regression
/codex:status
/codex:status task-abc123
/codex:result
/codex:result task-abc123
/codex:cancel
/codex:cancel task-abc123
/codex:setup --enable-review-gate
/codex:setup --disable-review-gate
# --model / --effort: same as rescue; native review applies model on thread start
# sol → gpt-5.6-sol; spark → gpt-5.3-codex-spark
```

> Warning: the review gate can create a long-running Grok/Codex loop and may drain usage limits quickly.

## Codex Integration

This plugin wraps the [Codex app server](https://developers.openai.com/codex/app-server) via your local `codex` binary and the same [Codex config](https://developers.openai.com/codex/config-basic) (`~/.codex/config.toml`, `.codex/config.toml`).

The companion **hard-defaults** to **`gpt-5.6-sol`** / **`max`** on task and adversarial-review turns (and Sol on native review `thread/start`). Pass `--model` / `--effort` to override — `config.toml` alone does not change what the companion forwards.

Recommended matching CLI config:

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "max"
```

Delegated tasks and stop-gate runs can be resumed in Codex with `codex resume <session-id>` when `/codex:status` or `/codex:result` prints a session ID.

## Cost / usage

- Defaults: **`gpt-5.6-sol`** at **`max`** when `--model` / `--effort` are omitted (`sol` maps to `gpt-5.6-sol`; `spark` maps to `gpt-5.3-codex-spark`).
- The companion `result` payload does **not** currently surface token or USD cost fields. Check your ChatGPT / OpenAI usage UI for spend.

## Known Issues

- **`/codex:cancel`** is verified for **queued / startup** cancellation in live smoke. Cancelling an **in-flight / mid-stream** turn is **best-effort**.
- **Mid-run status polling** was not separately proven.
- Handoff `model` / `effort` may be null even when defaults or flags applied.

## Reliability (near-term)

- **SessionEnd** only cleans jobs for the ending Grok session. If another session still has active jobs, the shared app-server broker is **not** torn down.
- Broker **`broker/shutdown`** refuses while a request/stream is in flight (busy).
- **`/codex:result`** reconciles dead worker PIDs to `failed` before returning.

## Orchestration contract (medium-term)

- Handoff envelopes validate against `plugins/codex/schemas/handoff-envelope.schema.json`.
- Versioned workflow contract: `plugins/codex/workflow-contract.json` with pinned `workflow-contract.sha256`.
- `/codex:result --json` returns a schema-validated `handoff` envelope plus the contract SHA.
- Stop-gate eval corpus: `plugins/codex/eval/stop-gate-corpus.json` with a false-approve rate metric.

## Development

```bash
cd ~/Workspaces/codex-plugin-grok
npm test
grok plugin validate ~/Workspaces/codex-plugin-grok/plugins/codex
```

Live smoke evidence: `plugins/codex/eval/live-smoke.md` (path coverage on a tiny fixture, not a soak).

## License

Apache-2.0. Companion runtime derived from OpenAI’s Codex plugin for Claude Code — see `LICENSE` and `NOTICE`.
