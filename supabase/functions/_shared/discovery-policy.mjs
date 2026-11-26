// Public-discovery screening (Feature Inventory Order 61). Runs server-side at
// creation. A withheld link still redirects; it is only kept out of Latest
// Links and public search. The result names rule categories, never values,
// so nothing secret reaches logs or storage.

import { DISCOVERY_RULES } from "./discovery-rules.mjs";

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function parameterNames(text) {
  const raw = String(text || "").replace(/^[?#]/, "");
  if (!raw.includes("=")) return [];
  return raw.split("&").map((pair) => {
    const name = pair.split("=")[0];
    try {
      return decodeURIComponent(name.replace(/\+/g, " ")).trim().toLowerCase();
    } catch {
      return name.toLowerCase();
    }
  }).filter(Boolean);
}

function hostMatches(hostname, patterns) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return patterns.some((pattern) => (pattern.startsWith(".") ? host.endsWith(pattern) : host === pattern));
}

function looksLikeSecretToken(segment, rules) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  if (UUID.test(decoded)) return true;
  return decoded.split(/[^A-Za-z0-9_-]+/).some((run) => {
    if (run.length >= rules.hexTokenMinLength && /^[0-9a-f]+$/i.test(run)) return true;
    return run.length >= rules.secretTokenMinLength && /[A-Za-z]/.test(run) && /[0-9]/.test(run);
  });
}

// url: a WHATWG URL already accepted by the destination policy.
// Returns {eligible, version, categories}.
export function evaluateDiscovery(url, rules = DISCOVERY_RULES) {
  const categories = new Set();
  const names = [...parameterNames(url.search), ...parameterNames(url.hash)];
  const sensitive = new Set(rules.sensitiveParameterNames);
  if (names.some((name) => sensitive.has(name) || rules.sensitiveParameterPrefixes.some((prefix) => name.startsWith(prefix)))) {
    categories.add("sensitive_parameter");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const words = new Set(rules.sensitivePathSegments);
  if (segments.some((segment) => words.has(segment.toLowerCase()))) categories.add("sensitive_path");
  if (segments.some((segment) => looksLikeSecretToken(segment, rules))) categories.add("secret_token");
  if (hostMatches(url.hostname, rules.privateShareHosts)) categories.add("private_share_host");
  return Object.freeze({ eligible: categories.size === 0, version: rules.version, categories: [...categories].sort() });
}
