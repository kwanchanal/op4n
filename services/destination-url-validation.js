(function (global) {
  "use strict";

  // Client mirror of supabase/functions/_shared/destination-policy.mjs. The two
  // must accept and reject the same inputs; tests/server/destination-parity.test.mjs
  // runs one fixture table through both so they cannot drift.

  const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
  const SHORT_LINK_HOSTS = new Set(["op4n.me", "staging.op4n.me"]);
  const MAX_DESTINATION_LENGTH = 2048;
  const MAX_TITLE_LENGTH = 200;

  function invalid(message) {
    return { valid: false, message };
  }

  function validateDestinationUrlInput(value) {
    const trimmedValue = String(value ?? "").trim();
    if (!trimmedValue) return invalid("Enter a destination URL.");
    if (trimmedValue.length > MAX_DESTINATION_LENGTH) {
      return invalid("This URL is too long. Use a URL of 2,048 characters or fewer.");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmedValue);
    } catch {
      return invalid("Enter a complete HTTP or HTTPS URL.");
    }

    if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
      return invalid("Only HTTP and HTTPS destination URLs are supported.");
    }
    if (parsedUrl.username || parsedUrl.password) {
      return invalid("Remove the username or password from this URL.");
    }
    if (!parsedUrl.hostname) return invalid("Enter a complete HTTP or HTTPS URL.");
    if (SHORT_LINK_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
      return invalid("Op4n short links can't be shortened again. Use the original destination URL.");
    }
    if (parsedUrl.href.length > MAX_DESTINATION_LENGTH) {
      return invalid("This URL is too long. Use a URL of 2,048 characters or fewer.");
    }

    return { valid: true, url: trimmedValue };
  }

  function validateTitleInput(value) {
    const trimmedValue = String(value ?? "").trim();
    if (trimmedValue.length > MAX_TITLE_LENGTH) {
      return invalid("Use a title of 200 characters or fewer.");
    }
    return { valid: true, title: trimmedValue };
  }

  global.op4nDestinationUrlValidation = Object.freeze({
    MAX_DESTINATION_LENGTH,
    MAX_TITLE_LENGTH,
    validateDestinationUrlInput,
    validateTitleInput,
  });
})(globalThis);
