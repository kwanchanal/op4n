import { adminSessionHandler, createAdminGate, createJwksKeyStore } from "../_shared/admin-auth.mjs";
import { createAdminHandlers } from "../_shared/admin-handlers.mjs";
import { createCanonicalCodeGenerator } from "../_shared/canonical-code.mjs";
import {
  createLinkHandler,
  deterministicLocalRateLimitGate,
} from "../_shared/create-link-handler.mjs";
import { createDestinationPolicy } from "../_shared/destination-policy.mjs";
import { createFeatureFlagReader } from "../_shared/feature-flags.mjs";
import { createPostgresRateLimitGate, resolveRateLimits } from "../_shared/rate-limit.mjs";
import {
  createClickHandler,
  createHealthHandlers,
  createOpsDailyCheckHandler,
  createNotificationClaimHandler,
  createNotificationCompleteHandler,
  createRedirectLookupHandler,
} from "../_shared/internal-handlers.mjs";
import { createPublicReadHandlers } from "../_shared/public-read-handlers.mjs";
import { createReportHandler } from "../_shared/report-handler.mjs";
import { hmacSha256Hex } from "../_shared/crypto-values.mjs";
import { createLogger } from "../_shared/log.mjs";
import { TIMEOUTS } from "../_shared/timeouts.mjs";
import { routeOperation } from "../_shared/router.mjs";
import { createPostgrestPersistence } from "../_shared/postgrest-persistence.mjs";
import { resolveRuntimeModes } from "../_shared/runtime-modes.mjs";
import { createConfiguredSafetyPort } from "../_shared/safety-port.mjs";

const environment = Deno.env.get("OP4N_ENVIRONMENT") || "local";
// Throws at startup for an unknown environment or a deterministic adapter in
// Production, so the function cannot serve requests in an unsafe mode.
const runtimeModes = resolveRuntimeModes({
  environment,
  safetyMode: Deno.env.get("OP4N_SAFETY_MODE"),
  rateLimitMode: Deno.env.get("OP4N_RATE_LIMIT_MODE"),
});
const localMode = environment === "local";
const logger = createLogger({ service: "op4n-api", environment });
const hmacMaterial = Deno.env.get("DESTINATION_FINGERPRINT_HMAC_KEY_CURRENT");
const supabaseUrl = Deno.env.get("SUPABASE_URL") ||
  (localMode
    ? Deno.env.get("OP4N_LOCAL_SUPABASE_URL") || Deno.env.get("API_URL")
    : undefined);
// Hosted Supabase reserves the SUPABASE_ prefix for function secrets, so the
// deploy workflow stores the backend secret key as OP4N_SUPABASE_SECRET_KEY.
const supabaseSecretKey = Deno.env.get("OP4N_SUPABASE_SECRET_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") ||
  (localMode
    ? Deno.env.get("OP4N_LOCAL_SUPABASE_SECRET_KEY") || Deno.env.get("SECRET_KEY")
    : undefined);
const configuredSafetyPort = createConfiguredSafetyPort({
  safetyKind: runtimeModes.safety,
});
const defaultCodeGenerator = createCanonicalCodeGenerator({
  reservedCodes: (Deno.env.get("OP4N_RESERVED_CODES") || "").split(",").filter(Boolean),
});
const localCodeSequence = localMode
  ? (Deno.env.get("OP4N_TEST_CODE_SEQUENCE") || "").split(",").filter(Boolean)
  : [];
const localSafetyDelayMs = localMode
  ? Number(Deno.env.get("OP4N_TEST_SAFETY_DELAY_MS") || 0)
  : 0;

const persistence = createPostgrestPersistence({
  supabaseUrl,
  secretKey: supabaseSecretKey,
});
const internalCredential = Deno.env.get("INTERNAL_SERVICE_CREDENTIAL");
const hmacBytes = new TextEncoder().encode(hmacMaterial || "");

// The Postgres limiter derives its daily identity key from the destination
// HMAC key with domain separation ("op4n-rate-limit:<date>"); see rate-limit.mjs.
function selectRateLimitGate() {
  if (runtimeModes.rateLimit === "real") {
    return createPostgresRateLimitGate({
      environment,
      persistence,
      masterKey: hmacBytes,
      limits: resolveRateLimits(Deno.env.get("OP4N_RATE_LIMITS")),
    });
  }
  return runtimeModes.rateLimit === "deterministic" ? deterministicLocalRateLimitGate() : null;
}

const allowedOrigins = localMode
  ? ["http://127.0.0.1:5500"]
  : environment === "production"
    ? ["https://op4n.com"]
    : ["https://staging.op4n.com", "http://127.0.0.1:5500"];
const rateLimitGate = selectRateLimitGate();
const featureFlags = createFeatureFlagReader({ persistence });

const canonicalBaseUrl = environment === "production" ? "https://op4n.me" : "https://staging.op4n.me";
const publicRead = createPublicReadHandlers({
  canonicalBaseUrl,
  allowedOrigins,
  persistence,
  rateLimitGate,
  featureFlags,
});

const createHandler = createLinkHandler({
  environment,
  canonicalBaseUrl,
  allowedOrigins,
  destinationPolicy: createDestinationPolicy({
    shortLinkHosts: ["op4n.me", "staging.op4n.me"],
  }),
  safetyPort: {
    async decide(input) {
      if (localSafetyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, localSafetyDelayMs));
      }
      return configuredSafetyPort.decide(input);
    },
  },
  rateLimitGate,
  featureFlags,
  persistence,
  generateCanonicalCode: () => localCodeSequence.shift() || defaultCodeGenerator(),
  destinationHmacKey: hmacBytes,
  fingerprintKeyVersion: Deno.env.get("DESTINATION_FINGERPRINT_HMAC_VERSION_CURRENT") || "",
});

// Admin: Supabase Auth user JWT (ES256, verified against this project's JWKS),
// founder subject allowlist, aal2. Missing configuration fails closed (503).
const adminRoute = createAdminGate({
  issuer: Deno.env.get("FOUNDER_AUTH_ISSUER"),
  audience: Deno.env.get("FOUNDER_AUTH_AUDIENCE"),
  subjectAllowlist: Deno.env.get("FOUNDER_SUBJECT_ALLOWLIST"),
  keyStore: supabaseUrl
    ? createJwksKeyStore({
      loadJwks: async () => {
        const response = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
          signal: AbortSignal.timeout(TIMEOUTS.JWKS_MS),
        });
        if (!response.ok) throw new Error(`JWKS returned ${response.status}`);
        return response.json();
      },
    })
    : null,
  allowedOrigins,
  log: ({ event, requestId, status, ...fields }) => logger[status >= 500 ? "error" : status >= 400 ? "warn" : "info"](event, {
    ...fields,
    requestId,
    status,
    outcome: status < 400 ? "ok" : "denied",
  }),
});

const admin = createAdminHandlers({
  persistence,
  destinationPolicy: createDestinationPolicy({ shortLinkHosts: ["op4n.me", "staging.op4n.me"] }),
  destinationHmacKey: hmacBytes,
  shortHosts: environment === "production" ? ["op4n.me"] : ["staging.op4n.me"],
  environment,
});

const health = createHealthHandlers({
  credential: internalCredential,
  persistence,
  environment,
  releaseSha: Deno.env.get("OP4N_RELEASE_SHA") || "",
  configVersion: Deno.env.get("OP4N_CONFIG_VERSION") || "",
  // Required configuration for the environment's real adapters.
  environmentReady: Boolean(hmacMaterial && internalCredential && supabaseSecretKey) &&
    (environment !== "production" || (runtimeModes.safety === "real" && runtimeModes.rateLimit === "real")),
  frontendOrigin: environment === "production" ? "https://op4n.com" : "https://staging.op4n.com",
  destinationHmacKey: hmacBytes,
  hmac: hmacSha256Hex,
});

const handlers = {
  getEnvironmentLiveness: health.live,
  getEnvironmentReadiness: health.ready,
  ensureSyntheticLink: health.ensureSynthetic,
  runOpsDailyCheck: createOpsDailyCheckHandler({ credential: internalCredential, persistence, environment }),
  createGuestCanonicalLink: createHandler,
  resolveCanonicalRedirect: createRedirectLookupHandler({ credential: internalCredential, persistence }),
  recordRedirectClick: createClickHandler({ credential: internalCredential, persistence }),
  claimFounderNotifications: createNotificationClaimHandler({ credential: internalCredential, persistence, environment }),
  completeFounderNotifications: createNotificationCompleteHandler({ credential: internalCredential, persistence }),
  getAdminSession: adminRoute("getAdminSession", adminSessionHandler({ environment })),
  findAdminLink: adminRoute("findAdminLink", admin.findLink, { methods: ["POST"] }),
  getAdminLinkRecord: adminRoute("getAdminLinkRecord", admin.getRecord),
  revealAdminDestination: adminRoute("revealAdminDestination", admin.revealDestination, { methods: ["POST"] }),
  listAdminCases: adminRoute("listAdminCases", admin.listCases),
  transitionAdminCase: adminRoute("transitionAdminCase", admin.transitionCase, { methods: ["POST"] }),
  disableCanonicalLink: adminRoute("disableCanonicalLink", admin.moderate("disable"), { methods: ["POST"], requireRecentAuth: true }),
  setAdminDiscovery: adminRoute("setAdminDiscovery", admin.setDiscovery, { methods: ["POST"], requireRecentAuth: true }),
  listLatestPublicLinks: publicRead.listLatest,
  getPublicLinkCard: publicRead.getCard,
  exactLookupPublicLink: publicRead.exactLookup,
  restoreCanonicalLink: adminRoute("restoreCanonicalLink", admin.moderate("restore"), { methods: ["POST"], requireRecentAuth: true }),
  submitPublicLinkReport: createReportHandler({
    environment,
    allowedOrigins,
    persistence,
    rateLimitGate,
    featureFlags,
  }),
};

Deno.serve(async (request) => {
  // Unknown paths fall through to the create handler, which answers 405.
  const operation = routeOperation(new URL(request.url).pathname, request.method) || "createGuestCanonicalLink";
  try {
    const response = await handlers[operation](request);
    const status = response.status;
    logger[status >= 500 ? "error" : status >= 400 ? "warn" : "info"]("api_request", {
      requestId: response.headers.get("X-Request-ID"),
      outcome: status >= 500 ? "error" : status >= 400 ? "rejected" : "ok",
      status,
      operation,
    });
    return response;
  } catch {
    const requestId = crypto.randomUUID();
    logger.error("api_unhandled_error", { requestId, outcome: "error", status: 500, operation });
    return new Response(JSON.stringify({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId,
      },
    }), {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "Vary": "Origin",
        "X-Request-ID": requestId,
      },
    });
  }
});
