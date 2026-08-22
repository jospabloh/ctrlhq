// Config for tests/smoke/ only — a live-site check, not part of
// the regular unit/build pipeline (see that file's header comment for why
// it exists and where it runs). Not used by `npm run build`/`npm run lint`.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    screenshot: "only-on-failure",
  },
});
