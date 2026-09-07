import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildEnv } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run, scrubCompanionEnv } from "./helpers.mjs";
import { shouldTeardownSharedBroker } from "../plugins/codex/scripts/lib/session-teardown.mjs";
import { upsertJob, writeJobFile, listJobs } from "../plugins/codex/scripts/lib/state.mjs";
import { createJobRecord } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "../plugins/codex/scripts/lib/workspace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");
const SESSION_HOOK = path.join(ROOT, "plugins", "codex", "scripts", "session-lifecycle-hook.mjs");

async function withScrubbedParentEnv(fn) {
  const previous = {
    GROK_PLUGIN_DATA: process.env.GROK_PLUGIN_DATA,
    CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    CODEX_COMPANION_SESSION_ID: process.env.CODEX_COMPANION_SESSION_ID
  };
  delete process.env.GROK_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CODEX_COMPANION_SESSION_ID;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("shouldTeardownSharedBroker refuses when foreign active jobs exist", () => {
  const decision = shouldTeardownSharedBroker({
    endingSessionId: "sess-a",
    jobs: [
      { id: "a", sessionId: "sess-a", status: "running" },
      { id: "b", sessionId: "sess-b", status: "running" }
    ]
  });
  assert.equal(decision.teardown, false);
  assert.equal(decision.reason, "foreign-active-jobs");
});

test("shouldTeardownSharedBroker refuses when brokerBusy", () => {
  const decision = shouldTeardownSharedBroker({
    endingSessionId: "sess-a",
    brokerBusy: true,
    jobs: [{ id: "a", sessionId: "sess-a", status: "completed" }]
  });
  assert.equal(decision.teardown, false);
  assert.equal(decision.reason, "broker-busy");
});

test("shouldTeardownSharedBroker allows when only ending session has jobs", () => {
  const decision = shouldTeardownSharedBroker({
    endingSessionId: "sess-a",
    jobs: [
      { id: "a", sessionId: "sess-a", status: "running" },
      { id: "b", sessionId: "sess-b", status: "completed" }
    ]
  });
  assert.equal(decision.teardown, true);
});

test("SessionEnd keeps foreign-session active jobs", async () => {
  await withScrubbedParentEnv(() => {
    const repo = makeTempDir();
    initGitRepo(repo);
    const pluginData = makeTempDir();
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const own = createJobRecord({
      id: "task-own",
      kind: "task",
      title: "Own",
      workspaceRoot,
      jobClass: "task",
      summary: "own",
      status: "completed",
      sessionId: "sess-ending"
    });
    const foreign = createJobRecord({
      id: "task-foreign",
      kind: "task",
      title: "Foreign",
      workspaceRoot,
      jobClass: "task",
      summary: "foreign",
      status: "running",
      phase: "running",
      pid: 99999998,
      sessionId: "sess-other"
    });
    process.env.GROK_PLUGIN_DATA = pluginData;
    writeJobFile(workspaceRoot, own.id, own);
    writeJobFile(workspaceRoot, foreign.id, foreign);
    upsertJob(workspaceRoot, own);
    upsertJob(workspaceRoot, foreign);

    const result = run("node", [SESSION_HOOK, "SessionEnd"], {
      cwd: repo,
      env: {
        ...scrubCompanionEnv(process.env),
        GROK_PLUGIN_DATA: pluginData,
        CODEX_COMPANION_SESSION_ID: "sess-ending"
      },
      input: JSON.stringify({ cwd: repo, sessionId: "sess-ending", hook_event_name: "SessionEnd" })
    });
    assert.equal(result.status, 0, result.stderr);

    const remaining = listJobs(workspaceRoot);
    const ids = remaining.map((job) => job.id);
    assert.equal(ids.includes("task-own"), false);
    assert.equal(ids.includes("task-foreign"), true);
    assert.equal(remaining.find((job) => job.id === "task-foreign")?.status, "running");
  });
});

test("result reconciles dead worker to failed (near-term)", async () => {
  await withScrubbedParentEnv(() => {
    const repo = makeTempDir();
    initGitRepo(repo);
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const job = createJobRecord({
      id: "task-dead-near",
      kind: "task",
      title: "Dead",
      workspaceRoot,
      jobClass: "task",
      summary: "dead",
      status: "running",
      phase: "running",
      pid: 99999997,
      sessionId: "sess-current"
    });
    writeJobFile(workspaceRoot, job.id, job);
    upsertJob(workspaceRoot, job);

    const result = run("node", [SCRIPT, "result", "task-dead-near", "--json"], {
      cwd: repo,
      env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-current" })
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.job.status, "failed");
  });
});

test("review and adversarial-review docs expose --model and --effort", () => {
  const review = fs.readFileSync(path.join(ROOT, "plugins/codex/commands/review.md"), "utf8");
  const adversarial = fs.readFileSync(path.join(ROOT, "plugins/codex/commands/adversarial-review.md"), "utf8");
  assert.match(review, /--model <model\|sol\|spark>/);
  assert.match(review, /--effort <none\|minimal\|low\|medium\|high\|xhigh\|ultra\|max>/);
  assert.match(review, /companion defaults to `gpt-6-astra` at `xhigh`|gpt-6-astra` at `xhigh`/);
  assert.match(adversarial, /--model <model\|sol\|spark>/);
  assert.match(adversarial, /--effort <none\|minimal\|low\|medium\|high\|xhigh\|ultra\|max>/);
  assert.match(adversarial, /companion defaults to `gpt-6-astra` at `xhigh`|gpt-6-astra` at `xhigh`/);
});
