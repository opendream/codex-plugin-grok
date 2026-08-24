# Live companion smoke evidence — codex-plugin-grok

- **Date (UTC):** 2026-08-24T07:58:52Z
- **Pre-release smoke runtime SHA (historical; not this release root):** `7fbd75782b237aa7400f21d43292850f9c31267c`
- **Companion entrypoint:** installed `~/.grok/installed-plugins/codex-*/scripts/codex-companion.mjs` (byte-identical to workspace tip at smoke time)
- **Codex CLI:** codex-cli 0.149.0
- **Node:** v22.19.0
- **Fixture:** one-file dirty git repo (`src/app.js`: `value` 1→2 + `// review target`)
- **Defaults exercised:** gpt-5.6-sol/max (contract); override cell used `--model sol --effort low`
- **Scope:** single smoke run per cell — path coverage, not soak

## Outcomes

| Use case | Exit | Duration (s) | Coverage | Notes |
|---|---:|---:|---|---|
| setup | 0 | 0.216 | **PASS** | ready JSON |
| review | 0 | 31.903 | **PASS** | --wait defaults |
| adversarial-review | 0 | 9.703 | **PASS** | --effort low + focus prompt |
| rescue | 0 | 4.357 | **PASS** | task --write PONG |
| rescue-override | 0 | 4.828 | **PASS** | explicit --model/--effort low → PONG2 |
| status | 0 | 0.085 | **PASS** | --json (sampled before background) |
| result | 0 | 0.092 | **PASS** | --json handoff+contract |
| rescue-background | 0 | 0.216 | **PASS** | --background longer Fibonacci prompt |
| cancel | 0 | 0.151 | **PASS** | cancel background job --json (queued/startup cancel; turnInterrupt flags may be false) |

**Score:** 9/9 PASS

Machine-readable rows (argv, previews; account identifiers redacted): `live-smoke-matrix.json`.

## Commands (shape)

Each cell invoked `node <companion> …` with `--cwd` on the fixture (except setup). Representative argv are retained under the generating scratch `runs/<plugin>-<usecase>/argv.json` from the matrix driver.

## Caveats recorded at smoke time

- Cancel cell proves job reaches `cancelled`; active mid-stream turn interrupt was not separately proven.
- Companion `result` did not surface token/cost fields.
- Status was sampled before background start (`running: []` expected at that moment); mid-run status polling not separately proven.
- Handoff envelope `model`/`effort` may be null (provenance); resume uses session/thread ids.

Twin plugin: see `claude-plugin-grok` `plugins/claude/eval/live-smoke.md`.
