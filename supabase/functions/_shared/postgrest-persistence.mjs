export function createPostgrestPersistence({ supabaseUrl, secretKey, fetchImpl = fetch }) {
  if (!supabaseUrl || !secretKey) {
    throw new Error("Database persistence configuration is incomplete.");
  }

  return Object.freeze({
    async beginCreation(input) {
      return callRpc("begin_creation_idempotency_v1", {
        p_environment: input.environment,
        p_operation: input.operation,
        p_key_hash: input.keyHash,
        p_payload_digest: input.payloadDigest,
      });
    },
    async releaseCreation(input) {
      return callRpc("release_creation_idempotency_v1", {
        p_environment: input.environment,
        p_operation: input.operation,
        p_key_hash: input.keyHash,
        p_payload_digest: input.payloadDigest,
        p_reservation_token: input.reservationToken,
      });
    },
    async createGuestLink(input) {
      return callRpc("create_guest_link_v1", {
        p_environment: input.environment,
        p_operation: input.operation,
        p_key_hash: input.keyHash,
        p_payload_digest: input.payloadDigest,
        p_reservation_token: input.reservationToken,
        p_candidate_code: input.candidateCode,
        p_title: input.title,
        p_full_destination_url: input.fullDestinationUrl,
        p_safe_origin: input.safeOrigin,
        p_destination_fingerprint: input.destinationFingerprint,
        p_fingerprint_algorithm: input.fingerprintAlgorithm,
        p_fingerprint_key_version: input.fingerprintKeyVersion,
        p_summary_policy_version: input.summaryPolicyVersion,
        p_canonical_base_url: input.canonicalBaseUrl,
      }, { detectCodeCollision: true });
    },
  });

  async function callRpc(name, requestBody, { detectCodeCollision = false } = {}) {
    const response = await fetchImpl(
      `${supabaseUrl}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: secretKey,
        },
        body: JSON.stringify(requestBody),
      },
    );

    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      const collision = detectCodeCollision && responseBody?.code === "23505" &&
        [responseBody?.message, responseBody?.details, responseBody?.hint]
          .some((value) => String(value || "").includes("issued_codes_canonical_code_key"));
      if (collision) return { kind: "code_collision" };
      throw new Error("Database creation operation failed.");
    }
    return responseBody;
  }
}
