// Deterministic report responses for Prototype Cleanup only.
// A success state is simulated locally and is never delivered to an Admin or server.
window.OP4N_MOCK_REPORT_CONFIG = Object.freeze({
  delayMs: 220,
  defaultScenario: "success",
  scenarios: Object.freeze({
    success: Object.freeze({ type: "success" }),
    validation: Object.freeze({ type: "error", code: "MOCK_REPORT_VALIDATION" }),
    network: Object.freeze({ type: "error", code: "MOCK_REPORT_NETWORK" }),
    server: Object.freeze({ type: "error", code: "MOCK_REPORT_SERVER" })
  })
});
