(function (global) {
  "use strict";

  // MOCK adapter for Latest Links and exact search. Serves the deterministic
  // fixtures in data/mock-public-links-config.js through the same interface as
  // the http adapter. Not production data.
  const config = global.OP4N_MOCK_PUBLIC_LINKS;
  const params = new URLSearchParams(global.location?.search || "");
  const latestScenario = params.get("latest") || config.defaultLatestScenario;

  const wait = (ms) => new Promise((resolve) => global.setTimeout(resolve, ms));

  function mockError(code, status, retryAfter = null) {
    const error = new Error("Mock public link request failed");
    error.code = code;
    error.status = status;
    error.requestId = "mock-public-0000";
    error.retryAfter = retryAfter;
    return error;
  }

  function toCardModel(card) {
    return Object.freeze({
      id: card.canonicalCode,
      code: card.canonicalCode,
      title: card.displayTitle,
      shortUrl: card.canonicalShortUrl,
      openUrl: card.canonicalOpenUrl,
      destinationSummary: card.safeDestinationSummary.displayValue,
      clickCount: card.aggregateTotalClicks,
      discoveryWithheld: false,
      source: "public",
    });
  }

  global.op4nMockPublicLinkService = Object.freeze({
    isPrototype: true,

    async listLatest() {
      await wait(latestScenario === "slow" ? config.slowDelayMs : config.delayMs);
      if (latestScenario === "error") throw mockError("DEPENDENCY_UNAVAILABLE", 503, 1);
      if (latestScenario === "paused") throw mockError("FEATURE_UNAVAILABLE", 503, 60);
      const cards = latestScenario === "empty" ? [] : config.cards;
      return { links: cards.map(toCardModel), requestId: "mock-public-0000" };
    },

    async lookup(code) {
      await wait(code === "SLOW00001" ? config.slowDelayMs : config.delayMs);
      const failure = config.errorCodes[code];
      if (failure) throw mockError(failure.code, failure.status, failure.retryAfter);
      if (config.unavailableCodes.includes(code)) return { kind: "unavailable" };
      const card = config.cards.find((item) => item.canonicalCode === code);
      return card ? { kind: "card", link: toCardModel(card) } : { kind: "not_found" };
    },
  });
})(globalThis);
