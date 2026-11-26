// Browser copy of the exact short-link lookup normalizer (Order 72). Gives
// instant feedback before a request; the server re-validates. Must agree with
// supabase/functions/_shared/lookup-normalizer.mjs on
// tests/fixtures/lookup-inputs.json.
(function (global) {
  const CODE = /^[A-Za-z0-9]{6,32}$/;
  const MAX_INPUT = 256;

  function normalizeLookupInput(input, shortHost) {
    const text = String(input ?? "").trim();
    if (!text || text.length > MAX_INPUT) return { valid: false };
    if (CODE.test(text)) return { valid: true, code: text };

    let rest = text;
    const scheme = /^https:\/\//i;
    if (scheme.test(rest)) rest = rest.replace(scheme, "");
    else if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) return { valid: false };

    const slash = rest.indexOf("/");
    if (slash < 1) return { valid: false };
    const host = rest.slice(0, slash);
    const path = rest.slice(slash + 1);
    if (host.toLowerCase() !== shortHost) return { valid: false };
    if (!CODE.test(path)) return { valid: false };
    return { valid: true, code: path };
  }

  global.op4nShortLinkLookup = Object.freeze({ normalizeLookupInput });
})(globalThis);
