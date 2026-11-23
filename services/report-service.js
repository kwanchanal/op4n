(function (global) {
  "use strict";

  // Selects the report adapter from config/runtime-config.js, like link-service.js.
  const config = global.OP4N_RUNTIME_CONFIG || { adapter: "mock" };

  if (config.adapter === "http") {
    global.op4nReportService = global.op4nHttpReportService.createHttpReportAdapter({
      apiBaseUrl: config.apiBaseUrl,
    });
  } else if (config.adapter === "mock") {
    global.op4nReportService = global.op4nMockReportService;
  } else {
    throw new Error("Unsupported report service adapter in runtime configuration");
  }
})(globalThis);
