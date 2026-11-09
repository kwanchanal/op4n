import "../services/destination-url-validation.js";

const { validateDestinationUrlInput } = globalThis.op4nDestinationUrlValidation;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

function expectInvalid(value, messagePart, label) {
  const result = validateDestinationUrlInput(value);
  assert(!result.valid && result.message.includes(messagePart), label);
}

expectInvalid("", "Enter a destination", "empty input is rejected");
expectInvalid("   \n\t", "Enter a destination", "whitespace-only input is rejected");
expectInvalid("not a URL", "complete HTTP or HTTPS URL", "malformed input is rejected");
expectInvalid("javascript:alert(1)", "Only HTTP and HTTPS", "javascript scheme is rejected");
expectInvalid("file:///tmp/example", "Only HTTP and HTTPS", "file scheme is rejected");
expectInvalid("mailto:test@example.com", "Only HTTP and HTTPS", "unsupported scheme is rejected");

const http = validateDestinationUrlInput("http://example.com/path");
assert(http.valid && http.url === "http://example.com/path", "valid HTTP input is accepted");

const https = validateDestinationUrlInput("https://example.com/path?secret=1#private");
assert(https.valid, "valid HTTPS input is accepted");

const trimmed = validateDestinationUrlInput("  https://example.com/path?x=1#section  \n");
assert(
  trimmed.valid && trimmed.url === "https://example.com/path?x=1#section",
  "leading and trailing whitespace is removed before validation"
);
