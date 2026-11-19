// Canonical short-link redirect edge for op4n.me (Staging: staging.op4n.me).
//
// GET/HEAD /{code}: one authorized internal lookup, then 302 to the stored
// destination with Cache-Control: no-store. Unknown and unavailable codes get
// small intentional pages; nothing ever falls back to a guessed destination.
// After a GET redirect, one minimal click event is recorded via waitUntil so
// analytics never delays or changes the 302. The destination is never logged.

const CODE_PATTERN = /^\/([A-Za-z0-9]{6,32})$/;
const LOOKUP_TIMEOUT_MS = 2000;
const CLICK_TIMEOUT_MS = 3000;

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "strict-origin-when-cross-origin",
});

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page({ title, heading, body, frontendOrigin }) {
  const home = escapeHtml(frontendOrigin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · Op4n.com</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f9fafb; color: #111827; }
  main { max-width: 32rem; margin: 15vh auto; padding: 0 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
  p { line-height: 1.5; color: #374151; }
  a { color: #111827; font-weight: 600; }
  a:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(body)}</p>
<p><a href="${home}/">Make a short link on Op4n.com</a></p>
<p>Questions? Contact <a href="mailto:support@op4n.com">support@op4n.com</a>.</p>
</main>
</body>
</html>`;
}

const PAGES = Object.freeze({
  notFound: {
    status: 404,
    title: "Link not found",
    heading: "This short link doesn't exist",
    body: "Check the address for typos. Short links are case-sensitive.",
  },
  unavailable: {
    status: 404,
    title: "Link unavailable",
    heading: "This short link is unavailable",
    body: "This link has been disabled and no longer redirects.",
  },
  serviceUnavailable: {
    status: 503,
    title: "Temporarily unavailable",
    heading: "We can't open this link right now",
    body: "The short-link service is temporarily unavailable. Please try again in a moment.",
  },
});

function htmlResponse(kind, method, env, extraHeaders = {}) {
  const definition = PAGES[kind];
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": PAGE_CSP,
    ...extraHeaders,
  });
  const body = method === "HEAD" ? null : page({ ...definition, frontendOrigin: env.FRONTEND_ORIGIN });
  return new Response(body, { status: definition.status, headers });
}

function textResponse(status, text, method, extraHeaders = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extraHeaders });
  return new Response(method === "HEAD" ? null : text, { status, headers });
}

function redirectResponse(location) {
  return new Response(null, { status: 302, headers: new Headers({ ...SECURITY_HEADERS, Location: location }) });
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

async function lookup(code, env, fetchImpl) {
  const response = await fetchImpl(`${env.API_BASE_URL}/api/v1/internal/redirect-lookup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.INTERNAL_SERVICE_CREDENTIAL}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ canonicalCode: code }),
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`lookup status ${response.status}`);
  return response.json();
}

async function recordClick(event, env, fetchImpl) {
  const send = () => fetchImpl(`${env.API_BASE_URL}/api/v1/internal/clicks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.INTERNAL_SERVICE_CREDENTIAL}`,
      "Content-Type": "application/json",
      "Idempotency-Key": event.eventId,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(CLICK_TIMEOUT_MS),
  });
  try {
    const response = await send();
    if (response.status >= 500) await send();
  } catch {
    try {
      // One retry with the same eventId; the API never double counts it.
      await send();
    } catch {
      console.warn(JSON.stringify({ event: "click_record_failed", code: event.canonicalCode }));
    }
  }
}

export async function handleRequest(request, env, ctx, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const url = new URL(request.url);
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    return textResponse(405, "Method not allowed.", "GET", { Allow: "GET, HEAD" });
  }
  if (url.pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: new Headers({ ...SECURITY_HEADERS, Location: `${env.FRONTEND_ORIGIN}/` }),
    });
  }
  if (url.pathname === "/robots.txt") {
    return textResponse(200, "User-agent: *\nDisallow: /\n", method);
  }

  const match = url.pathname.match(CODE_PATTERN);
  if (!match) return htmlResponse("notFound", method, env);
  const code = match[1];

  if (!env.API_BASE_URL || !env.INTERNAL_SERVICE_CREDENTIAL || !env.FRONTEND_ORIGIN) {
    return htmlResponse("serviceUnavailable", method, env, { "Retry-After": "5" });
  }

  let decision;
  try {
    decision = await lookup(code, env, fetchImpl);
  } catch {
    console.warn(JSON.stringify({ event: "redirect_lookup_failed", code }));
    return htmlResponse("serviceUnavailable", method, env, { "Retry-After": "5" });
  }

  if (decision?.decision === "unknown") return htmlResponse("notFound", method, env);
  if (decision?.decision === "disabled") return htmlResponse("unavailable", method, env);
  if (decision?.decision !== "redirect" || decision.canonicalCode !== code ||
      !isHttpUrl(decision.fullDestinationUrl) || decision.destinationVersion !== 1) {
    console.warn(JSON.stringify({ event: "redirect_integrity_failed", code }));
    return htmlResponse("serviceUnavailable", method, env, { "Retry-After": "5" });
  }

  const response = redirectResponse(decision.fullDestinationUrl);
  // SA DECISION: only GET navigations are counted; HEAD probes are not clicks.
  if (method === "GET") {
    ctx.waitUntil(recordClick({
      eventId: crypto.randomUUID(),
      canonicalCode: code,
      destinationVersion: 1,
      occurredAt: now().toISOString(),
    }, env, fetchImpl));
  }
  return response;
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
