(function (global) {
  "use strict";

  // Selects the link-creation adapter from config/runtime-config.js. UI code
  // only talks to window.op4nLinkService and never to a specific adapter.
  const config = global.OP4N_RUNTIME_CONFIG || { adapter: "mock" };

  if (config.adapter === "http") {
    global.op4nLinkService = global.op4nHttpLinkService.createHttpLinkAdapter({
      apiBaseUrl: config.apiBaseUrl,
    });
  } else if (config.adapter === "mock") {
    global.op4nLinkService = global.op4nMockLinkService;
  } else {
    throw new Error("Unsupported link service adapter in runtime configuration");
  }
})(globalThis);
