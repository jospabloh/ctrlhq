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

## Multi-tenancy: one active tenant, many memberships

A user can belong to several businesses — `business_admin` of one, `staff` of
another. The model deliberately keeps `User.business_id` a **single** value
meaning *the tenant you are operating in right now*, and adds `Membership`
(`base44/entities/Membership.jsonc`) as the record of which tenants you may
enter and as what.

**Why it is built this way.** Every tenant entity's RLS still reads
`data.business_id == {{user.data.business_id}}`, completely unchanged, so a
user can only ever touch the one tenant they are currently in. Isolation does
not get weaker as people join more tenants. The alternative — letting RLS match
"business_id is in my list of memberships" — would have meant rewriting the
rules on all 13 tenant entities and relying on `$in` against an array user
field, which is not a verified Base44 capability; a silent widening of data
access is exactly the failure mode worth designing out.

- **`Membership`** — `(business_id, user_id, user_email, role)`. Its `read` rule
  keys the caller's own rows on `{{user.id}}` (from the token) rather than on
  `business_id`, which is what lets the picker list tenants you are *not*
  currently in. Seeing a membership grants nothing by itself.
- **`base44/functions/switch-tenant`** — the only sanctioned way `business_id`
  changes after onboarding. Re-derives membership server-side from `Membership`
  (never from the request body, which supplies only the target id), then writes
  `business_id` and the role that membership grants. Returns the same 403
  whether the business does not exist or you simply are not in it — a tenant's
  existence is not something an outsider gets to probe for by id.
- **`complete-onboarding`** creates a `Membership` alongside the Business, and
  no longer rejects a caller who already has one: creating or joining an
  additional tenant is the point. Joining a tenant you are already in is still
  refused.
- **`User.role`** always reflects your role in the *active* tenant.
  The platform owner (`role: "admin"`) is the exception and keeps that role
  across every switch — see the Backend functions section for why writing role
  on that account fails and why it would be wrong anyway.
- **UI** — `src/pages/SelectTenant.jsx` asks which tenant to open, once per
  session, and only when you have more than one (a single membership skips it).
  `src/components/TenantSwitcher.jsx` is the sidebar's business name, made a
  dropdown only when there is somewhere to switch to; switching reloads the
  page so nothing from the previous tenant survives on screen.

**Verification status — CONFIRMED live end-to-end** (2026-08-20 04:44, via
`.github/workflows/verify-onboarding.yml` with `phase: multitenant`). One
account created two businesses, was left in the second, switched back to the
first, and `business_id` really moved each time. Memberships were written for
both. The assertion that matters also holds: switching into a business the
account has no `Membership` for is refused with `403 {"message":"No perteneces
a ese negocio."}` **and** the refused switch does not move `business_id`. Both
functions answered `"build":"2026-08-20.multitenant.1"`. `delete-account`
cleaned up both tenants on the way out, exercising Module 7 as a side effect.

**Getting there cost hours, and the cause was never in this repo: after a
`functions deploy`, the runtime keeps serving the previous build until the
function goes idle.** For roughly two hours and across three deploys,
`complete-onboarding` kept rejecting a second business with the
pre-multi-tenancy wording — a string present in neither this repo nor Base44's
own sandbox copy (both grepped). Six minutes after a deploy that printed
`complete-onboarding deployed (1.5s)`, the runtime still produced it. Left
alone for about 90 minutes with no traffic, the same function then answered
with the new build and everything passed on the first try.

The `phase: probe` step was what localized it: `switch-tenant`, **new** in that
same deploy, answered on the runtime, while `complete-onboarding`, **updated**
in it, did not reflect its update. A warm worker not being recycled on
redeploy fits exactly — `switch-tenant` had no warm worker, so it loaded fresh
— and the eventual recovery after idling confirms it.

What to do with this:

1. **Do not trust `deployed (Ns)` as evidence a change is live.** Both
   functions return a `build` string with every successful response precisely
   so this is readable rather than inferred. Read it before believing a
   deploy, and bump `BUILD` on every meaningful change.
2. **After deploying a change to an existing function, expect a delay.** If
   the behaviour looks stale, leave it alone rather than redeploying in a
   loop; give it time with no traffic and re-check the `build` string. Three
   redeploys achieved nothing that waiting did not.
3. If it ever fails to recover, the workaround the evidence supports is
   publishing the changed logic under a *new* function name (new functions do
   deploy immediately) and repointing the client.

**Operational gotcha for that workflow: this app's outbound mail gets throttled.**
After roughly ten sends in an hour, Base44 stops delivering both registration
OTPs and password-reset links — the API still answers `HTTP 200` and claims the
mail was sent, so the failure looks like the workflow's rather than the mail
provider's. Registration OTPs dried up first, reset links a few minutes later.
Space the runs out, or drive the check from an account whose password is
already known.

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
- **`base44/functions/guardedEntityWrite` (added 2026-08-21) closes the two
  things RLS structurally cannot do.** It is now the sanctioned write path for
  `Income`/`Expense`/`Payroll`/`TeamConsumption`, which the client used to
  write directly with `base44.entities.X.create/update/delete()`:
  - **Granular keys.** A `PermissionProfile` override (e.g. a
    `business_admin` denying their staff `Ingresos:delete`) was UI-only —
    RLS cannot join to that row, so a denied staff member could still
    perform the write from devtools. It is now re-checked server-side, in
    the same precedence order `PermissionContext.can()` uses.
  - **The billing gate.** `Business.billing_status` lives on a different row,
    and Base44 RLS templates can't join across entities — so a
    `view_only`/`suspended` tenant's writes were blocked by the UI only.
    `guardedEntityWrite` rejects them with `write_blocked` server-side.
  `src/lib/guardedWrite.js` is the client wrapper
  (`guardedCreate`/`guardedUpdate`/`guardedDelete`); the 12 migrated call
  sites keep the same calling shape as the entity SDK they replace. The
  function's `PERMISSION_DEFAULTS` is a hand-kept mirror of
  `permissionRegistry.js` (Deno can't import from `src/`) — **`npm run
  validate:permissions` fails the build on any drift** between the two, in
  either direction, and is wired into `npm run lint`. Verified it is not a
  no-op by flipping one default and confirming it fails.
- The same pass also fixed a **client-side** hole this exposed: the pencil
  (edit) button in Ingresos/Egresos/ConsumosEquipo/Nómina had no `can()`
  gate at all — only delete did — so a staff member denied `Ingresos:create`
  could still edit an existing row. Nómina's "Nuevo Registro" and delete
  buttons were ungated too (the page as a whole was gated on `Nomina:view`,
  which happens to be staff-false, so nothing leaked in practice; the keys
  just were not enforced). All now gated on the same key the server checks.
- `PermissionProfile` itself was checked and needs no Safe function: its RLS
  already requires `business_admin` + a tenant match on create/update/delete,
  so a staff member cannot grant themselves anything.

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

- **Root cause, FOUND AND FIXED: an entity-level `rls` block on the
  built-in `User` entity.** Not a Base44 platform outage — an earlier pass
  in this repo concluded that, on the strength of an unauthenticated `curl`
  to `health` returning `HTTP 404 {"error":"not-found","detail":"user worker
  not found"}`. That reading was wrong, and the lesson is worth keeping:
  a platform-shaped error string is not proof the platform is the cause.
  The worker recovered on its own (the same curl now returns the expected
  `401 {"message":"unauthorized"}` from `health`'s own bearer check) and
  onboarding still failed — so the 404 was a transient that masked the real,
  code-side bug for a whole debugging session.

  The evidence that actually localized it:
  1. `Business.create` inside `complete-onboarding` succeeded **every**
     time — the failed attempts left orphaned Business rows with
     `created_by_id: service_*` and nobody attached. The `User.update` on
     the very next line never completed.
  2. The **empty response body** is the tell. A thrown error would have
     been caught by the function's own `try/catch` and returned as
     `{message}`. No body at all means the request never returned — it hung
     and the runtime killed it. Chase an empty-bodied 500 as a hang, not as
     an exception.
  3. The app has exactly **one** `User` record (`is_service: false`), so
     the service principal has no `User` row of its own.

  `User` carried a full entity-level `rls` block whose `read`/`update` rules
  included a `{{user.data.business_id}}` branch. That template cannot
  resolve for a principal with no `User` row. `Business.create` kept working
  because Business's *create* rule is
  `$or[{role:admin},{created_by_id:{{user.id}}}]` — no `{{user.data.*}}`
  anywhere, and `{{user.id}}` comes from the token rather than from an
  entity read. Note the service role does **not** bypass RLS; it is
  evaluated as an admin principal, which is why RLS shape matters at all
  for `asServiceRole` calls.

  The built-in `User` is not a normal entity — Base44 manages it through the
  app's authentication system, and its own tooling refuses to write it
  ("Users are managed through the app's authentication system"). stockflow,
  whose `business:createBusinessSafe` does the identical
  `asServiceRole.entities.User.update(user.id, {business_id, role})` and
  works, carries **field-level RLS only** on `User`, with no entity-level
  block. `base44/entities/User.jsonc` now matches it, and
  `scripts/validate-rls.mjs` fails the build if the block reappears or if
  either field-level write lock on `role`/`business_id` goes missing (those
  locks are the security-relevant half — they stop `auth.updateMe`
  privilege escalation — and are unchanged).

  **This was a schema fix, so no function redeploy was needed.** The
  function code never changed.

  **Verified end-to-end**, three consecutive fresh accounts, via
  `.github/workflows/verify-onboarding.yml` (register -> verify OTP ->
  `complete-onboarding` -> read back the user):

  ```
  --- state BEFORE onboarding ---  {"role":"user","business_id":null}
  complete-onboarding -> HTTP 200
  --- state AFTER onboarding ---   {"role":"business_admin","business_id":"6a862b86220ba8c5e96d056a", ...}
  PASS — onboarding wrote business_id=6a862b86220ba8c5e96d056a role=business_admin
  ```

  The "after" read hits `/entities/User/me` — the exact endpoint
  `auth.me()` calls (`@base44/sdk/dist/modules/auth.js`), which is what
  `AuthContext.checkUserAuth()` reads and what `App.jsx` gates `/onboarding`
  on — so this proves the browser leaves the onboarding screen, not merely
  that a database row changed. (An earlier revision of that workflow
  asserted against `/auth/me`, which does not exist and answers
  `{"error_type":"HTTPException","message":"App not found"}`; `jq` turned
  that error object into `null` fields and produced a convincing false
  failure. Assert against the endpoint the client actually calls.)

- **Second case, same symptom, different cause: the platform owner's own
  account.** After the RLS fix above, every ordinary account onboards (four
  fresh ones verified), but `h.josepablo@gmail.com` kept failing with the
  same empty-bodied 500 — a real retry at 22:29:53 created yet another
  "Owner Sandbox" while that User row stayed untouched (`updated_date` still
  `2026-08-11T17:34:07`, the day it was created — it has never been written
  to). The one thing different about that account is that it **owns the
  app**: `role: "admin"`, `collaborator_role: "editor"`, `_app_role`
  mirroring `role`. It is this app's Base44 collaborator record, and writing
  `role` away from `"admin"` on it never returns. Every test account had
  `collaborator_role: null`.

  That write should never have been attempted: `admin` is the ACACIA
  *platform* tier, not a tenant tier (`src/lib/rbac.js`), so demoting the
  owner to `business_admin` for creating a business strips the tier every
  entity's RLS service-role branch is written against. stockflow's
  `restoreOwnerAdmin` writes `{ business_id, role: "admin" }` — owner stays
  admin *with* a tenant. `complete-onboarding` now does the same: a caller
  already at `role: "admin"` gets a `business_id` and keeps their role.
  Alongside it, the User write is bounded at 25s (a hang otherwise reaches
  the browser as an unexplainable empty 500) and `Business.create` is rolled
  back when the write fails, so a failed attempt stops leaving an orphaned
  tenant with a live invite code behind.

  **This one needs `base44 functions deploy` to take effect** — unlike the
  RLS fix, it changes function code. Until that deploy runs, the owner's
  account stays stuck; any other (non-collaborator) account onboards fine
  today.

  The prior `{error}`→`{message}` and SDK-pin fixes were real improvements
  worth keeping — they are why the UI now surfaces a real status and body
  instead of a masked generic message, which is what made this diagnosable
  — but neither was the fix.

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
  Backend functions in this app are confirmed healthy as of 2026-08-19
  (`complete-onboarding` returns 200 end-to-end, `health` returns its own
  401), so a round-trip failure here is a real bug to chase, not the
  platform outage an earlier revision of this file blamed.
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
- `npm run test:smoke` — `tests/smoke/` (Playwright), checks the
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
  Since 2026-08-22 the auth-gate tests live in `tests/smoke/auth.spec.js`
  alongside the portfolio's shared `smoke.spec.js` — see the section at the
  end of this file.

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
- [x] Module 3 — Granular permissions: `permissionRegistry.js` + a real
      server-side re-check of every key on every write path, in the precedence
      documented above. Tenant-admin override layer (`PermissionProfile` +
      `Permisos.jsx`), and since 2026-08-21 `guardedEntityWrite` actually
      enforces those overrides and the billing gate server-side — before it,
      both were UI-only (see the Permissions section above).
- [x] Module 4 — RLS: four-op `$or` shape on every tenant entity, both path
      halves verified, deployed live and confirmed (via the Base44 MCP, then
      re-confirmed by `base44 entities push` from the platform owner's
      machine — 12/12 entities). `validate:rls` wired into `npm run lint`,
      not yet into CI as a standalone job (it runs as part of `npm run lint`
      in `ci.yml`).
- [x] Module 5 — Health: `base44/functions/health` — deployed and live.
- [x] Module 6 — Changelog: `appConfig.js` + `scripts/release.mjs`
      (`npm run release`).
- [x] Module 7 — Account & danger zone: `Cuenta.jsx`. The export is a **real
      data export** since 2026-08-21 — it was building the download from the
      single `business` object already on screen (the tenant's profile, not
      its Ingresos/Egresos/Nómina/Consumos rows). Now served by
      `base44/functions/export-business-data`, which returns the `Business`
      row plus every row of 12 business-scoped entities, each read explicitly
      filtered by the caller's own `business_id` re-derived from `auth.me()`.
      Read-only, so deliberately no billing gate: a suspended tenant getting
      its data out is exactly what the export is for. `User` is excluded on
      purpose (other members' PII).
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

**Deploy note (2026-08-21):** `guardedEntityWrite` and
`export-business-data` are **new** functions, so they deploy immediately —
the warm-worker staleness described above only affects *updated* ones. Both
return a `build` string; read it off a real response before believing the
deploy. No entity schema changed in that pass.

**Open follow-ups, in priority order:**
1. Five orphaned `Business` rows need a real delete — all renamed
   `[HUERFANO - BORRAR] ...` so they stand out. Three are from the original
   onboarding incident (`6a860fa4c538d19adbc17195`, was "Roseta Cafeteria";
   `6a8622701fd0abf41ff517c6` and `6a8625b144e9a1cad5777cba`, both "Owner
   Sandbox"), one from a later retry (`6a862e618bfba0142cffd416`), and one
   from a verification run that died before its own cleanup
   (`6a866ba33e6e3c32a2ecb1bc`). All are **neutralized** — `invite_code`
   cleared so nobody can join, `billing_status: suspended` — so this is
   tidiness, not risk. Entity deletes are not reachable through the Base44 MCP
   tooling, and `delete-account` needs a caller who is either that business's
   own `business_admin` (nobody is) or the platform admin, so it is the
   platform owner's to run from an authenticated session. Note
   `6a8634fce74f65b1f11ea8b0` ("E2E Tenant A") still has
   `h.josepablo+ctrlhq-e2e-5@gmail.com` attached and was never renamed —
   delete it the same way.
2. The `h.josepablo+ctrlhq-e2e-*` and `h.josepablo+ctrlhq-mt-*` test users
   are still registered. Harmless (most are `role: staff` with no
   `business_id`), but they clutter the user list; Base44 does not expose
   user deletion through its MCP tooling either.
3. Confirm the `acaciaControl` bridge actually round-trips
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

## Deploy: el id de la app vive en el repo (módulo 11, 2026-08-21)

El 2026-08-21, un `git pull` fallido dejó la terminal parada en `flowfin` y los
seis comandos siguientes desplegaron **el backend de FlowFin** en puntos, radar,
stockflow y ctrlhq: la CLI toma el origen del **directorio actual** y el destino
de `--app-id`, y nada comprueba que coincidan. En radar el `entities push` llegó
a completarse y borró el modelo de datos entero. Detalle en
`jospabloh/acacia-app-standard` → `docs/incidents.md`.

Por eso este repo ya no se deploya a mano:

```bash
npm run deploy            # funciones — lee el appId de base44.app.json
npm run deploy:site       # frontend — mergear a main NO lo hace por ti
npm run deploy:entities   # schema — DESTRUCTIVO, pide escribir "CtrlHQ"
npm run functions:audit   # quién llama a cada endpoint
```

**Mergear a `main` no deploya el sitio.** Se creyó lo contrario durante meses.
En flowfin se comprobó al revés: un fix se mergeó a `main` y, horas después, el
árbol que el app realmente servía seguía siendo el de antes del fix — mergear no
propaga nada (detalle en el CLAUDE.md de flowfin). El
frontend se deploya a mano con `npm run deploy:site`, igual que las funciones.
Y comprueba el resultado por **contenido**, no por hashes: el checkpoint del app
puede reportar un `git_commit_hash` igual al HEAD de `main` mientras el árbol que
de verdad se sirve está atrasado.

`scripts/base44-deploy.mjs` **rechaza** un `--app-id` por argumento, así que el
directorio y la app destino no pueden desalinearse. `deploy:entities` imprime la
lista de entidades y el nombre de la app antes de pedir confirmación — ver
"36 entidades de FlowFin" mientras crees estar desplegando otra app es la señal
de alto que faltaba.

`npm run validate:functions` (dentro de `npm run lint`) falla si los endpoints
pasan de `maxFunctions` en `base44.app.json` — hoy **40**, con
Base44 cortando en 50. El margen importa: por encima del tope el deploy falla a
media aplicación y la CLI **no** llega a su fase de poda, así que las funciones
viejas siguen ocupando los slots que harían falta para arreglarlo.

**Antes de consolidar o borrar cualquier función, corre `npm run functions:audit`.**
Una función sin llamadores en el repo casi nunca está muerta: el llamador vive
fuera, donde grep no ve — un entity hook de Base44, un cron del panel, un
`tool_config` de un agente, la URL de un webhook. El audit marca esas como
`REVISAR EN PANEL` en vez de adivinar; confírmalas contra
`npx base44 functions list` (anota `(N automation)`) antes de tocarlas.

## Selector de tema: claro / oscuro / dispositivo (módulo 12, 2026-08-21)

El tema se elige desde **un solo control**: un círculo pequeño anclado a una
esquina de la pantalla que muestra el modo vigente y, al pulsarlo, crece de lado
en una pista de tres ranuras (Claro · Oscuro · Sistema) con un indicador que se
desliza a la elegida. Tres estados, tres posiciones físicas — que es justo lo
que un botón sol/luna de dos estados no puede expresar en cuanto "seguir al
dispositivo" entra en la lista.

Lo que se guarda es la **preferencia** (`light` | `dark` | `system`), nunca el
color resuelto: con `system` la app sigue a `prefers-color-scheme` en vivo, sin
recargar. `index.html` trae un script pre-montaje que resuelve y aplica el tema
antes de que monte React, así que el primer frame ya sale del color correcto;
ese script y el proveedor comparten clave y valores, y cada uno lleva un
comentario apuntando al otro.

`src/components/ThemeSwitcher.jsx` es **idéntico byte a byte en todas las apps
del portafolio**. La fuente canónica vive en `jospabloh/acacia-app-standard` →
`shared/theme/`: cámbialo allí y cópialo, no lo edites aquí. Lo único propio de
esta app es `src/lib/useThemeMode.js` (de dónde sale el estado) y las variables
`--theme-switcher-bottom/right` en `src/index.css` (dónde se coloca).

**Aquí el tema oscuro no existía en la práctica.** `tailwind.config.js` tenía
`darkMode: ["class"]` y `src/index.css` una paleta `.dark` completa, pero nada
montaba un proveedor ni ponía la clase: era código muerto desde el scaffold. Se
montó `ThemeProvider` (next-themes, `defaultTheme="system"`) en `App.jsx`, se
añadió el script pre-montaje y el selector de esquina.

De paso se convirtieron a tokens semánticos los 19 colores claros hardcodeados
que quedaban del scaffold (`PageNotFound`, `UserNotRegisteredError`, los
spinners, dos chips de estado) — con el tema oscuro apagado nunca se habían
notado, y con él encendido se veían como parches blancos. Y `index.html`
declaraba `lang="en"` en una app entera en español; ahora dice `es-MX`.

## `npm run test:smoke` — comprueba el sitio DESPLEGADO (2026-08-22)

`tests/smoke/smoke.spec.js` es la suite compartida del portafolio, idéntica byte
a byte en todos los repos; la fuente canónica está en
`jospabloh/acacia-app-standard` → `shared/smoke/`. Lo propio de esta app vive en
`tests/smoke/smoke.config.js` (URL, `<title>`, cómo representa el tema).

**No comprueba el build local: comprueba lo que se sirve.** Es la automatización
de la regla que cada CLAUDE.md repite — mergear no deploya nada, y hay que
verificar por contenido y no por hash. Afirma cuatro cosas, todas derivadas de
lo que el propio repo produce (nunca de copy adivinado, que se rompe al cambiar
una palabra y enseña a ignorar la suite):

1. responde 200 y el `<title>` es el de esta app — no un deploy viejo ni otro;
2. no lanza excepciones al pintar;
3. el tema llega resuelto desde el primer frame (el script pre-montaje viajó);
4. el selector de esquina está montado, cambia el tema y la preferencia
   sobrevive a un reload.

**No corre en el pipeline normal ni desde un sandbox de desarrollo**: la salida
HTTPS ahí va por un proxy con allowlist que no incluye estos dominios. Corre en
GitHub Actions (`.github/workflows/smoke.yml`): `workflow_dispatch` para
dispararla a mano justo después de un deploy, y un cron diario como red.

    npm run test:smoke                      # contra producción
    SMOKE_URL=https://… npm run test:smoke  # contra un preview

Desde el 2026-08-22 la suite añade una quinta afirmación, del **módulo 12**: el
selector no tapa nada y nada lo tapa, en móvil (390), tablet (834) y escritorio
(1440), plegado y desplegado. Un control anclado por encima de todo en una
esquina es justo lo que acaba sentado sobre una barra inferior o un botón
flotante, y entonces la app pierde una función al ancho que nadie abrió. La
comprobación distingue las dos direcciones — algo pintado encima del selector, y
el selector respondiendo por un control que hay debajo — y nombra el control
afectado. Se coloca con `--theme-switcher-bottom/right`; si otra cosa ya es dueña
de esa esquina, se mueve el selector, no el control.

## Módulo 14 — auditoría de aislamiento multi-tenant (2026-08-22)

Nuevo en `jospabloh/acacia-app-standard`. **No es releer las reglas de RLS** (eso
es el módulo 4): es recorrer, con fecha y por escrito, todo lo que puede cruzar
un inquilino con otro — cada entidad, cada función de backend (el inquilino se
re-deriva en el servidor, nunca del cuerpo de la petición, y en update/delete se
comprueba contra el registro **almacenado**), cada campo bloqueado, cada
exportación/reporte/búsqueda, cada destinatario de correo o webhook, y el cambio
de inquilino. Contra el **esquema desplegado**, no contra el archivo del repo.

Se repite cuando se añade una entidad, una función o un rol. El resultado se
anota aquí, incluyendo **lo que no se pudo verificar** desde el entorno de
trabajo — normalmente una sesión autenticada como usuario restringido de un
segundo inquilino. Decirlo vale más que insinuar una cobertura que no se logró.

Lo que motiva el módulo es que todos los fallos de aislamiento que este
portafolio llegó a desplegar eran **sintácticamente válidos**: la rama de rol sin
`$and` al inquilino en `Parish` de cateqhub, las 84 instancias de liuma donde el
motor descartaba la cláusula hermana de `user_condition`, los campos de licencia
escribibles por el propio inquilino en puntos y rumbo, y el `PermissionProfile`
que ningún RLS puede consultar porque vive en otra fila.

### Resultado — 2026-08-23, contra el esquema desplegado

Primera pasada del módulo 14 aquí. **No se encontró ningún cruce entre
negocios.** Esta app es la que mejor responde la pregunta que el módulo hace
sobre el **cambio de inquilino**, así que vale la pena dejar por qué.

**`switch-tenant` es la implementación de referencia.** El cuerpo de la petición
aporta **sólo** el id destino; la membresía se re-lee del servidor
(`Membership.filter({user_id: user.id, business_id})`), el rol que se escribe es
`membership.role` y no nada que venga del cliente, y sin membresía responde 403
**con el mismo mensaje exista o no el negocio** — para que nadie pueda sondear
la existencia de un inquilino probando ids. El dueño de plataforma conserva
`admin` al cambiar, en vez de ser degradado al rol del inquilino.

**El diseño de una sola `business_id` activa es lo que mantiene el aislamiento
constante.** Cada entidad sigue comparando contra `{{user.data.business_id}}`,
así que el aislamiento no se debilita conforme alguien acumula membresías —
justo lo contrario de lo que pasaría con un `$in` sobre una lista.

**Las funciones comprueban contra el registro almacenado**, que es la otra mitad
de lo que el módulo pide:

- `guardedEntityWrite:159` — `existing.business_id !== businessId` → 403, sobre
  el registro leído, no sobre la petición;
- `manage-member:24‑27` — trae el `User` objetivo y compara su `business_id`
  almacenado contra el del solicitante;
- `delete-account:30` — recibe `businessId` por el cuerpo pero exige
  `caller.business_id === businessId` **y** rol `business_admin`;
- `export-business-data:56` — `businessId = caller.business_id`, del token, y
  filtra las 12 entidades por él.

`acaciaControl` y `health` no llevan `auth.me()` a propósito: son los canales de
Mission Control, cerrados por `INGEST_HMAC_SECRET`. `acaciaControl` es el único
camino cross-tenant deliberado.

**`Membership`, leída del esquema vivo**, confirma lo que este archivo ya
afirmaba: `read` se llave a `data.user_id == {{user.id}}`, que es lo que permite
al selector listar negocios en los que **no** estás sin que ver una membresía
conceda nada. El campo `role` lleva `rls.write: {role: admin}` — bloqueado a
nivel de campo — así que un `business_admin` no puede acuñar una membresía de
administrador; `manage-member` (rol de servicio) es el único que escribe ese
campo.

#### Una cosa anotada, que no es fuga

`Membership.create` permite a un `business_admin` insertar cualquier `user_id`
en **su propio** negocio (el `$and` al inquilino impide hacerlo en otro), sin
pasar por el `invite_code`. El rol queda en `staff` por el candado de campo, y
el afectado sólo gana acceso a ese negocio, nunca a otro. No cruza inquilinos;
lo que sí hace es que "quién está en mi negocio" no dependa del consentimiento
del invitado. Módulo 3, no 14.

#### No verificado

Una sesión autenticada como `staff` de un segundo negocio. Lo que **sí** está
verificado end-to-end, y por eso esta app llega mejor preparada que las otras:
el flujo multi-inquilino se ejerció de verdad el 2026-08-20 con
`.github/workflows/verify-onboarding.yml` (`phase: multitenant`) — una cuenta
creó dos negocios, cambió entre ellos, y el intento de entrar a uno sin
membresía devolvió 403 **sin mover `business_id`**. Esa evidencia es de la
implementación de entonces; esta pasada la releyó contra el código y el esquema
de hoy y coincide.
