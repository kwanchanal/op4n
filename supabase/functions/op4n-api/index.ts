import { createCanonicalCodeGenerator } from "../_shared/canonical-code.mjs";
import {
  createLinkHandler,
  deterministicLocalRateLimitGate,
} from "../_shared/create-link-handler.mjs";
import { createDestinationPolicy } from "../_shared/destination-policy.mjs";
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

const handler = createLinkHandler({
  environment,
  canonicalBaseUrl: environment === "production" ? "https://op4n.me" : "https://staging.op4n.me",
  allowedOrigins: localMode
    ? ["http://127.0.0.1:5500"]
    : environment === "production"
      ? ["https://op4n.com"]
      : ["https://staging.op4n.com", "http://127.0.0.1:5500"],
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
  rateLimitGate: runtimeModes.rateLimit === "deterministic"
    ? deterministicLocalRateLimitGate()
    : null,
  persistence: createPostgrestPersistence({
    supabaseUrl,
    secretKey: supabaseSecretKey,
  }),
  generateCanonicalCode: () => localCodeSequence.shift() || defaultCodeGenerator(),
  destinationHmacKey: new TextEncoder().encode(hmacMaterial || ""),
  fingerprintKeyVersion: Deno.env.get("DESTINATION_FINGERPRINT_HMAC_VERSION_CURRENT") || "",
});

Deno.serve(async (request) => {
  try {
    const response = await handler(request);
    console.info(JSON.stringify({
      requestId: response.headers.get("X-Request-ID"),
      status: response.status,
      operation: "createGuestCanonicalLink",
    }));
    return response;
  } catch {
    const requestId = crypto.randomUUID();
    console.error(JSON.stringify({ requestId, status: 500, operation: "createGuestCanonicalLink" }));
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
