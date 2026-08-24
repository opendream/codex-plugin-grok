import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

export function makeTempDir(prefix = "codex-plugin-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function scrubCompanionEnv(env = process.env) {
  const next = { ...env };
  delete next.GROK_PLUGIN_DATA;
  delete next.CLAUDE_PLUGIN_DATA;
  delete next.CODEX_COMPANION_SESSION_ID;
  delete next.CLAUDE_COMPANION_HOST_SESSION_ID;
  delete next.CLAUDE_COMPANION_STOP_GATE;
  delete next.CLAUDE_ENV_FILE;
  delete next.GROK_ENV_FILE;
  return next;
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    // Prefer an explicit env from the test; otherwise scrub live companion vars.
    env: options.env ?? scrubCompanionEnv(process.env),
    encoding: "utf8",
    input: options.input,
    shell: options.shell ?? (process.platform === "win32" && !path.isAbsolute(command)),
    windowsHide: true
  });
}

export function initGitRepo(cwd) {
  run("git", ["init", "-b", "main"], { cwd });
  run("git", ["config", "user.name", "Codex Plugin Tests"], { cwd });
  run("git", ["config", "user.email", "tests@example.com"], { cwd });
  run("git", ["config", "commit.gpgsign", "false"], { cwd });
  run("git", ["config", "tag.gpgsign", "false"], { cwd });
}
