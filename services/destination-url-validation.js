(function (global) {
  "use strict";

  // Client mirror of supabase/functions/_shared/destination-policy.mjs. The two
  // must accept and reject the same inputs; tests/server/destination-parity.test.mjs
  // runs one fixture table through both so they cannot drift.

  const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);
  const SHORT_LINK_HOSTS = new Set(["op4n.me", "staging.op4n.me"]);
  const MAX_DESTINATION_LENGTH = 2048;
  const MAX_TITLE_LENGTH = 200;

  // Private, local, and special-purpose network targets cannot be shortened.
  // Hosts are checked after WHATWG URL normalization, so numeric encodings
  // such as http://2130706433 or http://0x7f.1 are already 127.0.0.1 here.
  // No DNS resolution happens at creation time.
  const BLOCKED_IPV4 = [
    [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
    [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
    [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
    [0xe0000000, 4], [0xf0000000, 4],
  ];
  const BLOCKED_NAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

  function parseIpv4(host) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  function isBlockedIpv4(value) {
    return BLOCKED_IPV4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((value & mask) >>> 0) === ((base & mask) >>> 0);
    });
  }

  function parseIpv6(host) {
    if (!host.startsWith("[") || !host.endsWith("]")) return null;
    const text = host.slice(1, -1);
    const halves = text.split("::");
    if (halves.length > 2) return null;
    const toWords = (part) => (part ? part.split(":") : []);
    const head = toWords(halves[0]);
    const tail = halves.length === 2 ? toWords(halves[1]) : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
    const words = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
    if (words.length !== 8 || !words.every((word) => /^[0-9a-f]{1,4}$/i.test(word))) return null;
    return words.map((word) => parseInt(word, 16));
  }

  function isBlockedIpv6(words) {
    const [w0, w1, w2, w3, w4, w5, w6, w7] = words;
    const embeddedV4 = ((w6 << 16) >>> 0) + w7;
    if (words.every((word) => word === 0)) return true;
    if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && (w5 === 0 || w5 === 0xffff)) {
      return w5 === 0 && w6 === 0 && w7 === 1 ? true : isBlockedIpv4(embeddedV4) || w5 === 0;
    }
    if (w0 === 0x64 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) return isBlockedIpv4(embeddedV4);
    if ((w0 & 0xfe00) === 0xfc00) return true;
    if ((w0 & 0xffc0) === 0xfe80) return true;
    if ((w0 & 0xff00) === 0xff00) return true;
    if (w0 === 0x2001 && w1 === 0x0db8) return true;
    if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0) return true;
    return false;
  }

  function isPrivateNetworkHost(hostname) {
    const host = String(hostname).toLowerCase().replace(/\.$/, "");
    const ipv6 = parseIpv6(host);
    if (ipv6) return isBlockedIpv6(ipv6);
    if (host.startsWith("[")) return true;
    const ipv4 = parseIpv4(host);
    if (ipv4 !== null) return isBlockedIpv4(ipv4);
    if (host === "localhost" || BLOCKED_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
    return !host.includes(".");
  }

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
    if (SHORT_LINK_HOSTS.has(parsedUrl.hostname.toLowerCase().replace(/\.$/, ""))) {
      return invalid("Op4n short links can't be shortened again. Use the original destination URL.");
    }
    if (isPrivateNetworkHost(parsedUrl.hostname)) {
      return invalid("This URL points to a private or local network address and can't be shortened.");
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
    isPrivateNetworkHost,
    MAX_DESTINATION_LENGTH,
    MAX_TITLE_LENGTH,
    validateDestinationUrlInput,
    validateTitleInput,
  });
})(globalThis);
