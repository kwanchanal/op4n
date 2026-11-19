// Deterministic prototype responses shaped like the future API contract.
// They do not represent production persistence, safety approval, or activity.
window.OP4N_MOCK_API_CONFIG = Object.freeze({
  listDelayMs: 180,
  creationDelayMs: 240,
  defaultCreateScenario: "success",
  defaultListScenario: "success",
  listScenarios: Object.freeze({
    success: Object.freeze({
      type: "success",
      records: Object.freeze([
        Object.freeze({
          id: "mock-created-portfolio",
          title: "Portfolio",
          destinationUrl: "https://kwanchanal.github.io/hello/",
          code: "PL2TSH5",
          shortUrl: "https://op4n.me/PL2TSH5",
          clickCount: 0,
          publicStatus: "mock-public",
          source: "mock-created",
          pinned: true
        }),
        Object.freeze({
          id: "mock-created-zero",
          title: "Welcome link",
          destinationUrl: "https://example.com/welcome",
          code: "HELLO00",
          shortUrl: "https://op4n.me/HELLO00",
          clickCount: 0,
          publicStatus: "mock-public",
          source: "mock-created"
        }),
        Object.freeze({
          id: "mock-created-one",
          title: "Unicode destination",
          destinationUrl: "https://xn--bcher-kva.example/catalog?language=th",
          code: "ONECLK1",
          shortUrl: "https://op4n.me/ONECLK1",
          clickCount: 1,
          publicStatus: "mock-public",
          source: "mock-created"
        }),
        Object.freeze({
          id: "mock-created-many",
          title: "Long campaign destination",
          destinationUrl: "https://example.com/a/very/long/campaign/path?utm_source=prototype&utm_medium=card&utm_campaign=responsive-link-testing&audience=guest",
          code: "MANY128",
          shortUrl: "https://op4n.me/MANY128",
          clickCount: 128,
          publicStatus: "mock-public",
          source: "mock-created"
        })
      ])
    }),
    empty: Object.freeze({ type: "empty", records: Object.freeze([]) }),
    error: Object.freeze({
      type: "error",
      message: "Prototype Created Links could not be loaded."
    })
  }),
  creationScenarios: Object.freeze({
    success: Object.freeze({ type: "success", clickCount: 0 }),
    // Error scenarios emit the same codes as the R1 API error envelope so the
    // smoke test exercises the production error mapping.
    offline: Object.freeze({ type: "error", code: "NETWORK_ERROR", status: 0 }),
    timeout: Object.freeze({ type: "error", code: "CLIENT_TIMEOUT", status: 0, delayMs: 360 }),
    "rate-limit": Object.freeze({ type: "error", code: "RATE_LIMITED", status: 429, retryAfter: 60 }),
    "blocked-destination": Object.freeze({ type: "error", code: "DESTINATION_BLOCKED", status: 422 }),
    "server-error": Object.freeze({ type: "error", code: "INTERNAL_ERROR", status: 500 }),
    unavailable: Object.freeze({ type: "error", code: "DEPENDENCY_UNAVAILABLE", status: 503, retryAfter: 1 }),
    conflict: Object.freeze({ type: "error", code: "IDEMPOTENCY_CONFLICT", status: 409 }),
    "malformed-response": Object.freeze({ type: "malformed" })
  })
});

