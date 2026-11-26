// Founder notification Worker (Feature Inventory: "Notify the founder of new
// reports and safety blocks"). Every 5 minutes it claims due outbox rows from
// op4n-api, sends one plain-text digest through Cloudflare Email (send_email
// binding, verified destination only), and completes the batch as sent or
// failed. The digest contains short codes, reason categories, counts, and
// times only: never a destination, report free text, or reporter data.

import { createLogger } from "../../../supabase/functions/_shared/log.mjs";

const MAX_LINES = 50;

function utc(iso) {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function renderDigest({ entries, events, environment, shortHost, adminUrl }) {
  const label = environment === "production" ? "Op4n" : `Op4n ${environment[0].toUpperCase()}${environment.slice(1)}`;
  const moderation = entries.filter((entry) => entry.kind !== "ops_alert");
  const alerts = entries.filter((entry) => entry.kind === "ops_alert");
  const links = new Set(moderation.map((entry) => entry.canonicalCode)).size;
  const urgent = entries.some((entry) => entry.priority === "S1");
  const moderationEvents = moderation.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  const subject = alerts.length
    ? `[${label}] ${urgent ? "S1 " : ""}${alerts.length} operational alert${alerts.length === 1 ? "" : "s"}${moderationEvents ? ` and ${moderationEvents} moderation event${moderationEvents === 1 ? "" : "s"}` : ""}`
    : `[${label}] ${urgent ? "S1 " : ""}${events} new moderation event${events === 1 ? "" : "s"} on ${links} link${links === 1 ? "" : "s"}`;
  const lines = entries.slice(0, MAX_LINES).map((entry) => {
    if (entry.kind === "ops_alert") {
      const detail = String(entry.alertDetail ?? "").replace(/[\r\n]+/g, " ").slice(0, 200);
      return `${entry.priority}  operational alert (${String(entry.alertCode).replace(/[^a-z0-9_]/g, "")}): ${detail}`;
    }
    const what = entry.kind === "safety_block" ? "automatic safety block" : `${entry.reasonCategory} report`;
    const code = String(entry.canonicalCode).replace(/[^A-Za-z0-9]/g, "");
    return `${entry.priority}  ${shortHost}/${code}  ${what} x${entry.count}  (first ${utc(entry.firstAt)}, last ${utc(entry.lastAt)})`;
  });
  if (entries.length > MAX_LINES) lines.push(`…and ${entries.length - MAX_LINES} more groups. Open Admin for the full queue.`);
  const text = [
    `${label}: founder notification digest`,
    "",
    ...lines,
    "",
    `Review and act in Admin: ${adminUrl}`,
    "Triage targets: S1 within 24 hours, S2 within 72 hours, S3 within 7 days.",
    "",
    "This email never includes destinations, report text, or reporter data.",
  ].join("\n");
  return { subject, text };
}

export function buildMime({ from, to, subject, text, messageId, date }) {
  const safe = (value) => String(value).replace(/[\r\n]+/g, " ");
  return [
    `From: Op4n Notifications <${safe(from)}>`,
    `To: ${safe(to)}`,
    `Subject: ${safe(subject)}`,
    `Message-ID: <${safe(messageId)}@op4n.com>`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text.replace(/\r?\n/g, "\r\n"),
    "",
  ].join("\r\n");
}

async function callInternal(env, fetchImpl, path, body) {
  const response = await fetchImpl(`${env.API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.INTERNAL_SERVICE_CREDENTIAL}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

// Returns a summary for logs and tests. Throws only when the API is unreachable;
// the outbox then keeps the rows for the next run.
export async function runDigest(env, {
  fetchImpl = fetch,
  send,
  now = () => new Date(),
  log = createLogger({ service: "notifier-worker", environment: env?.OP4N_ENVIRONMENT }),
} = {}) {
  const claimed = await callInternal(env, fetchImpl, "/api/v1/internal/notifications/claim", {});
  if (!claimed.batchId) return { outcome: "empty" };

  const { subject, text } = renderDigest({
    entries: claimed.entries,
    events: claimed.events,
    environment: env.OP4N_ENVIRONMENT,
    shortHost: env.SHORT_HOST,
    adminUrl: `${env.FRONTEND_ORIGIN}/admin`,
  });
  const raw = buildMime({ from: env.NOTIFY_FROM, to: env.NOTIFY_TO, subject, text, messageId: claimed.batchId, date: now() });

  let outcome = "sent";
  try {
    await send(env.NOTIFY_FROM, env.NOTIFY_TO, raw);
  } catch (error) {
    outcome = "failed";
    log.error("founder_notification_send_failed", { outcome: "error", requestId: claimed.batchId, reason: String(error?.message || error) });
  }
  const completed = await callInternal(env, fetchImpl, "/api/v1/internal/notifications/complete", { batchId: claimed.batchId, outcome });
  if (completed.exhausted > 0) {
    // Picked up by the monitoring alert (card "Create production dashboards and actionable alerts").
    log.error("founder_notification_exhausted", { outcome: "error", requestId: claimed.batchId, rows: completed.exhausted });
  }
  log.info("founder_notification_digest", { outcome, requestId: claimed.batchId, events: claimed.events, groups: claimed.entries.length });
  return { outcome, events: claimed.events, exhausted: completed.exhausted };
}

export const DAILY_CHECK_CRON = "7 1 * * *";

// Once a day: ask op4n-api to queue quota and stale-S1 alerts (Orders 82,
// 83). A failure is logged and never blocks the digest.
export async function runDailyCheck(env, {
  fetchImpl = fetch,
  log = createLogger({ service: "notifier-worker", environment: env?.OP4N_ENVIRONMENT }),
} = {}) {
  try {
    const summary = await callInternal(env, fetchImpl, "/api/v1/internal/ops/daily-check", {});
    log.info("ops_daily_check", { outcome: "ok", ...summary });
    return summary;
  } catch (error) {
    log.error("ops_daily_check_failed", { outcome: "error", reason: String(error?.message || error) });
    return null;
  }
}

export default {
  async scheduled(event, env, ctx) {
    const { EmailMessage } = await import("cloudflare:email");
    ctx.waitUntil((async () => {
      if (event?.cron === DAILY_CHECK_CRON) await runDailyCheck(env);
      await runDigest(env, {
        send: (from, to, raw) => env.NOTIFY_EMAIL.send(new EmailMessage(from, to, raw)),
      });
    })());
  },
  async fetch() {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  },
};
