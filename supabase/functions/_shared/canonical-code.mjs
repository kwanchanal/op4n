export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const CANONICAL_CODE_LENGTH = 10;
export const MAX_CODE_ATTEMPTS = 5;
const MAX_RESERVED_CODE_DRAWS = 100;

export function createCanonicalCodeGenerator({
  randomSource = secureRandomBytes,
  reservedCodes = [],
} = {}) {
  const reserved = new Set(reservedCodes);

  return function generateCanonicalCode() {
    for (let draw = 0; draw < MAX_RESERVED_CODE_DRAWS; draw += 1) {
      const candidate = encodeBase62(randomSource, CANONICAL_CODE_LENGTH);
      if (!reserved.has(candidate)) return candidate;
    }
    throw new Error("Unable to generate a non-reserved canonical code.");
  };
}

function encodeBase62(randomSource, length) {
  let output = "";
  while (output.length < length) {
    const bytes = randomSource(Math.max(16, length - output.length));
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("Random source must return Uint8Array.");
    }
    for (const byte of bytes) {
      if (byte >= 248) continue;
      output += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
      if (output.length === length) break;
    }
  }
  return output;
}

function secureRandomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
