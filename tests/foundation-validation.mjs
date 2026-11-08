import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { parseDocument } from "yaml";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];
const redocly = join(root, "node_modules", ".bin", "redocly");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
});
const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false });

function fail(message) {
  failures.push(message);
}

function repositoryPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function walk(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".ci-artifacts", "dist", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function parseYaml(text, label) {
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length) {
    throw new Error(`${label}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJS({ maxAliasCount: 0 });
}

async function validateMarkdown(paths) {
  let links = 0;
  let diagrams = 0;
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    let fence = null;
    let mermaidStart = -1;
    let mermaidBody = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/\t$/.test(line) || /(?<! ) $/.test(line) || / {3,}$/.test(line)) {
        fail(`${repositoryPath(path)}:${index + 1} has non-Markdown trailing whitespace`);
      }
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})([^`]*)$/);
      if (fenceMatch) {
        if (!fence) {
          fence = fenceMatch[1][0];
          if (fenceMatch[2].trim() === "mermaid") {
            mermaidStart = index + 1;
            mermaidBody = [];
          }
        } else if (line.trim().startsWith(fence.repeat(3))) {
          if (mermaidStart >= 0) {
            const source = mermaidBody.join("\n");
            try {
              await mermaid.parse(source, { suppressErrors: false });
            } catch (error) {
              fail(`${repositoryPath(path)}:${mermaidStart} Mermaid parse failed: ${error.message.split("\n")[0]}`);
            }
            diagrams += 1;
            mermaidStart = -1;
          }
          fence = null;
        }
      } else if (mermaidStart >= 0) {
        mermaidBody.push(line);
      }
    }
    if (fence) fail(`${repositoryPath(path)} has an unclosed code fence`);

    const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of text.matchAll(linkPattern)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#|notion:)/.test(target)) continue;
      const decoded = decodeURIComponent(target.split("#", 1)[0]);
      if (!decoded) continue;
      const resolved = resolve(dirname(path), decoded);
      try {
        statSync(resolved);
      } catch {
        fail(`${repositoryPath(path)} has a missing relative link: ${target}`);
      }
      links += 1;
    }
  }
  console.log(`PASS Markdown policy checks: ${paths.length} files, ${links} relative links`);
  console.log(`PASS Mermaid semantic parsing: ${diagrams} diagrams`);
}

function runRedocly(path, { expectFailure = false } = {}) {
  const result = spawnSync(redocly, ["lint", "--config", "redocly.yaml", path], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (expectFailure) {
    if (result.status === 0) throw new Error(`${repositoryPath(resolve(root, path))} was not rejected by Redocly`);
    return;
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error("OpenAPI semantic validation failed");
  }
}

function validateOpenApi(path) {
  runRedocly(repositoryPath(path));
  const api = parseYaml(readFileSync(path, "utf8"), repositoryPath(path));
  if (!String(api.openapi).startsWith("3.1.")) fail("OpenAPI document is not version 3.1");
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  const operations = [];
  for (const [route, pathItem] of Object.entries(api.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (methods.has(method)) operations.push({ route, method, operation });
    }
  }
  const operationIds = operations.map(({ operation }) => operation.operationId);
  if (operations.length !== 12) fail(`OpenAPI has ${operations.length} operations; expected 12`);
  if (operationIds.some((value) => typeof value !== "string" || !value)) fail("OpenAPI has an operation without operationId");
  if (new Set(operationIds).size !== operationIds.length) fail("OpenAPI operationId values are not unique");
  if (operations.some(({ operation }) => Object.hasOwn(operation.responses ?? {}, "425"))) fail("OpenAPI still declares status 425");
  console.log(`PASS OpenAPI 3.1 semantic validation: ${operations.length} operations, resolved refs/examples/schemas, no status 425`);
}

function validateWorkflow(path, { deploymentReadiness = false } = {}) {
  const text = readFileSync(path, "utf8");
  const workflow = parseYaml(text, repositoryPath(path));
  if (workflow.permissions?.contents !== "read" || Object.keys(workflow.permissions ?? {}).length !== 1) {
    fail(`${repositoryPath(path)} lacks explicit minimum top-level permissions`);
  }
  for (const match of text.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/g)) {
    if (!/^[0-9a-f]{40}$/.test(match[2])) fail(`${repositoryPath(path)} action ${match[1]} is not pinned to a full SHA`);
  }
  if (/\$\{\{\s*secrets\./.test(text)) fail(`${repositoryPath(path)} references a GitHub secret`);
  if (/^\s*environment:\s*/m.test(text)) fail(`${repositoryPath(path)} could create or use an unprotected GitHub Environment`);
  if (deploymentReadiness) {
    if (workflow.concurrency?.["cancel-in-progress"] !== false) fail(`${repositoryPath(path)} readiness concurrency can cancel an in-progress run`);
    if (!text.includes("READINESS_ONLY") || !text.includes("NOT_DEPLOYED")) fail(`${repositoryPath(path)} does not declare the non-deployment state`);
  } else if (workflow.concurrency?.["cancel-in-progress"] !== true) {
    fail(`${repositoryPath(path)} does not cancel superseded CI runs`);
  }
  console.log(`PASS workflow YAML semantic parse and policy checks: ${repositoryPath(path)}`);
}

async function negativeSelfTests() {
  for (const fixture of [
    "tests/fixtures/invalid/openapi.yaml",
    "tests/fixtures/invalid/openapi-example.yaml",
    "tests/fixtures/invalid/openapi-operation.yaml",
  ]) {
    runRedocly(fixture, { expectFailure: true });
  }

  let mermaidRejected = false;
  try {
    await mermaid.parse(readFileSync(join(root, "tests/fixtures/invalid/mermaid.mmd"), "utf8"), { suppressErrors: false });
  } catch {
    mermaidRejected = true;
  }
  if (!mermaidRejected) throw new Error("malformed Mermaid fixture was not rejected");

  let yamlRejected = false;
  try {
    parseYaml(readFileSync(join(root, "tests/fixtures/invalid/workflow.yml"), "utf8"), "invalid workflow fixture");
  } catch {
    yamlRejected = true;
  }
  if (!yamlRejected) throw new Error("malformed workflow YAML fixture was not rejected");
  console.log("PASS semantic negative fixtures: unresolved ref, invalid example, duplicate operationId, malformed Mermaid, malformed YAML");
}

const markdown = walk(root).filter((path) => extname(path) === ".md");
await validateMarkdown(markdown);
validateOpenApi(join(root, "docs/api/r1-openapi.yaml"));
validateWorkflow(join(root, ".github/workflows/ci.yml"));
validateWorkflow(join(root, ".github/workflows/deployment-readiness.yml"), { deploymentReadiness: true });
await negativeSelfTests();

if (failures.length) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
} else {
  console.log("PASS Foundation semantic validation and structural policy checks");
}
dom.window.close();
