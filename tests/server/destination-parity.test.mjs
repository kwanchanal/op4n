import assert from "node:assert/strict";
import test from "node:test";
import "../../services/destination-url-validation.js";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";

const client = globalThis.op4nDestinationUrlValidation;
const server = createDestinationPolicy({ shortLinkHosts: ["op4n.me", "staging.op4n.me"] });

// One fixture table, two validators. The client trims before sending, so the
// server is evaluated on the trimmed value it would actually receive.
const FIXTURES = [
  ["valid https", "https://example.com/path?x=1#frag", true],
  ["valid http", "http://example.com/", true],
  ["surrounding whitespace", "  https://example.com/space  \n", true],
  ["unicode host", "https://bücher.example/catalog", true],
  ["public IP literal", "https://93.184.216.34/", true],
  ["credentials in URL", "https://user:pass@example.com/", false],
  ["username only", "https://user@example.com/", false],
  ["op4n.me host", "https://op4n.me/ABCDEFG", false],
  ["staging short host", "https://staging.op4n.me/ABCDEFG", false],
  ["uppercase short host", "https://OP4N.ME/ABCDEFG", false],
  ["trailing-dot short host", "https://op4n.me./ABCDEFG", false],
  ["trailing-dot staging short host", "https://STAGING.OP4N.ME./ABCDEFG", false],
  ["2049 characters", `https://example.com/${"a".repeat(2049 - "https://example.com/".length)}`, false],
  ["exactly 2048 characters", `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`, true],
  ["ftp scheme", "ftp://example.com/file", false],
  ["javascript scheme", "javascript:alert(1)", false],
  ["data scheme", "data:text/html,hi", false],
  ["file scheme", "file:///etc/passwd", false],
  ["missing scheme", "example.com/path", false],
  ["empty", "", false],
  ["whitespace only", "   ", false],
  ["loopback IPv4", "http://127.0.0.1/", false],
  ["loopback IPv6", "http://[::1]/", false],
  ["private 10/8", "http://10.0.0.1/", false],
  ["private 172.16/12", "http://172.16.0.1/", false],
  ["private 192.168/16", "http://192.168.1.1/", false],
  ["CGNAT 100.64/10", "http://100.64.0.1/", false],
  ["cloud metadata", "http://169.254.169.254/latest/meta-data", false],
  ["IPv6 link-local", "http://[fe80::1]/", false],
  ["IPv6 unique local", "http://[fd00::1]/", false],
  ["IPv4-mapped private IPv6", "http://[::ffff:10.0.0.1]/", false],
  ["localhost with port", "http://localhost:3000/", false],
  ["localhost trailing dot", "http://localhost./", false],
  ["subdomain of localhost", "http://app.localhost/", false],
  [".local host", "http://printer.local/", false],
  [".internal host", "http://service.internal/", false],
  ["single-label host", "http://intranet/", false],
  ["decimal IPv4 encoding", "http://2130706433/", false],
  ["hex IPv4 encoding", "http://0x7f.1/", false],
  ["octal IPv4 encoding", "http://0177.0.0.1/", false],
  ["multicast", "http://224.0.0.1/", false],
  ["public IPv6", "https://[2606:4700:4700::1111]/", true],
  ["public IPv4-mapped IPv6", "https://[::ffff:8.8.8.8]/", true],
  ["public host trailing dot", "https://example.com./", true],
];

for (const [label, input, expected] of FIXTURES) {
  test(`client and server agree: ${label}`, () => {
    const clientResult = client.validateDestinationUrlInput(input);
    const serverResult = server.parse(input.trim());
    assert.equal(clientResult.valid, expected, `client ${label}`);
    assert.equal(serverResult.valid, expected, `server ${label}`);
    if (expected) assert.equal(clientResult.url, input.trim());
  });
}

test("title limit is 200 characters after trimming", () => {
  assert.equal(client.validateTitleInput("a".repeat(200)).valid, true);
  assert.equal(client.validateTitleInput(` ${"a".repeat(200)} `).valid, true);
  assert.equal(client.validateTitleInput("a".repeat(201)).valid, false);
  assert.equal(client.MAX_TITLE_LENGTH, 200);
});
