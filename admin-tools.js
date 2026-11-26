// Op4n Admin tools (Feature Inventory Orders 57-60): reported-link queue, exact
// link lookup, audited destination reveal, case triage/resolve, audited
// disable/restore, and the audited public-discovery override (Order 61). Every value from the API is rendered with textContent;
// nothing here builds HTML from data. The full destination appears only after
// an explicit, audited Reveal.
(function () {
  "use strict";

  const DISABLE_REASONS = [
    ["abuse_report", "Confirmed abuse report"],
    ["safety_block", "Safety block"],
    ["policy_violation", "Policy violation"],
  ];
  const RESTORE_REASONS = [
    ["operator_correction", "Mistaken disable (correction)"],
    ["abuse_report", "Report reviewed: not abusive"],
  ];
  const REASON_LABELS = {
    phishing: "Phishing", malware: "Malware", child_safety: "Child safety", illegal: "Illegal",
    impersonation: "Impersonation", abuse: "Abuse", spam: "Spam", other: "Other",
  };

  let api = null;
  const view = { page: 1, code: null, pendingKey: null };

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === "text") node.textContent = String(value);
      else if (key === "className") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  const $ = (id) => document.getElementById(id);
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
  const reasons = (byReason) => Object.entries(byReason || {})
    .map(([reason, count]) => `${REASON_LABELS[reason] || reason} ×${count}`).join(", ") || "—";
  const ref = (result) => (result.requestId ? ` (Ref ${result.requestId.slice(0, 8)})` : "");

  function failureText(result, fallback) {
    if (result.code === "NETWORK_ERROR") return "Network error. Check your connection and retry.";
    if (result.code === "UNAUTHORIZED" || result.code === "MFA_REQUIRED") return "Your Admin session ended. Sign in again.";
    return `${result.message || fallback}${ref(result)}`;
  }

  async function handleAuthFailure(result) {
    if (result.code === "REAUTH_REQUIRED" || result.code === "UNAUTHORIZED") {
      await api.requireReauth();
      return true;
    }
    return false;
  }

  function showTab(name) {
    for (const tab of ["queue", "lookup"]) {
      const active = tab === name;
      $(`adminTab-${tab}`).setAttribute("aria-selected", String(active));
      $(`adminPanel-${tab}`).hidden = !active;
    }
  }

  // ── Queue (Order 58) ────────────────────────────────────────────
  async function loadQueue(page = view.page) {
    view.page = page;
    const list = $("queueList");
    list.replaceChildren(el("p", { className: "admin-help", text: "Loading reports…" }));
    const result = await api.callAdmin(`/api/v1/admin/cases?page=${page}`);
    if (!result.ok) {
      if (await handleAuthFailure(result)) return;
      list.replaceChildren(el("p", { className: "form-status", "data-tone": "error", role: "alert", text: failureText(result, "The queue could not be loaded.") }),
        el("button", { type: "button", className: "admin-signout", text: "Retry", onclick: () => loadQueue(page) }));
      return;
    }
    const { items, total, pageSize } = result.body;
    if (!items.length) {
      list.replaceChildren(el("aside", { className: "guest-link-disclosure" }, [
        el("span", { className: "material-symbols-outlined", "aria-hidden": "true", text: "task_alt" }),
        el("p", { text: "No open reports. New reports appear here and in the email digest." }),
      ]));
      $("queuePager").hidden = true;
      return;
    }
    list.replaceChildren(...items.map((item) => el("article", { className: "admin-case" }, [
      el("div", { className: "admin-case-head" }, [
        el("span", { className: `admin-badge admin-badge-${item.priority}`, text: item.priority }),
        el("strong", { text: `op4n.me/${item.canonicalCode}` }),
        el("span", { className: "admin-case-state", text: item.caseState === "triaged" ? "Triaged" : "New" }),
      ]),
      el("p", { className: "admin-case-title", text: item.title || "Untitled link" }),
      el("p", { className: "admin-help", text: `${item.safeDestinationOrigin} · ${item.lifecycleState === "disabled" ? "Disabled" : "Active"}` }),
      el("p", { className: "admin-help", text: `${item.reportCount} report(s): ${reasons(item.reportsByReason)}` }),
      el("p", { className: "admin-help", text: `First ${when(item.firstReportAt)} · Last ${when(item.lastReportAt)}` }),
      el("button", { type: "button", className: "cta admin-cta-small", text: "Open", onclick: () => openRecord(item.canonicalCode) }),
    ])));
    const pages = Math.max(1, Math.ceil(total / pageSize));
    $("queuePager").hidden = pages <= 1;
    $("queuePageLabel").textContent = `Page ${page} of ${pages} · ${total} open case(s)`;
    $("queuePrev").disabled = page <= 1;
    $("queueNext").disabled = page >= pages;
  }

  // ── Lookup and record (Order 57) ────────────────────────────────
  async function lookup(event) {
    event.preventDefault();
    const query = $("lookupQuery").value.trim();
    const out = $("lookupResult");
    if (!query) {
      out.replaceChildren(el("p", { className: "form-status", "data-tone": "error", text: "Enter a code, short URL, or full destination URL." }));
      return;
    }
    out.replaceChildren(el("p", { className: "admin-help", text: "Searching…" }));
    const result = await api.callAdmin("/api/v1/admin/link-lookup", { method: "POST", body: { query } });
    if (!result.ok) {
      if (await handleAuthFailure(result)) return;
      out.replaceChildren(el("p", { className: "form-status", "data-tone": "error", text: result.status === 400 ? "Use an exact code, an exact short URL, or a full destination URL (no partial text)." : failureText(result, "Search failed.") }));
      return;
    }
    if (!result.body.found) {
      out.replaceChildren(el("p", { className: "admin-help", role: "status", text: "No link matches exactly. Partial text never matches." }));
      return;
    }
    await openRecord(result.body.canonicalCode);
  }

  async function openRecord(code) {
    view.code = code;
    view.pendingKey = null;
    showTab("lookup");
    const out = $("lookupResult");
    out.replaceChildren(el("p", { className: "admin-help", text: "Loading link…" }));
    const result = await api.callAdmin(`/api/v1/admin/links/${encodeURIComponent(code)}`);
    if (!result.ok) {
      if (await handleAuthFailure(result)) return;
      out.replaceChildren(el("p", { className: "form-status", "data-tone": "error", text: failureText(result, "The link could not be loaded.") }));
      return;
    }
    out.replaceChildren(renderRecord(result.body));
  }

  function renderRecord(record) {
    const destination = el("dd", { id: "recordDestination" }, [
      el("span", { text: `${record.safeDestinationDisplay || record.safeDestinationOrigin} (full URL hidden)` }),
      el("button", { type: "button", className: "admin-link-button", text: "Reveal full destination (audited)", onclick: () => reveal(record.canonicalCode) }),
    ]);
    const facts = el("dl", { className: "admin-facts" }, [
      el("dt", { text: "Short link" }), el("dd", { text: `op4n.me/${record.canonicalCode}` }),
      el("dt", { text: "Title" }), el("dd", { text: record.title || "Untitled link" }),
      el("dt", { text: "Destination" }), destination,
      el("dt", { text: "Status" }), el("dd", { text: `${record.lifecycleState} · safety ${record.safetyState}` }),
      el("dt", { text: "Public discovery" }), el("dd", { text: discoveryText(record) }),
      el("dt", { text: "Clicks" }), el("dd", { text: String(record.aggregateTotalClicks) }),
      el("dt", { text: "Reports" }), el("dd", { text: `${record.reportCount}: ${reasons(record.reportsByReason)}` }),
      el("dt", { text: "Created" }), el("dd", { text: when(record.createdAt) }),
      el("dt", { text: "Disabled" }), el("dd", { text: when(record.disabledAt) }),
    ]);
    const history = el("ol", { className: "admin-history" }, record.history.length
      ? record.history.map((entry) => el("li", { text: `${when(entry.occurredAt)} · ${entry.actionType}${entry.reasonCode ? ` (${entry.reasonCode})` : ""}${entry.reasonDetail ? ` — ${entry.reasonDetail}` : ""}` }))
      : [el("li", { text: "No moderation actions yet." })]);
    return el("section", { className: "form-card admin-card", "aria-label": `Link op4n.me/${record.canonicalCode}` }, [
      facts,
      record.openCase ? renderCaseActions(record.openCase) : null,
      renderModeration(record),
      renderDiscovery(record),
      el("h3", { className: "admin-subhead", text: "Moderation history" }),
      history,
    ]);
  }

  // ── Public discovery override (Order 61) ───────────────────────
  function discoveryText(record) {
    const shown = record.publiclyDiscoverable ? "Shown in Latest Links and search" : "Not shown in Latest Links or search";
    const override = record.discoveryOverride ? ` · founder override: ${record.discoveryOverride}` : "";
    return `${shown} · screening ${record.discoveryState} (${record.discoveryPolicyVersion})${override}`;
  }

  function renderDiscovery(record) {
    if (record.lifecycleState === "deleted") return null;
    const select = el("select", { id: "discoveryDecision" }, [
      el("option", { value: "", text: "Choose" }),
      el("option", { value: "eligible", text: "Allow in Latest Links and search" }),
      el("option", { value: "withheld", text: "Keep out of Latest Links and search" }),
      el("option", { value: "policy", text: "Use the screening result" }),
    ]);
    const note = el("textarea", { id: "discoveryNote", rows: "2", maxlength: "900", placeholder: "Why (required, Admin-only)" });
    const status = el("p", { className: "form-status", role: "status" });
    const apply = async () => {
      if (!select.value || !note.value.trim()) {
        status.textContent = "Choose an option and add a note.";
        status.dataset.tone = "error";
        (select.value ? note : select).focus();
        return;
      }
      const result = await api.callAdmin(`/api/v1/admin/links/${encodeURIComponent(record.canonicalCode)}/discovery`, {
        method: "POST",
        body: { decision: select.value, note: note.value.trim() },
      });
      if (!result.ok) {
        if (await handleAuthFailure(result)) return;
        status.textContent = failureText(result, "The discovery setting could not be changed.");
        status.dataset.tone = "error";
        return;
      }
      await openRecord(record.canonicalCode);
      api.setStatus(result.body.changed ? "Discovery setting changed." : "Discovery setting was already in place; nothing changed.");
    };
    return el("div", { className: "field admin-discovery" }, [
      el("label", { for: "discoveryDecision", text: "Public discovery override" }),
      select,
      note,
      el("p", { className: "admin-help", text: "Requires a sign-in within the last 15 minutes. Every change is recorded." }),
      el("button", { type: "button", className: "admin-signout", text: "Apply", onclick: apply }),
      status,
    ]);
  }

  async function reveal(code) {
    const result = await api.callAdmin(`/api/v1/admin/links/${encodeURIComponent(code)}/reveal`, { method: "POST", body: {} });
    const target = $("recordDestination");
    if (!result.ok) {
      if (await handleAuthFailure(result)) return;
      target.append(el("p", { className: "form-status", "data-tone": "error", text: failureText(result, "Reveal failed.") }));
      return;
    }
    target.replaceChildren(el("code", { className: "admin-secret", text: result.body.fullDestinationUrl }),
      el("p", { className: "admin-help", text: "Reveal recorded in the audit history." }));
  }

  // ── Case triage / resolve (Order 58) ────────────────────────────
  function renderCaseActions(openCase) {
    const note = el("textarea", { id: "caseNote", rows: "2", maxlength: "1000", placeholder: "Note for the audit history (required)" });
    const status = el("p", { className: "form-status", role: "status" });
    const act = (action) => async () => {
      if (!note.value.trim()) {
        status.textContent = "Add a note first.";
        status.dataset.tone = "error";
        note.focus();
        return;
      }
      const result = await api.callAdmin(`/api/v1/admin/cases/${openCase.caseId}/transition`, { method: "POST", body: { action, note: note.value.trim() } });
      if (!result.ok) {
        if (await handleAuthFailure(result)) return;
        status.textContent = failureText(result, "The case could not be updated.");
        status.dataset.tone = "error";
        return;
      }
      await openRecord(view.code);
      api.setStatus(action === "resolve" ? "Case resolved." : "Case marked triaged.");
    };
    return el("div", { className: "field admin-case-actions" }, [
      el("label", { for: "caseNote", text: `Open case · ${openCase.priority} · ${openCase.caseState}` }),
      note,
      el("div", { className: "admin-actions" }, [
        el("button", { type: "button", className: "admin-signout", text: "Mark triaged", onclick: act("triage") }),
        el("button", { type: "button", className: "admin-signout", text: "Resolve case", onclick: act("resolve") }),
      ]),
      status,
    ]);
  }

  // ── Disable / restore (Orders 59-60) ────────────────────────────
  function renderModeration(record) {
    const disabling = record.lifecycleState === "active";
    if (record.lifecycleState === "deleted") return null;
    const options = disabling ? DISABLE_REASONS : RESTORE_REASONS;
    const select = el("select", { id: "moderationReason", required: "required" }, [
      el("option", { value: "", text: "Choose a reason" }),
      ...options.map(([value, label]) => el("option", { value, text: label })),
    ]);
    const detail = el("textarea", { id: "moderationDetail", rows: "2", maxlength: "1000", placeholder: "Optional detail (Admin-only)" });
    const status = el("p", { className: "form-status", role: "status" });
    const blocked = !disabling && record.safetyState !== "approved";
    const button = el("button", {
      type: "button",
      className: disabling ? "cta admin-danger" : "cta",
      text: disabling ? "Disable link…" : "Re-enable link…",
      disabled: blocked ? "disabled" : null,
      onclick: () => confirmModeration(record.canonicalCode, disabling ? "disable" : "restore", select, detail, status),
    });
    // A new intent gets a new Idempotency-Key; retries of the same intent reuse it.
    const reset = () => { view.pendingKey = null; };
    select.addEventListener("change", reset);
    detail.addEventListener("input", reset);
    return el("div", { className: "field admin-moderation" }, [
      el("label", { for: "moderationReason", text: disabling ? "Disable this link" : "Re-enable this link" }),
      select,
      detail,
      blocked ? el("p", { className: "form-status", "data-tone": "error", text: `Re-enable is not allowed while safety is ${record.safetyState}.` }) : null,
      el("p", { className: "admin-help", text: "Requires a sign-in within the last 15 minutes. Every action is recorded." }),
      button,
      status,
    ]);
  }

  function confirmModeration(code, action, select, detail, status) {
    if (!select.value) {
      status.textContent = "Choose a reason first.";
      status.dataset.tone = "error";
      select.focus();
      return;
    }
    const dialog = $("moderationConfirm");
    $("moderationConfirmText").textContent =
      `${action === "disable" ? "Disable" : "Re-enable"} op4n.me/${code} with reason “${select.selectedOptions[0].textContent}”?` +
      (action === "disable" ? " The short link will show the unavailable page." : " The short link will redirect again.");
    $("moderationConfirmGo").textContent = action === "disable" ? "Disable link" : "Re-enable link";
    $("moderationConfirmGo").onclick = async () => {
      $("moderationConfirmGo").disabled = true;
      view.pendingKey = view.pendingKey || crypto.randomUUID();
      const result = await api.callAdmin(`/api/v1/admin/links/${encodeURIComponent(code)}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": view.pendingKey },
        body: { reasonCode: select.value, reasonDetail: detail.value.trim() || null },
      });
      $("moderationConfirmGo").disabled = false;
      dialog.close();
      if (!result.ok) {
        if (await handleAuthFailure(result)) return;
        status.textContent = result.code === "SAFETY_HOLD" ? result.message : failureText(result, "The action failed. Nothing changed.");
        status.dataset.tone = "error";
        return;
      }
      view.pendingKey = null;
      await openRecord(code);
      api.setStatus(result.body.changed
        ? `op4n.me/${code} is now ${result.body.lifecycleState}.`
        : `op4n.me/${code} was already ${result.body.lifecycleState}; nothing changed.`);
    };
    dialog.showModal();
  }

  window.op4nAdminTools = {
    start(adminApi) {
      api = adminApi;
      $("adminTools").hidden = false;
      $("adminTab-queue").onclick = () => { showTab("queue"); void loadQueue(1); };
      $("adminTab-lookup").onclick = () => showTab("lookup");
      $("queuePrev").onclick = () => loadQueue(view.page - 1);
      $("queueNext").onclick = () => loadQueue(view.page + 1);
      $("lookupForm").onsubmit = lookup;
      $("moderationConfirmCancel").onclick = () => {
        if (!$("moderationConfirmGo").disabled) $("moderationConfirm").close();
      };
      // The dialog cannot be dismissed with Esc while the action is in flight.
      $("moderationConfirm").oncancel = (event) => {
        if ($("moderationConfirmGo").disabled) event.preventDefault();
      };
      showTab("queue");
      void loadQueue(1);
    },
  };
})();
