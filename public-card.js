(function (global) {
  "use strict";

  // Shared public link card (Feature Inventory Orders 65-68). The creation
  // page, Latest Links, and exact search all render cards through this module,
  // so the read-only rule and the locked Registered previews live in one place.
  //
  // A card is a Guest view of a public link: Copy, Open (through the canonical
  // short URL), aggregate Clicks, and Report. Registered features appear only
  // as locked previews that explain the feature; they never call an API, change
  // data, or generate a real asset. Nothing here implies the Guest owns a link.

  const CAPABILITY = Object.freeze({
    GUEST_ACTION: "guest-action",
    REGISTERED_PREVIEW: "registered-preview",
  });

  // Approved Registered previews (Product Plan). Copy explains the benefit
  // only: no pricing, Paid, or Premium wording.
  const REGISTERED_FEATURES = Object.freeze([
    Object.freeze({
      id: "qr",
      label: "QR Code",
      icon: "qr_code_2",
      description: "Registered owners will be able to generate, preview, and download a QR code for a link they own.",
    }),
    Object.freeze({
      id: "edit",
      label: "Edit link",
      icon: "edit",
      description: "Registered owners will be able to update the title and destination of links they created while signed in.",
    }),
    Object.freeze({
      id: "privacy",
      label: "Privacy / Visibility",
      icon: "visibility",
      description: "Registered owners will be able to choose Public or Unlisted visibility for links they own.",
    }),
    Object.freeze({
      id: "settings",
      label: "Link Settings",
      icon: "tune",
      description: "Registered owners will be able to manage settings for links they own.",
    }),
    Object.freeze({
      id: "alias",
      label: "Custom alias",
      icon: "ink_pen",
      description: "Registered owners will be able to add a memorable custom alias to a link they own. An alias is a renewable lease that points to the owned link, free and renewed manually during the beta; the original short link keeps working.",
    }),
    Object.freeze({
      id: "analytics",
      label: "Detailed analytics",
      icon: "query_stats",
      description: "Registered owners will be able to explore detailed performance for links they own.",
    }),
  ]);

  const PUBLIC_CARD_CAPABILITIES = Object.freeze({
    guestActions: Object.freeze(["copy", "open", "clicks", "report"]),
    registeredPreviews: REGISTERED_FEATURES,
  });

  const SIGN_UP_MESSAGE = "Accounts are coming soon. Nothing about this link has changed.";
  const COPY_CONFIRMATION_MS = 1600;
  const clickNumberFormat = new Intl.NumberFormat("en-US");

  const DIALOGS_HTML = `
    <dialog class="capability-dialog" id="capabilityDialog" aria-labelledby="capabilityDialogTitle" aria-describedby="capabilityDialogDescription">
      <button class="capability-dialog-close" type="button" id="capabilityDialogClose" aria-label="Close feature preview">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <p class="capability-dialog-label">
        <span class="material-symbols-outlined" aria-hidden="true">lock</span>
        Registered to unlock
      </p>
      <h2 id="capabilityDialogTitle">Feature preview</h2>
      <p id="capabilityDialogDescription"></p>
      <section class="qr-showcase" id="qrShowcase" aria-label="Non-live QR feature showcase" hidden>
        <div class="qr-showcase-tabs" aria-label="QR showcase sections">
          <button type="button" disabled aria-disabled="true">Preview</button>
          <button type="button" disabled aria-disabled="true">Settings</button>
        </div>
        <div class="qr-placeholder" role="img" aria-label="Non-live QR placeholder; this image does not encode a link">
          <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
          <strong>NON-LIVE<br />SAMPLE</strong>
        </div>
        <p class="qr-showcase-lock"><span class="material-symbols-outlined" aria-hidden="true">lock</span> Registered to unlock</p>
        <ul id="qrShowcaseFeatures"></ul>
        <button class="qr-download-disabled" type="button" disabled aria-disabled="true">Download QR Code</button>
      </section>
      <div class="capability-dialog-actions">
        <button type="button" class="capability-secondary" id="capabilityNotNow">Not now</button>
        <button type="button" class="capability-primary" id="capabilitySignup">Sign Up</button>
      </div>
    </dialog>

    <dialog class="capability-dialog report-dialog" id="reportDialog" aria-labelledby="reportDialogTitle" aria-describedby="reportDialogDescription">
      <button class="capability-dialog-close" type="button" id="reportDialogClose" aria-label="Close report form">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <p class="capability-dialog-label">
        <span class="material-symbols-outlined" aria-hidden="true">flag</span>
        Guest action
      </p>
      <h2 id="reportDialogTitle">Report this link</h2>
      <p id="reportDialogDescription">Tell us why this public link should be reviewed. We read every report.</p>
      <form class="report-form" id="reportForm" novalidate>
        <div class="field">
          <label for="reportCategory">What's wrong?</label>
          <select id="reportCategory" name="reasonCategory" required aria-describedby="reportCategoryError">
            <option value="">Choose a reason</option>
            <option value="phishing">Phishing or fake login</option>
            <option value="malware">Malware or harmful download</option>
            <option value="child_safety">Child sexual abuse or exploitation</option>
            <option value="illegal">Illegal content</option>
            <option value="impersonation">Impersonation or trademark misuse</option>
            <option value="abuse">Harassment, hate, or scam</option>
            <option value="spam">Spam</option>
            <option value="other">Something else</option>
          </select>
          <p class="field-error" id="reportCategoryError" aria-live="polite"></p>
        </div>
        <div class="field">
          <label for="reportReason">Details (optional)</label>
          <textarea id="reportReason" name="detail" rows="4" maxlength="1000" aria-describedby="reportReasonCount reportReasonError" placeholder="Anything that helps us review this link"></textarea>
          <p class="field-hint report-count" id="reportReasonCount" aria-live="off">0 / 1000</p>
          <p class="field-error" id="reportReasonError" aria-live="polite"></p>
        </div>
        <p class="report-status" id="reportStatus" role="status" aria-live="polite"></p>
        <div class="capability-dialog-actions">
          <button type="button" class="capability-secondary" id="reportCancel">Cancel</button>
          <button type="submit" class="capability-primary" id="reportSubmit">Submit report</button>
        </div>
      </form>
    </dialog>`;

  const state = {
    activeDialogTrigger: null,
    activeReportTrigger: null,
    activeReportLink: null,
    reportInFlight: false,
    reportRequest: null,
  };
  let el = null;

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getShortLink(link) {
    return link.shortUrl || `https://op4n.me/${link.code || link.shortCode}`;
  }

  // Visible short URL without the scheme (op4n.me/CODE). Copy and Open always
  // use the full canonical URL.
  function splitShortUrl(url) {
    const match = String(url).match(/^(https?:\/\/)(.*)$/);
    return match ? { scheme: match[1], display: match[2] } : { scheme: "", display: String(url) };
  }

  function getSafeHttpUrl(value) {
    try {
      const parsedUrl = new URL(String(value));
      return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl.href : "";
    } catch {
      return "";
    }
  }

  function withSupportReference(message, error) {
    const requestId = typeof error?.requestId === "string" ? error.requestId : "";
    return requestId ? `${message} (Ref ${requestId.slice(0, 8)})` : message;
  }

  // Aggregate total of successful redirects. "Clicks", never people or visitors.
  // A missing or invalid value is shown as unavailable rather than 0.
  function hasClickCount(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  function formatClicks(value) {
    if (!hasClickCount(value)) return "— clicks";
    return `${clickNumberFormat.format(value)} ${value === 1 ? "click" : "clicks"}`;
  }

  function describeClicks(value) {
    return hasClickCount(value) ? formatClicks(value) : "Click count temporarily unavailable";
  }

  function announce(statusElement, message) {
    statusElement.textContent = "";
    global.requestAnimationFrame(() => {
      statusElement.textContent = message;
    });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Continue to the in-page fallback.
      }
    }

    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.readOnly = true;
    fallback.className = "clipboard-fallback";
    fallback.setAttribute("aria-label", "Short link to copy");
    document.body.append(fallback);
    fallback.select();
    fallback.setSelectionRange(0, value.length);
    let copied = false;
    try {
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      copied = false;
    }
    fallback.remove();
    return copied;
  }

  // Final copy fallback: a visible, pre-selected field inside the card.
  function showCopyFallback(card, value) {
    let field = card.querySelector(".copy-fallback-field");
    if (!field) {
      const wrapper = document.createElement("div");
      wrapper.className = "copy-fallback";
      const label = document.createElement("label");
      label.textContent = "Press Ctrl/Cmd+C to copy";
      field = document.createElement("input");
      field.type = "text";
      field.readOnly = true;
      field.className = "copy-fallback-field";
      field.value = value;
      label.htmlFor = field.id = `copy-fallback-${card.dataset.linkId}`.replace(/[^A-Za-z0-9_-]/g, "-");
      wrapper.append(label, field);
      card.querySelector(".link-card-toolbar").after(wrapper);
    }
    field.focus();
    field.select();
  }

  // link: the shared card view model {id, code, title, shortUrl, openUrl,
  // destinationSummary, clickCount, source}. The full destination is never
  // part of it.
  function createPublicCard(link, capabilities = PUBLIC_CARD_CAPABILITIES) {
    const card = document.createElement("article");
    card.className = `link-card public-link-card${link.source === "example" ? " is-example" : ""}`;
    card.dataset.linkId = link.id;
    card.dataset.capability = CAPABILITY.GUEST_ACTION;

    const shortLink = getShortLink(link);
    const { scheme: shortScheme, display: shortDisplay } = splitShortUrl(shortLink);
    const safeShortScheme = escapeHTML(shortScheme);
    const safeShortDisplay = escapeHTML(shortDisplay);
    // Open navigates through the canonical short URL (openUrl), so the
    // redirect service resolves the stored destination and counts the click.
    // The summary is the server-approved r1-safe-path-v1 display value.
    const openUrl = getSafeHttpUrl(link.openUrl);
    const destinationSummary = openUrl ? String(link.destinationSummary || "") : "";
    const safeTitle = escapeHTML(link.title || "Untitled link");
    const safeDestinationSummary = escapeHTML(destinationSummary);
    const safeShortLink = escapeHTML(shortLink);
    const exampleLabel = link.source === "example"
      ? '<div class="link-example-label">Example</div>'
      : "";

    card.innerHTML = `
      ${exampleLabel}
      <div class="link-row public-link-summary">
        <div class="link-drag" aria-hidden="true">
          <span class="material-symbols-outlined">link</span>
        </div>
        <div class="link-info">
          <div class="link-title-row">
            <span class="link-title" title="${safeTitle}">${safeTitle}</span>
          </div>
          <div class="link-short-row">
            <span class="link-short-url"><span class="sr-only">${safeShortScheme}</span>${safeShortDisplay}</span>
          </div>
          <div class="link-url-row link-destination-field">
            <span class="link-field-label">Destination URL :</span>
            ${openUrl ? `<a class="link-url open-destination-btn" href="${escapeHTML(openUrl)}" target="_blank" rel="noopener noreferrer" title="${safeDestinationSummary}" aria-label="Open destination ${safeDestinationSummary} in a new tab">
              ${safeDestinationSummary}
            </a>` : '<span class="link-url">Destination unavailable</span>'}
          </div>
        </div>
      </div>

      <div class="link-card-toolbar" aria-label="Link actions">
        <div class="guest-action-row">
          ${capabilities.guestActions.includes("clicks") ? `<button class="guest-action-button public-click-count click-count-btn" type="button" data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Clicks" aria-label="View aggregate clicks: ${describeClicks(link.clickCount)}">
            <span class="material-symbols-outlined" aria-hidden="true">bar_chart</span>
            <strong>${formatClicks(link.clickCount)}</strong>
          </button>` : ""}
          ${capabilities.guestActions.includes("copy") ? `<button class="guest-action-button copy-link-btn" type="button" data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Copy link" aria-label="Copy short link ${safeShortDisplay}">
            <span class="material-symbols-outlined copy-icon" aria-hidden="true">content_copy</span>
            <span class="sr-only action-label">Copy short link</span>
          </button>` : ""}
          ${capabilities.guestActions.includes("open") && openUrl ? `<a class="guest-action-button open-destination-btn" href="${escapeHTML(openUrl)}" target="_blank" rel="noopener noreferrer"
             data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Open destination" aria-label="Open destination ${safeDestinationSummary} in a new tab">
            <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
            <span class="sr-only">Open destination</span>
          </a>` : ""}
          ${capabilities.guestActions.includes("report") ? `<button class="guest-action-button report-link-btn" type="button" data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Report link" aria-label="Report ${safeShortLink}">
            <span class="material-symbols-outlined" aria-hidden="true">flag</span>
            <span class="sr-only">Report link</span>
          </button>` : ""}
        </div>
        <div class="registered-preview-grid" aria-label="Registered feature previews">
          ${capabilities.registeredPreviews.map((feature) => `
            <button
              class="registered-preview-button"
              type="button"
              data-access="${CAPABILITY.REGISTERED_PREVIEW}"
              data-feature="${feature.id}"
              data-tooltip="${feature.label} — Registered to unlock"
              aria-disabled="true"
              aria-label="${feature.label} — Registered to unlock"
            >
              <span class="material-symbols-outlined" aria-hidden="true">${feature.icon}</span>
              <span class="sr-only">${feature.label} — Registered to unlock</span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="card-live-status" role="status" aria-live="polite"></div>
    `;

    let copyResetTimer = 0;
    card.querySelector(".copy-link-btn")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = card.querySelector(".card-live-status");
      const copied = await copyText(shortLink);
      if (!copied) {
        showCopyFallback(card, shortLink);
        announce(status, "Copy isn't available here. The short link is selected; press Ctrl or Cmd+C.");
        return;
      }
      button.querySelector(".action-label").textContent = "Copied";
      button.querySelector(".copy-icon").textContent = "check";
      button.dataset.tooltip = "Copied";
      button.classList.add("is-copied");
      button.setAttribute("aria-label", `Copied ${shortDisplay}`);
      announce(status, `Copied ${shortDisplay}`);
      global.clearTimeout(copyResetTimer);
      copyResetTimer = global.setTimeout(() => {
        button.querySelector(".action-label").textContent = "Copy short link";
        button.querySelector(".copy-icon").textContent = "content_copy";
        button.dataset.tooltip = "Copy link";
        button.classList.remove("is-copied");
        button.setAttribute("aria-label", `Copy short link ${shortDisplay}`);
      }, COPY_CONFIRMATION_MS);
    });

    card.querySelector(".click-count-btn")?.addEventListener("click", () => {
      card.querySelector(".card-live-status").textContent =
        hasClickCount(link.clickCount)
          ? `This public link has ${formatClicks(link.clickCount)}.`
          : "Click count temporarily unavailable.";
    });

    card.querySelector(".report-link-btn")?.addEventListener("click", () => {
      openReportDialog(link, card.querySelector(".report-link-btn"));
    });

    // Registered previews only open the explanation dialog.
    card.querySelectorAll(`[data-access="${CAPABILITY.REGISTERED_PREVIEW}"]`).forEach((button) => {
      button.addEventListener("click", () => {
        const feature = capabilities.registeredPreviews.find((item) => item.id === button.dataset.feature);
        openCapabilityDialog(feature, button);
      });
    });

    return card;
  }

  // ── Registered preview dialog ────────────────────────────────────────
  function openCapabilityDialog(feature, trigger) {
    if (!feature) return;
    state.activeDialogTrigger = trigger;
    el.capabilityDialogTitle.textContent = feature.label;
    const isQrShowcase = feature.id === "qr";
    el.qrShowcase.hidden = !isQrShowcase;
    el.capabilityDialogDescription.textContent = isQrShowcase && global.OP4N_QR_SHOWCASE
      ? global.OP4N_QR_SHOWCASE.description
      : feature.description;
    el.qrShowcaseFeatures.replaceChildren();
    if (isQrShowcase && global.OP4N_QR_SHOWCASE) {
      global.OP4N_QR_SHOWCASE.features.forEach((item) => {
        const listItem = document.createElement("li");
        listItem.textContent = item;
        el.qrShowcaseFeatures.append(listItem);
      });
    }
    el.capabilitySignup.textContent = "Sign Up";
    el.capabilityDialog.showModal();
  }

  function closeCapabilityDialog() {
    el.capabilityDialog.close();
    state.activeDialogTrigger?.focus();
  }

  // ── Report dialog ────────────────────────────────────────────────────
  function setReportStatus(message = "", status = "idle") {
    el.reportStatus.textContent = message;
    el.reportStatus.dataset.status = status;
  }

  function updateReportCount() {
    el.reportReasonCount.textContent = `${el.reportReason.value.length} / 1000`;
  }

  function openReportDialog(link, trigger) {
    state.activeReportTrigger = trigger;
    state.activeReportLink = link;
    state.reportRequest = null;
    el.reportForm.reset();
    el.reportCategoryError.textContent = "";
    el.reportCategory.setAttribute("aria-invalid", "false");
    el.reportReasonError.textContent = "";
    el.reportReason.setAttribute("aria-invalid", "false");
    el.reportSubmit.disabled = false;
    el.reportSubmit.textContent = "Submit report";
    updateReportCount();
    setReportStatus();
    el.reportDialog.showModal();
    el.reportCategory.focus();
  }

  function getReportErrorMessage(error) {
    switch (error?.code) {
      case "RATE_LIMITED":
        return "You've sent several reports recently. Please try again later.";
      case "LINK_NOT_FOUND":
        return "This link can no longer be reported.";
      case "FEATURE_UNAVAILABLE":
        return "Reporting is temporarily paused. Please try again later.";
      case "VALIDATION_ERROR":
        return "Check the reason and try again.";
      default:
        return withSupportReference("We couldn't send your report. Your answers are still here; please try again.", error);
    }
  }

  function closeReportDialog() {
    if (state.reportInFlight) return;
    el.reportDialog.close();
  }

  async function handleReportSubmit(event) {
    event.preventDefault();
    if (state.reportInFlight || !state.activeReportLink) return;

    const reasonCategory = el.reportCategory.value;
    const detail = el.reportReason.value.trim();
    el.reportCategoryError.textContent = reasonCategory ? "" : "Choose a reason before submitting.";
    el.reportCategory.setAttribute("aria-invalid", String(!reasonCategory));
    el.reportReasonError.textContent = detail.length > 1000 ? "Use 1,000 characters or fewer." : "";
    el.reportReason.setAttribute("aria-invalid", String(detail.length > 1000));
    if (!reasonCategory) {
      el.reportCategory.focus();
      return;
    }
    if (detail.length > 1000) {
      el.reportReason.focus();
      return;
    }

    // One report intent, one Idempotency-Key: retrying the same answers reuses it.
    const previous = state.reportRequest;
    const canonicalCode = state.activeReportLink.code;
    const sameIntent = previous && previous.canonicalCode === canonicalCode &&
      previous.reasonCategory === reasonCategory && previous.detail === detail;
    state.reportRequest = {
      requestId: sameIntent ? previous.requestId : global.crypto.randomUUID(),
      canonicalCode,
      reasonCategory,
      detail,
    };

    const prototype = Boolean(global.op4nReportService?.isPrototype);
    state.reportInFlight = true;
    el.reportDialog.setAttribute("aria-busy", "true");
    el.reportSubmit.disabled = true;
    el.reportSubmit.textContent = "Submitting…";
    setReportStatus(prototype ? "Simulating report submission…" : "Sending your report…", "submitting");
    let completed = false;

    try {
      const receipt = await global.op4nReportService.submitReport(state.reportRequest);
      setReportStatus(
        prototype
          ? "Report simulated in this prototype only. No Admin or production server received it."
          : `Thanks — we received your report (Ref ${String(receipt.receiptId).slice(0, 8)}). Questions? support@op4n.com`,
        "success"
      );
      completed = true;
      el.reportSubmit.textContent = prototype ? "Simulated" : "Sent";
    } catch (error) {
      setReportStatus(getReportErrorMessage(error), "error");
      el.reportSubmit.textContent = "Retry report";
    } finally {
      state.reportInFlight = false;
      el.reportDialog.setAttribute("aria-busy", "false");
      el.reportSubmit.disabled = completed;
    }
  }

  // Adds the shared dialogs to the page once and wires their listeners.
  function init() {
    if (el) return;
    if (!document.getElementById("capabilityDialog")) {
      document.body.insertAdjacentHTML("beforeend", DIALOGS_HTML);
    }
    const byId = (id) => document.getElementById(id);
    el = Object.fromEntries([
      "capabilityDialog", "capabilityDialogTitle", "capabilityDialogDescription", "capabilityDialogClose",
      "capabilityNotNow", "capabilitySignup", "qrShowcase", "qrShowcaseFeatures", "reportDialog",
      "reportDialogClose", "reportCancel", "reportForm", "reportCategory", "reportCategoryError",
      "reportReasonCount", "reportReason", "reportReasonError", "reportStatus", "reportSubmit",
    ].map((id) => [id, byId(id)]));

    el.capabilityDialogClose.addEventListener("click", closeCapabilityDialog);
    el.capabilityNotNow.addEventListener("click", closeCapabilityDialog);
    el.capabilitySignup.addEventListener("click", () => {
      el.capabilityDialogDescription.textContent = SIGN_UP_MESSAGE;
    });
    el.capabilityDialog.addEventListener("close", () => state.activeDialogTrigger?.focus());
    el.reportDialogClose.addEventListener("click", closeReportDialog);
    el.reportCancel.addEventListener("click", closeReportDialog);
    el.reportForm.addEventListener("submit", handleReportSubmit);
    el.reportCategory.addEventListener("change", () => {
      if (el.reportCategory.value) {
        el.reportCategoryError.textContent = "";
        el.reportCategory.setAttribute("aria-invalid", "false");
      }
    });
    el.reportReason.addEventListener("input", () => {
      updateReportCount();
      if (el.reportReason.value.length <= 1000) {
        el.reportReasonError.textContent = "";
        el.reportReason.setAttribute("aria-invalid", "false");
      }
    });
    el.reportDialog.addEventListener("cancel", (event) => {
      if (state.reportInFlight) event.preventDefault();
    });
    el.reportDialog.addEventListener("close", () => {
      state.activeReportTrigger?.focus();
      state.activeReportTrigger = null;
      state.activeReportLink = null;
    });
  }

  global.op4nPublicCard = Object.freeze({
    CAPABILITY,
    REGISTERED_FEATURES,
    PUBLIC_CARD_CAPABILITIES,
    SIGN_UP_MESSAGE,
    createPublicCard,
    escapeHTML,
    init,
    withSupportReference,
  });
})(globalThis);
