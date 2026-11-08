import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const allowlistPath = "tests/static-site-files.json";
const permittedRootFiles = new Set([
  "CNAME", "app.js", "discover.html", "index.html", "shared-sidebar.js", "styles.css",
]);
const permittedDirectories = [
  "data/", "discover-icon/", "favicon/", "message-icons/", "services/", "showcase/",
];

function git(root, args, { encoding = "utf8" } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}

function canonicalReleaseSha(root, value) {
  const sha = git(root, ["rev-parse", "--verify", `${value}^{commit}`]).trim();
  if (!/^[0-9a-f]{40}$/.test(sha) || value !== sha) {
    throw new Error("releaseSha must be an exact 40-character commit SHA");
  }
  return sha;
}

function treeEntry(root, releaseSha, path) {
  const records = git(root, ["ls-tree", "-z", releaseSha, "--", path]).split("\0").filter(Boolean);
  if (records.length !== 1) throw new Error(`allowlisted path is missing or ambiguous: ${path}`);
  const match = records[0].match(/^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/s);
  if (!match || match[4] !== path) throw new Error(`unexpected Git tree entry: ${path}`);
  return { mode: match[1], type: match[2], objectId: match[3], path: match[4] };
}

function blob(root, objectId) {
  return git(root, ["cat-file", "blob", objectId], { encoding: null });
}

function validateAllowlist(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("static-site allowlist must be a non-empty array");
  if (new Set(paths).size !== paths.length) throw new Error("static-site allowlist contains duplicates");
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) throw new Error("static-site allowlist must be sorted");
  for (const path of paths) {
    if (
      typeof path !== "string" || path.startsWith("/") || path.includes("\\") ||
      path.split("/").includes("..") || path.endsWith(".md") ||
      (!permittedRootFiles.has(path) && !permittedDirectories.some((prefix) => path.startsWith(prefix)))
    ) {
      throw new Error(`unexpected static-site allowlist path: ${path}`);
    }
  }
}

export function buildArtifact({ root, output, releaseSha }) {
  const exactSha = canonicalReleaseSha(root, releaseSha);
  const policyEntry = treeEntry(root, exactSha, allowlistPath);
  if (policyEntry.mode !== "100644" || policyEntry.type !== "blob") {
    throw new Error("static-site allowlist must be a regular non-executable Git blob");
  }
  const allowlist = JSON.parse(blob(root, policyEntry.objectId).toString("utf8"));
  validateAllowlist(allowlist);

  rmSync(output, { recursive: true, force: true });
  mkdirSync(join(output, "site"), { recursive: true });
  const entries = [];
  for (const path of allowlist) {
    const entry = treeEntry(root, exactSha, path);
    if (entry.mode !== "100644" || entry.type !== "blob") {
      throw new Error(`rejecting non-regular or executable artifact path: ${path}`);
    }
    const bytes = blob(root, entry.objectId);
    const destination = join(output, "site", path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { mode: 0o644 });
    entries.push({
      path,
      mode: entry.mode,
      objectId: entry.objectId,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  }

  const artifactDigest = createHash("sha256")
    .update(entries.map(({ path, mode, sha256, bytes }) => `${path}\0${mode}\0${sha256}\0${bytes}\n`).join(""))
    .digest("hex");
  const commitTime = git(root, ["show", "-s", "--format=%cI", exactSha]).trim();
  const manifest = {
    schemaVersion: 1,
    releaseSha: exactSha,
    sourceCommitTimeUtc: new Date(commitTime).toISOString(),
    artifactDigest,
    fileCount: entries.length,
    files: entries,
    deploymentState: "NOT_DEPLOYED",
  };
  writeFileSync(join(output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

function snapshot(directory) {
  const records = [];
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const relativePath = relative(directory, path).replaceAll("\\", "/");
      try {
        records.push(`${relativePath}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
      } catch {
        walk(path);
      }
    }
  }
  walk(directory);
  return records.join("\n");
}

function initializeFixture(root) {
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "index.html"), "committed bytes\n");
  writeFileSync(join(root, "styles.css"), "body{}\n");
  writeFileSync(join(root, allowlistPath), '["index.html","styles.css"]\n');
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Artifact Self Test"]);
  git(root, ["config", "user.email", "artifact-self-test@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function selfTest() {
  const temporary = mkdtempSync(join(tmpdir(), "op4n-artifact-test-"));
  try {
    const fixture = join(temporary, "repository");
    mkdirSync(fixture);
    const releaseSha = initializeFixture(fixture);
    const first = join(temporary, "first");
    const second = join(temporary, "second");
    const firstManifest = buildArtifact({ root: fixture, output: first, releaseSha });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(firstManifest.sourceCommitTimeUtc)) {
      throw new Error("sourceCommitTimeUtc is not normalized to UTC Z");
    }
    writeFileSync(join(fixture, "index.html"), "dirty working-tree bytes\n");
    writeFileSync(join(fixture, "unapproved.html"), "must not ship\n");
    const secondManifest = buildArtifact({ root: fixture, output: second, releaseSha });
    if (snapshot(first) !== snapshot(second) || firstManifest.artifactDigest !== secondManifest.artifactDigest) {
      throw new Error("dirty working tree changed artifact bytes for the same commit");
    }
    if (readdirSync(join(second, "site")).includes("unapproved.html")) {
      throw new Error("unapproved file entered the artifact");
    }

    rmSync(join(fixture, "index.html"));
    symlinkSync("styles.css", join(fixture, "index.html"));
    git(fixture, ["add", "index.html"]);
    git(fixture, ["commit", "--quiet", "-m", "symlink fixture"]);
    const symlinkSha = git(fixture, ["rev-parse", "HEAD"]).trim();
    let rejected = false;
    try {
      buildArtifact({ root: fixture, output: join(temporary, "symlink"), releaseSha: symlinkSha });
    } catch (error) {
      rejected = /non-regular/.test(error.message);
    }
    if (!rejected) throw new Error("symlink artifact entry was not rejected");

    git(fixture, ["checkout", `${releaseSha}^0`, "--", "index.html"]);
    mkdirSync(join(fixture, "docs"));
    writeFileSync(join(fixture, "docs/internal.md"), "internal\n");
    writeFileSync(join(fixture, allowlistPath), '["docs/internal.md","index.html","styles.css"]\n');
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "unexpected path fixture"]);
    const unexpectedSha = git(fixture, ["rev-parse", "HEAD"]).trim();
    rejected = false;
    try {
      buildArtifact({ root: fixture, output: join(temporary, "unexpected"), releaseSha: unexpectedSha });
    } catch (error) {
      rejected = /unexpected static-site allowlist path/.test(error.message);
    }
    if (!rejected) throw new Error("unexpected allowlist path was not rejected");
    console.log("PASS release artifact self-test: Git-object bytes are dirty-tree invariant; UTC Z, allowlist, mode, symlink, and unexpected-path rules hold");
  } finally {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const output = resolve(repositoryRoot, process.argv[2] || ".ci-artifacts");
  const requested = process.argv[3] || git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const manifest = buildArtifact({ root: repositoryRoot, output, releaseSha: requested });
  console.log(`PASS immutable release artifact: sha=${manifest.releaseSha} digest=${manifest.artifactDigest} files=${manifest.fileCount} state=NOT_DEPLOYED`);
}
