// Live-site smoke test — shared across the ACACIA portfolio, byte-identical in
// every repo. Everything app-specific lives in ./smoke.config.js next to it.
//
// WHAT THIS IS FOR, and why it is not part of the normal pipeline
// ----------------------------------------------------------------------------
// It checks the DEPLOYED site, not a local build. That is the whole point. The
// portfolio's most expensive recurring failure is not a broken build — builds
// are green — it is a change that merged to `main` and was never served:
// flowfin's tutorial fix sat unserved for four hours, and `guardedEntityWrite`
// answered 404 on the main write paths for three days while its client code was
// already live. Every CLAUDE.md now says "merging deploys nothing; verify by
// content, not by a commit hash". This is that verification, automated.
//
// It cannot run from a development sandbox: outbound HTTPS there is proxied to
// an allowlist that excludes these domains. It runs from GitHub Actions —
// `workflow_dispatch` right after a deploy, plus a daily cron as the backstop
// for the regression nobody thought to trigger it for.
//
//   npm run test:smoke                      # the configured production URL
//   SMOKE_URL=https://… npm run test:smoke  # a preview deployment
//
// WHAT IT ASSERTS, and why only this much
// ----------------------------------------------------------------------------
// Only what this repo's own source provably produces: the document title, the
// pre-mount theme script, and the theme switcher's own markup. Assertions
// invented from guessed page copy break on a wording change and teach everyone
// to ignore the suite. Put app-specific checks in a sibling spec file — see
// ctrlhq's auth-gate tests — and keep this one shared and identical.
import { test, expect } from '@playwright/test';
import config from './smoke.config.js';

const BASE_URL = process.env.SMOKE_URL || config.url;

// './' rather than '/': Plink FX is served from a sub-path
// (acaciaco.com.mx/freeware/plink-fx/), and an absolute '/' would resolve to
// the domain root and quietly test the wrong site. A sub-path url must keep its
// trailing slash for this to land on the page itself.
const HOME = './';

// The switcher's own semantics, the same in the React component, the vanilla
// twin and Plink FX's board-native copy: one collapsed button that expands, and
// three radios behind it in the order Claro · Oscuro · Sistema. Only the root
// element differs per stack, so only that is configured.
const BUBBLE = 'button[aria-expanded]';
const SLOT = '[role="radio"]';
const DARK_SLOT = 1;
const LIGHT_SLOT = 0;

// The switcher is pinned to a corner, above everything, on every screen — which
// is exactly the shape of thing that ends up sitting on top of a mobile tab bar
// or a floating action button. Each app places it with
// --theme-switcher-bottom/right and lifts it over its own bottom chrome; this is
// what proves the app actually did, at the sizes people use.
const VIEWPORTS = [
  { name: 'móvil', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'escritorio', width: 1440, height: 900 },
];

/** Clears whatever one-time overlay the site shows a first-time visitor. */
async function dismissOverlay(page) {
  if (!config.dismissOverlay) return;
  const overlay = page.locator(config.dismissOverlay);
  if (await overlay.count()) {
    await overlay.first().click();
    await page.waitForTimeout(400);
  }
}

/** The colour actually on screen, however this app represents it. */
function readTheme(page) {
  return page.evaluate(() => ({
    classDark: document.documentElement.classList.contains('dark'),
    attr: document.documentElement.getAttribute('data-theme'),
    colorScheme: document.documentElement.style.colorScheme,
    appClass: document.querySelector('.app')?.className || '',
  }));
}

/**
 * Runs in the page. Answers two questions about the corner switcher at the
 * current viewport: can it be reached, and is it stealing anyone's clicks.
 *
 * Both are decided with elementFromPoint rather than by comparing rectangles,
 * because overlap on its own is not a fault — a control clipped at one corner
 * by a rounded bubble is still perfectly usable. What matters is whether the
 * point a person actually aims at belongs to the thing they meant to press.
 */
function inspectCorner(rootSel) {
  const root = document.querySelector(rootSel);
  if (!root) return { missing: true };

  const box = root.getBoundingClientRect();
  const mid = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  const onScreen = ([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;

  // Nothing may be painted over the switcher itself.
  const [cx, cy] = mid(box);
  const atCentre = document.elementFromPoint(cx, cy);
  const covered = !atCentre || !root.contains(atCentre);

  // …and the switcher may not be what answers for someone else's control.
  const SEL = 'a[href], button, input, select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [role="switch"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const stolen = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (root.contains(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') continue;
    if (parseFloat(st.opacity) === 0) continue;
    const point = mid(r);
    if (!onScreen(point)) continue;
    const hit = document.elementFromPoint(point[0], point[1]);
    if (!hit || !root.contains(hit)) continue;
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    stolen.push(`<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''}> ${name || '(sin texto)'}`);
  }
  return { covered, stolen };
}

function isDark(state) {
  if (config.theme.kind === 'class') return state.classDark;
  if (config.theme.kind === 'attribute') return state.attr === 'dark';
  if (config.theme.kind === 'plink') return state.appClass.includes('theme-ink');
  return false;
}

test.describe(`${config.name} · smoke`, () => {
  test.use({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });

  test('responds, and is this app', async ({ page }) => {
    const res = await page.goto(HOME, { waitUntil: 'networkidle' });
    expect(res.status(), 'the deployed site should answer 200').toBe(200);
    await expect(page).toHaveTitle(config.title);
  });

  test('renders without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(HOME, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    expect(errors, 'no uncaught exception on first paint').toEqual([]);
  });

  test.describe('tema', () => {
    test.skip(config.theme.kind === 'none', 'this app ships one theme on purpose');

    test('the theme is painted before the app mounts', async ({ page }) => {
      // The pre-mount script is what keeps the first frame from flashing the
      // wrong colour. A deploy that did not carry it leaves the root element
      // reaching the browser with no resolved theme on it at all.
      //
      // Plink FX has no pre-mount script and needs none: it themes its own
      // board element rather than <html>, and nothing is painted until React
      // has run, so there is no earlier frame to get wrong.
      test.skip(config.theme.kind === 'plink', 'this app themes its board, not <html>');
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      const state = await readTheme(page);
      if (config.theme.kind === 'attribute') {
        expect(['light', 'dark'], 'data-theme resolved before paint').toContain(state.attr);
      }
      expect(state.colorScheme, 'color-scheme keeps native controls in step').toMatch(/light|dark/);
    });

    test('the switcher is mounted, and switching works', async ({ page }) => {
      await page.goto(HOME, { waitUntil: 'networkidle' });
      await dismissOverlay(page);

      const root = page.locator(config.theme.root);
      await expect(root, 'the corner switcher belongs on every screen').toBeVisible();

      await root.locator(BUBBLE).click();
      const slots = root.locator(SLOT);
      await expect(slots, 'Claro · Oscuro · Sistema').toHaveCount(3);

      await slots.nth(DARK_SLOT).click();
      await expect.poll(async () => isDark(await readTheme(page))).toBe(true);

      await slots.nth(LIGHT_SLOT).click();
      await expect.poll(async () => isDark(await readTheme(page))).toBe(false);
    });

    test('the chosen theme survives a reload', async ({ page }) => {
      await page.goto(HOME, { waitUntil: 'networkidle' });
      await dismissOverlay(page);

      const root = page.locator(config.theme.root);
      await root.locator(BUBBLE).click();
      await root.locator(SLOT).nth(DARK_SLOT).click();
      await expect.poll(async () => isDark(await readTheme(page))).toBe(true);

      await page.reload({ waitUntil: 'networkidle' });
      expect(isDark(await readTheme(page)), 'the preference must outlive the page').toBe(true);
    });

    test('the switcher covers nothing, at every size', async ({ page }) => {
      // A corner control that sits on top of a mobile tab bar, a floating
      // action button or a sticky "Guardar" is not a small cosmetic problem —
      // it is a function of the app the operator can no longer reach, and it
      // only shows up at the one width nobody opened. Checked collapsed and
      // expanded, since the track is at its widest once open.
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(HOME, { waitUntil: 'networkidle' });
        await dismissOverlay(page);

        const root = page.locator(config.theme.root);
        await expect(root, `the switcher belongs on ${vp.name} too`).toBeVisible();

        for (const state of ['plegado', 'desplegado']) {
          if (state === 'desplegado') {
            await root.locator(BUBBLE).click();
            await page.waitForTimeout(450); // the track finishes growing
          }
          const seen = await page.evaluate(inspectCorner, config.theme.root);
          expect(seen.missing, `the switcher is not in the DOM on ${vp.name}`).toBeFalsy();
          expect(seen.covered, `something is painted over the switcher on ${vp.name} (${state})`).toBe(false);
          expect(
            seen.stolen,
            `the switcher is taking the clicks meant for these, on ${vp.name} (${state})`
          ).toEqual([]);
        }
      }
    });
  });

  test.describe('tema único', () => {
    test.skip(config.theme.kind !== 'none', 'this app offers three themes');

    test('ships no theme switcher, deliberately', async ({ page }) => {
      // Not an oversight — see this app's CLAUDE.md. A control with a single
      // working option is worse than no control, so the absence is the
      // requirement and this is what holds it in place.
      await page.goto(HOME, { waitUntil: 'networkidle' });
      await expect(page.locator('[data-theme-switcher]')).toHaveCount(0);
    });
  });
});
