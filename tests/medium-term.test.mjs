import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  jobToHandoffEnvelope,
  loadEvalCorpus,
  loadWorkflowContract,
  scoreStopGateCorpus,
  validateHandoffEnvelope
} from "../plugins/codex/scripts/lib/orchestration.mjs";
import { buildEnv } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { createJobRecord } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";
import { upsertJob, writeJobFile } from "../plugins/codex/scripts/lib/state.mjs";
import { resolveWorkspaceRoot } from "../plugins/codex/scripts/lib/workspace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");

test("workflow-contract SHA matches pinned sha256 file", () => {
  const { contract, sha256, filePath } = loadWorkflowContract(PLUGIN_ROOT);
  assert.match(filePath, /workflow-contract\.json$/);
  assert.equal(contract.contractVersion, "1.0.0");
  assert.equal(contract.defaults.model, "gpt-6-astra");
  assert.equal(contract.defaults.effort, "xhigh");
  const pinned = fs.readFileSync(path.join(PLUGIN_ROOT, "workflow-contract.sha256"), "utf8").trim();
  assert.equal(sha256, pinned);
});

test("handoff envelope validates on the real schema path", () => {
  const envelope = jobToHandoffEnvelope({
    id: "task-1",
    kind: "task",
    status: "completed",
    workspaceRoot: "/tmp/repo",
    sessionId: "sess-1",
    threadId: "thr-1",
    model: "gpt-5.6-sol",
    effort: "max",
    summary: "done",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z"
  });
  const result = validateHandoffEnvelope(envelope, PLUGIN_ROOT);
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("invalid handoff envelope is rejected", () => {
  const result = validateHandoffEnvelope(
    {
      schemaVersion: "1.0.0",
      plugin: "codex",
      kind: "task",
      jobId: "task-1",
      status: "nope",
      workspaceRoot: "/tmp/repo",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    PLUGIN_ROOT
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("stop-gate eval corpus produces per-case records and false-approve rate", () => {
  const corpus = loadEvalCorpus(PLUGIN_ROOT);
  const scored = scoreStopGateCorpus(corpus);
  assert.equal(scored.total, corpus.cases.length);
  assert.equal(scored.records.length, corpus.cases.length);
  assert.ok(scored.records.every((r) => r.id && r.oracle && r.gate && r.parseOk));
  assert.equal(scored.oracleBlockCount, 3);
  assert.equal(scored.falseApproveCount, 1);
  assert.equal(scored.falseApproveRate, 1 / 3);
});

test("result --json emits schema-validated handoff envelope and workflow SHA", () => {
  const repo = makeTempDir();
  initGitRepo(repo);
  const workspaceRoot = resolveWorkspaceRoot(repo);
  const job = createJobRecord({
    id: "task-handoff",
    kind: "task",
    title: "Handoff",
    workspaceRoot,
    jobClass: "task",
    summary: "done",
    status: "completed",
    sessionId: "sess-1",
    threadId: "thr-1",
    model: "gpt-5.6-sol",
    effort: "max",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z"
  });
  writeJobFile(workspaceRoot, job.id, job);
  upsertJob(workspaceRoot, job);

  const result = run("node", [SCRIPT, "result", "task-handoff", "--json"], {
    cwd: repo,
    env: buildEnv(makeTempDir(), { CODEX_COMPANION_SESSION_ID: "sess-1" })
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.handoffValidation.ok, true, JSON.stringify(payload.handoffValidation));
  assert.equal(payload.handoff.plugin, "codex");
  assert.equal(payload.workflowContract.defaults.effort, "xhigh");
  const pinned = fs.readFileSync(path.join(PLUGIN_ROOT, "workflow-contract.sha256"), "utf8").trim();
  assert.equal(payload.workflowContract.sha256, pinned);
});

test("shouldTeardownSharedBroker treats missing sessionId active jobs as foreign", async () => {
  const { shouldTeardownSharedBroker } = await import("../plugins/codex/scripts/lib/session-teardown.mjs");
  const decision = shouldTeardownSharedBroker({
    endingSessionId: "sess-a",
    jobs: [{ id: "orphan", status: "running" }]
  });
  assert.equal(decision.teardown, false);
  assert.equal(decision.reason, "foreign-active-jobs");
});
