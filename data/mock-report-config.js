// Deterministic report responses for Prototype Cleanup only.
// A success state is simulated locally and is never delivered to an Admin or server.
window.OP4N_MOCK_REPORT_CONFIG = Object.freeze({
  delayMs: 220,
  defaultScenario: "success",
  scenarios: Object.freeze({
    success: Object.freeze({ type: "success" }),
    // Error scenarios emit the same codes as the R1 API.
    validation: Object.freeze({ type: "error", code: "VALIDATION_ERROR", status: 400 }),
    network: Object.freeze({ type: "error", code: "NETWORK_ERROR", status: 0 }),
    server: Object.freeze({ type: "error", code: "INTERNAL_ERROR", status: 500 }),
    "rate-limit": Object.freeze({ type: "error", code: "RATE_LIMITED", status: 429, retryAfter: 1200 }),
    unavailable: Object.freeze({ type: "error", code: "LINK_NOT_FOUND", status: 404 })
  })
});
