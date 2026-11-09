(function (global) {
  "use strict";

  const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

  function validateDestinationUrlInput(value) {
    const trimmedValue = String(value ?? "").trim();
    if (!trimmedValue) {
      return { valid: false, message: "Enter a destination URL." };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmedValue);
    } catch {
      return { valid: false, message: "Enter a complete HTTP or HTTPS URL." };
    }

    if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
      return {
        valid: false,
        message: "Only HTTP and HTTPS destination URLs are supported.",
      };
    }

    return { valid: true, url: trimmedValue };
  }

  global.op4nDestinationUrlValidation = Object.freeze({
    validateDestinationUrlInput,
  });
})(globalThis);
