import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const outputPath = process.argv[2] || "/tmp/op4n-local-edge.env";
const result = spawnSync(
  "npx",
  ["--yes", "supabase@3.0.0", "status", "--output-format", "json"],
  { cwd: new URL("../..", import.meta.url), encoding: "utf8" },
);
if (result.status !== 0) throw new Error("local Supabase status failed");

const status = JSON.parse(result.stdout);
const customEnvironment = await readFile(
  new URL("../../supabase/functions/.env", import.meta.url),
  "utf8",
);
const runtimeEnvironment = [
  customEnvironment.trimEnd(),
  `OP4N_LOCAL_SUPABASE_URL=${status.env.API_URL}`,
  `OP4N_LOCAL_SUPABASE_SECRET_KEY=${status.env.SECRET_KEY}`,
  "",
].join("\n");

await writeFile(outputPath, runtimeEnvironment, { mode: 0o600 });
console.log(`prepared local Edge environment at ${outputPath} (values redacted)`);
