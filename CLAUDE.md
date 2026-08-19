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
- The standalone `health` function above is *not* what Mission Control
  actually polls for Module 5 — `api/cron/sync.js`'s `probeAppHealth` calls
  `acaciaControl`'s `ping` action instead. `health` is harmless to keep (a
  human or an uptime tool can still hit it directly) but isn't the real
  integration point.

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
      translation across Login/Register/ForgotPassword/ResetPassword.

**Live since 2026-08-19**: production site at `https://ctrlhq.acaciaco.com.mx`
(Base44-assigned domain `https://smart-angelic-flow-ledger.base44.app` still
resolves too). All 5 backend functions (including `acaciaControl`) and all 13
entity schemas (with RLS) are deployed and confirmed against the live Base44
app; `INGEST_HMAC_SECRET` is set to match Mission Control's value; both
Mission Control migrations are applied to production.

**Open follow-ups, in priority order:**
1. Confirm the `acaciaControl` bridge actually round-trips (not just
   "deployed") — click "Sincronizar ahora" on this app's page in Mission
   Control, or wait for the next 08:00 UTC `api/cron/sync.js` run, then check
   `public.app_health` for a `ctrlhq` row with `status: ok`.
2. `apps/ctrlhq.html`'s WhatsApp number (`524498958291`) matches every other
   portfolio app's marketing page — it's real, not a placeholder. Its
   "Cotización" pricing (vs. other apps' flat MXN/mes prices) also isn't a bug:
   it matches `licenseControl.js`'s `payment: 'ref'` billing mode for this app
   (no Mercado Pago wired yet, same situation as cateqhub's manually-priced
   Premium tier) — a flat number would need a real pricing decision from the
   business, not a value invented here.
3. The `npm run typecheck` gap is portfolio-wide (confirmed against stockflow,
   see Build/verify above) — not a ctrlhq-specific follow-up, but worth fixing
   across the portfolio's shadcn/ui components someday.
