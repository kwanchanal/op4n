(() => {
  "use strict";

  const CAPABILITY = Object.freeze({
    GUEST_ACTION: "guest-action",
    REGISTERED_PREVIEW: "registered-preview",
  });

  const REGISTERED_FEATURES = Object.freeze([
    {
      id: "qr",
      label: "QR Code",
      icon: "qr_code_2",
      description: "Registered owners will be able to generate, preview, and download a QR code for a link they own.",
    },
    {
      id: "edit",
      label: "Edit link",
      icon: "edit",
      description: "Registered owners will be able to update the title and destination of links they created while signed in.",
    },
    {
      id: "privacy",
      label: "Privacy / Visibility",
      icon: "visibility",
      description: "Registered owners will be able to choose Public or Unlisted visibility for links they own.",
    },
    {
      id: "settings",
      label: "Link Settings",
      icon: "tune",
      description: "Registered owners will be able to manage settings for links they own.",
    },
    {
      id: "slug",
      label: "Custom Slug",
      icon: "ink_pen",
      description: "Registered owners will be able to choose a memorable back-half for an owned link.",
    },
    {
      id: "analytics",
      label: "Detailed analytics",
      icon: "query_stats",
      description: "Registered owners will be able to explore detailed performance for links they own.",
    },
  ]);

  const PUBLIC_CARD_CAPABILITIES = Object.freeze({
    guestActions: Object.freeze(["copy", "open", "clicks", "report"]),
    registeredPreviews: REGISTERED_FEATURES,
  });

  const state = {
    activeFilter: "created",
    createdLinks: [],
    createdLinksLoaded: false,
    createPhase: "idle",
    rateLimitedUntil: 0,
    rateLimitTimer: 0,
    createInFlight: false,
    lastCreateRequest: null,
    activeDialogTrigger: null,
    activeReportTrigger: null,
    activeReportLink: null,
    reportInFlight: false,
    reportRequestNumber: 0,
  };

  const elements = {
    appShell: document.getElementById("appShell"),
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    topbarAddBtn: document.getElementById("topbarAddBtn"),
    topbarPromptText: document.getElementById("topbarPromptText"),
    bannerText: document.getElementById("bannerText"),
    linkForm: document.getElementById("linkForm"),
    linkTitle: document.getElementById("linkTitle"),
    linkTitleError: document.getElementById("linkTitleError"),
    linkUrl: document.getElementById("linkUrl"),
    linkUrlError: document.getElementById("linkUrlError"),
    createSubmit: document.querySelector("[data-create-submit]"),
    formStatus: document.getElementById("formStatus"),
    formRetryButton: document.getElementById("formRetryButton"),
    linksList: document.getElementById("linksList"),
    filterButtons: Array.from(document.querySelectorAll("[data-link-filter]")),
    capabilityDialog: document.getElementById("capabilityDialog"),
    capabilityDialogTitle: document.getElementById("capabilityDialogTitle"),
    capabilityDialogDescription: document.getElementById("capabilityDialogDescription"),
    capabilityDialogClose: document.getElementById("capabilityDialogClose"),
    capabilityNotNow: document.getElementById("capabilityNotNow"),
    capabilitySignup: document.getElementById("capabilitySignup"),
    qrShowcase: document.getElementById("qrShowcase"),
    qrShowcaseFeatures: document.getElementById("qrShowcaseFeatures"),
    reportDialog: document.getElementById("reportDialog"),
    reportDialogClose: document.getElementById("reportDialogClose"),
    reportCancel: document.getElementById("reportCancel"),
    reportForm: document.getElementById("reportForm"),
    reportReason: document.getElementById("reportReason"),
    reportReasonError: document.getElementById("reportReasonError"),
    reportStatus: document.getElementById("reportStatus"),
    reportSubmit: document.getElementById("reportSubmit"),
    adPanel: document.getElementById("adPanel"),
    adSheetHandle: document.getElementById("adSheetHandle"),
    adPanelShowcase: document.getElementById("adPanelShowcase"),
    adPanelClose: document.getElementById("adPanelClose"),
    adYouWord: document.getElementById("adYouWord"),
    adContactTrigger: document.getElementById("adContactTrigger"),
    adContactBackdrop: document.getElementById("adContactBackdrop"),
    adContactSheet: document.getElementById("adContactSheet"),
    adContactClose: document.getElementById("adContactClose"),
    adContactForm: document.getElementById("adContactForm"),
    adContactEmail: document.getElementById("adContactEmail"),
    adContactMessage: document.getElementById("adContactMessage"),
  };

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

  // Prototype-only wording is shown only while the deterministic mock adapter
  // is active; the http adapter never shows it.
  function isPrototypeService() {
    return Boolean(window.op4nLinkService?.isPrototype);
  }

  function newRequestId() {
    return window.crypto.randomUUID();
  }

  function setUrlError(message = "") {
    elements.linkUrlError.textContent = message;
    elements.linkUrl.setAttribute("aria-invalid", String(Boolean(message)));
  }

  function setTitleError(message = "") {
    elements.linkTitleError.textContent = message;
    elements.linkTitle.setAttribute("aria-invalid", String(Boolean(message)));
  }

  const {
    validateDestinationUrlInput: validateDestination,
    validateTitleInput: validateTitle,
  } = window.op4nDestinationUrlValidation;

  const CREATE_TIMEOUT_MS = 15000;
  const COPY_CONFIRMATION_MS = 1600;

  function setCreatePhase(phase, message = "", options = {}) {
    const creating = phase === "creating";
    state.createPhase = phase;
    elements.linkForm.dataset.state = phase;
    elements.linkForm.setAttribute("aria-busy", String(creating));
    elements.createSubmit.disabled = creating || isRateLimited();
    elements.createSubmit.textContent = creating ? "Creating link…" : "Make Link";
    // Inputs stay readable but cannot drift while a request is unresolved.
    elements.linkUrl.readOnly = creating;
    elements.linkTitle.readOnly = creating;
    elements.formStatus.textContent = message;
    elements.formStatus.dataset.status = phase;
    elements.formRetryButton.hidden = !options.canRetry;
  }

  const RETRYABLE_ERROR = "Something went wrong while creating your link. Your details are still here.";
  const FINAL_ERROR = "We couldn't create this link. Check the details, then try again later.";

  // Maps R1 API error codes (the mock emits the same codes) to user-facing
  // copy. Raw server messages are never shown.
  function getCreateErrorPresentation(error) {
    switch (error?.code) {
      case "DEPENDENCY_UNAVAILABLE":
        return { message: "Link creation is temporarily unavailable. Try again in a moment.", canRetry: true };
      case "INTERNAL_ERROR":
      case "NETWORK_ERROR":
      case "CLIENT_TIMEOUT":
        return { message: RETRYABLE_ERROR, canRetry: true };
      case "FEATURE_UNAVAILABLE":
        return { message: "Link creation is temporarily paused. Please try again later.", canRetry: false };
      case "IDEMPOTENCY_CONFLICT":
        return { message: RETRYABLE_ERROR, canRetry: true, rotateKey: true };
      default:
        return { message: FINAL_ERROR, canRetry: false };
    }
  }

  // Server-side destination rejections are shown inline under the URL field.
  const BLOCKED_DESTINATION_MESSAGE =
    "This destination can't be shortened on Op4n.com because it may be unsafe. " +
    "If you think this is a mistake, contact support@op4n.com.";

  function isRateLimited() {
    return state.rateLimitedUntil > Date.now();
  }

  function describeWait(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "in a few minutes";
    if (seconds < 60) return "in a minute";
    const minutes = Math.ceil(seconds / 60);
    return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  // 429: explain the wait, keep input, and re-enable Make Link automatically.
  // Only the wait time is shown, never limiter internals.
  function startRateLimitCooldown(error) {
    const seconds = Number(error?.retryAfter);
    const known = Number.isFinite(seconds) && seconds > 0;
    const waitMs = (known ? seconds : 300) * 1000;
    state.rateLimitedUntil = Date.now() + waitMs;
    setCreatePhase(
      "error",
      withSupportReference(
        `You've reached the limit for new links. You can make another ${describeWait(known ? seconds : NaN)}.`,
        error,
      ),
    );
    window.clearTimeout(state.rateLimitTimer);
    state.rateLimitTimer = window.setTimeout(() => {
      state.rateLimitedUntil = 0;
      setCreatePhase("idle", "You can make a link again.");
    }, waitMs);
  }

  function getInlineDestinationError(error) {
    if (error?.code === "DESTINATION_BLOCKED") return BLOCKED_DESTINATION_MESSAGE;
    if (error?.code === "UNSUPPORTED_PROTOCOL") return "Only HTTP and HTTPS destination URLs are supported.";
    if (error?.code === "VALIDATION_ERROR" && error.fields?.includes("destinationUrl")) {
      return "Check this URL and try again.";
    }
    return "";
  }

  function withSupportReference(message, error) {
    const requestId = typeof error?.requestId === "string" ? error.requestId : "";
    return requestId ? `${message} (Ref ${requestId.slice(0, 8)})` : message;
  }

  const clickNumberFormat = new Intl.NumberFormat("en-US");

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

  function announce(statusElement, message) {
    statusElement.textContent = "";
    window.requestAnimationFrame(() => {
      statusElement.textContent = message;
    });
  }

  function setFilter(filter) {
    state.activeFilter = filter;
    elements.filterButtons.forEach((button) => {
      const active = button.dataset.linkFilter === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    void renderLinks();
  }

  function getCreatedLinksForDisplay() {
    return state.createdLinks
      .map((link, index) => ({ link, index }))
      .sort((a, b) => Number(Boolean(b.link.pinned)) - Number(Boolean(a.link.pinned)) || a.index - b.index)
      .map(({ link }) => link);
  }

  async function renderLinks() {
    const records = getCreatedLinksForDisplay();
    elements.linksList.innerHTML = "";

    if (state.activeFilter === "created" && !state.createdLinksLoaded) {
      const loading = document.createElement("div");
      loading.className = "guest-empty-state";
      loading.dataset.state = "loading";
      loading.textContent = isPrototypeService()
        ? "Loading deterministic prototype links…"
        : "Loading links…";
      elements.linksList.append(loading);
      try {
        const response = await window.op4nLinkService.listCreatedLinks();
        if (state.activeFilter !== "created") return;
        state.createdLinks = response.links;
        state.createdLinksLoaded = true;
        return renderLinks();
      } catch {
        if (state.activeFilter !== "created") return;
        elements.linksList.innerHTML = "";
        const error = document.createElement("div");
        error.className = "guest-empty-state guest-error-state";
        error.dataset.state = "error";
        error.textContent = isPrototypeService()
          ? "Prototype Created Links could not be loaded. Switch views and try again."
          : "Links could not be loaded. Reload the page and try again.";
        elements.linksList.append(error);
        return;
      }
    }

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "guest-empty-state";
      empty.textContent = isPrototypeService()
        ? "No Created Links in this prototype session yet."
        : "Links you create in this tab will appear here.";
      elements.linksList.append(empty);
      return;
    }

    records.forEach((link) =>
      elements.linksList.append(createPublicCard(link, PUBLIC_CARD_CAPABILITIES))
    );
  }

  function createPublicCard(link, capabilities) {
    const card = document.createElement("article");
    card.className = `link-card public-link-card${link.source === "example" ? " is-example" : ""}`;
    card.dataset.linkId = link.id;
    card.dataset.capability = CAPABILITY.GUEST_ACTION;

    const shortLink = getShortLink(link);
    const { scheme: shortScheme, display: shortDisplay } = splitShortUrl(shortLink);
    const safeShortScheme = escapeHTML(shortScheme);
    const safeShortDisplay = escapeHTML(shortDisplay);
    // The card never holds the full destination: Open navigates through the
    // canonical short URL (openUrl), so the redirect service resolves the
    // stored destination and counts the click. The summary is server-approved.
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
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
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

    card.querySelectorAll('[data-access="registered-preview"]').forEach((button) => {
      button.addEventListener("click", () => {
        const feature = capabilities.registeredPreviews.find((item) => item.id === button.dataset.feature);
        openCapabilityDialog(feature, button);
      });
    });

    return card;
  }

  function openCapabilityDialog(feature, trigger) {
    if (!feature) return;
    state.activeDialogTrigger = trigger;
    elements.capabilityDialogTitle.textContent = feature.label;
    const isQrShowcase = feature.id === "qr";
    elements.qrShowcase.hidden = !isQrShowcase;
    elements.capabilityDialogDescription.textContent = isQrShowcase
      ? window.OP4N_QR_SHOWCASE.description
      : feature.description;
    elements.qrShowcaseFeatures.replaceChildren();
    if (isQrShowcase) {
      window.OP4N_QR_SHOWCASE.features.forEach((item) => {
        const listItem = document.createElement("li");
        listItem.textContent = item;
        elements.qrShowcaseFeatures.append(listItem);
      });
    }
    elements.capabilitySignup.textContent = "Sign Up";
    elements.capabilityDialog.showModal();
  }

  function closeCapabilityDialog() {
    elements.capabilityDialog.close();
    state.activeDialogTrigger?.focus();
  }

  function setReportStatus(message = "", status = "idle") {
    elements.reportStatus.textContent = message;
    elements.reportStatus.dataset.status = status;
  }

  function openReportDialog(link, trigger) {
    state.activeReportTrigger = trigger;
    state.activeReportLink = link;
    elements.reportForm.reset();
    elements.reportReasonError.textContent = "";
    elements.reportReason.setAttribute("aria-invalid", "false");
    elements.reportSubmit.disabled = false;
    elements.reportSubmit.textContent = "Submit report";
    setReportStatus();
    elements.reportDialog.showModal();
    elements.reportReason.focus();
  }

  function closeReportDialog() {
    if (state.reportInFlight) return;
    elements.reportDialog.close();
  }

  async function handleReportSubmit(event) {
    event.preventDefault();
    if (state.reportInFlight || !state.activeReportLink) return;

    const reason = elements.reportReason.value.trim();
    if (!reason) {
      elements.reportReasonError.textContent = "Enter a reason before submitting.";
      elements.reportReason.setAttribute("aria-invalid", "true");
      elements.reportReason.focus();
      return;
    }

    elements.reportReasonError.textContent = "";
    elements.reportReason.setAttribute("aria-invalid", "false");
    state.reportInFlight = true;
    state.reportRequestNumber += 1;
    elements.reportDialog.setAttribute("aria-busy", "true");
    elements.reportSubmit.disabled = true;
    elements.reportSubmit.textContent = "Submitting…";
    setReportStatus("Simulating report submission…", "submitting");
    let completed = false;

    try {
      await window.op4nReportService.submitReport({
        requestId: `prototype-report-${state.reportRequestNumber}`,
        shortUrl: getShortLink(state.activeReportLink),
        reason,
      });
      setReportStatus(
        "Report simulated in this prototype only. No Admin or production server received it.",
        "success"
      );
      completed = true;
      elements.reportSubmit.textContent = "Simulated";
    } catch (error) {
      const messages = {
        MOCK_REPORT_VALIDATION: "Check the reason and try again.",
        MOCK_REPORT_NETWORK: "The prototype is offline. Your reason is preserved; retry when ready.",
        MOCK_REPORT_SERVER: "The prototype report service is unavailable. Your reason is preserved; retry when ready.",
      };
      setReportStatus(
        messages[error?.code] || "The simulated report could not be submitted. Your reason is preserved.",
        "error"
      );
      elements.reportSubmit.textContent = "Retry report";
    } finally {
      state.reportInFlight = false;
      elements.reportDialog.setAttribute("aria-busy", "false");
      elements.reportSubmit.disabled = completed;
    }
  }

  async function createWithTimeout(request) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
    try {
      return await window.op4nLinkService.createLink(request, { signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  // An identical request still being processed is retried once with the same
  // Idempotency-Key after Retry-After (bounded to 1–5 s).
  async function createWithInProgressRetry(request) {
    try {
      return await createWithTimeout(request);
    } catch (error) {
      if (error?.code !== "IDEMPOTENCY_IN_PROGRESS") throw error;
      const waitSeconds = Math.min(Math.max(Number(error.retryAfter) || 1, 1), 5);
      await new Promise((resolve) => window.setTimeout(resolve, waitSeconds * 1000));
      return createWithTimeout(request);
    }
  }

  function focusCreatedCard(linkId) {
    const card = [...elements.linksList.querySelectorAll(".public-link-card")]
      .find((item) => item.dataset.linkId === String(linkId));
    if (!card) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    card.querySelector(".copy-link-btn")?.focus({ preventScroll: true });
  }

  async function submitCreateRequest(request) {
    if (state.createInFlight) return;
    state.createInFlight = true;
    setCreatePhase(
      "creating",
      isPrototypeService() ? "Creating a deterministic prototype link…" : "Creating your short link…"
    );
    let createdLinkId = null;

    try {
      const response = await createWithInProgressRetry(request);
      if (!response?.link?.id || !response.link.shortUrl) {
        const malformedError = new Error("Malformed link response");
        malformedError.code = "MALFORMED_RESPONSE";
        throw malformedError;
      }
      // A replayed response for the same key never adds a second card.
      if (!state.createdLinks.some((link) => link.id === response.link.id)) {
        state.createdLinks.unshift(response.link);
      }
      state.createdLinksLoaded = true;
      state.lastCreateRequest = null;
      createdLinkId = response.link.id;
      setCreatePhase(
        "success",
        isPrototypeService()
          ? "Short link created. This is prototype data only; it is not saved to a production service."
          : "Short link created."
      );
      elements.linkUrl.value = "";
      elements.linkTitle.value = "";
      setUrlError();
      setTitleError();
      setFilter("created");
    } catch (error) {
      if (error?.code === "RATE_LIMITED") {
        startRateLimitCooldown(error);
        return;
      }
      const inlineMessage = getInlineDestinationError(error);
      if (inlineMessage) {
        setCreatePhase("error");
        setUrlError(inlineMessage);
        elements.linkUrl.focus();
        return;
      }
      const presentation = getCreateErrorPresentation(error);
      if (presentation.rotateKey && state.lastCreateRequest) {
        state.lastCreateRequest = { ...state.lastCreateRequest, requestId: newRequestId() };
      }
      setCreatePhase("error", withSupportReference(presentation.message, error), {
        canRetry: presentation.canRetry,
      });
    } finally {
      state.createInFlight = false;
      if (state.createPhase === "creating") setCreatePhase("idle");
      elements.linkForm.setAttribute("aria-busy", "false");
      elements.createSubmit.disabled = isRateLimited();
      elements.createSubmit.textContent = "Make Link";
      elements.linkUrl.readOnly = false;
      elements.linkTitle.readOnly = false;
    }
    if (createdLinkId !== null) focusCreatedCard(createdLinkId);
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (state.createInFlight || isRateLimited()) return;

    setCreatePhase("validating");
    const validation = validateDestination(elements.linkUrl.value);
    const titleValidation = validateTitle(elements.linkTitle.value);
    setUrlError(validation.valid ? "" : validation.message);
    setTitleError(titleValidation.valid ? "" : titleValidation.message);
    if (!validation.valid || !titleValidation.valid) {
      setCreatePhase("idle");
      (validation.valid ? elements.linkTitle : elements.linkUrl).focus();
      return;
    }
    elements.linkUrl.value = validation.url;

    // One intent, one Idempotency-Key: resubmitting or retrying the same
    // payload after a failure reuses the key; any edit starts a new intent.
    const previous = state.lastCreateRequest;
    const sameIntent = previous &&
      previous.destinationUrl === validation.url &&
      previous.title === titleValidation.title;
    state.lastCreateRequest = {
      requestId: sameIntent ? previous.requestId : newRequestId(),
      title: titleValidation.title,
      destinationUrl: validation.url,
    };
    await submitCreateRequest(state.lastCreateRequest);
  }

  function initSidebar() {
    if (!elements.sidebarToggle || !elements.sidebar || !elements.sidebarOverlay) return;
    const close = () => {
      elements.sidebar.classList.remove("is-open");
      elements.sidebarOverlay.classList.remove("is-visible");
      elements.sidebarToggle.setAttribute("aria-expanded", "false");
      elements.sidebarToggle.setAttribute("aria-label", "Open navigation");
    };
    elements.sidebarToggle.setAttribute("aria-expanded", "false");
    elements.sidebarToggle.addEventListener("click", () => {
      const opening = !elements.sidebar.classList.contains("is-open");
      elements.sidebar.classList.toggle("is-open", opening);
      elements.sidebarOverlay.classList.toggle("is-visible", opening);
      elements.sidebarToggle.setAttribute("aria-expanded", String(opening));
      elements.sidebarToggle.setAttribute("aria-label", opening ? "Close navigation" : "Open navigation");
    });
    elements.sidebarOverlay.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.sidebar.classList.contains("is-open")) {
        close();
        elements.sidebarToggle.focus();
      }
    });
  }

  function initTopbar() {
    elements.topbarAddBtn?.addEventListener("click", () => {
      elements.linkUrl.focus({ preventScroll: true });
      elements.linkUrl.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    if (!elements.topbarPromptText) return;
    const prompts = [
      "Tell The World What You Do",
      "Paste Your Link And Get Shareable One",
      "Share Your Link and Get Data",
    ];
    let promptIndex = 0;
    window.setInterval(() => {
      promptIndex = (promptIndex + 1) % prompts.length;
      elements.topbarPromptText.textContent = prompts[promptIndex];
    }, 4500);
  }

  function initBanner() {
    if (!elements.bannerText) return;
    const messages = ["OP4N.COM", "OP4N.ME/MAKE LINKS SHAREABLE"];
    let messageIndex = 0;
    window.setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      elements.bannerText.textContent = messages[messageIndex];
    }, 4200);
  }

  // Promotional panel behavior is intentionally preserved.
  function initPromotionalPanel() {
    const isMobileAd = () =>
      window.matchMedia("(max-width: 1024px), (hover: none), (pointer: coarse)").matches;
    let lastScrollY = window.scrollY;
    let scrollDownDistance = 0;
    let touchY = null;
    let touchDownDistance = 0;
    let expandedAt = 0;
    let scrollFrame = 0;

    const setAdCollapsed = (collapsed, { persist = true } = {}) => {
      if (!elements.adPanel || !elements.appShell) return;
      elements.adPanel.classList.toggle("is-collapsed", collapsed);
      elements.adPanel.classList.toggle("is-expanded", !collapsed);
      elements.appShell.classList.toggle("is-ad-expanded", !collapsed);
      elements.adSheetHandle?.setAttribute("aria-expanded", String(!collapsed));
      elements.adSheetHandle?.setAttribute(
        "aria-label",
        collapsed ? "Show promotional showcase" : "Hide promotional showcase"
      );
      elements.adPanelShowcase?.setAttribute("aria-hidden", String(collapsed));
      if (!collapsed) expandedAt = performance.now();
      scrollDownDistance = 0;
      touchDownDistance = 0;
      if (persist) sessionStorage.setItem("openme_ad_collapsed", String(collapsed));
    };

    const collapseForDownwardMotion = () => {
      if (
        !isMobileAd() ||
        !elements.adPanel?.classList.contains("is-expanded") ||
        performance.now() - expandedAt < 280 ||
        document.querySelector("dialog[open]")
      ) return;
      setAdCollapsed(true, { persist: false });
    };

    if (elements.adPanel && elements.appShell) {
      const syncAdPanelState = () => {
        if (isMobileAd()) {
          setAdCollapsed(false, { persist: false });
        } else {
          elements.adPanel.classList.remove("is-collapsed", "is-expanded", "is-hidden");
          elements.appShell.classList.remove("is-ad-dismissed", "is-ad-expanded");
          elements.adSheetHandle?.setAttribute("aria-expanded", "false");
          elements.adPanelShowcase?.removeAttribute("aria-hidden");
        }
      };
      syncAdPanelState();
      window.addEventListener("resize", syncAdPanelState);
    }

    const toggleAdCollapse = () => {
      if (!isMobileAd() || !elements.adPanel) return;
      const willExpand = elements.adPanel.classList.contains("is-collapsed");
      setAdCollapsed(!willExpand);
    };

    elements.adPanelClose?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAdCollapse();
    });
    elements.adSheetHandle?.addEventListener("click", toggleAdCollapse);
    window.addEventListener("scroll", () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollY;
        lastScrollY = currentScrollY;
        scrollDownDistance = delta > 0 ? scrollDownDistance + delta : 0;
        if (scrollDownDistance >= 18) collapseForDownwardMotion();
      });
    }, { passive: true });
    window.addEventListener("wheel", (event) => {
      if (event.deltaY > 12) collapseForDownwardMotion();
    }, { passive: true });
    window.addEventListener("touchstart", (event) => {
      touchY = event.touches[0]?.clientY ?? null;
      touchDownDistance = 0;
    }, { passive: true });
    window.addEventListener("touchmove", (event) => {
      const nextTouchY = event.touches[0]?.clientY;
      if (touchY === null || nextTouchY === undefined) return;
      const delta = touchY - nextTouchY;
      touchY = nextTouchY;
      touchDownDistance = delta > 0 ? touchDownDistance + delta : 0;
      if (touchDownDistance >= 18) collapseForDownwardMotion();
    }, { passive: true });
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        isMobileAd() &&
        elements.adPanel?.classList.contains("is-expanded")
      ) {
        setAdCollapsed(true);
        elements.adSheetHandle?.focus();
      }
    });

    const setAdContactSheetOpen = (open) => {
      elements.adContactSheet?.classList.toggle("is-open", open);
      elements.adContactBackdrop?.classList.toggle("is-open", open);
      elements.adContactSheet?.setAttribute("aria-hidden", String(!open));
      elements.adContactBackdrop?.setAttribute("aria-hidden", String(!open));
      if (open) window.setTimeout(() => elements.adContactEmail?.focus(), 120);
    };

    elements.adContactTrigger?.addEventListener("click", () => setAdContactSheetOpen(true));
    elements.adContactClose?.addEventListener("click", () => setAdContactSheetOpen(false));
    elements.adContactBackdrop?.addEventListener("click", () => setAdContactSheetOpen(false));
    elements.adContactForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = elements.adContactEmail?.value.trim() || "";
      const message = elements.adContactMessage?.value.trim() || "";
      const subject = encodeURIComponent("OP4N.ME contact");
      const body = encodeURIComponent(`Email: ${email}\n\nMessage:\n${message}`);
      window.location.href =
        `mailto:kwanchanok.phon@gmail.com?subject=${subject}&body=${body}`;
    });

    if (!elements.adYouWord) return;
    const words = ["YOU", "คุณ", "你", "당신", "あなた", "тебя", "tú", "te", "toi", "ʻoe"];
    let wordIndex = 0;
    window.setInterval(() => {
      elements.adYouWord.classList.add("is-exiting");
      window.setTimeout(() => {
        wordIndex = (wordIndex + 1) % words.length;
        elements.adYouWord.textContent = words[wordIndex];
        elements.adYouWord.classList.remove("is-exiting");
        elements.adYouWord.classList.add("is-entering");
        void elements.adYouWord.offsetHeight;
        elements.adYouWord.classList.remove("is-entering");
      }, 350);
    }, 2000);
  }

  function init() {
    // Transitional cleanup only: preserved legacy-created records are not mixed
    // into Example data or the mock Created Link service.
    window.op4nPrototypeStorage?.migrate();
    elements.linkForm.addEventListener("submit", handleCreate);
    elements.formRetryButton.addEventListener("click", () => {
      if (state.lastCreateRequest) void submitCreateRequest(state.lastCreateRequest);
    });
    elements.linkUrl.addEventListener("input", () => {
      if (elements.linkUrl.getAttribute("aria-invalid") === "true") {
        const validation = validateDestination(elements.linkUrl.value);
        setUrlError(validation.valid ? "" : validation.message);
      }
      if (state.createPhase === "error" && !isRateLimited()) setCreatePhase("idle");
    });
    elements.linkTitle.addEventListener("input", () => {
      if (elements.linkTitle.getAttribute("aria-invalid") === "true") {
        const validation = validateTitle(elements.linkTitle.value);
        setTitleError(validation.valid ? "" : validation.message);
      }
      if (state.createPhase === "error") setCreatePhase("idle");
    });
    elements.filterButtons.forEach((button) => {
      button.addEventListener("click", () => setFilter(button.dataset.linkFilter));
    });
    elements.capabilityDialogClose.addEventListener("click", closeCapabilityDialog);
    elements.capabilityNotNow.addEventListener("click", closeCapabilityDialog);
    elements.capabilitySignup.addEventListener("click", () => {
      elements.capabilityDialogDescription.textContent =
        "Sign Up is not connected during Prototype Cleanup. This preview cannot change link data.";
    });
    elements.capabilityDialog.addEventListener("close", () => state.activeDialogTrigger?.focus());
    elements.reportDialogClose.addEventListener("click", closeReportDialog);
    elements.reportCancel.addEventListener("click", closeReportDialog);
    elements.reportForm.addEventListener("submit", handleReportSubmit);
    elements.reportReason.addEventListener("input", () => {
      if (elements.reportReason.value.trim()) {
        elements.reportReasonError.textContent = "";
        elements.reportReason.setAttribute("aria-invalid", "false");
      }
    });
    elements.reportDialog.addEventListener("cancel", (event) => {
      if (state.reportInFlight) event.preventDefault();
    });
    elements.reportDialog.addEventListener("close", () => {
      state.activeReportTrigger?.focus();
      state.activeReportTrigger = null;
      state.activeReportLink = null;
    });

    initSidebar();
    initTopbar();
    initBanner();
    initPromotionalPanel();
    void renderLinks();
  }

  init();
})();
