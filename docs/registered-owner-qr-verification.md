# Future Registered-owner QR verification contract

This contract belongs to the later Registered Feature Inventory phase. Prototype
Cleanup keeps only the static, non-live Guest showcase and must not generate,
render, scan, customize, save, or download a QR code.

## Authorization boundary

- Require an authenticated Registered session and server-side authorization for
  the requested link on every generate, preview, save, and download operation.
- Confirm that the link belongs to the authenticated account. A short code,
  query parameter, browser state, CSS class, or localStorage value is never
  ownership proof.
- Deny Guests and authenticated non-owners without returning owner data or
  revealing whether a private link exists.
- Keep the Guest showcase and owner implementation as separate authorization
  and rendering paths; do not unlock the Guest markup client-side.

## Encoded value and visual quality

- Encode the exact canonical `https://op4n.me/{code}` value returned by the
  authorized link API, with no display-only substitutions or tracking data.
- Decode the rendered output in an automated test and compare the full value
  byte-for-byte with the canonical short URL.
- Enforce adequate foreground/background contrast and a standards-compliant
  quiet zone after applying approved colors, logo, frame, or label options.
- Test the final branded output, not only an unstyled intermediate QR.

## PNG download

- Produce a non-empty PNG with the expected MIME type and dimensions.
- Use the safe filename `qr-{shortCode}.png`; derive `shortCode` from the
  authorized record and allow only the canonical code character set.
- Show a user-facing failure state for generation, rendering, network, and
  download failures without exposing internal payloads.
- Revoke every temporary object URL and release temporary canvas/image
  resources after success, failure, cancellation, and repeated downloads.
- Verify repeated downloads do not accumulate DOM nodes, object URLs, event
  handlers, or retained image buffers.

## Required verification cases

1. The authenticated owner can generate and decode the exact canonical URL.
2. A Guest receives an authorization denial and no QR payload.
3. An authenticated non-owner receives an authorization denial and no QR payload.
4. Altering a short code, URL parameter, CSS state, or localStorage does not grant access.
5. Approved styling retains scan accuracy, contrast, and quiet zone.
6. The PNG is non-empty and uses `qr-{shortCode}.png`.
7. Failures are recoverable and visible without leaking internals.
8. Repeated downloads clean up all temporary resources.
