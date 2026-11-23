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
      error.status = scenario.status;
      error.requestId = "mock-report-0000";
      error.retryAfter = scenario.retryAfter ?? null;
      throw error;
    }

    lastReportRequest = JSON.parse(JSON.stringify(request));
    return { receiptId: "00000000-0000-4000-8000-000000000010", requestId: "mock-report-0000" };
  }

  let lastReportRequest = null;

  window.op4nMockReportService = Object.freeze({
    isPrototype: true,
    submitReport,
    prototypeControls: Object.freeze({
      setScenario(name) {
        scenarioName = Object.prototype.hasOwnProperty.call(config.scenarios, name)
          ? name
          : config.defaultScenario;
      },
      getScenarios() {
        return Object.keys(config.scenarios);
      },
      getLastReportRequest() {
        return lastReportRequest ? JSON.parse(JSON.stringify(lastReportRequest)) : null;
      }
    })
  });
})();
