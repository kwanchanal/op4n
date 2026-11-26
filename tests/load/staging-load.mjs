// Redirect load and capacity test against Staging only (Feature Inventory
// Order 86). Small by design: it measures latency and correctness without
// burning the free quota (about 1,000 requests, ~1,300 Edge invocations).
//
// Usage: SUPABASE_PROJECT_REF=<ref> node tests/load/staging-load.mjs
import { randomUUID } from "node:crypto";

const REF = process.env.SUPABASE_PROJECT_REF;
if (!/^[a-z0-9]{20}$/.test(REF ?? "")) throw new Error("SUPABASE_PROJECT_REF is required (Staging only)");
const API = `https://${REF}.supabase.co/functions/v1/op4n-api/api/v1`;
const SHORT = "https://staging.op4n.me";
const ORIGIN = "https://staging.op4n.com";

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
};
async function timed(fn) {
  const start = performance.now();
  const response = await fn();
  await response.body?.cancel();
  return { status: response.status, ms: performance.now() - start, location: response.headers.get("location") };
}
async function run(name, total, concurrency, makeRequest) {
  const results = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const index = next++;
      try {
        results.push(await timed(() => makeRequest(index)));
      } catch {
        results.push({ status: 0, ms: null });
      }
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  const times = results.filter((item) => item.ms !== null).map((item) => item.ms);
  const statuses = results.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {});
  const summary = {
    scenario: name, requests: total, concurrency, seconds: Number(seconds.toFixed(1)),
    rps: Number((total / seconds).toFixed(1)), statuses,
    p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)), p99: Math.round(percentile(times, 99)),
  };
  console.log(JSON.stringify(summary));
  return { summary, results };
}

const card = async (code) => (await (await fetch(`${API}/links/${code}`, { headers: { Origin: ORIGIN } })).json());

// 1. A counted test link (appears in Staging Latest Links).
const created = await (await fetch(`${API}/links`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), Origin: ORIGIN },
  body: JSON.stringify({ destinationUrl: "https://example.com/op4n-load-test", title: "Load test" }),
})).json();
const code = created.canonicalCode;
if (!code) throw new Error(`could not create the load-test link: ${JSON.stringify(created)}`);
const before = (await card(code)).aggregateTotalClicks;

// Warm the Edge Function so the first scenario measures steady state, and
// report the cold-start sample separately.
const cold = await timed(() => fetch(`${SHORT}/${code}`, { redirect: "manual" }));
console.log(JSON.stringify({ scenario: "first request (may be cold)", ms: Math.round(cold.ms), status: cold.status }));

const steady = await run("steady redirects", 300, 5, () => fetch(`${SHORT}/${code}`, { redirect: "manual" }));
const hot = await run("hot single link burst", 200, 25, () => fetch(`${SHORT}/${code}`, { redirect: "manual" }));
const randomCodes = await run("random unknown codes", 150, 10, () => fetch(`${SHORT}/${randomUUID().replace(/-/g, "").slice(0, 10)}`, { redirect: "manual" }));
const latest = await run("Latest Links reads", 100, 5, () => fetch(`${API}/links`, { headers: { Origin: ORIGIN } }));
const creates = await run("creation at the rate limit", 8, 1, (index) => fetch(`${API}/links`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), Origin: ORIGIN },
  body: JSON.stringify({ destinationUrl: `https://example.com/op4n-load-create-${index}`, title: "Load create" }),
}));

// Clicks are recorded after the 302 (waitUntil); give them a moment.
await new Promise((resolve) => setTimeout(resolve, 8000));
const after = (await card(code)).aggregateTotalClicks;
const redirected = 1 + [...steady.results, ...hot.results].filter((item) => item.status === 302 && item.location === "https://example.com/op4n-load-test").length;
const wrong = [...steady.results, ...hot.results].filter((item) => item.status === 302 && item.location !== "https://example.com/op4n-load-test").length;
console.log(JSON.stringify({
  correctness: { successfulRedirects: redirected, clicksCounted: after - before, wrongDestinations: wrong,
    unknownCodesRedirected: randomCodes.results.filter((item) => item.status === 302).length },
  limits: { creates201: creates.summary.statuses[201] ?? 0, creates429: creates.summary.statuses[429] ?? 0 },
  code,
}));
if (wrong > 0) process.exitCode = 1;
