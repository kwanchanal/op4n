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
    requestNumber: 0,
    createPhase: "idle",
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

  function getDestinationUrl(link) {
    return link.destinationUrl || link.url;
  }

  function getSafeHttpUrl(value) {
    try {
      const parsedUrl = new URL(String(value));
      return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl.href : "";
    } catch {
      return "";
    }
  }

  function getPublicDestinationSummary(value) {
    const destinationUrl = getSafeHttpUrl(value);
    if (!destinationUrl) return "";

    const parsedUrl = new URL(destinationUrl);
    return parsedUrl.origin;
  }

  function setUrlError(message = "") {
    elements.linkUrlError.textContent = message;
    elements.linkUrl.setAttribute("aria-invalid", String(Boolean(message)));
  }

  const { validateDestinationUrlInput: validateDestination } =
    window.op4nDestinationUrlValidation;

  function setCreatePhase(phase, message = "", options = {}) {
    state.createPhase = phase;
    elements.linkForm.dataset.state = phase;
    elements.linkForm.setAttribute("aria-busy", String(phase === "creating"));
    elements.createSubmit.disabled = phase === "creating";
    elements.createSubmit.textContent = phase === "creating" ? "Creating link…" : "Make Link";
    elements.formStatus.textContent = message;
    elements.formStatus.dataset.status = phase;
    elements.formRetryButton.hidden = !options.canRetry;
  }

  function getCreateErrorPresentation(error) {
    const messages = {
      MOCK_OFFLINE: ["You appear to be offline. Reconnect, then retry this prototype request.", true],
      MOCK_TIMEOUT: ["The prototype request timed out. You can retry safely.", true],
      MOCK_RATE_LIMIT: ["Too many prototype requests. Wait a moment, then retry.", true],
      MOCK_BLOCKED_DESTINATION: ["This destination cannot be used in the prototype. Check or replace the URL.", false],
      MOCK_SERVER_ERROR: ["The prototype service is temporarily unavailable. You can retry safely.", true],
      MOCK_MALFORMED_RESPONSE: ["The prototype returned an unusable response. Check the URL or try again later.", false],
    };
    const [message, canRetry] = messages[error?.code] || [
      "The prototype could not create this link. Your form values are unchanged.",
      true,
    ];
    return { message, canRetry };
  }

  function formatClicks(value) {
    const count = Math.max(0, Math.trunc(Number(value) || 0));
    return `${count} ${count === 1 ? "click" : "clicks"}`;
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
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    fallback.remove();
    if (copied) return true;

    window.prompt("Copy this short link manually (Command/Ctrl+C):", value);
    return false;
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
      loading.textContent = "Loading deterministic prototype links…";
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
        error.textContent =
          "Prototype Created Links could not be loaded. Switch views and try again.";
        elements.linksList.append(error);
        return;
      }
    }

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "guest-empty-state";
      empty.textContent = "No Created Links in this prototype session yet.";
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
    const destinationUrl = getSafeHttpUrl(getDestinationUrl(link));
    const destinationSummary = getPublicDestinationSummary(destinationUrl);
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
            <span class="link-short-url">${safeShortLink}</span>
          </div>
          <div class="link-url-row link-destination-field">
            <span class="link-field-label">Destination URL :</span>
            ${destinationUrl ? `<button class="link-url open-destination-btn" type="button" title="${safeDestinationSummary}" aria-label="Open destination ${safeDestinationSummary} in a new tab">
              ${safeDestinationSummary}
            </button>` : '<span class="link-url">Destination unavailable</span>'}
          </div>
        </div>
      </div>

      <div class="link-card-toolbar" aria-label="Link actions">
        <div class="guest-action-row">
          ${capabilities.guestActions.includes("clicks") ? `<button class="guest-action-button public-click-count click-count-btn" type="button" data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Clicks" aria-label="View aggregate clicks: ${formatClicks(link.clickCount)}">
            <span class="material-symbols-outlined" aria-hidden="true">bar_chart</span>
            <strong>${formatClicks(link.clickCount)}</strong>
          </button>` : ""}
          ${capabilities.guestActions.includes("copy") ? `<button class="guest-action-button copy-link-btn" type="button" data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Copy link" aria-label="Copy short link ${safeShortLink}">
            <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
            <span class="sr-only action-label">Copy short link</span>
          </button>` : ""}
          ${capabilities.guestActions.includes("open") && destinationUrl ? `<button class="guest-action-button open-destination-btn" type="button"
             data-access="${CAPABILITY.GUEST_ACTION}" data-tooltip="Open destination" aria-label="Open destination ${safeDestinationSummary} in a new tab">
            <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
            <span class="sr-only">Open destination</span>
          </button>` : ""}
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

    card.querySelectorAll(".open-destination-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const openedWindow = window.open(destinationUrl, "_blank", "noopener,noreferrer");
        if (openedWindow) openedWindow.opener = null;
      });
    });

    card.querySelector(".copy-link-btn")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = card.querySelector(".card-live-status");
      const copied = await copyText(shortLink);
      if (copied) {
        button.querySelector(".action-label").textContent = "Copied";
        button.setAttribute("aria-label", `Copied ${shortLink}`);
        status.textContent = `Copied ${shortLink}`;
        window.setTimeout(() => {
          button.querySelector(".action-label").textContent = "Copy short link";
          button.setAttribute("aria-label", `Copy short link ${shortLink}`);
        }, 1600);
      } else {
        status.textContent = "Copy the selected short link, then close the copy dialog.";
      }
    });

    card.querySelector(".click-count-btn")?.addEventListener("click", () => {
      card.querySelector(".card-live-status").textContent =
        `This public link has ${formatClicks(link.clickCount)}.`;
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

  async function submitCreateRequest(request) {
    if (state.createInFlight) return;
    state.createInFlight = true;
    setCreatePhase("creating", "Creating a deterministic prototype link…");

    try {
      const response = await window.op4nLinkService.createLink(request);
      if (!response?.link?.id || !response.link.shortUrl || !getDestinationUrl(response.link)) {
        const malformedError = new Error("Malformed prototype response");
        malformedError.code = "MOCK_MALFORMED_RESPONSE";
        throw malformedError;
      }
      if (!state.createdLinks.some((link) => link.id === response.link.id)) {
        state.createdLinks.unshift(response.link);
      }
      state.createdLinksLoaded = true;
      state.lastCreateRequest = null;
      setCreatePhase(
        "success",
        "Your short link is ready. This is prototype data only; it is not saved to a production service."
      );
      setFilter("created");
    } catch (error) {
      const presentation = getCreateErrorPresentation(error);
      setCreatePhase("error", presentation.message, { canRetry: presentation.canRetry });
    } finally {
      state.createInFlight = false;
      elements.linkForm.setAttribute("aria-busy", "false");
      elements.createSubmit.disabled = false;
      elements.createSubmit.textContent = "Make Link";
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (state.createInFlight) return;

    setCreatePhase("validating");
    const validation = validateDestination(elements.linkUrl.value);
    if (!validation.valid) {
      setUrlError(validation.message);
      setCreatePhase("idle");
      elements.linkUrl.focus();
      return;
    }
    setUrlError();
    elements.linkUrl.value = validation.url;

    state.requestNumber += 1;
    state.lastCreateRequest = {
      requestId: `prototype-create-${state.requestNumber}`,
      title: elements.linkTitle.value.trim(),
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
