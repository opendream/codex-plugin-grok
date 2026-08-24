import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildEnv } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run, scrubCompanionEnv } from "./helpers.mjs";
import { upsertJob, writeJobFile } from "../plugins/codex/scripts/lib/state.mjs";
import { createJobRecord } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "../plugins/codex/scripts/lib/workspace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");

async function withScrubbedParentEnv(fn) {
  const previous = {
    GROK_PLUGIN_DATA: process.env.GROK_PLUGIN_DATA,
    CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    CODEX_COMPANION_SESSION_ID: process.env.CODEX_COMPANION_SESSION_ID,
    CLAUDE_COMPANION_HOST_SESSION_ID: process.env.CLAUDE_COMPANION_HOST_SESSION_ID
  };
  delete process.env.GROK_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CODEX_COMPANION_SESSION_ID;
  delete process.env.CLAUDE_COMPANION_HOST_SESSION_ID;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("status --all includes jobs from other sessions", async () => {
  await withScrubbedParentEnv(() => {
    const repo = makeTempDir();
    initGitRepo(repo);
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const other = createJobRecord({
      id: "task-other",
      kind: "task",
      kindLabel: "rescue",
      title: "Other",
      workspaceRoot,
      jobClass: "task",
      summary: "other",
      status: "completed",
      sessionId: "sess-other",
      threadId: "thread-other"
    });
    const current = createJobRecord({
      id: "task-current",
      kind: "task",
      kindLabel: "rescue",
      title: "Current",
      workspaceRoot,
      jobClass: "task",
      summary: "current",
      status: "completed",
      sessionId: "sess-current",
      threadId: "thread-current"
    });
    writeJobFile(workspaceRoot, other.id, other);
    writeJobFile(workspaceRoot, current.id, current);
    upsertJob(workspaceRoot, other);
    upsertJob(workspaceRoot, current);

    const filtered = run("node", [SCRIPT, "status", "--json"], {
      cwd: repo,
      env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-current" })
    });
    assert.equal(filtered.status, 0, filtered.stderr);
    const filteredPayload = JSON.parse(filtered.stdout);
    const filteredIds = [filteredPayload.latestFinished, ...filteredPayload.recent, ...filteredPayload.running]
      .filter(Boolean)
      .map((job) => job.id);
    assert.ok(filteredIds.includes("task-current"));
    assert.equal(filteredIds.includes("task-other"), false);

    const all = run("node", [SCRIPT, "status", "--all", "--json"], {
      cwd: repo,
      env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-current" })
    });
    assert.equal(all.status, 0, all.stderr);
    const allPayload = JSON.parse(all.stdout);
    const allIds = [allPayload.latestFinished, ...allPayload.recent, ...allPayload.running]
      .filter(Boolean)
      .map((job) => job.id);
    assert.ok(allIds.includes("task-current"));
    assert.ok(allIds.includes("task-other"));
  });
});

test("status reconciles a dead worker pid to failed", async () => {
  await withScrubbedParentEnv(() => {
    const repo = makeTempDir();
    initGitRepo(repo);
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const job = createJobRecord({
      id: "task-dead",
      kind: "task",
      kindLabel: "rescue",
      title: "Dead",
      workspaceRoot,
      jobClass: "task",
      summary: "dead",
      status: "running",
      phase: "running",
      pid: 99999999,
      sessionId: "sess-current"
    });
    writeJobFile(workspaceRoot, job.id, job);
    upsertJob(workspaceRoot, job);

    const result = run("node", [SCRIPT, "status", "task-dead", "--json"], {
      cwd: repo,
      env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-current" })
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.job.status, "failed");
    assert.match(payload.job.errorMessage || "", /no longer running/i);
  });
});

test("result reconciles a dead worker pid to failed", async () => {
  await withScrubbedParentEnv(() => {
    const repo = makeTempDir();
    initGitRepo(repo);
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const job = createJobRecord({
      id: "task-dead-result",
      kind: "task",
      kindLabel: "rescue",
      title: "Dead Result",
      workspaceRoot,
      jobClass: "task",
      summary: "dead result",
      status: "running",
      phase: "running",
      pid: 99999999,
      sessionId: "sess-current"
    });
    writeJobFile(workspaceRoot, job.id, job);
    upsertJob(workspaceRoot, job);

    const result = run("node", [SCRIPT, "result", "task-dead-result", "--json"], {
      cwd: repo,
      env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-current" })
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.job.status, "failed");
    assert.match(payload.job.errorMessage || "", /no longer running/i);
  });
});

test("stop-gate jobs are excluded from resume-candidate", async () => {
  await withScrubbedParentEnv(() => {
    const repo = makeTempDir();
    initGitRepo(repo);
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const stopGate = createJobRecord({
      id: "task-stop",
      kind: "stop-gate",
      kindLabel: "stop-gate",
      title: "Codex Stop Gate Review",
      workspaceRoot,
      jobClass: "task",
      summary: "gate",
      status: "completed",
      sessionId: "sess-current",
      threadId: "thread-stop"
    });
    const rescue = createJobRecord({
      id: "task-rescue",
      kind: "task",
      kindLabel: "rescue",
      title: "Codex Task",
      workspaceRoot,
      jobClass: "task",
      summary: "rescue",
      status: "completed",
      sessionId: "sess-current",
      threadId: "thread-rescue"
    });
    writeJobFile(workspaceRoot, stopGate.id, stopGate);
    writeJobFile(workspaceRoot, rescue.id, rescue);
    upsertJob(workspaceRoot, stopGate);
    upsertJob(workspaceRoot, rescue);

    const result = run("node", [SCRIPT, "task-resume-candidate", "--json"], {
      cwd: repo,
      env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-current" })
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.available, true);
    assert.equal(payload.candidate.id, "task-rescue");
  });
});

test("runTrackedJob does not clobber cancelled status", async () => {
  await withScrubbedParentEnv(async () => {
    const { runTrackedJob, createJobRecord: createRec, nowIso } = await import(
      "../plugins/codex/scripts/lib/tracked-jobs.mjs"
    );
    const { writeJobFile, upsertJob, readJobFile, resolveJobFile } = await import(
      "../plugins/codex/scripts/lib/state.mjs"
    );
    const repo = makeTempDir();
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const job = createRec({
      id: "task-cancel-race",
      kind: "task",
      title: "Race",
      workspaceRoot,
      jobClass: "task",
      summary: "race"
    });
    await runTrackedJob(job, async () => {
      const stored = readJobFile(resolveJobFile(workspaceRoot, job.id));
      writeJobFile(workspaceRoot, job.id, {
        ...stored,
        status: "cancelled",
        phase: "cancelled",
        completedAt: nowIso()
      });
      upsertJob(workspaceRoot, { id: job.id, status: "cancelled", phase: "cancelled" });
      return {
        exitStatus: 0,
        payload: { ok: true },
        rendered: "done\n",
        summary: "done"
      };
    });
    const finalJob = readJobFile(resolveJobFile(workspaceRoot, job.id));
    assert.equal(finalJob.status, "cancelled");
  });
});

test("runTrackedJob does not resurrect a pre-cancelled job", async () => {
  await withScrubbedParentEnv(async () => {
    const { runTrackedJob, createJobRecord: createRec, nowIso } = await import(
      "../plugins/codex/scripts/lib/tracked-jobs.mjs"
    );
    const { writeJobFile, upsertJob, readJobFile, resolveJobFile } = await import(
      "../plugins/codex/scripts/lib/state.mjs"
    );
    const repo = makeTempDir();
    const workspaceRoot = resolveWorkspaceRoot(repo);
    const job = createRec({
      id: "task-pre-cancel",
      kind: "task",
      title: "Pre",
      workspaceRoot,
      jobClass: "task",
      summary: "pre"
    });
    writeJobFile(workspaceRoot, job.id, {
      ...job,
      status: "cancelled",
      phase: "cancelled",
      completedAt: nowIso()
    });
    upsertJob(workspaceRoot, { id: job.id, status: "cancelled", phase: "cancelled" });
    await runTrackedJob(job, async () => {
      throw new Error("runner should not run");
    });
    const finalJob = readJobFile(resolveJobFile(workspaceRoot, job.id));
    assert.equal(finalJob.status, "cancelled");
  });
});
