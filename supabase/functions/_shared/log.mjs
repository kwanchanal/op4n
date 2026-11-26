// Structured application and security logging (Feature Inventory Order 80).
//
// One JSON line per event: {ts, env, service, event, outcome, severity,
// requestId, ...fields}. Shared by the Edge Function and both Workers.
// Redaction is applied to every field:
//   * keys that can carry secrets (destination, URL, token, cookie,
//     authorization, idempotency key, password, email, IP) are replaced;
//   * any string that parses as a URL keeps only its origin;
//   * control characters are escaped, so one event is always one line.
// Logging never throws: a failure to serialize or write is swallowed.

const SEVERITIES = new Set(["debug", "info", "warn", "error"]);
const SENSITIVE_KEY = /destination|url|token|secret|cookie|authorization|idempotency|password|email|address|credential|apikey|api_key|subject|^sub$|^(client_?|remote_?)?ip$/i;
const MAX_STRING = 200;
const MAX_FIELDS = 24;

export function redactUrlText(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "[redacted-url]";
    // Paths can carry secrets too (/reset/TOKEN), so only the origin remains.
    return `${url.origin}${url.pathname !== "/" || url.search || url.hash ? "/[redacted]" : ""}`;
  } catch {
    return value;
  }
}

function cleanString(value) {
  let text = String(value);
  // Any URL anywhere in the text keeps only its origin.
  text = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => redactUrlText(match));
  // Escape every control character (newline, CR, tab, ANSI, NUL ...).
  text = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
}

function cleanValue(key, value, depth = 0) {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return depth > 1 ? "[array]" : value.slice(0, 10).map((item) => cleanValue("", item, depth + 1));
  if (typeof value === "object") {
    if (depth > 1) return "[object]";
    return Object.fromEntries(Object.entries(value).slice(0, MAX_FIELDS).map(([k, v]) => [cleanString(k), cleanValue(k, v, depth + 1)]));
  }
  return "[unsupported]";
}

export function buildLogEntry({ service, environment, now = () => new Date() }, event, details = {}) {
  const { outcome = "ok", severity = "info", requestId = null, ...fields } = details;
  const entry = {
    ts: now().toISOString(),
    env: cleanString(environment || "unknown"),
    service: cleanString(service),
    event: cleanString(event),
    outcome: cleanString(outcome),
    severity: SEVERITIES.has(severity) ? severity : "info",
    requestId: requestId === null ? null : cleanString(requestId),
  };
  for (const [key, value] of Object.entries(fields).slice(0, MAX_FIELDS)) {
    if (key in entry) continue;
    entry[cleanString(key)] = cleanValue(key, value);
  }
  return entry;
}

export function createLogger({ service, environment, sink = console, now }) {
  const write = (event, details) => {
    try {
      const entry = buildLogEntry({ service, environment, now }, event, details);
      const line = JSON.stringify(entry);
      const method = entry.severity === "error" ? "error" : entry.severity === "warn" ? "warn" : "info";
      (sink[method] || sink.log).call(sink, line);
    } catch {
      // Logging must never break a request.
    }
  };
  return Object.freeze({
    info: (event, details = {}) => write(event, { severity: "info", ...details }),
    warn: (event, details = {}) => write(event, { severity: "warn", ...details }),
    error: (event, details = {}) => write(event, { severity: "error", ...details }),
  });
}
