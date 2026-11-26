// Serves the repository root for Playwright in mock mode (no network, no API).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const port = Number(process.env.E2E_PORT || 4173);
const types = new Map([[".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"], [".svg", "image/svg+xml"], [".png", "image/png"], [".txt", "text/plain"], [".xml", "application/xml"]]);

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  let requested = pathname === "/" ? "/index.html" : pathname;
  if (!extname(requested) && existsSync(join(root, `${requested}.html`))) requested = `${requested}.html`;
  const path = normalize(join(root, requested));
  if (!path.startsWith(`${root}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types.get(extname(path)) || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(path).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`e2e static server on ${port}`));
