import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function resolvePluginRoot(root = ROOT_DIR) {
  return root;
}

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function sha256CanonicalJson(value) {
  const canonical = JSON.stringify(value);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function loadWorkflowContract(root = ROOT_DIR) {
  const filePath = path.join(root, "workflow-contract.json");
  const contract = loadJson(filePath);
  return {
    filePath,
    contract,
    sha256: sha256CanonicalJson(contract)
  };
}

export function loadHandoffSchema(root = ROOT_DIR) {
  return loadJson(path.join(root, "schemas", "handoff-envelope.schema.json"));
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateAgainstDraftSchema(schema, value, pathPrefix = "$") {
  const errors = [];
  if (schema.type) {
    const expected = schema.type;
    const actual = typeOf(value);
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(actual)) {
      errors.push(`${pathPrefix}: expected ${allowed.join("|")}, got ${actual}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${pathPrefix}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathPrefix}: value not in enum`);
  }
  if (schema.minLength != null && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${pathPrefix}: shorter than minLength ${schema.minLength}`);
  }
  if (schema.type === "object" || (!schema.type && schema.properties)) {
    const obj = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    if (!obj) return errors;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${pathPrefix}.${key}: required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!schema.properties?.[key]) errors.push(`${pathPrefix}.${key}: additional property`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        errors.push(...validateAgainstDraftSchema(childSchema, obj[key], `${pathPrefix}.${key}`));
      }
    }
  }
  return errors;
}

export function validateHandoffEnvelope(envelope, root = ROOT_DIR) {
  const schema = loadHandoffSchema(root);
  const errors = validateAgainstDraftSchema(schema, envelope);
  return { ok: errors.length === 0, errors, schemaVersion: schema.properties?.schemaVersion?.const ?? null };
}

export function jobToHandoffEnvelope(job, plugin = "codex") {
  return {
    schemaVersion: "1.0.0",
    plugin,
    kind: job.kind === "adversarial-review" || job.kind === "stop-gate" || job.kind === "review" ? job.kind : "task",
    jobId: job.id,
    status: job.status,
    workspaceRoot: job.workspaceRoot,
    sessionId: job.sessionId ?? null,
    threadId: job.threadId ?? null,
    model: job.model ?? null,
    effort: job.effort ?? null,
    summary: job.summary ?? null,
    createdAt: job.createdAt ?? job.startedAt ?? new Date(0).toISOString(),
    completedAt: job.completedAt ?? null
  };
}

export function loadEvalCorpus(root = ROOT_DIR) {
  return loadJson(path.join(root, "eval", "stop-gate-corpus.json"));
}

/**
 * Parse stop-gate companion output. First line must be ALLOW:/BLOCK: (same contract as the hook).
 */
export function parseStopGateVerdict(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return { verdict: null, ok: false, reason: "empty" };
  }
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) {
    return { verdict: "ALLOW", ok: true, reason: firstLine.slice("ALLOW:".length).trim() || null };
  }
  if (firstLine.startsWith("BLOCK:")) {
    return {
      verdict: "BLOCK",
      ok: false,
      reason: firstLine.slice("BLOCK:".length).trim() || text
    };
  }
  return { verdict: null, ok: false, reason: "unexpected" };
}

/**
 * Score stop-gate corpus by parsing executable gateOutput through parseStopGateVerdict.
 * falseApproveRate = ALLOW-when-oracle-BLOCK / oracle-BLOCK count.
 */
export function scoreStopGateCorpus(corpus) {
  const records = (corpus.cases ?? []).map((entry) => {
    const parsed = parseStopGateVerdict(entry.gateOutput ?? entry.gate ?? "");
    const gate = parsed.verdict;
    const correct = gate === entry.oracle;
    const falseApprove = entry.oracle === "BLOCK" && gate === "ALLOW";
    const falseBlock = entry.oracle === "ALLOW" && gate === "BLOCK";
    return {
      id: entry.id,
      oracle: entry.oracle,
      gate,
      gateOutput: entry.gateOutput ?? null,
      parseOk: parsed.verdict != null,
      correct,
      falseApprove,
      falseBlock,
      notes: entry.notes ?? null
    };
  });
  const oracleBlocks = records.filter((r) => r.oracle === "BLOCK");
  const falseApproves = records.filter((r) => r.falseApprove);
  const falseApproveRate = oracleBlocks.length === 0 ? 0 : falseApproves.length / oracleBlocks.length;
  return {
    corpusVersion: corpus.corpusVersion ?? null,
    total: records.length,
    correct: records.filter((r) => r.correct).length,
    falseApproveCount: falseApproves.length,
    oracleBlockCount: oracleBlocks.length,
    falseApproveRate,
    records
  };
}
