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
    async consumeRateLimit(input) {
      return callRpc("consume_rate_limit_v1", {
        p_environment: input.environment,
        p_class: input.limitClass,
        p_identity: input.identity,
        p_windows: input.windows,
      });
    },
    async submitReport(input) {
      return callRpc("submit_report_v1", {
        p_environment: input.environment,
        p_code: input.canonicalCode,
        p_key_hash: input.keyHash,
        p_payload_digest: input.payloadDigest,
        p_reason: input.reasonCategory,
        p_detail: input.detail,
      });
    },
    async getFeatureFlags() {
      return callRpc("get_feature_flags_v1", {});
    },
    async resolveRedirect(canonicalCode) {
      return callRpc("resolve_canonical_redirect_v1", { p_code: canonicalCode });
    },
    async adminFindLink(input) {
      return callRpc("admin_find_link_v1", { p_code: input.code, p_fingerprint: input.fingerprint });
    },
    async adminLinkRecord(code) {
      return callRpc("admin_link_record_v1", { p_code: code });
    },
    async adminRevealDestination(input) {
      return callRpc("admin_reveal_destination_v1", { p_code: input.code, p_actor: input.actor });
    },
    async adminListCases(input) {
      return callRpc("admin_list_cases_v1", { p_limit: input.limit, p_offset: input.offset });
    },
    async adminTransitionCase(input) {
      return callRpc("admin_transition_case_v1", {
        p_case_id: input.caseId, p_action: input.action, p_actor: input.actor, p_note: input.note,
      });
    },
    async adminModerateLink(input) {
      return callRpc("admin_moderate_link_v1", {
        p_code: input.code,
        p_action: input.action,
        p_actor: input.actor,
        p_reason: input.reasonCode,
        p_detail: input.reasonDetail,
        p_key_hash: input.keyHash,
        p_payload_digest: input.payloadDigest,
      });
    },
    async claimNotifications(input) {
      return callRpc("claim_notifications_v1", {
        p_environment: input.environment,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      });
    },
    async completeNotifications(input) {
      return callRpc("complete_notifications_v1", { p_batch_id: input.batchId, p_outcome: input.outcome });
    },
    async recordClick(input) {
      return callRpc("record_click_v1", {
        p_event_id: input.eventId,
        p_code: input.canonicalCode,
        p_destination_version: input.destinationVersion,
        p_occurred_at: input.occurredAt,
      });
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
