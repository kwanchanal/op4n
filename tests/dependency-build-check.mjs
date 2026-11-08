import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");

if (!existsSync(packagePath) && !existsSync(lockPath)) {
  console.log("PASS dependency/build gate: no manifest or lockfile is present; no dependency step is applicable");
  process.exit(0);
}
if (!existsSync(packagePath) || !existsSync(lockPath)) {
  throw new Error("package.json and package-lock.json must be committed together");
}

const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (install.status !== 0) process.exit(install.status ?? 1);

if (manifest.scripts?.build) {
  const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  console.log("PASS dependency/build gate: locked install and declared build completed");
} else {
  console.log("PASS dependency/build gate: locked install completed; no build script is declared");
}
