// Maps a request path to one approved operation. Paths are matched by suffix
// because Supabase serves the function under /functions/v1/op4n-api.
const ROUTES = Object.freeze([
  ["/api/v1/internal/redirect-lookup", "resolveCanonicalRedirect"],
  ["/api/v1/internal/clicks", "recordRedirectClick"],
  ["/api/v1/links", "createGuestCanonicalLink"],
]);

export function routeOperation(pathname) {
  const path = String(pathname || "");
  for (const [suffix, operation] of ROUTES) {
    if (path.endsWith(suffix)) return operation;
  }
  return null;
}
