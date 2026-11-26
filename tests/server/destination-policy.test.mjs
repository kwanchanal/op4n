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

test("summary of a withheld destination shows the origin and a marker only", () => {
  const result = policy.parse("https://example.com/private/path?token=secret#account");
  assert.equal(result.discovery.eligible, false);
  assert.deepEqual(result.publicSummary, {
    origin: "https://example.com",
    path: "/…",
    displayValue: "https://example.com/…",
    displayPath: "/…",
  });
  assert.doesNotMatch(JSON.stringify(result.publicSummary), /private|token|secret|account/);
});

test("summary policy r1-safe-path-v1 shows ordinary leading segments and marks what it hides", () => {
  const cases = [
    ["https://shop.com/products/running-shoes?ref=ig", "https://shop.com/products/running-shoes?…", "/products/running-shoes"],
    ["https://example.com/", "https://example.com", undefined],
    ["https://example.com", "https://example.com", undefined],
    ["https://example.com/?utm=1", "https://example.com?…", undefined],
    ["https://example.com/#top", "https://example.com?…", undefined],
    ["https://docs.example.com/guide/v2/install/linux", "https://docs.example.com/guide/v2/install/…", "/guide/v2/install/…"],
    ["https://example.com/blog/2024/hello-world/", "https://example.com/blog/2024/hello-world", "/blog/2024/hello-world"],
    ["https://youtube.com/watch?v=abc", "https://youtube.com/watch?…", "/watch"],
    ["https://example.com/p/A1b2C3d4", "https://example.com/p/…", "/p/…"],
    ["https://example.com/orders/123", "https://example.com/…", "/…"],
    ["https://example.com/u/12345", "https://example.com/u/…", "/u/…"],
    ["https://example.com/doc/AbCdEfGhIj", "https://example.com/doc/…", "/doc/…"],
    ["https://example.com/caf%C3%A9/menu", "https://example.com/…", "/…"],
    ["https://example.com/a~b", "https://example.com/…", "/…"],
    ["https://example.com/x//y", "https://example.com/x/…", "/x/…"],
    [`https://example.com/${"a".repeat(33)}`, "https://example.com/…", "/…"],
    ["https://example.com/ABCDEFGHI", "https://example.com/…", "/…"],
    ["https://example.com/iPhone-15/specs", "https://example.com/iPhone-15/specs", "/iPhone-15/specs"],
  ];
  for (const [input, display, path] of cases) {
    const summary = policy.parse(input).publicSummary;
    assert.equal(summary.displayValue, display, input);
    assert.equal(summary.path, path, input);
    assert.doesNotMatch(summary.displayValue.slice(summary.origin.length), /[#%@]|\?(?!…$)/, input);
  }
  assert.equal(policy.parse("https://example.com/").summaryPolicyVersion, "r1-safe-path-v1");
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
