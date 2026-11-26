// Maps a request path to one approved operation. Paths are matched by suffix
// because Supabase serves the function under /functions/v1/op4n-api.
const ROUTES = Object.freeze([
  ["/api/v1/internal/redirect-lookup", "resolveCanonicalRedirect"],
  ["/api/v1/internal/clicks", "recordRedirectClick"],
  ["/api/v1/internal/notifications/claim", "claimFounderNotifications"],
  ["/api/v1/internal/notifications/complete", "completeFounderNotifications"],
  ["/api/v1/admin/session", "getAdminSession"],
  ["/api/v1/admin/link-lookup", "findAdminLink"],
  ["/api/v1/admin/cases", "listAdminCases"],
  ["/api/v1/links", "createGuestCanonicalLink"],
]);

export function routeOperation(pathname) {
  const path = String(pathname || "");
  if (/\/api\/v1\/links\/[^/]+\/reports$/.test(path)) return "submitPublicLinkReport";
  const adminLink = path.match(/\/api\/v1\/admin\/links\/[^/]+(?:\/(reveal|disable|restore))?$/);
  if (adminLink) {
    return { reveal: "revealAdminDestination", disable: "disableCanonicalLink", restore: "restoreCanonicalLink" }[adminLink[1]] ||
      "getAdminLinkRecord";
  }
  if (/\/api\/v1\/admin\/cases\/[^/]+\/transition$/.test(path)) return "transitionAdminCase";
  for (const [suffix, operation] of ROUTES) {
    if (path.endsWith(suffix)) return operation;
  }
  return null;
}
