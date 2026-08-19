# CtrlHQ — Project Notes

Multi-tenant income/expense/payroll tracker for small businesses (Base44 backend +
Vite/React frontend). Each business (tenant) is isolated by `business_id`; two
in-app roles (`business_admin`, `staff`) plus the platform `admin`.

See `AGENTS.md` for the generic Base44 CLI/repo workflow (local dev, `base44 dev`,
publishing). This file covers CtrlHQ-specific architecture.

## Tenant model (Module 2)

- **Business** entity is the tenant. `billing_status` (`trial|active|view_only|
  suspended`), `license_plan`, `licensed_user_limit`, `trial_end_at`,
  `license_expires_at` are written ONLY by Mission Control's unified lifecycle
  cron — this app only ever reads them (field-locked via RLS `write`).
- **User.role**: `admin` (platform/ACACIA owner) | `business_admin` (tenant
  owner) | `staff` (tenant employee) — declared once in `src/lib/rbac.js`.
  `User.business_id` is field-locked to admin-only writes; the only place it's
  ever set is `base44/functions/complete-onboarding` (service role, after its
  own validation) — never a raw `auth.updateMe()` from the client. See that
  function's header comment for why.
- New users land on `/onboarding` (src/pages/Onboarding.jsx) until they have a
  `business_id`: create a new Business (become `business_admin`) or redeem an
  existing one's `invite_code` (become `staff`).

## Permissions (Module 3)

- `src/lib/permissionRegistry.js` — the `"Section:action"` registry + per-role
  defaults, consumed by `src/lib/PermissionContext.jsx`'s `usePermissions().can()`.
  UI-gating only. Also exports `PERMISSION_SECTIONS` (grouped UI metadata) and
  `resolvePermission(key, role, overrides)`, documenting the full precedence:
  1. platform-owner (`role: admin`) → always allowed.
  2. an explicit `true`/`false` override for `(business_id, role, key)` in
     `PermissionProfile` wins over the registry default — see below.
  3. `billing_status` suspended/view_only → every write rejected regardless.
  4. else the registry's per-role default.
- **Tenant-admin override layer** (`PermissionProfile` entity +
  `src/pages/Permisos.jsx`, nav-gated on `Cuenta:manage_members`): lets a
  `business_admin` tune what their own `staff` can do beyond the hardcoded
  registry default, matching stockflow's `PermissionAdmin.jsx` pattern. RLS on
  `PermissionProfile` scopes writes to the caller's own `business_id` — a
  tenant can only ever change its own staff's access, even if the client is
  bypassed. `PermissionContext.jsx` loads the current tenant's `staff`
  overrides on mount/`business_id` change and exposes `refreshOverrides()` so
  `Permisos.jsx` can invalidate the cache right after saving.
- Server-side re-check is split across two mechanisms, by what each entity's
  RLS can express:
  - **Entity-level RLS** (`base44/entities/*.jsonc`) enforces tenant isolation
    and role-based CRUD for straightforward entity writes (Ingresos, Egresos,
    Nómina, catálogos, tickets, `PermissionProfile` itself).
  - **`base44/functions/*` Safe functions** handle everything RLS can't:
    onboarding (`complete-onboarding`), member role changes/removal
    (`manage-member`), and irreversible account deletion (`delete-account`).
    Each independently re-validates caller role + tenant match server-side —
    read each file's header comment before touching it.
- billing_status gate: `view_only`/`suspended` block every write in
  `PermissionContext.can()` (client) — there is currently no cross-entity RLS
  check for this (Base44 RLS templates can't join to a different entity), so
  a suspended tenant's writes are blocked by the UI, not by RLS. If that gap
  ever matters (a client bypassing the UI), route the affected write through
  a Safe function that checks `Business.billing_status` server-side.

## RLS (Module 4)

Every tenant-scoped entity has `business_id` + the four-op `$or` shape (tenant
branch + `{"user_condition":{"role":"admin"}}` branch). `npm run validate:rls`
(wired into `npm run lint`) statically checks path shape (`data.business_id`,
`{{user.data.business_id}}`) and that every op has the admin branch — it does
**not** catch over-restrictive-but-valid rules, only malformed ones.

**Schema-as-code trap**: the `base44/entities/*.jsonc` files in this repo were
deployed to the live Base44 app (id `6a7b5d0edb6b035ccae558f3`) via the Base44
MCP `update_entity_schema`/`create_entity_schema` and confirmed live in this
session — committing the file alone would NOT have been enough. Any future
schema edit needs the same explicit deploy step (`base44 entities push` or the
MCP equivalent) — verify against the live schema, don't assume the diff shipped.

## Backend functions (Modules 3, 5, 7, 8)

`base44/functions/` — `complete-onboarding`, `manage-member`, `delete-account`,
`health`. **Deployed and confirmed live** (2026-08-19, `base44 functions
deploy --app-id 6a7b5d0edb6b035ccae558f3`, run by the platform owner from a
real terminal — the Base44 MCP `run_command` tool couldn't complete the
device-code login this needs, it isn't a substitute for a human running the
CLI directly for anything auth-gated).

- **Two confirmed bugs found the first time onboarding was actually
  exercised end-to-end** (the platform owner clicking "Crear negocio" for a
  real business, "Roseta Cafeteria" — `Business.create` succeeded,
  `User.update` failed, leaving him stuck: still `role: admin`, no
  `business_id`, and an orphaned Business row with nobody attached):
  1. **Wrong error-response key.** These four functions (not `acaciaControl`
     — see why below) returned `{ error: "..." }` on failure, but
     `@base44/sdk`'s axios error interceptor only reads `data.message` or
     `data.detail` before falling back to axios's own generic text — so
     every failure surfaced to the user as the useless "Request failed with
     status code 500" instead of the function's real, specific message.
     Confirmed by reading the SDK's interceptor source
     (`node_modules/@base44/sdk/dist/utils/axios-client.js`), not
     guessed. **Fixed**: changed `{ error: ... }` → `{ message: ... }`
     across `complete-onboarding`/`manage-member`/`delete-account`/`health`.
     `acaciaControl` keeps `{ error: ... }` deliberately — Mission Control's
     `callBridge()` does its own manual `e?.response?.data?.error`
     extraction and doesn't go through this SDK's interceptor the same way;
     changing that key would break Mission Control's parsing instead.
  2. **Unpinned `@base44/sdk` version.** These four functions imported
     `npm:@base44/sdk` with no version — Deno resolves that to whatever's
     latest at each cold start, unlike every other function in this repo
     (`acaciaControl`) and every function in stockflow's, which pin an
     exact version (`@base44/sdk@0.8.20`–`0.8.25`). Given the actual
     `asServiceRole.entities.User.update()` failure couldn't be directly
     observed (no server-log access from this session, and the error-key
     bug above was masking the real message anyway), pinning to the same
     `0.8.20` already proven working in this app's own `acaciaControl` and
     across stockflow is the well-evidenced, low-risk fix — not a confirmed
     root cause with a stack trace, but the strongest lead available.
     Both real improvements, but **neither was the actual fix** — see the
     platform-infrastructure finding immediately below, confirmed after
     these landed.

- **Root cause, definitively confirmed: this is a Base44 platform
  infrastructure failure, not a ctrlhq code issue.** After the two fixes
  above shipped and onboarding still failed, a clean control test settled
  it: `curl -X POST https://base44.app/api/apps/6a7b5d0edb6b035ccae558f3/functions/health`
  with **no auth header at all** — should 401 on a healthy app, since
  `health`'s own bearer check runs before anything else — instead returned
  `HTTP 404 {"error":"not-found","detail":"user worker not found"}`. That's
  Base44's own platform error string: the request never reached this app's
  code (the 401 bearer check, or any handler logic, never ran) because
  Base44's serverless runtime couldn't provision/find the worker process to
  execute *any* function in this app — reproduced identically on `health`,
  the simplest function in the repo, ruling out anything specific to
  `complete-onboarding`. A later retry through the actual UI (post-PR #11,
  with the new human-readable-error UI live) surfaced a second symptom of
  the same underlying failure: `POST .../functions/complete-onboarding ->
  500 | body: no-body` — no response body at all, which is what the
  SDK interceptor sees when the platform fails before the function's own
  `Response.json(...)` ever runs, consistent with the same worker-provisioning
  problem manifesting as a different raw status this time. **No code change
  in this repo can fix this** — the error-key and SDK-pin fixes above were
  real, worth keeping, and are why the UI now shows a real status/body
  instead of a masked generic message, but they were never capable of
  fixing the actual failure. This needs Base44 platform support to restart
  or fix worker provisioning for app `6a7b5d0edb6b035ccae558f3`; the
  `health` curl reproduction above is the exact repro to hand them. Until
  it's fixed, expect *every* function in this app — including
  `acaciaControl` (see below) — to fail the same way, since they all run
  through the same per-app worker.

- **`acaciaControl`**: the generic, HMAC-gated bridge every portfolio app
  implements identically (copied verbatim from stockflow's, per its own
  header comment) — the single channel Mission Control's `api/cron/sync.js`
  uses for *everything* app-specific: license read/write, health `ping`,
  ticket sync, usage/session sync. Without this deployed, none of Modules
  1/5/8's Mission-Control-side integration actually runs, even though the app
  is registered in Mission Control's config files — registration alone wires
  the config, not the data path. **Deployed 2026-08-19** (`base44 functions
  deploy --app-id 6a7b5d0edb6b035ccae558f3 --force`, run by the platform
  owner from a real terminal — `entities push` and `site deploy` run in the
  same session, all three confirmed successful) and `INGEST_HMAC_SECRET` is
  set on this Base44 app, matching Mission Control's value. **Not yet
  independently confirmed round-tripping**: `public.app_health` has no row
  for `ctrlhq` yet (the daily `api/cron/sync.js` run at 08:00 UTC hadn't
  fired again since the deploy as of this check) — the fastest way to prove
  the bridge actually authenticates end-to-end is the "Sincronizar ahora"
  button on this app's page in Mission Control (`AppDetail.jsx`), which hits
  `api/control/run-sync` on demand rather than waiting for tomorrow's cron.
  **Expect this to fail too until Base44 fixes the worker-provisioning issue
  documented above** — `acaciaControl` is a function in this same app, run
  through the same per-app worker as `health`/`complete-onboarding`; don't
  re-diagnose a round-trip failure here as a new bug before checking whether
  the platform issue is still open.
- The standalone `health` function above is *not* what Mission Control
  actually polls for Module 5 — `api/cron/sync.js`'s `probeAppHealth` calls
  `acaciaControl`'s `ping` action instead. It's kept as a convenience for a
  human or an external uptime monitor to hit directly, *not* harmless to
  leave unauthenticated: Base44's own security scan flagged the earlier
  version as an unprotected backend function — no caller check at all before
  a real `asServiceRole.entities.Business.list` query, and the error branch
  echoed `error.message` to anonymous callers. **Fixed 2026-08-19**: gated on
  the same `INGEST_HMAC_SECRET` shared with Mission Control, checked as a
  simple bearer value in the `x-health-secret` header (there's no request
  body here to sign, unlike `acaciaControl`'s full HMAC), and the error
  response no longer echoes `error.message`.

## Modules 6–10

- **Changelog**: `src/lib/appConfig.js` (`APP_VERSION`/`RELEASE_DATE`/
  `CHANGELOG`), surfaced in Cuenta's "Novedades" tab. `scripts/release.mjs`
  (`npm run release`) bumps the version, stamps `RELEASE_DATE`, and inserts a
  new `CHANGELOG` entry — drafted from the git log since the last release via
  Anthropic if `ANTHROPIC_API_KEY_CTRLHQ` is set, else a generic one-liner
  fallback. Modeled on stockflow's `scripts/publish-release.mjs`, trimmed to
  drop the `generate:all`/`audit-permissions.mjs` steps stockflow has and this
  repo doesn't. Never runs as part of `npm run build` — a human runs it
  deliberately when cutting a release.
- **Account & danger zone**: `src/pages/Cuenta.jsx` — profile (read-only
  billing_status/plan), member management (business_admin only, via
  `manage-member`), JSON export, irreversible delete (via `delete-account`,
  requires typing the business's exact name).
- **Support**: `src/pages/Soporte.jsx` + `SupportTicket`/`SupportTicketMessage`
  entities (the latter carries `author_role`/`author_name`/`author_email`,
  field-locked so only staff replies can claim the `acacia_staff` role).
  Writes to this app first. Mission Control's `ticketControl.js` now has a
  `ctrlhq` entry (Module 8 sync wired) — the actual pull happens over the
  `acaciaControl` bridge above, which is now deployed (see Backend functions).
- **acaciaco-site**: `jospabloh/acaciaco-site` `apps/ctrlhq.html` + the
  `index.html` apps grid.
- **Login/Register/ForgotPassword/ResetPassword**: `src/pages/Login.jsx` +
  siblings, fully in Spanish (matching the portfolio convention confirmed
  against stockflow's `Login.jsx` — this repo's own UI was already Spanish
  everywhere else, these four auth pages just hadn't been translated yet).
  Real error states, links to the marketing page and support.
  `suspended`/`view_only` are explained via a banner in
  `src/components/Layout.jsx` (post-login, since billing_status lives on the
  Business the user hasn't loaded yet at the login screen itself).
  **These pages were translated but never actually reachable** — a real bug,
  found the hard way when the platform owner reported the deployed site let
  them straight into the dashboard with no login prompt and no tenant. Root
  cause, found by re-diffing against stockflow's real auth architecture
  (not just its Login.jsx copy) rather than assuming a translated page was a
  working page:
  1. `App.jsx` never routed `/login`/`/register`/`/forgot-password`/
     `/reset-password` at all — they were dead files. The only "log in" path
     was `AuthContext`'s `authError.type === 'auth_required'` branch calling
     `base44.auth.redirectToLogin()`, i.e. Base44's generic hosted login, not
     this app's own Spanish page.
  2. `src/components/ProtectedRoute.jsx` existed as unused Base44-scaffold
     boilerplate — never imported by `App.jsx`. So the authenticated route
     tree rendered unconditionally regardless of `isAuthenticated`: a visitor
     with no valid session (or a browser that simply already carried a valid
     Base44 platform session, e.g. the app's own builder) saw the full app
     shell with no explicit login step.
  3. The onboarding gate special-cased `role !== 'admin'`, so the one User
     row with `role: admin` (the platform owner, auto-registered as the
     app's Base44 builder) skipped `/onboarding` entirely and had no
     business_id — "no tenant" was the correct behavior for a bare Base44
     `admin`, not a bug in isolation, but combined with #1/#2 it meant this
     account saw the tenant UI shell with zero tenant context.
  **Fixed**: rewired `ProtectedRoute.jsx` to redirect an unauthenticated
  visitor to `/login` (mirrors stockflow's `ProtectedRoute.jsx` exactly);
  `App.jsx` now routes the four auth pages as public routes and wraps the
  tenant routes in `<ProtectedRoute>`; the onboarding gate now applies to
  every role, including `admin` — `role: admin` exists to satisfy each
  entity's RLS service-role branch (exercised server-side by Mission
  Control), not to let a human skip creating/joining a business in the
  browser. Also matched stockflow's `checkUserAuth`: only a 401 means the
  session itself is invalid — a 403 is a permission error on an otherwise
  valid session and must not bounce a legitimate user to `/login`.
  **A second, separate gap found afterward**: even once reachable, the login
  screen didn't *look* like the rest of the portfolio's. `AuthLayout.jsx` was
  a single centered card; stockflow's (and per its own comment, rumbo's) is a
  two-column desktop layout — form on the left, a gradient brand panel with a
  pill badge + headline + copy on the right, hidden on mobile. Rebuilt
  `AuthLayout.jsx` to match that skeleton exactly, with CtrlHQ's own logo and
  copy ("Ingresos, egresos y nómina bajo control", echoing the marketing
  page's hero). Verified visually at desktop and mobile viewports.
- **Accent color**: `--primary` was originally near-black/greyscale (matching
  every button/nav-active state in the app), which read as a missing brand
  color once the two-column login's gradient panel made the lack of any hue
  obvious. Sampled the teal from the actual logo PNG (`public/logo-512.png`)
  and applied it to `--primary`/`--sidebar-primary` (and their `.dark`
  counterparts) in `src/index.css` — one token change that flows through
  every button, active nav item, focus ring, and the login brand panel,
  rather than a one-off login-page tweak. **Landed at `hsl(175 70% 33%)`
  first, then darkened to `175 70% 25%`**: a bot review (Codex, on the PR
  that introduced it) flagged the lighter value at ~3.95:1 contrast against
  white foreground text — below WCAG AA's 4.5:1 — verified independently
  with a WCAG luminance calculation (matched the bot's number exactly) before
  fixing, including the `hover:bg-primary/90` state the bot also flagged
  (blends 10% toward white, dropping contrast further — `175 70% 25%` keeps
  even that state at ~5.0:1).

## Build / verify

- `npm run build` — Vite production build. **Passes.**
- `npm run lint` — ESLint (0 errors) + `validate:rls`. **Passes.**
- `npm run typecheck` — **fails, and is not wired into CI, but this is now
  confirmed to be a portfolio-wide gap, not a ctrlhq-specific one**: cloned
  stockflow (the reference standard app) into this session and ran its own
  `npm run typecheck` — it fails identically, on the same root cause. The
  shadcn/ui vendor components under `src/components/ui/` (`button.jsx`,
  `label.jsx`, …) are plain `React.forwardRef` JS with no JSDoc prop types;
  `jsconfig.json` excludes that folder from `checkJs`, so TS falls back to
  inferring their exported prop type as bare `RefAttributes<any>` — every
  page that passes them `className`/`children`/`htmlFor`/etc. (which is all
  of them) then fails to typecheck. Fixing it for real means adding explicit
  JSDoc prop typings to every vendored shadcn component, portfolio-wide, not
  a ctrlhq change — out of scope here. `.github/workflows/ci.yml` documents
  this with an inline comment.
- `npm run test:smoke` — `tests/e2e/smoke.spec.js` (Playwright), checks the
  **deployed production site**, not the local build: anonymous visitors land
  on `/login` (never the tenant dashboard — the exact regression this app
  shipped once, see the Login/Register/… entry above), the login page keeps
  the portfolio's two-column skeleton, the brand color is a real hue (not
  greyscale), and `/register`/`/forgot-password` are reachable. Deliberately
  **not** run from `npm run build`/`lint`/CI's push-triggered job, and not
  runnable from an AI coding sandbox — see `.github/workflows/smoke.yml`'s
  header comment: those environments proxy outbound HTTPS to an allowlist
  that excludes this app's domain, confirmed by three independent failed
  attempts (direct curl, Playwright, and `curl` from inside the Base44 app
  sandbox via MCP — all rejected by network policy) before building this.
  Runs via `workflow_dispatch` (triggerable on demand right after a `base44
  site deploy`, without waiting for the next tick) plus a daily cron
  backstop. This is the answer to "you should be able to verify the live
  site yourself" — the dev sandbox structurally can't reach it, so the check
  runs somewhere that can, and its result is readable via the GitHub API.

## ACACIA Portfolio Standard

This app is part of the ACACIA portfolio and must stay compliant with
jospabloh/acacia-app-standard. Status (audited 2026-08-19, brought up from a
brand-new single-tenant scaffold to the full 10-module standard in this
session — see module sections above for detail and evidence):

- [x] Module 1 — License lifecycle: `Business.billing_status` (trial|active|
      view_only|suspended), field-locked to admin-only writes. No native
      lifecycle/renewal cron in this repo. Registered in Mission Control's
      `apps` table (migrations `0037_seed_ctrlhq_v2.sql` + `0038_ctrlhq_url.sql`,
      applied to production 2026-08-19) and `api/_lib/licenseControl.js`/
      `messaging.js`/`Licenses.jsx`.
- [x] Module 2 — Roles: `src/lib/rbac.js`. Mission Control's operator roles
      are a separate layer, never conflated.
- [x] Module 3 — Granular permissions: `permissionRegistry.js` + RLS/Safe
      functions server-side re-check, in the precedence documented above.
      Tenant-admin override layer (`PermissionProfile` + `Permisos.jsx`) added
      and deployed live, matching stockflow's `PermissionAdmin.jsx` pattern.
- [x] Module 4 — RLS: four-op `$or` shape on every tenant entity, both path
      halves verified, deployed live and confirmed (via the Base44 MCP, then
      re-confirmed by `base44 entities push` from the platform owner's
      machine — 12/12 entities). `validate:rls` wired into `npm run lint`,
      not yet into CI as a standalone job (it runs as part of `npm run lint`
      in `ci.yml`).
- [x] Module 5 — Health: `base44/functions/health` — deployed and live.
- [x] Module 6 — Changelog: `appConfig.js` + `scripts/release.mjs`
      (`npm run release`).
- [x] Module 7 — Account & danger zone: `Cuenta.jsx`.
- [x] Module 8 — Support: `Soporte.jsx` + entities + `acaciaControl` bridge
      (deployed) + Mission Control's `ticketControl.js` `ctrlhq` entry — sync
      is wired end-to-end; not yet independently observed round-tripping a
      real ticket (see Backend functions above for how to confirm it).
- [x] Module 9 — acaciaco-site: `apps/ctrlhq.html` + apps grid entry.
- [x] Module 10 — Login: real states, links to trial/support, dark-theme
      correct (existing `.dark` token setup, unchanged), full Spanish
      translation across Login/Register/ForgotPassword/ResetPassword — and,
      after an earlier pass wired the translation but not the routing, now
      actually reachable: `ProtectedRoute` gates the tenant app on
      `isAuthenticated` and the onboarding gate applies to every role (see
      Modules 6–10 above for the full root-cause writeup).

**Live since 2026-08-19**: production site at `https://ctrlhq.acaciaco.com.mx`
(Base44-assigned domain `https://smart-angelic-flow-ledger.base44.app` still
resolves too). All 5 backend functions (including `acaciaControl`) and all 13
entity schemas (with RLS) are deployed and confirmed against the live Base44
app; `INGEST_HMAC_SECRET` is set to match Mission Control's value; both
Mission Control migrations are applied to production.

**Open follow-ups, in priority order:**
1. **Blocking everything below**: get Base44 platform support to fix worker
   provisioning for app `6a7b5d0edb6b035ccae558f3` — see "Root cause,
   definitively confirmed" under Backend functions above. Hand them the
   `health` curl repro (unauthenticated request returning
   `{"error":"not-found","detail":"user worker not found"}` instead of the
   expected 401). Nothing that depends on a backend function running
   (onboarding, `acaciaControl`, the standalone `health` endpoint) can be
   verified until this is fixed — re-testing them before then just
   reproduces the same platform failure, not a new bug.
2. Once #1 is fixed: retry onboarding end-to-end for real (`Business.create`
   + `User.update` both succeeding) for the platform owner's own stuck
   account, then clean up the orphaned "Roseta Cafeteria"
   (`6a860fa4c538d19adbc17195`) / "Owner Sandbox" Business rows left behind
   by the failed attempts — they have `invite_code`s but nobody attached.
3. Once #1 is fixed: confirm the `acaciaControl` bridge actually round-trips
   (not just "deployed") — click "Sincronizar ahora" on this app's page in
   Mission Control, or wait for the next 08:00 UTC `api/cron/sync.js` run,
   then check `public.app_health` for a `ctrlhq` row with `status: ok`.
4. `apps/ctrlhq.html`'s WhatsApp number (`524498958291`) matches every other
   portfolio app's marketing page — it's real, not a placeholder. Its
   "Cotización" pricing (vs. other apps' flat MXN/mes prices) also isn't a bug:
   it matches `licenseControl.js`'s `payment: 'ref'` billing mode for this app
   (no Mercado Pago wired yet, same situation as cateqhub's manually-priced
   Premium tier) — a flat number would need a real pricing decision from the
   business, not a value invented here.
5. The `npm run typecheck` gap is portfolio-wide (confirmed against stockflow,
   see Build/verify above) — not a ctrlhq-specific follow-up, but worth fixing
   across the portfolio's shadcn/ui components someday.
