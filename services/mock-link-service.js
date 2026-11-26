(function () {
  const config = window.OP4N_MOCK_API_CONFIG;
  let listScenario =
    new URLSearchParams(window.location.search).get("list") ||
    config.defaultListScenario;
  let createScenario =
    new URLSearchParams(window.location.search).get("create") ||
    config.defaultCreateScenario;
  let creationSequence = 0;
  let lastCreateRequest = null;
  const successfulRequests = new Map();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  // Converts a deterministic fixture to the shared card view model used by
  // every adapter. Only the mock may open its fixture destination directly,
  // because mock short URLs do not resolve; the UI never reads destinationUrl.
  function toCardModel(record) {
    let destinationSummary = "";
    let openUrl = "";
    try {
      const parsed = new URL(record.destinationUrl);
      if (["http:", "https:"].includes(parsed.protocol)) {
        destinationSummary = parsed.origin;
        // Mock short URLs do not resolve, so the mock opens the fixture's
        // origin and path. Query strings and fragments are never placed in
        // the page, matching the production rule.
        openUrl = `${parsed.origin}${parsed.pathname}`;
      }
    } catch {
      // Leave the summary empty; the card shows "Destination unavailable".
    }
    return {
      id: record.id,
      code: record.code,
      title: record.title || "",
      shortUrl: record.shortUrl,
      openUrl,
      destinationSummary,
      clickCount: record.clickCount,
      pinned: Boolean(record.pinned),
      discoveryWithheld: Boolean(record.discoveryWithheld),
      source: record.source,
    };
  }

  function getScenario() {
    return config.listScenarios[listScenario] ||
      config.listScenarios[config.defaultListScenario];
  }

  async function listCreatedLinks() {
    await wait(config.listDelayMs);
    const scenario = getScenario();
    if (scenario.type === "error") {
      const error = new Error(scenario.message);
      error.code = "MOCK_LIST_ERROR";
      throw error;
    }
    return {
      links: clone(scenario.records).map(toCardModel),
      meta: {
        prototype: true,
        persisted: false,
        safetyApproved: false
      }
    };
  }

  async function createLink(request) {
    lastCreateRequest = clone(request);
    const scenario = config.creationScenarios[createScenario] ||
      config.creationScenarios[config.defaultCreateScenario];
    await wait(scenario.delayMs || config.creationDelayMs);

    if (successfulRequests.has(request.requestId)) {
      return clone(successfulRequests.get(request.requestId));
    }

    if (scenario.type === "error") {
      const error = new Error("Configured prototype creation error");
      error.code = scenario.code;
      error.status = scenario.status;
      error.requestId = "mock-request-0000";
      error.retryAfter = scenario.retryAfter ?? null;
      error.fields = [];
      throw error;
    }
    if (scenario.type === "malformed") {
      const error = new Error("Malformed prototype response");
      error.code = "MALFORMED_RESPONSE";
      error.status = 201;
      error.requestId = "mock-request-0000";
      error.fields = [];
      throw error;
    }

    creationSequence += 1;
    const shortCode = `DEMO${String(creationSequence).padStart(3, "0")}`;
    // Mock stand-in for the server's discovery screening (r1-discovery-v1):
    // a secret-bearing query parameter withholds the link from discovery.
    const discoveryWithheld = /[?&#](token|code|state|sig|signature|password|pwd|session|key)=/i
      .test(request.destinationUrl);
    const response = {
      link: toCardModel({
        id: request.requestId,
        title: request.title || "",
        destinationUrl: request.destinationUrl,
        code: shortCode,
        shortUrl: `https://op4n.me/${shortCode}`,
        clickCount: scenario.clickCount,
        discoveryWithheld,
        source: "mock-created"
      }),
      meta: {
        prototype: true,
        persisted: false,
        safetyApproved: false,
        requestId: request.requestId
      }
    };
    successfulRequests.set(request.requestId, response);
    return clone(response);
  }

  window.op4nMockLinkService = Object.freeze({
    isPrototype: true,
    createLink,
    listCreatedLinks,
    prototypeControls: Object.freeze({
      setListScenario(name) {
        listScenario = Object.prototype.hasOwnProperty.call(
          config.listScenarios,
          name
        )
          ? name
          : config.defaultListScenario;
      },
      getListScenarios() {
        return Object.keys(config.listScenarios);
      },
      setCreateScenario(name) {
        createScenario = Object.prototype.hasOwnProperty.call(
          config.creationScenarios,
          name
        )
          ? name
          : config.defaultCreateScenario;
      },
      getCreateScenarios() {
        return Object.keys(config.creationScenarios);
      },
      getLastCreateRequest() {
        return lastCreateRequest ? clone(lastCreateRequest) : null;
      }
    })
  });
})();
