(() => {
  "use strict";

  // Latest Links and exact search (Feature Inventory Orders 69-71, 73-78).
  // Data comes only from window.op4nPublicLinkService (mock or http adapter);
  // cards come only from the shared public-card.js module.

  const config = window.OP4N_RUNTIME_CONFIG || { shortLinkHost: "op4n.me" };
  const shortHost = config.shortLinkHost || "op4n.me";
  const service = window.op4nPublicLinkService;
  const { createPublicCard, withSupportReference } = window.op4nPublicCard;
  const { normalizeLookupInput } = window.op4nShortLinkLookup;

  const el = {
    list: document.getElementById("latestList"),
    listStatus: document.getElementById("latestStatus"),
    form: document.getElementById("searchForm"),
    input: document.getElementById("searchInput"),
    submit: document.getElementById("searchSubmit"),
    error: document.getElementById("searchError"),
    result: document.getElementById("searchResult"),
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
  };

  const state = {
    listSequence: 0,
    searchSequence: 0,
    searchInFlight: false,
    searchBlockedUntil: 0,
    searchTimer: 0,
    lastCode: null,
  };

  function describeWait(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "in a few minutes";
    if (seconds < 60) return "in a minute";
    const minutes = Math.ceil(seconds / 60);
    return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  function stateBlock(kind, message, action) {
    const block = document.createElement("div");
    block.className = `guest-empty-state latest-state${kind === "error" ? " guest-error-state" : ""}`;
    block.dataset.state = kind;
    const text = document.createElement("p");
    text.textContent = message;
    block.append(text);
    if (action) block.append(action);
    return block;
  }

  function makeLinkAction() {
    const link = document.createElement("a");
    link.className = "cta latest-state-action";
    link.href = "index.html#linkUrl";
    link.textContent = "Make a link";
    return link;
  }

  function retryButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "form-retry-button latest-state-action";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  // ── Latest Links (Orders 69-71) ──────────────────────────────────────
  function renderSkeleton() {
    el.list.replaceChildren(...Array.from({ length: 3 }, () => {
      const card = document.createElement("div");
      card.className = "link-card latest-skeleton";
      card.setAttribute("aria-hidden", "true");
      card.innerHTML = '<span class="latest-skeleton-line is-title"></span><span class="latest-skeleton-line"></span><span class="latest-skeleton-line is-short"></span>';
      return card;
    }));
  }

  async function loadLatest() {
    const sequence = ++state.listSequence;
    el.list.setAttribute("aria-busy", "true");
    renderSkeleton();
    el.listStatus.textContent = "Loading latest links";
    try {
      const { links } = await service.listLatest();
      if (sequence !== state.listSequence) return;
      if (!links.length) {
        el.list.replaceChildren(stateBlock("empty", "No public links yet.", makeLinkAction()));
        el.listStatus.textContent = "No public links yet.";
      } else {
        el.list.replaceChildren(...links.map((link) => createPublicCard(link)));
        el.listStatus.textContent = `Showing ${links.length} latest public link${links.length === 1 ? "" : "s"}.`;
      }
    } catch (error) {
      if (sequence !== state.listSequence) return;
      let block;
      if (error?.code === "FEATURE_UNAVAILABLE") {
        block = stateBlock("paused", "Latest Links is temporarily paused. Please check back later.");
      } else if (error?.code === "RATE_LIMITED") {
        block = stateBlock("error", `Too many requests. Try again ${describeWait(Number(error.retryAfter))}.`,
          retryButton("Retry", () => void loadLatest()));
      } else {
        block = stateBlock("error", withSupportReference("Latest links couldn’t load. Check your connection and try again.", error),
          retryButton("Retry", () => void loadLatest()));
      }
      el.list.replaceChildren(block);
      el.listStatus.textContent = block.textContent;
    } finally {
      if (sequence === state.listSequence) el.list.setAttribute("aria-busy", "false");
    }
  }

  // ── Exact search (Orders 72-78) ──────────────────────────────────────
  function setSearchError(message = "") {
    el.error.textContent = message;
    el.input.setAttribute("aria-invalid", String(Boolean(message)));
  }

  function setSearching(searching) {
    state.searchInFlight = searching;
    el.submit.disabled = searching || Date.now() < state.searchBlockedUntil;
    el.submit.textContent = searching ? "Searching…" : "Find";
    el.result.setAttribute("aria-busy", String(searching));
  }

  function showResult(node) {
    el.result.replaceChildren(node);
  }

  async function search(code) {
    if (state.searchInFlight || Date.now() < state.searchBlockedUntil) return;
    const sequence = ++state.searchSequence;
    state.lastCode = code;
    // Clear the previous result at submit so stale data is never shown.
    el.result.replaceChildren();
    setSearching(true);
    const display = `${shortHost}/${code}`;
    try {
      const outcome = await service.lookup(code);
      if (sequence !== state.searchSequence) return;
      if (outcome.kind === "card") {
        showResult(createPublicCard(outcome.link));
      } else if (outcome.kind === "unavailable") {
        showResult(stateBlock("unavailable", `This short link is unavailable. Questions? Contact support@op4n.com.`));
      } else {
        showResult(stateBlock("no-result", `No public link matches ${display}.`, makeLinkAction()));
      }
    } catch (error) {
      if (sequence !== state.searchSequence) return;
      if (error?.code === "FEATURE_UNAVAILABLE") {
        showResult(stateBlock("paused", "Search is temporarily paused. Please try again later."));
      } else if (error?.code === "RATE_LIMITED") {
        const seconds = Number(error.retryAfter);
        const waitMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
        state.searchBlockedUntil = Date.now() + waitMs;
        showResult(stateBlock("error", `You’ve searched a lot recently. You can search again ${describeWait(seconds)}.`));
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(() => {
          state.searchBlockedUntil = 0;
          el.submit.disabled = state.searchInFlight;
        }, waitMs);
      } else {
        showResult(stateBlock("error", withSupportReference("Search is temporarily unavailable. Try again.", error),
          retryButton("Retry search", () => void search(code))));
      }
    } finally {
      if (sequence === state.searchSequence) setSearching(false);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    if (state.searchInFlight) return;
    const normalized = normalizeLookupInput(el.input.value, shortHost);
    if (!normalized.valid) {
      setSearchError(`Enter a short link like ${shortHost}/PL2TSH5, or just its code.`);
      el.input.focus();
      return;
    }
    setSearchError();
    void search(normalized.code);
  }

  function initSidebarToggle() {
    if (!el.sidebarToggle || !el.sidebar || !el.sidebarOverlay) return;
    const close = () => {
      el.sidebar.classList.remove("is-open");
      el.sidebarOverlay.classList.remove("is-visible");
      el.sidebarToggle.setAttribute("aria-expanded", "false");
      el.sidebarToggle.setAttribute("aria-label", "Open navigation");
    };
    el.sidebarToggle.setAttribute("aria-expanded", "false");
    el.sidebarToggle.addEventListener("click", () => {
      const opening = !el.sidebar.classList.contains("is-open");
      el.sidebar.classList.toggle("is-open", opening);
      el.sidebarOverlay.classList.toggle("is-visible", opening);
      el.sidebarToggle.setAttribute("aria-expanded", String(opening));
      el.sidebarToggle.setAttribute("aria-label", opening ? "Close navigation" : "Open navigation");
    });
    el.sidebarOverlay.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && el.sidebar.classList.contains("is-open")) {
        close();
        el.sidebarToggle.focus();
      }
    });
  }

  window.op4nPublicCard.init();
  el.form.addEventListener("submit", handleSearch);
  el.input.addEventListener("input", () => {
    if (el.input.getAttribute("aria-invalid") === "true") setSearchError();
  });
  initSidebarToggle();
  void loadLatest();
})();
