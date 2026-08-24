import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_MD = path.join(ROOT, "plugins", "codex", "eval", "live-smoke.md");
const SMOKE_MATRIX = path.join(ROOT, "plugins", "codex", "eval", "live-smoke-matrix.json");
const README = path.join(ROOT, "README.md");

const USE_CASES = [
  "setup",
  "review",
  "adversarial-review",
  "rescue",
  "rescue-override",
  "status",
  "result",
  "rescue-background",
  "cancel"
];

test("live-smoke.md exists with historical SHA attribution and all 9 use cases", () => {
  assert.ok(fs.existsSync(SMOKE_MD), `missing ${SMOKE_MD}`);
  const text = fs.readFileSync(SMOKE_MD, "utf8");
  const shaMatch =
    text.match(/Pre-release smoke runtime SHA[^`]*`([0-9a-f]{40})`/i) ||
    text.match(/\b([0-9a-f]{40})\b/);
  assert.ok(shaMatch, "live-smoke.md must embed a 40-char smoke runtime SHA");
  assert.match(shaMatch[1], /^[0-9a-f]{40}$/);
  assert.ok(
    text.includes("historical") || text.includes("Pre-release smoke runtime SHA"),
    "live-smoke.md must mark the SHA as historical for fresh-root releases"
  );
  for (const usecase of USE_CASES) {
    assert.ok(text.includes(`| ${usecase} |`), `live-smoke.md must list use case: ${usecase}`);
  }
});

test("live-smoke-matrix.json parses with 9 codex rows, all PASS or BLOCKED", () => {
  assert.ok(fs.existsSync(SMOKE_MATRIX), `missing ${SMOKE_MATRIX}`);
  const rows = JSON.parse(fs.readFileSync(SMOKE_MATRIX, "utf8"));
  assert.ok(Array.isArray(rows), "matrix must be a JSON array");
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.equal(row.plugin, "codex", `unexpected plugin in row: ${row.usecase}`);
    assert.ok(
      ["PASS", "BLOCKED"].includes(row.coverage),
      `row ${row.usecase} has coverage ${row.coverage}, expected PASS or BLOCKED`
    );
    if (Array.isArray(row.argv)) {
      for (const arg of row.argv) {
        const personalHome = ["", "Users", "keng"].join("/");
        assert.equal(typeof arg === "string" && arg.includes(personalHome), false, `argv must not contain personal home path: ${arg}`);
      }
    }
  }
  assert.deepEqual(rows.map((row) => row.usecase).sort(), [...USE_CASES].sort());
});

test("README documents Known Issues and cost caveats", () => {
  const readme = fs.readFileSync(README, "utf8");
  for (const phrase of ["Known Issues", "Cost / usage", "best-effort", "queued", "transfer", "null"]) {
    assert.ok(readme.includes(phrase), `README.md must mention: ${phrase}`);
  }

  assert.ok(
    readme.includes("does **not** currently surface") || readme.includes("does not currently surface"),
    "README.md must say companion does not surface token/cost"
  );
});
