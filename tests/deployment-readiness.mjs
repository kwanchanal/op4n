import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function assess(input, now = new Date("2026-11-08T00:00:00.000Z")) {
  const reasons = [];
  if (input.mode !== "READINESS_ONLY") reasons.push("mode must be READINESS_ONLY");
  if (!/^[0-9a-f]{40}$/.test(input.releaseSha ?? "")) reasons.push("release SHA must be a full lowercase commit SHA");
  if (!/^[0-9a-f]{64}$/.test(input.artifactDigest ?? "")) reasons.push("artifact digest must be SHA-256");
  if (!['staging', 'production'].includes(input.target)) reasons.push("target must be unambiguous");
  if (input.evidenceStatus !== "PASS") reasons.push("all evidence must pass");
  const observed = new Date(input.observedAtUtc ?? "invalid");
  if (!Number.isFinite(observed.valueOf()) || now - observed > 60 * 60 * 1000 || observed > now) reasons.push("evidence is missing, stale, or future-dated");
  if (input.target === "production") {
    if (input.stagingReleaseSha !== input.releaseSha) reasons.push("Production release must equal the Staging-verified release");
    if (input.stagingArtifactDigest !== input.artifactDigest) reasons.push("Production artifact must equal the Staging-verified artifact");
    if (input.founderApproval !== "APPROVED") reasons.push("Founder approval is required");
  }
  if (input.databaseAction && input.databaseAction !== "NONE") reasons.push("database rollback/restore is not automated");
  return { readyForDryRun: reasons.length === 0, reasons, deploymentState: "NOT_DEPLOYED" };
}

function selfTest() {
  const base = {
    mode: "READINESS_ONLY",
    target: "staging",
    releaseSha: "a".repeat(40),
    artifactDigest: "b".repeat(64),
    evidenceStatus: "PASS",
    observedAtUtc: "2026-11-07T23:30:00.000Z",
    databaseAction: "NONE",
  };
  const cases = [
    [base, true],
    [{ ...base, evidenceStatus: "SKIPPED" }, false],
    [{ ...base, observedAtUtc: "2026-11-07T20:00:00.000Z" }, false],
    [{ ...base, target: "production", founderApproval: "APPROVED", stagingReleaseSha: base.releaseSha, stagingArtifactDigest: base.artifactDigest }, true],
    [{ ...base, target: "production", founderApproval: "APPROVED", stagingReleaseSha: "c".repeat(40), stagingArtifactDigest: base.artifactDigest }, false],
    [{ ...base, target: "production", founderApproval: "MISSING", stagingReleaseSha: base.releaseSha, stagingArtifactDigest: base.artifactDigest }, false],
    [{ ...base, databaseAction: "REVERSE_MIGRATION" }, false],
  ];
  cases.forEach(([input, expected], index) => {
    const actual = assess(input).readyForDryRun;
    if (actual !== expected) throw new Error(`readiness self-test ${index + 1} failed`);
  });
  console.log(`PASS deployment fail-closed self-tests: ${cases.length} cases, state=NOT_DEPLOYED`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const path = process.argv[2];
  if (!path) throw new Error("provide a sanitized readiness JSON path or --self-test");
  const result = assess(JSON.parse(readFileSync(resolve(root, path), "utf8")), new Date());
  console.log(JSON.stringify(result));
  if (!result.readyForDryRun) process.exitCode = 1;
}
