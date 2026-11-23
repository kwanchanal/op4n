(function (global) {
  "use strict";

  // Production adapter for POST /api/v1/links/{code}/reports. Returns only the
  // opaque receipt; the API never reveals report or moderation state.

  function reportError(code, status, requestId, retryAfter) {
    const error = new Error("Report request failed");
    error.code = code;
    error.status = status;
    error.requestId = requestId || null;
    error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
    return error;
  }

  function createHttpReportAdapter({ apiBaseUrl, fetchImpl }) {
    const base = String(apiBaseUrl || "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) throw new Error("apiBaseUrl must be an absolute HTTP(S) URL");
    const doFetch = fetchImpl || global.fetch.bind(global);

    return Object.freeze({
      isPrototype: false,
      async submitReport({ requestId, canonicalCode, reasonCategory, detail }) {
        let response;
        try {
          response = await doFetch(`${base}/api/v1/links/${encodeURIComponent(canonicalCode)}/reports`, {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "Idempotency-Key": requestId,
            },
            body: JSON.stringify({ reasonCategory, detail: detail || null }),
          });
        } catch {
          throw reportError("NETWORK_ERROR", 0, null);
        }
        const responseId = response.headers.get("X-Request-ID");
        const body = await response.json().catch(() => null);
        if (response.status !== 202 || body?.accepted !== true || typeof body.receiptId !== "string") {
          const retryHeader = response.headers.get("Retry-After");
          throw reportError(
            typeof body?.error?.code === "string" ? body.error.code : "HTTP_ERROR",
            response.status,
            responseId,
            retryHeader === null ? NaN : Number(retryHeader),
          );
        }
        return { receiptId: body.receiptId, requestId: responseId };
      },
    });
  }

  global.op4nHttpReportService = Object.freeze({ createHttpReportAdapter });
})(globalThis);
