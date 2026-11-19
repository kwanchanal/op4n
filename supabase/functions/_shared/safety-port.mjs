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

// `safetyKind` comes from resolveRuntimeModes, which already refuses
// deterministic modes in Production.
export function createConfiguredSafetyPort({ safetyKind }) {
  if (safetyKind === "deterministic") {
    return deterministicSafetyPort("approved");
  }
  return unavailableSafetyPort();
}
