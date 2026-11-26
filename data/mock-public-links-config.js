// Deterministic MOCK fixtures for Latest Links and exact search. Shaped like
// the R1 PublicLinkCard contract (r1-safe-path-v1 summaries). They are not
// production data and never represent real activity.
//
// Scenarios (mock adapter only):
//   latest.html?latest=success|empty|error|paused|slow
//   Exact search codes: any fixture code -> card; OFFLINE01 -> unavailable;
//   ERROR0001 -> service error; LIMIT0001 -> 429; SLOW00001 -> delayed card;
//   anything else -> no result.
window.OP4N_MOCK_PUBLIC_LINKS = Object.freeze({
  delayMs: 160,
  slowDelayMs: 1200,
  defaultLatestScenario: "success",
  cards: Object.freeze([
    Object.freeze({
      canonicalCode: "PL2TSH5",
      displayTitle: "Portfolio",
      canonicalShortUrl: "https://op4n.me/PL2TSH5",
      canonicalOpenUrl: "https://kwanchanal.github.io/hello/",
      safeDestinationSummary: Object.freeze({ origin: "https://kwanchanal.github.io", path: "/hello", displayValue: "https://kwanchanal.github.io/hello" }),
      aggregateTotalClicks: 12,
    }),
    Object.freeze({
      canonicalCode: "SHOES01",
      displayTitle: "Running shoes sale",
      canonicalShortUrl: "https://op4n.me/SHOES01",
      canonicalOpenUrl: "https://example.com/",
      safeDestinationSummary: Object.freeze({ origin: "https://example.com", path: "/products/running-shoes", displayValue: "https://example.com/products/running-shoes?…" }),
      aggregateTotalClicks: 1,
    }),
    Object.freeze({
      canonicalCode: "DOCS0001",
      displayTitle: "Install guide",
      canonicalShortUrl: "https://op4n.me/DOCS0001",
      canonicalOpenUrl: "https://example.com/",
      safeDestinationSummary: Object.freeze({ origin: "https://docs.example.com", path: "/guide/v2/install/…", displayValue: "https://docs.example.com/guide/v2/install/…" }),
      aggregateTotalClicks: 0,
    }),
    Object.freeze({
      canonicalCode: "SLOW00001",
      displayTitle: "Slow lookup fixture",
      canonicalShortUrl: "https://op4n.me/SLOW00001",
      canonicalOpenUrl: "https://example.com/",
      safeDestinationSummary: Object.freeze({ origin: "https://example.com", displayValue: "https://example.com" }),
      aggregateTotalClicks: 3,
    }),
  ]),
  unavailableCodes: Object.freeze(["OFFLINE01"]),
  errorCodes: Object.freeze({ ERROR0001: Object.freeze({ code: "DEPENDENCY_UNAVAILABLE", status: 503, retryAfter: 1 }), LIMIT0001: Object.freeze({ code: "RATE_LIMITED", status: 429, retryAfter: 90 }) }),
});
