// Confirms the hosted Staging Supabase project is the expected, active, and
// healthy target before the deploy workflow mutates anything. Prints only
// bounded check names and states; never a project reference or credential.

const MANAGEMENT_API = "https://api.supabase.com/v1";
const EXPECTED_REGION = "ap-southeast-1";
const REQUIRED_SERVICES = ["db", "rest"];

export function assessProject(project, health) {
  const reasons = [];
  if (project?.status !== "ACTIVE_HEALTHY") reasons.push("project is not ACTIVE_HEALTHY");
  if (project?.region !== EXPECTED_REGION) reasons.push("project region is not Singapore");
  if (!/staging/i.test(String(project?.name ?? ""))) {
    reasons.push("project name does not identify Staging");
  }
  if (/prod/i.test(String(project?.name ?? ""))) {
    reasons.push("project name looks like Production");
  }
  const services = new Map((Array.isArray(health) ? health : []).map((item) => [item?.name, item]));
  for (const name of REQUIRED_SERVICES) {
    if (services.get(name)?.healthy !== true) reasons.push(`${name} service is not healthy`);
  }
  return { ready: reasons.length === 0, reasons };
}

async function getJson(path, token) {
  const response = await fetch(`${MANAGEMENT_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Management API request failed with status ${response.status}`);
  return response.json();
}

function selfTest() {
  const project = { status: "ACTIVE_HEALTHY", region: EXPECTED_REGION, name: "op4n-staging" };
  const health = [{ name: "db", healthy: true }, { name: "rest", healthy: true }];
  const cases = [
    [project, health, true],
    [{ ...project, status: "INACTIVE" }, health, false],
    [{ ...project, status: "COMING_UP" }, health, false],
    [{ ...project, region: "us-east-1" }, health, false],
    [{ ...project, name: "op4n-production" }, health, false],
    [{ ...project, name: "op4n" }, health, false],
    [project, [{ name: "db", healthy: false }, { name: "rest", healthy: true }], false],
    [project, [], false],
    [null, null, false],
  ];
  cases.forEach(([input, services, expected], index) => {
    if (assessProject(input, services).ready !== expected) {
      throw new Error(`staging preflight self-test ${index + 1} failed`);
    }
  });
  console.log(`PASS staging preflight self-tests: ${cases.length} cases`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !/^[a-z0-9]{20}$/.test(ref ?? "")) {
    throw new Error("SUPABASE_ACCESS_TOKEN and a 20-character SUPABASE_PROJECT_REF are required");
  }
  const project = await getJson(`/projects/${ref}`, token);
  const health = await getJson(
    `/projects/${ref}/health?${REQUIRED_SERVICES.map((name) => `services=${name}`).join("&")}`,
    token,
  );
  const result = assessProject(project, health);
  if (!result.ready) {
    result.reasons.forEach((reason) => console.error(`BLOCKED ${reason}`));
    console.error("Staging preflight failed; nothing was changed.");
    process.exit(1);
  }
  console.log("PASS Staging preflight: project active, healthy, Singapore, Staging-named");
}
