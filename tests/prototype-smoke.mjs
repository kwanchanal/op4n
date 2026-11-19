import process from "node:process";

const port = Number(process.argv[2] || 9228);
const sitePort = Number(process.argv[3] || 4173);
const base = `http://127.0.0.1:${port}`;
const pages = await (await fetch(`${base}/json`)).json();
const page = pages.find((item) =>
  item.type === "page" &&
  (item.url.includes(`127.0.0.1:${sitePort}`) || item.url.includes("/Github/openme/index.html"))
);
if (!page) throw new Error("Prototype page was not found in the Chrome debug session.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const exceptions = [];
let commandId = 0;

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.text || "Uncaught exception");
  }
  if (message.method === "Fetch.requestPaused") {
    void handlePausedRequest(message.params);
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

await new Promise((resolve) => {
  socket.onopen = resolve;
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++commandId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || "Evaluation failed");
  }
  return response.result.result.value;
}

// http-adapter phase: Chrome DevTools serves an http runtime config and a
// same-origin fake API, so the real http adapter runs without any network.
const fakeApiBase = `http://127.0.0.1:${sitePort}/__fake-api/functions/v1/op4n-api`;
const httpRuntimeConfig = {
  environment: "staging",
  adapter: "http",
  apiBaseUrl: fakeApiBase,
  shortLinkHost: "staging.op4n.me",
};
const fakeApi = { requests: [], nextStatus: 201 };
const fakeCard = {
  aggregateTotalClicks: 0,
  canonicalCode: "HTTPCODE",
  canonicalOpenUrl: "https://staging.op4n.me/HTTP0001",
  canonicalShortUrl: "https://staging.op4n.me/HTTP0001",
  displayTitle: "HTTP smoke",
  safeDestinationSummary: { origin: "https://example.com", displayValue: "https://example.com" },
};

function fulfill(requestId, status, contentType, body) {
  return send("Fetch.fulfillRequest", {
    requestId,
    responseCode: status,
    responseHeaders: [
      { name: "Content-Type", value: contentType },
      { name: "Cache-Control", value: "no-store" },
      { name: "X-Request-ID", value: "smoke-request-0001" },
    ],
    body: Buffer.from(body).toString("base64"),
  });
}

async function handlePausedRequest({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/config/runtime-config.js")) {
    return fulfill(requestId, 200, "text/javascript",
      `window.OP4N_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(httpRuntimeConfig)});`);
  }
  if (url.pathname.startsWith("/__fake-api/")) {
    fakeApi.requests.push({ url: request.url, method: request.method, headers: request.headers, postData: request.postData });
    const body = fakeApi.nextStatus === 201
      ? fakeCard
      : { error: { code: "DEPENDENCY_UNAVAILABLE", message: "A required service is temporarily unavailable.", requestId: "smoke-request-0001" } };
    return fulfill(requestId, fakeApi.nextStatus, "application/json", JSON.stringify(body));
  }
  return send("Fetch.continueRequest", { requestId });
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(700);
exceptions.length = 0;

const initial = await evaluate(`({
  title: document.title,
  favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  faviconType: document.querySelector('link[rel="icon"]')?.type,
  exampleCards: document.querySelectorAll('.public-link-card.is-example').length,
  exampleMenu: Boolean(document.querySelector('[data-link-filter="example"]')),
  createdActive: document.querySelector('[data-link-filter="created"]')?.getAttribute('aria-pressed'),
  promo: Boolean(document.querySelector('#adPanel')),
  disclosure: document.querySelector('.guest-link-disclosure')?.textContent || '',
  disclosureBeforeSubmit: Boolean(
    document.querySelector('.guest-link-disclosure')?.compareDocumentPosition(
      document.querySelector('[data-create-submit]')
    ) & Node.DOCUMENT_POSITION_FOLLOWING
  ),
  disclosureVisible: (() => {
    const disclosure = document.querySelector('.guest-link-disclosure');
    return Boolean(disclosure && disclosure.getClientRects().length && getComputedStyle(disclosure).visibility !== 'hidden');
  })(),
  urlInputContract: (() => {
    const input = document.querySelector('#linkUrl');
    return input?.type === 'url' && input.required && input.name === 'url';
  })(),
  lockedNav: [...document.querySelectorAll('.nav-link.is-locked')].every((item) => item.tagName === 'BUTTON' && item.getAttribute('aria-disabled') === 'true' && !item.hasAttribute('href')),
  fetches: performance.getEntriesByType('resource').filter((item) => ['fetch', 'xmlhttprequest'].includes(item.initiatorType)).length
})`);
assert(initial.title === "OP4N.COM", "browser title is OP4N.COM");
assert(initial.favicon === "favicon/op4n-star.svg" && initial.faviconType === "image/svg+xml", "valid ✱ SVG favicon is configured");
assert(!initial.exampleMenu && initial.exampleCards === 0 && initial.createdActive === "true", "Created Link is the only available view");
assert(initial.promo, "promotional panel is preserved");
assert(initial.disclosure.includes("public and read-only"), "Guest disclosure is visible");
assert(initial.disclosureBeforeSubmit && initial.disclosureVisible, "Guest disclosure is visible before Make Link");
assert(initial.urlInputContract, "destination URL is the required URL input on the creation form");
assert(initial.lockedNav, "non-live navigation remains locked");
assert(initial.fetches === 0, "no production fetch/XHR occurs");

await evaluate(`document.querySelector('[data-link-filter="created"]').click()`);
await sleep(350);
const fixtures = await evaluate(`({
  count: document.querySelectorAll('.public-link-card').length,
  clicks: [...document.querySelectorAll('.public-click-count strong')].map((item) => item.textContent.trim()),
  firstTitle: document.querySelector('.public-link-card .link-title')?.textContent.trim(),
  firstId: document.querySelector('.public-link-card')?.dataset.linkId,
  createdTags: [...document.querySelectorAll('.public-link-card .link-example-label')].filter((item) => item.textContent.trim() === 'Created Link').length,
  destinationFields: document.querySelectorAll('.public-link-card .link-destination-field').length
})`);
assert(fixtures.count === 4, "mock Created Link list includes the pinned Portfolio fixture");
assert(fixtures.firstTitle === "Portfolio" && fixtures.firstId === "mock-created-portfolio", "configured Portfolio link stays first");
assert(JSON.stringify(fixtures.clicks) === JSON.stringify(["0 clicks", "0 clicks", "1 click", "128 clicks"]), "clickCount formats 0, 1, and many");
assert(fixtures.createdTags === 0, "Created Link cards have no visible Created Link tag");
assert(fixtures.destinationFields === fixtures.count, "every public card uses the labeled destination field");

await evaluate(`document.querySelector('#linkUrl').value = ''; document.querySelector('#linkForm').requestSubmit()`);
await sleep(50);
assert((await evaluate(`document.querySelector('#linkUrlError').textContent`)).includes("Enter a destination"), "blank URL stays inline");
const accessibleError = await evaluate(`({
  invalid: document.querySelector('#linkUrl').getAttribute('aria-invalid'),
  describedBy: document.querySelector('#linkUrl').getAttribute('aria-describedby'),
  errorRole: document.querySelector('#linkUrlError').getAttribute('role'),
  focused: document.activeElement === document.querySelector('#linkUrl')
})`);
assert(
  accessibleError.invalid === "true" && accessibleError.describedBy === "linkUrlError" && accessibleError.errorRole === "alert" && accessibleError.focused,
  "URL errors are announced next to the field and focus returns to the invalid input"
);

await evaluate(`document.querySelector('#linkUrl').value = 'not a URL'; document.querySelector('#linkForm').requestSubmit()`);
await sleep(50);
assert((await evaluate(`document.querySelector('#linkUrlError').textContent`)).includes("complete HTTP or HTTPS"), "malformed URL receives clear feedback");

for (const unsupported of ['javascript:alert(1)', 'file:///tmp/example', 'mailto:test@example.com']) {
  await evaluate(`document.querySelector('#linkUrl').value = ${JSON.stringify(unsupported)}; document.querySelector('#linkForm').requestSubmit()`);
  await sleep(50);
  assert((await evaluate(`document.querySelector('#linkUrlError').textContent`)).includes("HTTP"), `${unsupported.split(':')[0]} URL scheme is rejected`);
}

await evaluate(`(() => {
  const input = document.querySelector('#linkUrl');
  input.value = '  https://example.com/smoke?x=1#private  ';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#linkTitle').value = '';
  input.focus();
})()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await evaluate(`document.querySelector('#linkForm').requestSubmit()`);
await sleep(450);
let createdCount = await evaluate(`document.querySelectorAll('.public-link-card').length`);
assert(createdCount === 5, "keyboard submission works and duplicate submission creates exactly one result");
assert((await evaluate(`window.op4nLinkService.prototypeControls.getLastCreateRequest().destinationUrl`)) === "https://example.com/smoke?x=1#private", "valid URL whitespace is trimmed before the mock request");
const afterSuccess = await evaluate(`({
  url: document.querySelector('#linkUrl').value,
  title: document.querySelector('#linkTitle').value,
  state: document.querySelector('#linkForm').dataset.state,
  busy: document.querySelector('#linkForm').getAttribute('aria-busy'),
  focusedCopy: document.activeElement?.classList.contains('copy-link-btn') &&
    document.activeElement.closest('.public-link-card')?.querySelector('.link-title')?.textContent.trim() === 'Untitled link',
  status: document.querySelector('#formStatus').textContent
})`);
assert(afterSuccess.url === "" && afterSuccess.title === "" && afterSuccess.state === "success" && afterSuccess.busy === "false", "success clears the form and leaves no busy state");
assert(afterSuccess.focusedCopy, "success moves focus to the new card's Copy button");
assert(afterSuccess.status.startsWith("Short link created"), "success is announced once in the status region");
assert((await evaluate(`[
  ...document.querySelectorAll('.public-link-card .link-title')
].some((item) => item.textContent.trim() === 'Untitled link')`)), "empty optional Title is accepted with a presentation fallback");
assert((await evaluate(`(() => {
  const card = [...document.querySelectorAll('.public-link-card')].find((item) =>
    item.querySelector('.link-title')?.textContent.trim() === 'Untitled link'
  );
  return card && ![card.textContent, ...[...card.querySelectorAll('*')].flatMap((item) =>
    [...item.attributes].map((attribute) => attribute.value)
  )].some((value) => String(value).includes('x=1') || String(value).includes('private'));
})()`)), "created public card DOM hides destination query parameters and fragments");
assert((await evaluate(`document.querySelector('#formStatus').textContent`)).includes("prototype data only"), "success is labeled prototype-only");

await evaluate(`(() => {
  document.querySelector('#linkTitle').value = '<img src=x onerror=globalThis.__unsafeTitle = true>';
  document.querySelector('#linkUrl').value = 'https://example.com/titled';
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(350);
createdCount += 1;
const safeTitle = await evaluate(`(() => {
  const expected = '<img src=x onerror=globalThis.__unsafeTitle = true>';
  const title = [...document.querySelectorAll('.public-link-card .link-title')].find((item) => item.textContent === expected);
  return { found: Boolean(title), injectedImage: Boolean(title?.querySelector('img')), executed: Boolean(globalThis.__unsafeTitle) };
})()`);
assert(safeTitle.found && !safeTitle.injectedImage && !safeTitle.executed, "optional Title is rendered as inert text");

// Loading state: inputs are read-only and the CTA is disabled while unresolved.
await evaluate(`(() => {
  window.op4nLinkService.prototypeControls.setCreateScenario('timeout');
  const input = document.querySelector('#linkUrl');
  input.value = 'https://example.com/loading';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(120);
const loading = await evaluate(`({
  busy: document.querySelector('#linkForm').getAttribute('aria-busy'),
  disabled: document.querySelector('[data-create-submit]').disabled,
  label: document.querySelector('[data-create-submit]').textContent.trim(),
  readOnly: document.querySelector('#linkUrl').readOnly && document.querySelector('#linkTitle').readOnly,
  value: document.querySelector('#linkUrl').value
})`);
assert(loading.busy === "true" && loading.disabled && loading.label === "Creating link…", "loading state disables Make Link and sets aria-busy");
assert(loading.readOnly && loading.value === "https://example.com/loading", "inputs are read-only and keep their values while creating");
await sleep(450);
const loaded = await evaluate(`({
  busy: document.querySelector('#linkForm').getAttribute('aria-busy'),
  disabled: document.querySelector('[data-create-submit]').disabled,
  readOnly: document.querySelector('#linkUrl').readOnly || document.querySelector('#linkTitle').readOnly
})`);
assert(loaded.busy === "false" && !loaded.disabled && !loaded.readOnly, "loading state ends cleanly after an error");

// Title limit: more than 200 characters never reaches the service.
await evaluate(`(() => {
  window.op4nLinkService.prototypeControls.setCreateScenario('success');
  window.__requestsBeforeTitle = window.op4nLinkService.prototypeControls.getLastCreateRequest()?.requestId;
  document.querySelector('#linkTitle').value = 'a'.repeat(201);
  document.querySelector('#linkUrl').value = 'https://example.com/long-title';
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(80);
const titleLimit = await evaluate(`({
  error: document.querySelector('#linkTitleError').textContent,
  invalid: document.querySelector('#linkTitle').getAttribute('aria-invalid'),
  focused: document.activeElement === document.querySelector('#linkTitle'),
  maxLength: document.querySelector('#linkTitle').maxLength,
  unchanged: window.op4nLinkService.prototypeControls.getLastCreateRequest()?.requestId === window.__requestsBeforeTitle
})`);
assert(titleLimit.error.includes("200") && titleLimit.invalid === "true" && titleLimit.focused && titleLimit.unchanged, "Title over 200 characters is rejected inline without a request");
assert(titleLimit.maxLength === 200, "Title input enforces maxlength 200");
await evaluate(`document.querySelector('#linkTitle').value = ''; document.querySelector('#linkTitle').dispatchEvent(new Event('input', { bubbles: true }))`);

// Client policy parity: short-link hosts and credentials are rejected before any request.
for (const [value, part] of [["https://op4n.me/ABCDEFG", "shortened again"], ["https://user:pass@example.com/", "username or password"]]) {
  await evaluate(`document.querySelector('#linkUrl').value = ${JSON.stringify(value)}; document.querySelector('#linkForm').requestSubmit()`);
  await sleep(50);
  assert((await evaluate(`document.querySelector('#linkUrlError').textContent`)).includes(part), `client rejects ${part} inline`);
}

const expectedRetry = {
  offline: true, timeout: true, "rate-limit": true, "blocked-destination": false,
  "server-error": true, unavailable: true, conflict: true, "malformed-response": false,
};
for (const scenario of ["offline", "timeout", "rate-limit", "blocked-destination", "server-error", "unavailable", "conflict", "malformed-response"]) {
  await evaluate(`(() => {
    window.op4nLinkService.prototypeControls.setCreateScenario(${JSON.stringify(scenario)});
    const input = document.querySelector('#linkUrl');
    input.value = 'https://example.com/${scenario}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#linkForm').requestSubmit();
  })()`);
  await sleep(scenario === "timeout" ? 500 : 350);
  const errorState = await evaluate(`({
    state: document.querySelector('#linkForm').dataset.state,
    value: document.querySelector('#linkUrl').value,
    count: document.querySelectorAll('.public-link-card').length,
    retry: !document.querySelector('#formRetryButton').hidden,
    status: document.querySelector('#formStatus').textContent
  })`);
  assert(errorState.state === "error", `${scenario} enters the error state`);
  assert(errorState.retry === expectedRetry[scenario], `${scenario} ${expectedRetry[scenario] ? "offers" : "does not offer"} Retry`);
  assert(errorState.status.includes("(Ref mock-req)") && !/prototype|MOCK_|stack/i.test(errorState.status), `${scenario} shows a support reference and no raw detail`);
  assert(errorState.value.includes(scenario), `${scenario} preserves input`);
  assert(errorState.count === createdCount, `${scenario} does not create a card`);
}

await evaluate(`(() => {
  window.op4nLinkService.prototypeControls.setCreateScenario('offline');
  const input = document.querySelector('#linkUrl');
  input.value = 'https://example.com/retry';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(350);
await evaluate(`window.__retryKeyBefore = window.op4nLinkService.prototypeControls.getLastCreateRequest().requestId; window.op4nLinkService.prototypeControls.setCreateScenario('success'); document.querySelector('#formRetryButton').click()`);
await sleep(350);
createdCount += 1;
assert(await evaluate(`window.op4nLinkService.prototypeControls.getLastCreateRequest().requestId === window.__retryKeyBefore`), "Retry reuses the same Idempotency-Key");

// Conflict rotates the key; resubmitting the same payload otherwise reuses it.
await evaluate(`(() => {
  window.op4nLinkService.prototypeControls.setCreateScenario('conflict');
  const input = document.querySelector('#linkUrl');
  input.value = 'https://example.com/conflict-retry';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(350);
await evaluate(`window.__conflictKey = window.op4nLinkService.prototypeControls.getLastCreateRequest().requestId; window.op4nLinkService.prototypeControls.setCreateScenario('success'); document.querySelector('#formRetryButton').click()`);
await sleep(350);
createdCount += 1;
assert(await evaluate(`window.op4nLinkService.prototypeControls.getLastCreateRequest().requestId !== window.__conflictKey`), "IDEMPOTENCY_CONFLICT retries with a new key");
assert((await evaluate(`document.querySelectorAll('.public-link-card').length`)) === createdCount, "conflict retry creates exactly one card");
assert((await evaluate(`document.querySelectorAll('.public-link-card').length`)) === createdCount, "safe retry creates one result with the same request");
assert((await evaluate(`document.querySelector('.public-link-card')?.dataset.linkId`)) === "mock-created-portfolio", "pinned Portfolio stays first after new links are created");

const cardContract = await evaluate(`(() => {
  const card = document.querySelector('.public-link-card');
  const destination = card.querySelector('.link-url');
  const longCard = [...document.querySelectorAll('.public-link-card')].find((item) => item.dataset.linkId === 'mock-created-many');
  const longDestinationField = longCard?.querySelector('.link-destination-field');
  const longDestination = longCard?.querySelector('.link-url');
  return {
    shortUrl: card.querySelector('.link-short-url').textContent.trim(),
    destinationLabel: card.querySelector('.link-field-label').textContent.trim(),
    destinationControl: destination.tagName,
    destinationSummary: destination.textContent.trim(),
    longDestinationSummary: longDestination.textContent.trim(),
    fullQueryExposed: [...longCard.querySelectorAll('*')].some((item) =>
      [item.textContent, ...[...item.attributes].map((attribute) => attribute.value)]
        .some((value) => String(value).includes('utm_source=prototype'))
    ),
    toolbar: Boolean(card.querySelector('.link-card-toolbar')),
    visibleClicks: card.querySelector('.public-click-count strong')?.textContent.trim(),
    registeredLabels: [...card.querySelectorAll('[data-access="registered-preview"]')].every((item) => item.getAttribute('aria-label').includes('Registered to unlock')),
    registeredPreviewContract: [...card.querySelectorAll('[data-access="registered-preview"]')].every((item) => item.getAttribute('aria-disabled') === 'true' && item.tabIndex >= 0 && item.dataset.tooltip.includes('Registered to unlock')),
    guestTooltips: [...card.querySelectorAll('[data-access="guest-action"]')].every((item) => Boolean(item.dataset.tooltip)),
    guestIconOnly: [...card.querySelectorAll('.guest-action-button:not(.public-click-count)')].every((item) => item.querySelector('.material-symbols-outlined') && ![...item.children].some((child) => !child.classList.contains('material-symbols-outlined') && !child.classList.contains('sr-only'))),
    longDestinationContained: Boolean(longDestinationField && longDestination) && longDestinationField.scrollWidth <= longDestinationField.clientWidth && getComputedStyle(longDestination).textOverflow === 'ellipsis'
  };
})()`);
assert(cardContract.shortUrl.startsWith("https://op4n.me/"), "card uses canonical short URL");
const shortDisplay = await evaluate(`(() => {
  const element = document.querySelector('.public-link-card .link-short-url');
  const style = getComputedStyle(element);
  const visible = [...element.childNodes]
    .filter((node) => !node.classList?.contains('sr-only'))
    .map((node) => node.textContent).join('').trim();
  return { visible, overflow: style.textOverflow, wrap: style.overflowWrap };
})()`);
assert(shortDisplay.visible.startsWith("op4n.me/") && !shortDisplay.visible.includes("https://"), "short URL is shown as op4n.me/CODE while the full URL stays in text");
assert(shortDisplay.overflow !== "ellipsis" && shortDisplay.wrap === "anywhere", "short URL wraps instead of truncating");
assert(cardContract.destinationLabel === "Destination URL :", "card labels the destination separately");
assert(cardContract.destinationControl === "BUTTON" && cardContract.longDestinationSummary === "https://example.com", "destination summary is limited to the normalized origin");
assert(!cardContract.fullQueryExposed, "public card DOM does not expose destination query parameters");
assert(cardContract.toolbar && cardContract.visibleClicks, "compact toolbar keeps Clicks visible as a number");
assert(cardContract.registeredLabels, "all Registered previews announce their locked state");
assert(cardContract.registeredPreviewContract, "Registered previews stay focusable and non-mutating with exact unlock tooltips");
assert(cardContract.guestTooltips && cardContract.guestIconOnly, "Guest actions use named icon controls");
assert(cardContract.longDestinationContained, "long destination URL stays inside its field with ellipsis");

await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__copiedSmoke = value; } } }); document.querySelector('.copy-link-btn').click()`);
await sleep(50);
assert((await evaluate(`window.__copiedSmoke`)) === cardContract.shortUrl, "Copy writes the full short URL");
assert((await evaluate(`document.querySelector('.copy-link-btn span:last-child').textContent`)) === "Copied", "Copy announces confirmation");
assert((await evaluate(`document.querySelector('.copy-link-btn .copy-icon').textContent`)) === "check", "Copy confirmation changes the icon, not only color");
await evaluate(`(() => { const button = document.querySelector('.copy-link-btn'); button.click(); button.click(); button.click(); })()`);
await sleep(1800);
assert((await evaluate(`document.querySelector('.copy-link-btn span:last-child').textContent`)) === "Copy short link", "rapid copies reset to the default label after one timer");
assert((await evaluate(`document.querySelector('.copy-link-btn').getAttribute('aria-label')`)).startsWith("Copy short link op4n.me/"), "Copy has the accessible name Copy short link op4n.me/CODE");
const copyFallback = await evaluate(`(async () => {
  window.__promptCalled = false;
  window.prompt = () => { window.__promptCalled = true; };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
  document.execCommand = () => false;
  const card = document.querySelector('.public-link-card');
  card.querySelector('.copy-link-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const field = card.querySelector('.copy-fallback-field');
  return {
    field: Boolean(field),
    value: field?.value,
    selected: document.activeElement === field,
    prompt: window.__promptCalled,
    label: card.querySelector('.copy-link-btn span:last-child').textContent
  };
})()`);
assert(copyFallback.field && copyFallback.value === cardContract.shortUrl && copyFallback.selected, "denied clipboard shows a selected inline fallback field");
assert(!copyFallback.prompt && copyFallback.label !== "Copied", "copy fallback never calls window.prompt or claims Copied");

await evaluate(`document.querySelector('.click-count-btn').click()`);
assert((await evaluate(`document.querySelector('.card-live-status').textContent`)).includes("public link has"), "Clicks action announces aggregate clicks");

const reportFlow = await evaluate(`(async () => {
  const trigger = document.querySelector('.report-link-btn');
  trigger.click();
  const dialog = document.querySelector('#reportDialog');
  const focusedOnReason = document.activeElement === document.querySelector('#reportReason');
  document.querySelector('#reportForm').requestSubmit();
  const requiredError = document.querySelector('#reportReasonError').textContent;
  document.querySelector('#reportReason').value = 'Smoke-test reason';
  document.querySelector('#reportReason').dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#reportForm').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const status = document.querySelector('#reportStatus').textContent;
  document.querySelector('#reportDialogClose').click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { focusedOnReason, requiredError, status, returned: document.activeElement === trigger, closed: !dialog.open };
})()`);
assert(reportFlow.focusedOnReason, "Report dialog focuses the reason field");
assert(reportFlow.requiredError.includes("Enter a reason"), "Report requires a reason");
assert(reportFlow.status.includes("simulated") && reportFlow.status.includes("No Admin"), "Report success is explicitly simulated and undelivered");
assert(reportFlow.returned && reportFlow.closed, "Report closes and restores focus");

await evaluate(`document.querySelector('[data-feature="qr"]').focus()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await sleep(50);
const qrFlow = await evaluate(`(() => {
  const trigger = document.querySelector('[data-feature="qr"]');
  const dialog = document.querySelector('#capabilityDialog');
  const showcase = document.querySelector('#qrShowcase');
  return {
    open: dialog.open,
    hidden: showcase.hidden,
    disabled: [...showcase.querySelectorAll('button')].every((item) => item.disabled),
    placeholder: showcase.querySelector('.qr-placeholder').getAttribute('aria-label'),
    canvas: showcase.querySelectorAll('canvas, img').length,
    blobUrl: [...showcase.querySelectorAll('[src], [href]')].some((item) => /^(blob:|data:)/.test(item.src || item.href || ''))
  };
})()`);
assert(qrFlow.open && !qrFlow.hidden, "keyboard activation opens the QR read-only showcase");
assert(qrFlow.disabled, "QR Preview, Settings, and Download controls are disabled");
assert(qrFlow.placeholder.includes("does not encode a link"), "QR placeholder is announced as non-live");
assert(qrFlow.canvas === 0 && !qrFlow.blobUrl, "QR showcase has no generated image, canvas, blob, or data URL");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(50);
assert(!(await evaluate(`document.querySelector('#capabilityDialog').open`)), "feature dialog closes with Escape");
assert(await evaluate(`document.activeElement?.dataset?.feature === 'qr'`), "feature dialog restores focus to its trigger");

for (const width of [320, 768, 1024, 1440]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  const metrics = await evaluate(`({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })`);
  assert(metrics.viewport === width && metrics.documentWidth <= width, `${width}px layout has no horizontal scroll`);
}

await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(700);
const mobilePromoInitial = await evaluate(`(() => {
  const panel = document.querySelector('#adPanel');
  const handle = document.querySelector('#adSheetHandle');
  const showcase = document.querySelector('#adPanelShowcase');
  return {
    expandedClass: panel.classList.contains('is-expanded'),
    expanded: handle.getAttribute('aria-expanded'),
    hidden: showcase.getAttribute('aria-hidden'),
    position: getComputedStyle(panel).position,
    bottom: getComputedStyle(panel).bottom,
    handleHeight: handle.getBoundingClientRect().height,
    visibleWords: /show|hide|promotional/i.test(handle.textContent)
  };
})()`);
assert(mobilePromoInitial.expandedClass && mobilePromoInitial.expanded === "true" && mobilePromoInitial.hidden === "false", "mobile promo restores the original expanded bottom sheet");
assert(mobilePromoInitial.position === "fixed" && mobilePromoInitial.bottom === "0px" && mobilePromoInitial.handleHeight >= 44, "mobile promo keeps the original fixed bottom-bar geometry and a touch target");
assert(!mobilePromoInitial.visibleWords, "mobile promo handle displays only the arrow");

await evaluate(`window.scrollTo(0, 0)`);
await sleep(50);
await evaluate(`window.scrollTo(0, 120)`);
await sleep(600);
const mobilePromoCollapsed = await evaluate(`(() => {
  const panel = document.querySelector('#adPanel');
  const handle = document.querySelector('#adSheetHandle');
  return {
    collapsed: panel.classList.contains('is-collapsed') && handle.getAttribute('aria-expanded') === 'false',
    hidden: document.querySelector('#adPanelShowcase').getAttribute('aria-hidden') === 'true',
    horizontal: document.documentElement.scrollWidth <= innerWidth
  };
})()`);
assert(mobilePromoCollapsed.collapsed && mobilePromoCollapsed.hidden, "downward mobile scrolling smoothly auto-collapses the bottom sheet");
assert(mobilePromoCollapsed.horizontal, "original bottom bar has no horizontal page overflow");
await evaluate(`document.querySelector('#adSheetHandle').click()`);
await sleep(350);
assert(await evaluate(`document.querySelector('#adPanel').classList.contains('is-expanded') && document.querySelector('#adSheetHandle').getAttribute('aria-expanded') === 'true' && document.querySelector('#adPanel').textContent.includes('fully custom-designed')`), "mobile promo expands again and preserves the fictional showcase and CTA");

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(700);
const desktopPromo = await evaluate(`(() => {
  const panel = document.querySelector('#adPanel');
  const main = document.querySelector('.main');
  return {
    position: getComputedStyle(panel).position,
    handle: getComputedStyle(document.querySelector('#adSheetHandle')).display,
    rightColumn: panel.getBoundingClientRect().left > main.getBoundingClientRect().left,
    collapsed: panel.classList.contains('is-collapsed')
  };
})()`);
assert(desktopPromo.position === "sticky" && desktopPromo.handle === "none" && desktopPromo.rightColumn && !desktopPromo.collapsed, "desktop promotional showcase remains in its approved right column");

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(700);
const reloaded = await evaluate(`({
  createdActive: document.querySelector('[data-link-filter="created"]').getAttribute('aria-pressed'),
  sessionResultVisible: [...document.querySelectorAll('.link-short-url')].some((item) => item.textContent.includes('DEMO')),
  promo: Boolean(document.querySelector('#adPanel'))
})`);
assert(reloaded.createdActive === "true", "reload returns to the Created Link default view");
assert(!reloaded.sessionResultVisible, "session mock result does not claim persistence");
assert(reloaded.promo, "promotional panel remains after reload");

// ---- http adapter (runtime config adapter=http, same-origin fake API) ----
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*/config/runtime-config.js*" }, { urlPattern: "*/__fake-api/*" }],
});
await send("Page.reload", { ignoreCache: true });
await sleep(700);
const prototypeWording = /prototype|simulated|deterministic/i;
const creationText = `document.querySelector('#linkForm').textContent + ' ' + document.querySelector('#linksWorkspace').textContent`;
const httpInitial = await evaluate(`({
  isPrototype: window.op4nLinkService.isPrototype,
  hasControls: Boolean(window.op4nLinkService.prototypeControls),
  cards: document.querySelectorAll('.public-link-card').length,
  text: ${creationText}
})`);
assert(httpInitial.isPrototype === false && !httpInitial.hasControls, "runtime config alone selects the http adapter");
assert(httpInitial.cards === 0, "http mode starts with no links (session-only list, no list API)");
assert(!prototypeWording.test(httpInitial.text), "http mode shows no prototype wording before creation");

await evaluate(`(() => {
  document.querySelector('#linkTitle').value = 'HTTP smoke';
  const input = document.querySelector('#linkUrl');
  input.value = 'https://example.com/http-smoke?token=SECRET#frag';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(500);
const httpCreated = await evaluate(`(() => {
  const card = document.querySelector('.public-link-card');
  return {
    cards: document.querySelectorAll('.public-link-card').length,
    shortUrl: card?.querySelector('.link-short-url')?.textContent.trim(),
    title: card?.querySelector('.link-title')?.textContent.trim(),
    summary: card?.querySelector('.link-url')?.textContent.trim(),
    clicks: card?.querySelector('.public-click-count strong')?.textContent.trim(),
    leaks: [document.body.innerHTML].some((value) => value.includes('SECRET') || value.includes('#frag')),
    text: ${creationText}
  };
})()`);
const post = fakeApi.requests[0];
assert(fakeApi.requests.length === 1 && post.method === "POST" && post.url === `${fakeApiBase}/api/v1/links`, "Make Link sends exactly one POST to the configured API");
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(header(post.headers, "Idempotency-Key") || ""), "http create sends a UUID v4 Idempotency-Key");
assert(String(header(post.headers, "Content-Type")).startsWith("application/json"), "http create sends JSON");
assert(JSON.stringify(JSON.parse(post.postData)) === JSON.stringify({ destinationUrl: "https://example.com/http-smoke?token=SECRET#frag", title: "HTTP smoke" }), "http create sends the trimmed destination and title");
assert(httpCreated.cards === 1 && httpCreated.shortUrl === fakeCard.canonicalShortUrl && httpCreated.title === "HTTP smoke", "card renders the API short URL and title");
assert(httpCreated.summary === "https://example.com" && httpCreated.clicks === "0 clicks", "card renders the API destination summary and aggregate clicks");
assert(!httpCreated.leaks, "http mode never renders the destination query or fragment");
assert(!prototypeWording.test(httpCreated.text), "http mode shows no prototype wording after success");

fakeApi.nextStatus = 503;
await evaluate(`(() => {
  const input = document.querySelector('#linkUrl');
  input.value = 'https://example.com/http-error';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#linkForm').requestSubmit();
})()`);
await sleep(500);
const httpError = await evaluate(`({
  state: document.querySelector('#linkForm').dataset.state,
  value: document.querySelector('#linkUrl').value,
  cards: document.querySelectorAll('.public-link-card').length,
  retry: !document.querySelector('#formRetryButton').hidden,
  text: ${creationText}
})`);
assert(httpError.state === "error" && httpError.value === "https://example.com/http-error" && httpError.cards === 1, "http service error preserves input and creates no card");
assert(httpError.retry && !prototypeWording.test(httpError.text), "http service error offers retry without prototype wording");
assert(httpError.text.includes("temporarily unavailable") && httpError.text.includes("(Ref smoke-re)"), "http 503 shows the approved message and X-Request-ID reference");
await send("Fetch.disable");

assert(exceptions.length === 0, "zero uncaught JavaScript exceptions");

console.log("SMOKE TEST PASSED");
socket.close();
