// Exact short-link lookup input (Feature Inventory Order 72).
// Accepts exactly: CODE, HOST/CODE, https://HOST/CODE, where HOST is this
// environment's short host. Codes are case-sensitive and never lowercased.
// Everything else is rejected before any database query. The browser copy
// (services/short-link-lookup.js) must agree on tests/fixtures/lookup-inputs.json.

const CODE = /^[A-Za-z0-9]{6,32}$/;
const MAX_INPUT = 256;

export function normalizeLookupInput(input, shortHost) {
  const text = String(input ?? "").trim();
  if (!text || text.length > MAX_INPUT) return { valid: false };
  if (CODE.test(text)) return { valid: true, code: text };

  let rest = text;
  const scheme = /^https:\/\//i;
  if (scheme.test(rest)) rest = rest.replace(scheme, "");
  else if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) return { valid: false };

  const slash = rest.indexOf("/");
  if (slash < 1) return { valid: false };
  const host = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  // Host must be exactly the short host (case-insensitive), with no user
  // info, port, or trailing dot.
  if (host.toLowerCase() !== shortHost) return { valid: false };
  // Path must be exactly one canonical code: no extra segments, query,
  // fragment, percent-encoding, or trailing slash.
  if (!CODE.test(path)) return { valid: false };
  return { valid: true, code: path };
}
