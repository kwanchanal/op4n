import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE62_ALPHABET,
  CANONICAL_CODE_LENGTH,
  createCanonicalCodeGenerator,
} from "../../supabase/functions/_shared/canonical-code.mjs";

function sourceFrom(values) {
  let offset = 0;
  return (length) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = values[offset % values.length];
      offset += 1;
    }
    return bytes;
  };
}

test("generates fixed ten-character case-sensitive Base62 codes", () => {
  const generate = createCanonicalCodeGenerator({
    randomSource: sourceFrom([0, 10, 35, 36, 61]),
  });
  const code = generate();
  assert.equal(code.length, CANONICAL_CODE_LENGTH);
  assert.match(code, /^[A-Za-z0-9]{10}$/);
  assert.ok([...code].every((character) => BASE62_ALPHABET.includes(character)));
  assert.match(code, /[A-Z]/);
  assert.match(code, /[a-z]/);
});

test("rejects biased bytes and configured reserved candidates", () => {
  const reserved = "0000000000";
  let call = 0;
  const generate = createCanonicalCodeGenerator({
    reservedCodes: [reserved],
    randomSource(length) {
      call += 1;
      return new Uint8Array(length).fill(call === 1 ? 0 : call === 2 ? 255 : 1);
    },
  });
  assert.equal(generate(), "1111111111");
  assert.ok(call >= 3);
});
