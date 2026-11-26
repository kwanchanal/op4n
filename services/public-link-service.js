(function (global) {
  "use strict";

  // Selects the public discovery adapter from config/runtime-config.js. UI
  // code only talks to window.op4nPublicLinkService.
  const config = global.OP4N_RUNTIME_CONFIG || { adapter: "mock" };

  if (config.adapter === "http") {
    global.op4nPublicLinkService = global.op4nHttpPublicLinkService.createHttpPublicLinkAdapter({
      apiBaseUrl: config.apiBaseUrl,
    });
  } else if (config.adapter === "mock") {
    global.op4nPublicLinkService = global.op4nMockPublicLinkService;
  } else {
    throw new Error("Unsupported public link service adapter in runtime configuration");
  }
})(globalThis);
