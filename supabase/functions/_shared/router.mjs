// Maps a request path to one approved operation. Paths are matched by suffix
// because Supabase serves the function under /functions/v1/op4n-api.
const ROUTES = Object.freeze([
  ["/api/v1/internal/redirect-lookup", "resolveCanonicalRedirect"],
  ["/api/v1/internal/clicks", "recordRedirectClick"],
  ["/api/v1/internal/notifications/claim", "claimFounderNotifications"],
  ["/api/v1/internal/notifications/complete", "completeFounderNotifications"],
  ["/api/v1/internal/health/live", "getEnvironmentLiveness"],
  ["/api/v1/internal/health/ready", "getEnvironmentReadiness"],
  ["/api/v1/internal/synthetic/ensure", "ensureSyntheticLink"],
  ["/api/v1/internal/ops/daily-check", "runOpsDailyCheck"],
  ["/api/v1/admin/session", "getAdminSession"],
  ["/api/v1/admin/link-lookup", "findAdminLink"],
  ["/api/v1/admin/cases", "listAdminCases"],
  ["/api/v1/link-lookup", "exactLookupPublicLink"],
  ["/api/v1/links", "createGuestCanonicalLink"],
]);

// GET and HEAD on /api/v1/links list Latest Links; every other method there
// belongs to creation (POST, and its OPTIONS preflight).
export function routeOperation(pathname, method = "POST") {
  const path = String(pathname || "");
  const read = method === "GET" || method === "HEAD";
  if (/\/api\/v1\/links\/[^/]+\/reports$/.test(path)) return "submitPublicLinkReport";
  const adminLink = path.match(/\/api\/v1\/admin\/links\/[^/]+(?:\/(reveal|disable|restore|discovery))?$/);
  if (adminLink) {
    return {
      reveal: "revealAdminDestination",
      disable: "disableCanonicalLink",
      restore: "restoreCanonicalLink",
      discovery: "setAdminDiscovery",
    }[adminLink[1]] || "getAdminLinkRecord";
  }
  if (/\/api\/v1\/links\/[^/]+$/.test(path) && !/\/api\/v1\/admin\//.test(path)) return "getPublicLinkCard";
  if (read && path.endsWith("/api/v1/links")) return "listLatestPublicLinks";
  if (/\/api\/v1\/admin\/cases\/[^/]+\/transition$/.test(path)) return "transitionAdminCase";
  for (const [suffix, operation] of ROUTES) {
    if (path.endsWith(suffix)) return operation;
  }
  return null;
}
