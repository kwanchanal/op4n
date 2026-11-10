const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export const MAX_DESTINATION_LENGTH = 2048;

export function createDestinationPolicy({ shortLinkHosts = ["op4n.me"] } = {}) {
  const blockedHosts = new Set(shortLinkHosts.map((host) => String(host).toLowerCase()));

  return Object.freeze({
    parse(value) {
      if (typeof value !== "string" || value.length === 0) {
        return invalid("VALIDATION_ERROR", "A destination URL is required.");
      }
      if (value.length > MAX_DESTINATION_LENGTH) {
        return invalid("VALIDATION_ERROR", "The destination URL is too long.");
      }

      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        return invalid("VALIDATION_ERROR", "Enter a complete absolute URL.");
      }

      if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
        return invalid("UNSUPPORTED_PROTOCOL", "Only HTTP and HTTPS destinations are supported.");
      }
      if (parsed.username || parsed.password) {
        return invalid("VALIDATION_ERROR", "Destination credentials are not allowed.");
      }
      if (!parsed.hostname || blockedHosts.has(parsed.hostname.toLowerCase())) {
        return invalid("VALIDATION_ERROR", "This destination host is not allowed.");
      }
      if (parsed.href.length > MAX_DESTINATION_LENGTH) {
        return invalid("VALIDATION_ERROR", "The normalized destination URL is too long.");
      }

      return {
        valid: true,
        normalizedUrl: parsed.href,
        publicSummary: Object.freeze({
          origin: parsed.origin,
          displayValue: parsed.origin,
        }),
      };
    },
  });
}

function invalid(code, message) {
  return { valid: false, code, message };
}
