import process from "node:process";

const port = Number(process.argv[2] || 9228);
const base = `http://127.0.0.1:${port}`;
const pages = await (await fetch(`${base}/json`)).json();
const page = pages.find((item) =>
  item.type === "page" &&
  (item.url.includes("127.0.0.1:4173") || item.url.includes("/Github/openme/index.html"))
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
  lockedNav: [...document.querySelectorAll('.nav-link.is-locked')].every((item) => item.tagName === 'BUTTON' && item.getAttribute('aria-disabled') === 'true' && !item.hasAttribute('href')),
  fetches: performance.getEntriesByType('resource').filter((item) => ['fetch', 'xmlhttprequest'].includes(item.initiatorType)).length
})`);
assert(initial.title === "OP4N.COM", "browser title is OP4N.COM");
assert(initial.favicon === "favicon/op4n-star.svg" && initial.faviconType === "image/svg+xml", "valid ✱ SVG favicon is configured");
assert(!initial.exampleMenu && initial.exampleCards === 0 && initial.createdActive === "true", "Created Link is the only available view");
assert(initial.promo, "promotional panel is preserved");
assert(initial.disclosure.includes("public and read-only"), "Guest disclosure is visible");
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

await evaluate(`document.querySelector('#linkUrl').value = 'javascript:alert(1)'; document.querySelector('#linkForm').requestSubmit()`);
await sleep(50);
assert((await evaluate(`document.querySelector('#linkUrlError').textContent`)).includes("HTTP"), "unsupported URL scheme is rejected");

await evaluate(`(() => {
  const input = document.querySelector('#linkUrl');
  input.value = '  https://example.com/smoke?x=1  ';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const form = document.querySelector('#linkForm');
  form.requestSubmit();
  form.requestSubmit();
})()`);
await sleep(450);
let createdCount = await evaluate(`document.querySelectorAll('.public-link-card').length`);
assert(createdCount === 5, "double submission creates exactly one additional result");
assert((await evaluate(`document.querySelector('#formStatus').textContent`)).includes("prototype data only"), "success is labeled prototype-only");

for (const scenario of ["offline", "timeout", "rate-limit", "blocked-destination", "server-error", "malformed-response"]) {
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
    count: document.querySelectorAll('.public-link-card').length
  })`);
  assert(errorState.state === "error", `${scenario} enters the error state`);
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
await evaluate(`window.op4nLinkService.prototypeControls.setCreateScenario('success'); document.querySelector('#formRetryButton').click()`);
await sleep(350);
createdCount += 1;
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
    target: destination.target,
    rel: destination.rel,
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
assert(cardContract.destinationLabel === "Destination URL :", "card labels the destination separately");
assert(cardContract.target === "_blank" && cardContract.rel.includes("noopener") && cardContract.rel.includes("noreferrer"), "destination anchor opens safely");
assert(cardContract.toolbar && cardContract.visibleClicks, "compact toolbar keeps Clicks visible as a number");
assert(cardContract.registeredLabels, "all Registered previews announce their locked state");
assert(cardContract.registeredPreviewContract, "Registered previews stay focusable and non-mutating with exact unlock tooltips");
assert(cardContract.guestTooltips && cardContract.guestIconOnly, "Guest actions use named icon controls");
assert(cardContract.longDestinationContained, "long destination URL stays inside its field with ellipsis");

await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__copiedSmoke = value; } } }); document.querySelector('.copy-link-btn').click()`);
await sleep(50);
assert((await evaluate(`window.__copiedSmoke`)) === cardContract.shortUrl, "Copy writes the full short URL");
assert((await evaluate(`document.querySelector('.copy-link-btn span:last-child').textContent`)) === "Copied", "Copy announces confirmation");

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
assert(exceptions.length === 0, "zero uncaught JavaScript exceptions");

console.log("SMOKE TEST PASSED");
socket.close();
