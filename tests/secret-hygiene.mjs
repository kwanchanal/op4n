import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const selfTestOnly = process.argv.includes("--self-test-only");
const maximumTextBytes = 2 * 1024 * 1024;
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".properties",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const extensionlessTextFiles = new Set(["AGENTS.md", "CNAME", "LICENSE"]);
const frontendPathPattern = /^(?:app\.js|discover\.html|index\.html|shared-sidebar\.js|data\/|services\/|dist\/)/;

const detectors = [
  {
    id: "PRIVATE_KEY_MATERIAL",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    canary: () => ["-----BEGIN ", "PRIVATE KEY", "-----"].join(""),
  },
  {
    id: "GITHUB_TOKEN",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{32,255}\b/g,
    canary: () => ["gh", "p_", "A".repeat(40)].join(""),
  },
  {
    id: "GITLAB_TOKEN",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,255}\b/g,
    canary: () => ["gl", "pat-", "B".repeat(24)].join(""),
  },
  {
    id: "NPM_TOKEN",
    pattern: /\bnpm_[A-Za-z0-9]{32,255}\b/g,
    canary: () => ["np", "m_", "C".repeat(36)].join(""),
  },
  {
    id: "SUPABASE_CREDENTIAL",
    pattern: /\b(?:sbp_[A-Za-z0-9]{20,255}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,255})\b/g,
    canary: () => ["sb", "_secret_", "D".repeat(28)].join(""),
  },
  {
    id: "JWT_CREDENTIAL",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    canary: () => ["ey", "J", "E".repeat(12), ".", "F".repeat(12), ".", "G".repeat(12)].join(""),
  },
  {
    id: "AWS_ACCESS_KEY",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    canary: () => ["AK", "IA", "H".repeat(16)].join(""),
  },
  {
    id: "GOOGLE_API_KEY",
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    canary: () => ["AI", "za", "I".repeat(35)].join(""),
  },
  {
    id: "STRIPE_SECRET_KEY",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,255}\b/g,
    canary: () => ["sk_", "live_", "J".repeat(24)].join(""),
  },
  {
    id: "CREDENTIAL_URL",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^@\s/]+@/gi,
    canary: () => ["post", "gresql://", "user", ":", "password", "@", "database.invalid/db"].join(""),
  },
  {
    id: "NAMED_SECRET_ASSIGNMENT",
    pattern: /\b(?:SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD|SECRET_KEY)|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|INTERNAL_(?:API_)?SERVICE_CREDENTIAL(?:_(?:CURRENT|NEXT))?|DESTINATION_FINGERPRINT_HMAC_KEY(?:_(?:CURRENT|NEXT))?|SAFETY_PROVIDER_CREDENTIAL|DATABASE_URL)\s*[:=]\s*["']?[A-Za-z0-9_./+@:-]{12,}/gi,
    canary: () => ["SUPABASE_", "ACCESS_TOKEN", "=", "K".repeat(32)].join(""),
  },
];

const frontendSecretAssignment = {
  id: "FRONTEND_SECRET_ASSIGNMENT",
  pattern: /\b(?:SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD|SECRET_KEY)|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|INTERNAL_(?:API_)?SERVICE_CREDENTIAL(?:_(?:CURRENT|NEXT))?|DESTINATION_FINGERPRINT_HMAC_KEY(?:_(?:CURRENT|NEXT))?|SAFETY_PROVIDER_CREDENTIAL|DATABASE_URL)\s*[:=]/gi,
  canary: () => ["INTERNAL_", "SERVICE_CREDENTIAL", ":"].join(""),
};

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed with status ${result.status}`);
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function detectorMatches(detector, text) {
  detector.pattern.lastIndex = 0;
  return detector.pattern.test(text);
}

function runDetectorSelfTests() {
  for (const detector of [...detectors, frontendSecretAssignment]) {
    assert(
      detectorMatches(detector, detector.canary()),
      `detector self-test failed for ${detector.id}`,
    );
  }

  const safeSamples = [
    "SUPABASE_SECRET_KEY",
    "API_BASE_URL=https://<environment-project-ref>.supabase.co/functions/v1/op4n-api",
    "support@op4n.com",
    "INTERNAL_SERVICE_CREDENTIAL=<runtime-secret-store>",
  ];
  for (const sample of safeSamples) {
    for (const detector of detectors) {
      assert(
        !detectorMatches(detector, sample),
        `negative self-test failed for ${detector.id}`,
      );
    }
  }
  console.log(
    `PASS detector self-tests: ${detectors.length + 1} positive and ${safeSamples.length * detectors.length} negative cases`,
  );
}

function isTextPath(path) {
  const name = path.split("/").at(-1);
  return textExtensions.has(extname(path).toLowerCase()) || extensionlessTextFiles.has(name);
}

function bufferIsText(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function scanText(text, metadata, findings) {
  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      findings.push({
        ruleId: detector.id,
        ...metadata,
        line: lineNumberAt(text, match.index),
      });
    }
  }

  if (frontendPathPattern.test(metadata.path)) {
    frontendSecretAssignment.pattern.lastIndex = 0;
    for (const match of text.matchAll(frontendSecretAssignment.pattern)) {
      findings.push({
        ruleId: frontendSecretAssignment.id,
        ...metadata,
        line: lineNumberAt(text, match.index),
      });
    }
  }
}

function scanBuffer(buffer, metadata, findings) {
  if (buffer.length > maximumTextBytes || !bufferIsText(buffer)) return false;
  scanText(buffer.toString("utf8"), metadata, findings);
  return true;
}

function repositoryCandidatePaths() {
  const output = runGit([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  return output.split("\0").filter(Boolean);
}

function scanRepositoryFiles(findings) {
  let scanned = 0;
  for (const path of repositoryCandidatePaths()) {
    if (!isTextPath(path)) continue;
    const absolutePath = join(repositoryRoot, path);
    const buffer = readFileSync(absolutePath);
    if (scanBuffer(buffer, { scope: "repository", path }, findings)) scanned += 1;
  }
  console.log(`PASS repository scan completed: ${scanned} text files`);
}

function walkTextFiles(root) {
  const paths = [];
  if (!statSafe(root)) return paths;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...walkTextFiles(absolutePath));
    else if (entry.isFile() && isTextPath(absolutePath)) paths.push(absolutePath);
  }
  return paths;
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function scanDistribution(findings) {
  const distributionRoot = join(repositoryRoot, "dist");
  let scanned = 0;
  for (const absolutePath of walkTextFiles(distributionRoot)) {
    const path = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
    const buffer = readFileSync(absolutePath);
    if (scanBuffer(buffer, { scope: "dist", path }, findings)) scanned += 1;
  }
  console.log(`PASS frontend bundle scan completed: ${scanned} text files`);
}

function scanGitHistory(findings) {
  const objectLines = runGit(["rev-list", "--objects", "--all"])
    .split("\n")
    .filter(Boolean);
  const seenBlobs = new Set();
  let scanned = 0;

  for (const objectLine of objectLines) {
    const separator = objectLine.indexOf(" ");
    if (separator < 0) continue;
    const objectId = objectLine.slice(0, separator);
    const path = objectLine.slice(separator + 1);
    if (!path || !isTextPath(path) || seenBlobs.has(objectId)) continue;
    if (runGit(["cat-file", "-t", objectId]).trim() !== "blob") continue;
    const size = Number(runGit(["cat-file", "-s", objectId]).trim());
    if (!Number.isFinite(size) || size > maximumTextBytes) continue;
    const buffer = runGit(["cat-file", "blob", objectId], { encoding: null });
    seenBlobs.add(objectId);
    if (
      scanBuffer(
        buffer,
        { scope: "history", path, objectId: objectId.slice(0, 12) },
        findings,
      )
    ) {
      scanned += 1;
    }
  }
  console.log(`PASS Git history scan completed: ${scanned} unique text blobs`);
}

function checkIgnored(path) {
  const result = runGit(["check-ignore", "-q", "--no-index", "--", path], {
    allowFailure: true,
  });
  return result.status === 0;
}

function runGitignoreSelfTests() {
  const temporaryRoot = mkdtempSync(join(repositoryRoot, ".order7-ignore-test-"));
  try {
    const relativeRoot = relative(repositoryRoot, temporaryRoot).replaceAll("\\", "/");
    const ignored = [
      ".env",
      ".env.production",
      "supabase/functions/.env",
      ".dev.vars",
      ".dev.vars.production",
      "worker.dev.vars",
      "private.pem",
      "client.key",
      "bundle.p12",
      "credentials.production.json",
      "cloud-service-account.json",
    ];
    const reviewable = [
      ".env.example",
      "wrangler.toml",
      "supabase/config.toml",
      "docs/api/r1-openapi.yaml",
    ];

    for (const path of ignored) {
      assert(checkIgnored(`${relativeRoot}/${path}`), `.gitignore should ignore ${path}`);
    }
    for (const path of reviewable) {
      assert(!checkIgnored(`${relativeRoot}/${path}`), `.gitignore should track ${path}`);
    }
    console.log(
      `PASS .gitignore self-tests: ${ignored.length} secret paths ignored and ${reviewable.length} reviewed configs trackable`,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function reportFindings(findings) {
  const unique = new Map();
  for (const finding of findings) {
    const key = [
      finding.ruleId,
      finding.scope,
      finding.path,
      finding.objectId ?? "worktree",
      finding.line,
    ].join("|");
    unique.set(key, finding);
  }

  const safeFindings = [...unique.values()].sort((left, right) =>
    `${left.scope}/${left.path}/${left.line}`.localeCompare(
      `${right.scope}/${right.path}/${right.line}`,
    ),
  );
  for (const finding of safeFindings) {
    const historyLocation = finding.objectId ? ` blob=${finding.objectId}` : "";
    console.error(
      `FAIL rule=${finding.ruleId} scope=${finding.scope} path=${finding.path} line=${finding.line}${historyLocation}`,
    );
  }
  return safeFindings.length;
}

runDetectorSelfTests();
runGitignoreSelfTests();

if (!selfTestOnly) {
  const findings = [];
  scanRepositoryFiles(findings);
  scanDistribution(findings);
  scanGitHistory(findings);
  const findingCount = reportFindings(findings);
  if (findingCount > 0) {
    console.error(
      `BLOCK secret hygiene scan found ${findingCount} location(s); values were not printed`,
    );
    process.exitCode = 1;
  } else {
    console.log("PASS secret hygiene scan found no suspicious credential material");
  }
}
