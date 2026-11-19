// Operational kill switches read from public.feature_flags with a 30 s cache.
// If the flags cannot be read and no fresh cached value exists, every flag is
// treated as off (creation and discovery pause). Redirects never consult flags.

export const FEATURE_FLAG_TTL_MS = 30_000;

export function createFeatureFlagReader({ persistence, ttlMs = FEATURE_FLAG_TTL_MS, now = () => Date.now() }) {
  let cached = null;
  let cachedAt = -Infinity;

  return Object.freeze({
    async isEnabled(flagKey) {
      if (cached && now() - cachedAt < ttlMs) return cached[flagKey] === true;
      try {
        const flags = await persistence.getFeatureFlags();
        if (!flags || typeof flags !== "object" || Array.isArray(flags)) throw new Error("invalid flags");
        cached = flags;
        cachedAt = now();
        return flags[flagKey] === true;
      } catch {
        return false;
      }
    },
  });
}
