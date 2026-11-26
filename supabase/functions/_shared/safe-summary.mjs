// Public destination summary policy r1-safe-path-v1 (Feature Inventory Order 65).
//
// Shows the origin plus the leading path segments only while each one reads
// like an ordinary word; cuts at the first segment that could be an ID, token,
// or secret-bearing route and marks the cut with "/…". Query strings and
// fragments are never shown and are marked with "?…". A destination withheld
// from public discovery (Order 61) shows the origin only.
//
// Examples:
//   https://shop.com/products/running-shoes?ref=ig -> https://shop.com/products/running-shoes?…
//   https://site.com/reset/AbC9xYz123             -> https://site.com/…
//   https://docs.example.com/guide/v2/install/linux -> https://docs.example.com/guide/v2/install/…

export const SUMMARY_POLICY_VERSION = "r1-safe-path-v1";
export const HIDDEN_PATH_MARKER = "/…";
export const HIDDEN_QUERY_MARKER = "?…";

const MAX_SEGMENTS = 3;
const MAX_SEGMENT_LENGTH = 32;
const MAX_PATH_LENGTH = 64;
const SEGMENT_SHAPE = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/;

// Words whose following segments commonly carry secrets, or which reveal a
// private flow. The word itself is hidden too.
const SENSITIVE_WORDS = new Set([
  "account", "accounts", "activate", "activation", "admin", "api", "auth", "authorize", "billing",
  "callback", "checkout", "confirm", "confirmation", "download", "downloads", "file", "files",
  "forgot-password", "invitation", "invitations", "invite", "invoice", "invoices", "join", "key",
  "keys", "login", "logout", "magic", "magic-link", "me", "oauth", "oauth2", "order", "orders",
  "password", "password-reset", "pay", "payment", "payments", "private", "profile", "receipt",
  "reset", "reset-password", "secret", "secrets", "session", "sessions", "share", "shared", "signin",
  "sign-in", "signup", "sign-up", "sso", "token", "tokens", "unsubscribe", "user", "users", "verify",
  "verification",
]);

function looksLikeIdentifier(run) {
  const digits = (run.match(/[0-9]/g) || []).length;
  const letters = /[A-Za-z]/.test(run);
  if (run.length >= 20) return true;
  if (digits >= 5) return true;
  if (letters && digits > 0 && run.length >= 8) return true;
  if (run.length >= 8 && /^[A-Z]+$/.test(run)) return true;
  const caseChanges = (run.match(/[a-z][A-Z]/g) || []).length;
  return run.length >= 8 && caseChanges >= 2;
}

export function isSafePathSegment(segment) {
  if (!segment || segment.length > MAX_SEGMENT_LENGTH || !SEGMENT_SHAPE.test(segment)) return false;
  if (SENSITIVE_WORDS.has(segment.toLowerCase())) return false;
  return !segment.split(/[-_.]/).some(looksLikeIdentifier);
}

// url: a WHATWG URL already accepted by the destination policy.
export function buildSafeSummary(url, { discoveryWithheld = false } = {}) {
  const origin = url.origin;
  const hasQuery = Boolean(url.search || url.hash);
  const rawSegments = url.pathname.split("/").slice(1);
  if (rawSegments.at(-1) === "") rawSegments.pop();

  let shown = [];
  let cut = false;
  if (discoveryWithheld) {
    cut = rawSegments.length > 0 || hasQuery;
  } else {
    for (const segment of rawSegments) {
      const candidate = [...shown, segment];
      if (shown.length >= MAX_SEGMENTS || !isSafePathSegment(segment) ||
          `/${candidate.join("/")}`.length > MAX_PATH_LENGTH) {
        cut = true;
        break;
      }
      shown = candidate;
    }
  }

  const visiblePath = shown.length ? `/${shown.join("/")}` : "";
  let displayPath = visiblePath;
  if (cut) displayPath = `${visiblePath}${HIDDEN_PATH_MARKER}`;
  else if (hasQuery) displayPath = `${visiblePath}${HIDDEN_QUERY_MARKER}`;

  return Object.freeze({
    origin,
    ...(cut ? { path: `${visiblePath}${HIDDEN_PATH_MARKER}` } : visiblePath ? { path: visiblePath } : {}),
    displayValue: `${origin}${displayPath}`,
    displayPath,
  });
}
