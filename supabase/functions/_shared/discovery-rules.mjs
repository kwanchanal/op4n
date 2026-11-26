// Versioned public-discovery rule configuration (Feature Inventory Order 61).
// Data only: discovery-policy.mjs evaluates it. A new rule set needs a new
// version; links keep the result and version recorded at creation, so changing
// rules never silently re-publishes an old withheld link.

export const DISCOVERY_RULES = Object.freeze({
  version: "r1-discovery-v1",

  // Query or fragment parameter names (case-insensitive) that carry secrets.
  sensitiveParameterNames: Object.freeze([
    "access_token", "api_key", "apikey", "auth", "auth_token", "client_secret", "code", "expires",
    "id_token", "invite", "jwt", "key", "otp", "password", "pwd", "refresh_token", "reset", "secret",
    "session", "sessionid", "sid", "sig", "signature", "state", "ticket", "token",
    "googleaccessid", "x-amz-credential", "x-amz-security-token", "x-amz-signature",
    "x-goog-credential", "x-goog-signature",
  ]),
  // Parameter-name prefixes used by signed URLs.
  sensitiveParameterPrefixes: Object.freeze(["x-amz-", "x-goog-"]),

  // Path segments (case-insensitive) that mark auth, reset, invite, or
  // payment-session flows.
  sensitivePathSegments: Object.freeze([
    "activate", "activation", "authorize", "callback", "confirm", "forgot-password", "invitation",
    "invitations", "invite", "magic", "magic-link", "oauth", "oauth2", "password-reset", "reset",
    "reset-password", "sso", "unsubscribe", "verify", "verification",
  ]),

  // Hosts whose links are usually private shares, signed downloads, meeting
  // invitations, or payment sessions. A leading "." matches any subdomain.
  privateShareHosts: Object.freeze([
    "1drv.ms", "checkout.stripe.com", "dl.dropboxusercontent.com", "docs.google.com",
    "drive.google.com", "dropbox.com", "onedrive.live.com", "we.tl", "wetransfer.com",
    "www.dropbox.com", ".sharepoint.com", ".zoom.us", "zoom.us",
  ]),

  // A path segment run that looks like a random secret: at least this long
  // and mixing letters and digits, or a long hexadecimal or UUID value.
  secretTokenMinLength: 20,
  hexTokenMinLength: 24,
});
