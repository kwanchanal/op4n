(function () {
  const config = window.OP4N_MOCK_API_CONFIG;
  let listScenario =
    new URLSearchParams(window.location.search).get("list") ||
    config.defaultListScenario;
  let createScenario =
    new URLSearchParams(window.location.search).get("create") ||
    config.defaultCreateScenario;
  let creationSequence = 0;
  const successfulRequests = new Map();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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
      links: clone(scenario.records),
      meta: {
        prototype: true,
        persisted: false,
        safetyApproved: false
      }
    };
  }

  async function createLink(request) {
    const scenario = config.creationScenarios[createScenario] ||
      config.creationScenarios[config.defaultCreateScenario];
    await wait(scenario.delayMs || config.creationDelayMs);

    if (successfulRequests.has(request.requestId)) {
      return clone(successfulRequests.get(request.requestId));
    }

    if (scenario.type === "error") {
      const error = new Error("Configured prototype creation error");
      error.code = scenario.code;
      throw error;
    }
    if (scenario.type === "malformed") {
      return { meta: { prototype: true, requestId: request.requestId } };
    }

    creationSequence += 1;
    const shortCode = `DEMO${String(creationSequence).padStart(3, "0")}`;
    const response = {
      link: {
        id: request.requestId,
        title: request.title || "",
        destinationUrl: request.destinationUrl,
        code: shortCode,
        shortUrl: `https://op4n.me/${shortCode}`,
        clickCount: scenario.clickCount,
        publicStatus: "mock-public",
        source: "mock-created"
      },
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

  window.op4nLinkService = Object.freeze({
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
      }
    })
  });
})();
