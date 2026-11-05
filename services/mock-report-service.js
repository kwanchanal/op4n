(function () {
  "use strict";

  const config = window.OP4N_MOCK_REPORT_CONFIG;
  let scenarioName =
    new URLSearchParams(window.location.search).get("report") ||
    config.defaultScenario;

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function submitReport(request) {
    await wait(config.delayMs);
    const scenario = config.scenarios[scenarioName] ||
      config.scenarios[config.defaultScenario];

    if (scenario.type === "error") {
      const error = new Error("Configured prototype report error");
      error.code = scenario.code;
      throw error;
    }

    return {
      report: {
        requestId: request.requestId,
        shortUrl: request.shortUrl,
        simulated: true,
        delivered: false
      },
      meta: { prototype: true, persisted: false }
    };
  }

  window.op4nReportService = Object.freeze({
    submitReport,
    prototypeControls: Object.freeze({
      setScenario(name) {
        scenarioName = Object.prototype.hasOwnProperty.call(config.scenarios, name)
          ? name
          : config.defaultScenario;
      },
      getScenarios() {
        return Object.keys(config.scenarios);
      }
    })
  });
})();
