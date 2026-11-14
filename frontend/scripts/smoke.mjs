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

async function launch() {
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
function watch(page, name) {
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') failures.push(`${name}: console ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', error => failures.push(`${name}: uncaught ${error.message}`));
}

const byTestId = (page, id) => page.getByTestId(id);
const isPressed = async locator => (await locator.getAttribute('aria-pressed')) === 'true';
const routeSentCount = page => page.evaluate(() => window.__marsMission.getSnapshot().log.filter(e => e.type === 'route-sent').length);

/** Lets the map tiles arrive before a screenshot; the imagery is live from NASA, so this is best effort. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

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
  check((await page.getByTestId('live-placeholder').textContent())?.includes('ARRIVES IN'), 'Live shows the route in transit');
  await page.screenshot({ path: `${OUT_DIR}live-placeholder.png` });

  await page.reload();
  await byTestId(page, 'live-placeholder').waitFor();
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
