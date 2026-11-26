// Non-secret runtime configuration. This committed default keeps local
// development and the prototype smoke test on the deterministic mock adapter.
// The Staging deploy workflow overwrites this one file with the Staging API
// base URL, adapter "http", and the public Auth URL and publishable key used
// by admin.html; no other file changes between environments.
window.OP4N_RUNTIME_CONFIG = Object.freeze({
  environment: "local",
  adapter: "mock",
  apiBaseUrl: "",
  shortLinkHost: "op4n.me",
  authUrl: "",
  publishableKey: "",
});
