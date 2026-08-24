#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { terminateProcessTree } from "./lib/process.mjs";
import { BROKER_ENDPOINT_ENV } from "./lib/app-server.mjs";
import {
  clearBrokerSession,
  LOG_FILE_ENV,
  loadBrokerSession,
  PID_FILE_ENV,
  sendBrokerShutdown,
  teardownBrokerSession
} from "./lib/broker-lifecycle.mjs";
import { loadState, resolveStateFile, saveState, listJobs } from "./lib/state.mjs";
import { shouldTeardownSharedBroker } from "./lib/session-teardown.mjs";
import { TRANSCRIPT_PATH_ENV } from "./lib/claude-session-transfer.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
function resolvePluginDataDir(env = process.env) {
  return env.GROK_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || null;
}

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function resolveHookEnvFile(env = process.env) {
  return env.GROK_ENV_FILE || env.CLAUDE_ENV_FILE || null;
}

function appendEnvVar(name, value) {
  const envFile = resolveHookEnvFile();
  if (!envFile || value == null || value === "") {
    return;
  }
  fs.appendFileSync(envFile, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

function readSessionId(input) {
  return input.sessionId || input.session_id || null;
}

function readTranscriptPath(input) {
  return input.transcriptPath || input.transcript_path || null;
}

function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return;
  }

  const state = loadState(workspaceRoot);
  const removedJobs = state.jobs.filter((job) => job.sessionId === sessionId);
  if (removedJobs.length === 0) {
    return;
  }

  for (const job of removedJobs) {
    const stillRunning = job.status === "queued" || job.status === "running";
    if (!stillRunning) {
      continue;
    }
    try {
      terminateProcessTree(job.pid ?? Number.NaN);
    } catch {
      // Ignore teardown failures during session shutdown.
    }
  }

  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter((job) => job.sessionId !== sessionId)
  });
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, readSessionId(input));
  appendEnvVar(TRANSCRIPT_PATH_ENV, readTranscriptPath(input));
  const pluginDataDir = resolvePluginDataDir();
  if (pluginDataDir) {
    appendEnvVar("GROK_PLUGIN_DATA", pluginDataDir);
    appendEnvVar("CLAUDE_PLUGIN_DATA", pluginDataDir);
  }
}

async function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  const endingSessionId = readSessionId(input) || process.env[SESSION_ID_ENV] || null;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = listJobs(workspaceRoot);
  const decision = shouldTeardownSharedBroker({
    jobs,
    endingSessionId,
    brokerBusy: false
  });

  // Always clean this session's jobs; never touch foreign-session workers.
  cleanupSessionJobs(cwd, endingSessionId);

  if (!decision.teardown) {
    return;
  }

  const brokerSession =
    loadBrokerSession(cwd) ??
    (process.env[BROKER_ENDPOINT_ENV]
      ? {
          endpoint: process.env[BROKER_ENDPOINT_ENV],
          pidFile: process.env[PID_FILE_ENV] ?? null,
          logFile: process.env[LOG_FILE_ENV] ?? null
        }
      : null);
  const brokerEndpoint = brokerSession?.endpoint ?? null;
  const pidFile = brokerSession?.pidFile ?? null;
  const logFile = brokerSession?.logFile ?? null;
  const sessionDir = brokerSession?.sessionDir ?? null;
  const pid = brokerSession?.pid ?? null;

  if (brokerEndpoint) {
    const shutdown = await sendBrokerShutdown(brokerEndpoint);
    // Only tear down locally after an explicit successful shutdown ack.
    if (!shutdown?.ok || shutdown?.busy) {
      return;
    }
  }

  teardownBrokerSession({
    endpoint: brokerEndpoint,
    pidFile,
    logFile,
    sessionDir,
    pid,
    killProcess: terminateProcessTree
  });
  clearBrokerSession(cwd);
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd") {
    await handleSessionEnd(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
