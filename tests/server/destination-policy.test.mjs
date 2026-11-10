import assert from "node:assert/strict";
import test from "node:test";
import {
  createDestinationPolicy,
  MAX_DESTINATION_LENGTH,
} from "../../supabase/functions/_shared/destination-policy.mjs";

const policy = createDestinationPolicy({
  shortLinkHosts: ["op4n.me", "staging.op4n.me"],
});

test("accepts absolute HTTP and HTTPS and preserves accepted URL semantics", () => {
  const http = policy.parse("http://example.com:80/a/../b?x=1#frag");
  assert.equal(http.valid, true);
  assert.equal(http.normalizedUrl, "http://example.com/b?x=1#frag");

  const https = policy.parse("https://example.com/path%20name?q=a%2Fb#part");
  assert.equal(https.valid, true);
  assert.equal(https.normalizedUrl, "https://example.com/path%20name?q=a%2Fb#part");
});

test("returns origin-only public summary", () => {
  const result = policy.parse("https://example.com/private/path?token=secret#account");
  assert.deepEqual(result.publicSummary, {
    origin: "https://example.com",
    displayValue: "https://example.com",
  });
  assert.doesNotMatch(JSON.stringify(result.publicSummary), /private|token|secret|account/);
});

test("rejects malformed, unsupported, credentialed, oversized, and short-link destinations", () => {
  for (const value of [
    "not a URL",
    "/relative",
    "javascript:alert(1)",
    "file:///tmp/example",
    "https://user:password@example.com/path",
    "https://op4n.me/ABCDEFGHIJ",
    "https://staging.op4n.me/ABCDEFGHIJ",
    `https://example.com/${"a".repeat(MAX_DESTINATION_LENGTH)}`,
  ]) {
    assert.equal(policy.parse(value).valid, false, value);
  }
});

test("rejects a URL that expands beyond the limit during parser normalization", () => {
  const raw = `https://example.com/${"é".repeat(340)}`;
  assert.ok(raw.length <= MAX_DESTINATION_LENGTH);
  assert.ok(new URL(raw).href.length > MAX_DESTINATION_LENGTH);
  assert.equal(policy.parse(raw).valid, false);
});

test("destination policy performs no outbound request", () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("must not fetch");
  };
  try {
    assert.equal(policy.parse("https://example.com/health").valid, true);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
