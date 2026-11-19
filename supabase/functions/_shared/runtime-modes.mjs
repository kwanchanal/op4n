const ENVIRONMENTS = new Set(["local", "staging", "production"]);
const DETERMINISTIC_SAFETY_MODES = new Set(["deterministic-approved"]);
const DETERMINISTIC_RATE_LIMIT_MODES = new Set(["deterministic", "deterministic-local"]);

// Resolves which adapter kinds this process may use. Deterministic test
// adapters are allowed only outside Production; any unknown or Production
// deterministic value throws so the function fails closed at startup.
export function resolveRuntimeModes({ environment, safetyMode, rateLimitMode }) {
  if (!ENVIRONMENTS.has(environment)) {
    throw new Error("OP4N_ENVIRONMENT must be local, staging, or production.");
  }
  const production = environment === "production";

  let safety = "unavailable";
  if (safetyMode) {
    if (!DETERMINISTIC_SAFETY_MODES.has(safetyMode)) {
      throw new Error("OP4N_SAFETY_MODE has an unsupported value.");
    }
    if (production) {
      throw new Error("Production must not run a deterministic safety mode.");
    }
    safety = "deterministic";
  }

  let rateLimit = "none";
  if (rateLimitMode) {
    if (!DETERMINISTIC_RATE_LIMIT_MODES.has(rateLimitMode)) {
      throw new Error("OP4N_RATE_LIMIT_MODE has an unsupported value.");
    }
    if (production) {
      throw new Error("Production must not run a deterministic rate-limit mode.");
    }
    if (rateLimitMode === "deterministic-local" && environment !== "local") {
      throw new Error("deterministic-local rate limiting is only valid in local.");
    }
    rateLimit = "deterministic";
  }

  return Object.freeze({ environment, safety, rateLimit });
}
