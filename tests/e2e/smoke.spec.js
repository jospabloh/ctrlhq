// Live-site smoke test (Module 10 + auth gate). Runs from GitHub Actions
// (workflow_dispatch, see .github/workflows/smoke.yml) — NOT locally or from
// any AI sandbox with restricted network egress, which is exactly why this
// exists: no tool available inside the development sandbox that produced
// this repo can reach the production domain directly (outbound HTTPS is
// proxied to an allowlist that doesn't include it), so this is the only
// automated way to verify the *deployed* site — not just the local build —
// actually shows the right thing to a real, unauthenticated visitor.
//
// Covers exactly the regression this app shipped once already: an
// unauthenticated visitor landing on the tenant dashboard shell instead of
// the login page (see CLAUDE.md's "Login/Register/ForgotPassword/
// ResetPassword" section for the incident writeup).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SMOKE_URL || "https://ctrlhq.acaciaco.com.mx";

test.describe("CtrlHQ production smoke test", () => {
  test.use({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });

  test("anonymous visitor lands on /login, never the tenant dashboard", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // The auth gate (ProtectedRoute) must redirect here — this is the exact
    // failure mode reported live: no redirect, full dashboard shell with a
    // null user.
    await expect(page).toHaveURL(/\/login$/);

    await expect(page.getByRole("heading", { name: "Bienvenido a CtrlHQ" })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Never render tenant nav/data for a signed-out visitor.
    await expect(page.getByRole("link", { name: "Resumen" })).toHaveCount(0);
    await expect(page.getByText("Ingresos del mes")).toHaveCount(0);
  });

  test("login page matches the portfolio's two-column skeleton on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login", { waitUntil: "networkidle" });

    // Form column + brand panel, side by side (stockflow/rumbo pattern —
    // see AuthLayout.jsx's header comment). A regression back to the old
    // single centered card would collapse this to one column.
    const brandPanel = page.getByText("Gestión financiera");
    await expect(brandPanel).toBeVisible();
    const box = await brandPanel.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThan(viewport.width / 2);
  });

  test("brand color is a real hue, not greyscale", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "Iniciar sesión" });
    await expect(button).toBeVisible();
    const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    // Greyscale means r ≈ g ≈ b; a real accent color has a wide spread
    // between channels. Catches a regression back to the near-black default.
    expect(spread).toBeGreaterThan(20);
  });

  test("registered auth pages are reachable directly", async ({ page }) => {
    for (const path of ["/register", "/forgot-password"]) {
      const res = await page.goto(path, { waitUntil: "networkidle" });
      expect(res.status(), `${path} should respond 200`).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });
});
