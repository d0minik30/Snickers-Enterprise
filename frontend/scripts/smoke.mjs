// Browser smoke test for the running app: `npm run dev`, then `npm run smoke`.
// Drives an installed Edge (or Chrome) through playwright-core; it never downloads a browser.
// Any failed check, console error or warning, or uncaught page error makes it exit non-zero.

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT_DIR = fileURLToPath(new URL('../.smoke/', import.meta.url));
const SCREENSHOT_WIDTHS = [
  { width: 1120, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const failures = [];

function check(ok, what) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
}

/** Edge, then Chrome; BROWSER_PATH points at any other Chromium build (for example on Linux or in CI). */
async function launch() {
  if (process.env.BROWSER_PATH) return chromium.launch({ executablePath: process.env.BROWSER_PATH });
  let lastError;
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Fails the run on anything the page itself reports as wrong. */
function watch(page, name, { allowFailedLoads = false } = {}) {
  page.on('console', msg => {
    if (allowFailedLoads && msg.text().startsWith('Failed to load resource')) return;
    // Chrome's timing heuristic for font preloads on the static build; the fonts do load and are used.
    if (msg.text().includes('was preloaded using link preload but not used')) return;
    if (msg.type() === 'error' || msg.type() === 'warning') failures.push(`${name}: console ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', error => failures.push(`${name}: uncaught ${error.message}`));
}

const byTestId = (page, id) => page.getByTestId(id);
const isPressed = async locator => (await locator.getAttribute('aria-pressed')) === 'true';
const routeSentCount = page => page.evaluate(() => window.__marsMission.getSnapshot().log.filter(e => e.type === 'route-sent').length);
const setRate = (page, rate) => page.evaluate(r => window.__marsMission.setRate(r), rate);
const fieldStatus = page => byTestId(page, 'field-status').getAttribute('data-status');

/** Waits until the Field page reports `status`; false after `timeout` ms. */
const waitForStatus = (page, status, timeout = 15_000) => page
  .waitForFunction(s => document.querySelector('[data-testid="field-status"]')?.getAttribute('data-status') === s, status, { timeout })
  .then(() => true, () => false);

/** Waits until the comms entry containing `text` reaches `status`; false after `timeout` ms. */
const waitForUplink = (control, text, status, timeout = 15_000) => control
  .waitForFunction(([t, st]) => [...document.querySelectorAll('[data-testid="uplink"]')]
    .some(e => e.textContent.includes(t) && e.getAttribute('data-status') === st), [text, status], { timeout })
  .then(() => true, () => false);

/** Runs the mission clock at 600x until `until` resolves, then back to 30x. */
async function fastForward(control, until) {
  await setRate(control, 600);
  try {
    return await until();
  } finally {
    await setRate(control, 30);
  }
}

/** Lets the map tiles arrive before a screenshot; the imagery is live from NASA, so this is best effort. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/**
 * Runs in every page before the app: remembers the canvas angle the traveller arrow (a path starting at (0, -tip))
 * was last drawn at on the map, and on which canvas, so a check can add the canvas's own CSS rotation.
 */
function recordTravellerArrow() {
  const P = CanvasRenderingContext2D.prototype;
  const moveTo = P.moveTo;
  P.moveTo = function (x, y) {
    if (x === 0 && y < 0 && this.canvas.closest?.('[data-testid="mars-map"]')) {
      const t = this.getTransform();
      window.__arrow = { canvas: this.canvas, drawnDeg: (Math.atan2(t.b, t.a) * 180) / Math.PI };
    }
    return moveTo.call(this, x, y);
  };
}

/** The traveller arrow's direction on screen, in degrees clockwise from straight up; null if none was drawn. */
const arrowScreenDeg = page => page.evaluate(() => {
  const a = window.__arrow;
  if (!a) return null;
  const m = new DOMMatrix(getComputedStyle(a.canvas).transform);
  const css = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  return ((((a.drawnDeg + css) % 360) + 540) % 360) - 180; // -180..180, 0 = up the screen
});

/** The heading the Field HUD shows, in degrees, or null. */
const fieldHeading = page => page.evaluate(() => {
  const cell = [...document.querySelectorAll('[data-testid="field-next-move"] ~ * span')].find(s => /^\d{1,3}°$/.test(s.textContent.trim()));
  return cell ? Number(cell.textContent.trim().slice(0, -1)) : null;
});

async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('header');
    return document.documentElement.scrollWidth <= window.innerWidth && bar !== null && bar.scrollWidth <= bar.clientWidth;
  });
}

async function planMode(page) {
  await page.goto(`${BASE_URL}/control/`);
  await byTestId(page, 'route-card-safest').waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT_DIR}plan.png` });

  const cards = ['safest', 'shortest', 'flattest'].map(p => byTestId(page, `route-card-${p}`));
  check((await Promise.all(cards.map(c => c.count()))).every(n => n === 1), 'three route cards');
  check(await isPressed(cards[0]), 'route-card-safest is selected at first');
  await cards[2].click();
  check(await isPressed(cards[2]) && !(await isPressed(cards[0])), 'clicking route-card-flattest selects it');
  check((await byTestId(page, 'send-route').textContent())?.includes('ROUTE C'), 'send button names route C');
  await cards[0].click();
  check(await isPressed(cards[0]), 'clicking route-card-safest selects it again');

  const onFoot = await cards[0].textContent();
  await byTestId(page, 'plan-traveller-rover').click();
  check((await cards[0].textContent()) !== onFoot, 'switching to rover changes the route times');
  await byTestId(page, 'plan-traveller-astronaut').click();
  check((await cards[0].textContent()) === onFoot, 'switching back restores them');

  const arm = byTestId(page, 'plan-arm-start');
  await arm.click();
  check(await isPressed(arm), 'arm start');
  await page.keyboard.press('Escape');
  check(!(await isPressed(arm)), 'Escape disarms');
  const startText = await page.locator('[data-armed]').first().textContent();
  await byTestId(page, 'mars-map').click();
  check((await page.locator('[data-armed]').first().textContent()) === startText, 'an unarmed map click changes nothing');

  for (const size of SCREENSHOT_WIDTHS) {
    await page.setViewportSize(size);
    await settle(page);
    check(await noHorizontalOverflow(page), `nothing overflows at ${size.width} px`);
    await page.screenshot({ path: `${OUT_DIR}plan-${size.width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function sendRoute(page) {
  await byTestId(page, 'send-route').click();
  check(await routeSentCount(page) === 1, 'the log has one route-sent event');
  check((await byTestId(page, 'tab-live').getAttribute('aria-selected')) === 'true', 'Control switches to Live');
  check((await byTestId(page, 'uplink').first().getAttribute('data-status')) === 'in-transit', 'Live shows the route in transit');
  check((await byTestId(page, 'uplink').first().textContent())?.includes('ARRIVES IN'), 'with a countdown');
  await settle(page);
  await page.screenshot({ path: `${OUT_DIR}live-transit.png` });

  await page.reload();
  await byTestId(page, 'data-age').waitFor();
  check((await byTestId(page, 'tab-live').getAttribute('aria-selected')) === 'true', 'after a reload Control opens on Live');
  check(await routeSentCount(page) === 1, 'the route survives the reload');

  await byTestId(page, 'tab-plan').click();
  check(await byTestId(page, 'send-route').count() === 0, 'Plan offers no second send while a mission runs');
  check((await page.getByText('MISSION IN PROGRESS').count()) === 1, 'Plan says the mission is in progress');
}

async function demoControls(page, other) {
  const rate10 = byTestId(page, 'demo-rate').locator('[data-rate="10"]');
  await rate10.click();
  check(await isPressed(rate10), 'rate 10× is applied');
  const followed = await other
    .waitForFunction(() => window.__marsMission.getSnapshot().clock.rate === 10, null, { timeout: 3000 })
    .then(() => true, () => false);
  check(followed, 'the other window follows the rate');
  await byTestId(page, 'demo-rate').locator('[data-rate="30"]').click();

  const pause = byTestId(page, 'demo-pause');
  await pause.click();
  check(await isPressed(pause), 'pause');
  await pause.click();
  check(!(await isPressed(pause)), 'resume');

  // Reset from the other window: this one must come back to a fresh plan without complaint.
  const reset = byTestId(other, 'demo-reset');
  await reset.click();
  check((await reset.textContent()) === 'CONFIRM RESET', 'reset asks for confirmation');
  await reset.click();
  await byTestId(page, 'send-route').waitFor();
  check(await routeSentCount(page) === 0, 'reset empties the log');
  check((await byTestId(page, 'tab-plan').getAttribute('aria-selected')) === 'true', 'reset returns Control to Plan');
  check(await isPressed(byTestId(page, 'route-card-safest')), 'with the default draft');
}

/** Moves start and end onto the map centre in turn; each refit halves their distance until they are too close. */
async function tooClose(page) {
  const map = byTestId(page, 'mars-map');
  for (let i = 0; i < 16 && (await page.getByText('START AND END ARE TOO CLOSE').count()) === 0; i++) {
    await byTestId(page, i % 2 === 0 ? 'plan-arm-start' : 'plan-arm-end').click();
    await map.click();
  }
  check((await page.getByText('START AND END ARE TOO CLOSE').count()) === 1, 'start and end too close: cards replaced');
  check(await byTestId(page, 'send-route').isDisabled(), 'start and end too close: send disabled');
  await page.screenshot({ path: `${OUT_DIR}plan-too-close.png` });
}

/** Task 8: the Field HUD from awaiting a route to moving, and a reload mid-traverse (Review Focus 1). */
async function fieldRun(control, field) {
  await field.goto(`${BASE_URL}/field/`);
  await byTestId(field, 'field-status').waitFor();
  check(await waitForStatus(field, 'awaiting-route', 3000), 'Field waits for a route');
  await settle(field);
  await field.screenshot({ path: `${OUT_DIR}field-awaiting.png` });

  await byTestId(control, 'send-route').click();
  check(await fastForward(control, () => waitForStatus(field, 'ready')), 'the route reaches Field after the delay');
  await byTestId(field, 'field-start').click();
  check(await waitForStatus(field, 'moving', 3000), 'Start sets the traveller moving');
  check(((await byTestId(field, 'field-next-move').textContent()) ?? '').trim().length > 0, 'Field shows the next move');
  await settle(field);
  await field.screenshot({ path: `${OUT_DIR}field.png` });

  await field.reload();
  check(await waitForStatus(field, 'moving', 2000), 'after a reload Field is still moving, without pressing Start');

  for (const width of [360, 390, 430]) {
    await field.setViewportSize({ width, height: 800 });
    const fits = await field.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(fits, `Field fits at ${width} px`);
  }
  await field.setViewportSize({ width: 390, height: 844 });

  // The map turns to face the heading, so the arrow must point up the screen whatever the heading is.
  // Walk on until the heading is well away from north, so an arrow stuck on north would show.
  const offNorth = () => field.waitForFunction(() => {
    const cell = [...document.querySelectorAll('[data-testid="field-next-move"] ~ * span')].find(s => /^\d{1,3}°$/.test(s.textContent.trim()));
    const h = cell ? Number(cell.textContent.trim().slice(0, -1)) : NaN;
    return Math.min(h, 360 - h) > 30;
  }, null, { timeout: 15_000 }).then(() => true, () => false);
  check(await fastForward(control, offNorth), 'the heading turns well away from north');
  await field.waitForTimeout(500);
  const heading = await fieldHeading(field);
  const arrow = await arrowScreenDeg(field);
  check(arrow !== null && Math.abs(arrow) < 5, `the Field arrow points up the screen, along the route (heading ${heading}°, arrow ${arrow?.toFixed(1)}°)`);
}

/** Task 9: Live mode: a hazard flag and reroute, orders, a message and its acknowledgement. Early in the walk, so all of it lands before arrival. */
async function liveRun(control, field) {
  check(((await byTestId(control, 'data-age').textContent()) ?? '').includes('11:20'), 'Live states the field data is 11:20 old');

  // Reduced motion in Field from here, so the route-change cue that follows must not animate.
  await field.emulateMedia({ reducedMotion: 'reduce' });
  const before = await control.evaluate(() => window.__marsMission.getSnapshot().log.length);
  await byTestId(control, 'flag-hazard').click();
  await byTestId(control, 'mars-map').click();
  await control.waitForTimeout(300);
  const log = await control.evaluate(() => window.__marsMission.getSnapshot().log);
  check(log.length === before + 1 && log.at(-1).type === 'route-changed', 'flagging a hazard early sends a new route');
  check(await control.locator('[data-testid="uplink"]', { hasText: 'Route changed' }).getAttribute('data-status') === 'in-transit',
    'the new route is shown in transit');
  await settle(control);
  await control.screenshot({ path: `${OUT_DIR}live.png` });

  // Hold first, then the message, so the message is the newest notice when both land.
  await byTestId(control, 'order-hold').click();
  const text = 'Sample at next waypoint';
  await byTestId(control, 'msg-input').fill(text);
  await byTestId(control, 'msg-send').click();
  const entry = control.locator('[data-testid="uplink"]', { hasText: text });
  await entry.waitFor();
  check((await entry.getAttribute('data-status')) === 'in-transit', 'a new message is in transit');

  // A photo fix in Field reaches Control as a downlink after the delay.
  await byTestId(field, 'field-photo-fix').click();
  check(await field.getByTestId('field-fix-cue').waitFor({ timeout: 3000 }).then(() => true, () => false), 'Field shows FIX ACQUIRED after a photo fix');
  check(await fastForward(control, () => waitForStatus(field, 'holding')), 'a hold order stops the traveller when it lands');
  check(await control.locator('[data-testid="downlink"][data-kind="photo-fix"]').count() === 1, 'Control receives the photo fix after the delay');
  check(await field.evaluate(() => document.getAnimations().length === 0), 'nothing animates in Field under reduced motion');
  // The message left a moment after the hold order, so it lands a moment later: wait for it.
  check(await fastForward(control, () => waitForUplink(control, text, 'delivered')), 'the message is delivered after the delay');
  const strip = byTestId(field, 'field-message');
  const shown = await strip.filter({ hasText: text }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(shown, 'Field shows the message');
  await settle(field);
  await field.screenshot({ path: `${OUT_DIR}field-live.png` });
  await strip.click();

  await byTestId(control, 'order-proceed').click();
  check(await fastForward(control, () => waitForStatus(field, 'moving')), 'a proceed order restarts it');
  check(await fastForward(control, () => waitForUplink(control, text, 'acknowledged')), 'Control sees the acknowledgement after the delay');
}

/** Task 10: NASA unreachable (Review Focus 2). Routes and the send button must still work. */
async function offline(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/trek.nasa.gov/**', r => r.abort());
  const page = await context.newPage();
  watch(page, 'offline control', { allowFailedLoads: true });
  await page.goto(`${BASE_URL}/control/`);
  const strip = byTestId(page, 'tiles-unavailable');
  check(await strip.waitFor({ timeout: 15_000 }).then(() => true, () => false), 'offline: the imagery message appears');
  check(await byTestId(page, 'route-card-safest').count() === 1, 'offline: route cards still there');
  await page.screenshot({ path: `${OUT_DIR}offline.png` });
  await byTestId(page, 'send-route').click();
  check(await routeSentCount(page) === 1, 'offline: sending still works');
  await context.close();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(recordTravellerArrow);
    const control = await context.newPage();
    watch(control, 'control');
    console.log('Plan mode');
    await planMode(control);
    console.log('Sending');
    await sendRoute(control);

    const second = await context.newPage();
    watch(second, 'second control');
    await second.goto(`${BASE_URL}/control/`);
    await byTestId(second, 'tab-live').waitFor();
    console.log('Demo controls');
    await demoControls(control, second);
    await second.close();

    console.log('Too close');
    await tooClose(control);

    console.log('Field');
    await control.evaluate(() => window.__marsMission.reset());
    await control.reload();
    await byTestId(control, 'send-route').waitFor();
    const field = await context.newPage();
    watch(field, 'field');
    await field.setViewportSize({ width: 390, height: 844 });
    await fieldRun(control, field);

    console.log('Live');
    await liveRun(control, field);
    await context.close();

    console.log('Offline');
    await offline(browser);
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  failures.push(`smoke run stopped: ${error.message}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n${failures.map(f => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nsmoke ok');
