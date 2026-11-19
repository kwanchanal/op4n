import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeModes } from "../../supabase/functions/_shared/runtime-modes.mjs";
import { createConfiguredSafetyPort } from "../../supabase/functions/_shared/safety-port.mjs";

test("Production refuses deterministic safety and rate-limit modes at startup", () => {
  assert.throws(
    () => resolveRuntimeModes({ environment: "production", safetyMode: "deterministic-approved" }),
    /Production must not run a deterministic safety mode/,
  );
  assert.throws(
    () => resolveRuntimeModes({ environment: "production", rateLimitMode: "deterministic" }),
    /Production must not run a deterministic rate-limit mode/,
  );
  assert.throws(
    () => resolveRuntimeModes({ environment: "production", rateLimitMode: "deterministic-local" }),
    /Production must not run a deterministic rate-limit mode/,
  );
});

test("Production without real adapters resolves to fail-closed kinds", () => {
  const modes = resolveRuntimeModes({ environment: "production" });
  assert.equal(modes.safety, "unavailable");
  assert.equal(modes.rateLimit, "none");
});

test("Staging may use deterministic adapters for pre-adapter verification", () => {
  const modes = resolveRuntimeModes({
    environment: "staging",
    safetyMode: "deterministic-approved",
    rateLimitMode: "deterministic",
  });
  assert.equal(modes.safety, "deterministic");
  assert.equal(modes.rateLimit, "deterministic");
});

test("deterministic-local rate limiting stays local-only", () => {
  assert.equal(
    resolveRuntimeModes({ environment: "local", rateLimitMode: "deterministic-local" }).rateLimit,
    "deterministic",
  );
  assert.throws(
    () => resolveRuntimeModes({ environment: "staging", rateLimitMode: "deterministic-local" }),
    /only valid in local/,
  );
});

test("unknown environments and mode values fail closed", () => {
  for (const environment of ["", "prod", "Production", "stage", undefined]) {
    assert.throws(() => resolveRuntimeModes({ environment }), /OP4N_ENVIRONMENT/);
  }
  assert.throws(
    () => resolveRuntimeModes({ environment: "staging", safetyMode: "approve-everything" }),
    /OP4N_SAFETY_MODE/,
  );
  assert.throws(
    () => resolveRuntimeModes({ environment: "staging", rateLimitMode: "off" }),
    /OP4N_RATE_LIMIT_MODE/,
  );
});

test("configured safety port only approves for the deterministic kind", async () => {
  assert.equal(
    (await createConfiguredSafetyPort({ safetyKind: "deterministic" }).decide({})).decision,
    "approved",
  );
  assert.equal(
    (await createConfiguredSafetyPort({ safetyKind: "unavailable" }).decide({})).decision,
    "unavailable",
  );
  assert.equal(
    (await createConfiguredSafetyPort({}).decide({})).decision,
    "unavailable",
  );
});
