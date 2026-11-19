(function (global) {
  "use strict";

  // Production link-creation adapter for POST /api/v1/links. It returns the
  // same card view model as the mock adapter, so UI code never depends on
  // which adapter is active. The full destination is sent once and is never
  // returned by the API or kept in the view model.

  const CARD_FIELDS = Object.freeze([
    "aggregateTotalClicks",
    "canonicalCode",
    "canonicalOpenUrl",
    "canonicalShortUrl",
    "displayTitle",
    "safeDestinationSummary",
  ]);

  function apiError(code, status, requestId) {
    const error = new Error("Link creation request failed");
    error.code = code;
    error.status = status;
    error.requestId = requestId || null;
    return error;
  }

  function isHttpUrl(value) {
    try {
      return ["http:", "https:"].includes(new URL(String(value)).protocol);
    } catch {
      return false;
    }
  }

  // Maps one PublicLinkCard to the UI card view model. Anything unexpected is
  // treated as a malformed response rather than rendered.
  function toCardModel(card) {
    const valid = card && typeof card === "object" &&
      CARD_FIELDS.every((field) => Object.hasOwn(card, field)) &&
      typeof card.canonicalCode === "string" && card.canonicalCode &&
      isHttpUrl(card.canonicalShortUrl) && isHttpUrl(card.canonicalOpenUrl) &&
      typeof card.safeDestinationSummary?.displayValue === "string";
    if (!valid) throw apiError("MALFORMED_RESPONSE", 201, null);
    return Object.freeze({
      id: card.canonicalCode,
      code: card.canonicalCode,
      title: typeof card.displayTitle === "string" ? card.displayTitle : "",
      shortUrl: card.canonicalShortUrl,
      openUrl: card.canonicalOpenUrl,
      destinationSummary: card.safeDestinationSummary.displayValue,
      clickCount: card.aggregateTotalClicks,
      source: "created",
    });
  }

  function createHttpLinkAdapter({ apiBaseUrl, fetchImpl }) {
    if (!isHttpUrl(apiBaseUrl)) throw new Error("apiBaseUrl must be an absolute HTTP(S) URL");
    const doFetch = fetchImpl || global.fetch.bind(global);
    const endpoint = `${String(apiBaseUrl).replace(/\/+$/, "")}/api/v1/links`;

    return Object.freeze({
      isPrototype: false,

      // Guests own no links and there is no list API. The creation view shows
      // only links created in this page session, held in memory by the UI.
      async listCreatedLinks() {
        return { links: [], meta: { sessionOnly: true } };
      },

      async createLink(request) {
        let response;
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "Idempotency-Key": request.requestId,
            },
            body: JSON.stringify({
              destinationUrl: request.destinationUrl,
              title: request.title ? request.title : null,
            }),
          });
        } catch {
          throw apiError("NETWORK_ERROR", 0, null);
        }
        const requestId = response.headers.get("X-Request-ID");
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const code = typeof body?.error?.code === "string" ? body.error.code : "HTTP_ERROR";
          throw apiError(code, response.status, requestId);
        }
        return {
          link: toCardModel(body),
          meta: { persisted: true, replayed: response.headers.get("Idempotency-Replayed") === "true", requestId },
        };
      },
    });
  }

  global.op4nHttpLinkService = Object.freeze({ createHttpLinkAdapter, toCardModel });
})(globalThis);
