import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error("Chrome/Chromium was not found; set CHROME_PATH to an installed browser");

const types = new Map([[".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"], [".svg", "image/svg+xml"], [".png", "image/png"]]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const path = normalize(join(root, requested));
  if (!path.startsWith(`${root}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types.get(extname(path)) || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(path).pipe(response);
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const sitePort = server.address().port;

const debugProbe = createServer();
await new Promise((resolveListen) => debugProbe.listen(0, "127.0.0.1", resolveListen));
const debugPort = debugProbe.address().port;
await new Promise((resolveClose) => debugProbe.close(resolveClose));
const profile = mkdtempSync(join(tmpdir(), "op4n-smoke-"));
const browser = spawn(chromePath, [
  "--headless=new",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${sitePort}/index.html`,
], { stdio: ["ignore", "ignore", "pipe"] });
let browserErrors = "";
browser.stderr.on("data", (chunk) => { browserErrors += chunk.toString().slice(-4000); });

async function waitForBrowser() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Chrome DevTools did not become ready: ${browserErrors}`);
}

try {
  await waitForBrowser();
  const smoke = spawn(process.execPath, [join(root, "tests/prototype-smoke.mjs"), String(debugPort), String(sitePort)], { cwd: root, stdio: "inherit" });
  const status = await new Promise((resolveExit) => smoke.on("exit", resolveExit));
  if (status !== 0) process.exitCode = status ?? 1;
} finally {
  browser.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => browser.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3000)),
  ]);
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
