export function deterministicSafetyPort(decision) {
  if (!["approved", "blocked", "unavailable"].includes(decision)) {
    throw new TypeError("Unsupported deterministic safety decision.");
  }
  return Object.freeze({
    async decide() {
      return { decision };
    },
  });
}

export function unavailableSafetyPort() {
  return deterministicSafetyPort("unavailable");
}

export function createConfiguredSafetyPort({ environment, mode }) {
  if (environment === "local" && mode === "deterministic-approved") {
    return deterministicSafetyPort("approved");
  }
  return unavailableSafetyPort();
}
