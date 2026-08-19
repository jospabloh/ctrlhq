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
  UI-gating only.
- Server-side re-check is split across two mechanisms, by what each entity's
  RLS can express:
  - **Entity-level RLS** (`base44/entities/*.jsonc`) enforces tenant isolation
    and role-based CRUD for straightforward entity writes (Ingresos, Egresos,
    Nómina, catálogos, tickets).
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

## Backend functions (Modules 3, 5, 7)

`base44/functions/` — `complete-onboarding`, `manage-member`, `delete-account`,
`health`. **Deployed and confirmed live** (2026-08-19, `base44 functions
deploy --app-id 6a7b5d0edb6b035ccae558f3`, run by the platform owner from a
real terminal — the Base44 MCP `run_command` tool couldn't complete the
device-code login this needs, it isn't a substitute for a human running the
CLI directly for anything auth-gated).

## Modules 6–10

- **Changelog**: `src/lib/appConfig.js` (`APP_VERSION`/`RELEASE_DATE`/
  `CHANGELOG`), surfaced in Cuenta's "Novedades" tab. No release script exists
  yet (`scripts/release.mjs` referenced by the standard is not built) — bump
  this file by hand until one exists; never regenerate it from `npm run build`.
- **Account & danger zone**: `src/pages/Cuenta.jsx` — profile (read-only
  billing_status/plan), member management (business_admin only, via
  `manage-member`), JSON export, irreversible delete (via `delete-account`,
  requires typing the business's exact name).
- **Support**: `src/pages/Soporte.jsx` + `SupportTicket`/`SupportTicketMessage`
  entities. Writes to this app first. Mission Control's own sync (not yet
  built — see acacia-mission-control's `apps.config.ticket_entity` for this
  app, already pointed at these entity names) is what pulls them into the
  shared `tickets` bodega; there is no push from this app yet.
- **acaciaco-site**: `jospabloh/acaciaco-site` `apps/ctrlhq.html` + the
  `index.html` apps grid.
- **Login**: real error state, links to the marketing page and support
  (`src/pages/Login.jsx`); `suspended`/`view_only` are explained via a banner
  in `src/components/Layout.jsx` (post-login, since billing_status lives on
  the Business the user hasn't loaded yet at the login screen itself).

## Build / verify

- `npm run build` — Vite production build. **Passes.**
- `npm run lint` — ESLint (0 errors) + `validate:rls`. **Passes.**
- `npm run typecheck` — **pre-existing failures, unrelated to app-standard
  work.** The shadcn/ui components under `src/components/ui/` aren't typed to
  accept the props every page already passes them (`children`, `htmlFor`,
  `className`, …); this fails identically on files this session never touched
  (Register.jsx, ResetPassword.jsx) on the pre-standard commit. Not wired into
  CI (`.github/workflows/ci.yml`) until fixed as its own task.

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
- [x] Module 4 — RLS: four-op `$or` shape on every tenant entity, both path
      halves verified, deployed live and confirmed (via the Base44 MCP, then
      re-confirmed by `base44 entities push` from the platform owner's
      machine — 12/12 entities). `validate:rls` wired into `npm run lint`,
      not yet into CI as a standalone job (it runs as part of `npm run lint`
      in `ci.yml`).
- [x] Module 5 — Health: `base44/functions/health` — deployed and live.
- [x] Module 6 — Changelog: `appConfig.js`, no release script yet (see above).
- [x] Module 7 — Account & danger zone: `Cuenta.jsx`.
- [x] Module 8 — Support: `Soporte.jsx` + entities; Mission Control-side pull
      sync not yet built.
- [x] Module 9 — acaciaco-site: `apps/ctrlhq.html` + apps grid entry.
- [x] Module 10 — Login: real states, links to trial/support, dark-theme
      correct (existing `.dark` token setup, unchanged).

**Live since 2026-08-19**: production site at `https://ctrlhq.acaciaco.com.mx`
(Base44-assigned domain `https://smart-angelic-flow-ledger.base44.app` still
resolves too). All 4 backend functions and all 12 entity schemas (with RLS)
are deployed and confirmed against the live Base44 app; both Mission Control
migrations are applied to production.

**Open follow-ups, in priority order:**
1. Confirm/replace the placeholder WhatsApp number and pricing copy on
   `apps/ctrlhq.html` with real ones before treating it as final marketing copy.
2. Build Mission Control's pull-sync for `SupportTicket`/`SupportTicketMessage`
   into the shared `tickets` bodega (Module 8) — the entities and config
   (`apps.config.ticket_entity`) are ready, the sync job itself is not built.
3. Fix the pre-existing `npm run typecheck` failures, then wire it into CI.
4. Build `scripts/release.mjs` (Module 6) instead of hand-editing `appConfig.js`.
