(function () {
  "use strict";

  const STORAGE_KEY = "op4n.prototype.r1";
  const SCHEMA_VERSION = 1;
  const EXAMPLE_IDS = new Set(["default-portfolio", "default-art-collection", "example-portfolio"]);

  // Retired Profile/builder keys from the pre-Cleanup prototype. These exact
  // keys are removed after the one-time link migration; unrelated storage is
  // never cleared.
  const RETIRED_NAMES = Object.freeze([
    "profile", "social_links", "link_enabled_overrides", "link_filter",
    "appearance", "visibility", "inbox_position", "banner_position",
    "inbox_name", "inbox_layout", "inbox_fields", "banner_items",
    "banner_enabled"
  ]);

  function safeParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeLegacyLink(link) {
    if (!link || typeof link !== "object" || EXAMPLE_IDS.has(String(link.id || ""))) return null;
    const destinationValue = String(link.destinationUrl || link.url || "").trim();
    let destinationUrl;
    try {
      const parsedUrl = new URL(destinationValue);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) return null;
      destinationUrl = parsedUrl.href;
    } catch {
      return null;
    }

    const code = String(link.code || link.shortCode || "").trim();
    if (!code || !/^[A-Za-z0-9-]+$/.test(code)) return null;
    return {
      id: String(link.id || `legacy-${code}`),
      title: String(link.title || ""),
      destinationUrl,
      code,
      shortUrl: `https://op4n.me/${code}`,
      clickCount: Math.max(0, Math.trunc(Number(link.clickCount) || 0)),
      source: "preserved-legacy-prototype"
    };
  }

  function readLegacyLinks() {
    const candidates = ["openme_links", "wemint_links"];
    for (const key of candidates) {
      const parsed = safeParse(localStorage.getItem(key), null);
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  }

  function readCurrentState() {
    const parsed = safeParse(localStorage.getItem(STORAGE_KEY), null);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.preservedCreatedLinks)) {
      return null;
    }
    return parsed;
  }

  function migrate() {
    try {
      const current = readCurrentState();
      if (current) return current;

      const preservedCreatedLinks = readLegacyLinks()
        .map(normalizeLegacyLink)
        .filter(Boolean);
      const nextState = { schemaVersion: SCHEMA_VERSION, preservedCreatedLinks };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

      ["openme", "wemint"].forEach((prefix) => {
        RETIRED_NAMES.forEach((name) => localStorage.removeItem(`${prefix}_${name}`));
        localStorage.removeItem(`${prefix}_links`);
      });
      return nextState;
    } catch {
      return { schemaVersion: SCHEMA_VERSION, preservedCreatedLinks: [] };
    }
  }

  window.op4nPrototypeStorage = Object.freeze({
    key: STORAGE_KEY,
    schemaVersion: SCHEMA_VERSION,
    migrate
  });
})();
