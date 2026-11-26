(function (global) {
  "use strict";

  // Production adapter for public discovery reads (Orders 63, 72):
  //   GET /api/v1/links             -> Latest Links
  //   GET /api/v1/link-lookup?input -> exact lookup
  // Returns the same card view model as every other adapter. Simple GET
  // requests with no custom headers, so the browser sends no preflight.

  function apiError(code, status, requestId, retryAfter) {
    const error = new Error("Public link request failed");
    error.code = code;
    error.status = status;
    error.requestId = requestId || null;
    error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
    return error;
  }

  function createHttpPublicLinkAdapter({ apiBaseUrl, fetchImpl }) {
    const doFetch = fetchImpl || global.fetch.bind(global);
    const base = `${String(apiBaseUrl).replace(/\/+$/, "")}/api/v1`;
    const toCardModel = global.op4nHttpLinkService.toCardModel;

    async function getJson(url, signal) {
      let response;
      try {
        response = await doFetch(url, { signal, method: "GET", mode: "cors", credentials: "omit", headers: { Accept: "application/json" } });
      } catch (error) {
        if (error?.name === "AbortError") throw apiError("CLIENT_TIMEOUT", 0, null);
        throw apiError("NETWORK_ERROR", 0, null);
      }
      const requestId = response.headers.get("X-Request-ID");
      const body = await response.json().catch(() => null);
      const retryHeader = response.headers.get("Retry-After");
      return { response, body, requestId, retryAfter: retryHeader === null ? NaN : Number(retryHeader) };
    }

    function asCard(card, requestId) {
      try {
        return { ...toCardModel(card), discoveryWithheld: false, source: "public" };
      } catch {
        throw apiError("MALFORMED_RESPONSE", 200, requestId);
      }
    }

    return Object.freeze({
      isPrototype: false,

      async listLatest({ signal } = {}) {
        const { response, body, requestId, retryAfter } = await getJson(`${base}/links`, signal);
        if (!response.ok) throw apiError(body?.error?.code || "HTTP_ERROR", response.status, requestId, retryAfter);
        if (!Array.isArray(body?.items)) throw apiError("MALFORMED_RESPONSE", response.status, requestId);
        return { links: body.items.map((item) => asCard(item, requestId)), requestId };
      },

      // code: an already-normalized canonical code.
      async lookup(code, { signal } = {}) {
        const { response, body, requestId, retryAfter } =
          await getJson(`${base}/link-lookup?input=${encodeURIComponent(code)}`, signal);
        if (response.status === 200) return { kind: "card", link: asCard(body, requestId), requestId };
        const errorCode = body?.error?.code;
        if (response.status === 404 && errorCode === "LINK_NOT_FOUND") return { kind: "not_found", requestId };
        if (response.status === 404 && errorCode === "LINK_DISABLED") return { kind: "unavailable", requestId };
        throw apiError(errorCode || "HTTP_ERROR", response.status, requestId, retryAfter);
      },
    });
  }

  global.op4nHttpPublicLinkService = Object.freeze({ createHttpPublicLinkAdapter });
})(globalThis);
