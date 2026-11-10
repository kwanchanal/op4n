export function evaluateCreateReadiness({
  environment,
  safetyAdapterKind,
  rateLimitAdapterKind,
  databaseConfigured,
  destinationHmacConfigured,
}) {
  const production = environment === "production";
  const checks = {
    database: Boolean(databaseConfigured),
    destinationHmac: Boolean(destinationHmacConfigured),
    safety: production ? safetyAdapterKind === "real" : safetyAdapterKind === "deterministic",
    rateLimit: production ? rateLimitAdapterKind === "real" : rateLimitAdapterKind === "deterministic",
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}
