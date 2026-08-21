import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

// Bump on every meaningful change — the CtrlHQ runtime keeps serving a
// previous build until the function goes idle, so `deployed (Ns)` is not
// evidence a change is live. Read this off a real response instead.
// See CLAUDE.md, "Verification status — CONFIRMED live end-to-end".
const BUILD = "2026-08-21.guardedEntityWrite.1";

/**
 * Module 3's server-side half, for the four operational entities the client
 * used to write DIRECTLY via base44.entities.X.create/update/delete().
 *
 * What RLS already does and this does NOT duplicate: tenant isolation by
 * `data.business_id` and the coarse role branches. What RLS structurally
 * CANNOT do, and is the reason this function exists:
 *
 *  1. **Granular permission keys.** `PermissionProfile` lets a business_admin
 *     deny their own staff a specific key (e.g. `Ingresos:delete`). RLS has no
 *     way to join to that row, so before this function those overrides were
 *     UI-only: a staff member denied a key could still perform the write from
 *     devtools.
 *  2. **The billing gate.** `Business.billing_status` lives on a DIFFERENT row
 *     than the record being written, and Base44 RLS templates cannot join
 *     across entities — CLAUDE.md's "Permissions (Module 3)" section documents
 *     this exact gap ("blocked by the UI, not by RLS ... route the affected
 *     write through a Safe function that checks Business.billing_status
 *     server-side"). This is that Safe function.
 *
 * Precedence mirrors src/lib/PermissionContext.jsx's `can()` EXACTLY, so the
 * client and server can never disagree:
 *   1. platform owner (role: "admin") → always allowed, gate skipped;
 *   2. explicit true/false override for (business_id, role, key) in
 *      PermissionProfile wins;
 *   3. billing_status view_only/suspended → every write rejected;
 *   4. else the registry default for the caller's role.
 *
 * PERMISSION_DEFAULTS below is a hand-kept mirror of
 * src/lib/permissionRegistry.js's PERMISSION_REGISTRY — Deno functions cannot
 * import from src/. Keep the two in sync; `npm run validate:permissions`
 * fails the build if they drift.
 */

const PERMISSION_DEFAULTS: Record<string, Record<string, boolean>> = {
  "Ingresos:create": { business_admin: true, staff: true },
  "Ingresos:delete": { business_admin: true, staff: false },
  "Egresos:create": { business_admin: true, staff: true },
  "Egresos:delete": { business_admin: true, staff: false },
  "ConsumosEquipo:create": { business_admin: true, staff: true },
  "ConsumosEquipo:delete": { business_admin: true, staff: false },
  "Nomina:view": { business_admin: true, staff: false },
  "Nomina:create": { business_admin: true, staff: false },
  "Nomina:edit": { business_admin: true, staff: false },
  "Nomina:delete": { business_admin: true, staff: false },
  "Configuracion:manage_catalogs": { business_admin: true, staff: false },
  "Cuenta:manage_members": { business_admin: true, staff: false },
  "Cuenta:edit_profile": { business_admin: true, staff: false },
  "Cuenta:danger_zone": { business_admin: true, staff: false },
  "Soporte:create": { business_admin: true, staff: true },
};

/**
 * Which permission key gates each operation, per entity.
 *
 * `update` reuses the `:create` key for Ingresos/Egresos/ConsumosEquipo
 * because the edit dialog IS the create dialog in those pages — there is no
 * separate "edit" key in the registry, and inventing one here would enforce a
 * restriction no admin has ever had a way to configure. Nomina is the one
 * entity whose registry does distinguish create from edit, so it uses both.
 */
const ENTITY_CONFIG: Record<
  string,
  { create: string; update: string; delete: string; fields: string[] }
> = {
  Income: {
    create: "Ingresos:create",
    update: "Ingresos:create",
    delete: "Ingresos:delete",
    fields: ["date", "amount", "payment_method", "sale_type", "description"],
  },
  Expense: {
    create: "Egresos:create",
    update: "Egresos:create",
    delete: "Egresos:delete",
    fields: [
      "date",
      "supplier_name",
      "amount",
      "invoice_status",
      "invoice_number",
      "category",
      "notes",
    ],
  },
  TeamConsumption: {
    create: "ConsumosEquipo:create",
    update: "ConsumosEquipo:create",
    delete: "ConsumosEquipo:delete",
    fields: ["date", "collaborator", "dish", "amount"],
  },
  Payroll: {
    create: "Nomina:create",
    update: "Nomina:edit",
    delete: "Nomina:delete",
    fields: [
      "date",
      "collaborator",
      "base_salary",
      "overtime_hours",
      "overtime_pay",
      "vacation_days",
      "absences",
      "deductions",
      "total",
      "notes",
    ],
  },
};

const READ_ONLY_STATUSES = new Set(["view_only", "suspended"]);

function fail(status: number, message: string, extra: Record<string, unknown> = {}) {
  // `message` — NOT `error`. @base44/sdk's axios interceptor only reads
  // data.message / data.detail; anything else surfaces to the user as the
  // useless "Request failed with status code 500". See CLAUDE.md.
  return Response.json({ message, build: BUILD, ...extra }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return fail(401, "unauthorized");

    const body = await req.json().catch(() => ({}));
    const { entity, operation, id, data } = body ?? {};

    const config = ENTITY_CONFIG[entity];
    if (!config) return fail(400, `Entidad no permitida: ${entity}`);
    if (!["create", "update", "delete"].includes(operation)) {
      return fail(400, `Operación no permitida: ${operation}`);
    }

    const isPlatformAdmin = caller.role === "admin";

    // Tenant is ALWAYS the caller's own, re-derived from their token — never
    // read from the request body.
    const businessId = caller.business_id;
    if (!isPlatformAdmin && !businessId) {
      return fail(403, "No perteneces a ningún negocio.");
    }

    // For update/delete, the record's OWN business_id is what gets checked, so
    // a client cannot submit a foreign id to sidestep its own tenant's gates.
    let existing: Record<string, unknown> | null = null;
    if (operation !== "create") {
      if (!id) return fail(400, "id es obligatorio.");
      existing = await base44.asServiceRole.entities[entity].get(id).catch(() => null);
      if (!existing) return fail(404, "Registro no encontrado.");
      if (!isPlatformAdmin && existing.business_id !== businessId) {
        return fail(403, "No autorizado.");
      }
    }

    if (!isPlatformAdmin) {
      const key = config[operation as "create" | "update" | "delete"];

      // Precedence 2 — an explicit override for this tenant + role wins.
      const profiles = await base44.asServiceRole.entities.PermissionProfile.filter(
        { business_id: businessId, role: caller.role },
        null,
        1,
      );
      const override = profiles?.[0]?.permissions?.[key];

      let allowed: boolean;
      if (override === true || override === false) {
        allowed = override;
      } else {
        // Precedence 4 — the registry default for this role. A role with no
        // entry (anything other than business_admin/staff) is denied.
        allowed = Boolean(PERMISSION_DEFAULTS[key]?.[caller.role]);
      }
      if (!allowed) {
        return fail(403, "No tienes permiso para esta acción.", { permission: key });
      }

      // Precedence 3 — the billing gate RLS cannot express. Checked AFTER the
      // permission key so a denied user gets the accurate reason, and only for
      // writes: reads elsewhere in the app stay open for a view_only tenant.
      const businesses = await base44.asServiceRole.entities.Business.filter(
        { id: businessId },
        null,
        1,
      );
      const billingStatus = businesses?.[0]?.billing_status || "active";
      if (READ_ONLY_STATUSES.has(billingStatus)) {
        return fail(403, "Tu cuenta es de solo lectura. Regulariza tu licencia para volver a registrar movimientos.", {
          code: "write_blocked",
          billing_status: billingStatus,
        });
      }
    }

    if (operation === "delete") {
      await base44.asServiceRole.entities[entity].delete(id);
      return Response.json({ ok: true, build: BUILD });
    }

    // Field whitelist — mass-assignment protection. business_id is set from
    // the caller, never from the payload, on both create and update.
    const sanitized: Record<string, unknown> = {};
    for (const field of config.fields) {
      if (data && field in data) sanitized[field] = data[field];
    }

    if (operation === "create") {
      const record = await base44.asServiceRole.entities[entity].create({
        ...sanitized,
        business_id: isPlatformAdmin ? (data?.business_id ?? businessId) : businessId,
      });
      return Response.json({ record, build: BUILD });
    }

    const record = await base44.asServiceRole.entities[entity].update(id, sanitized);
    return Response.json({ record, build: BUILD });
  } catch (error) {
    // Never echo error.message to the caller — Base44's own security scan
    // flagged that on `health` (see CLAUDE.md, Backend functions).
    console.error("guardedEntityWrite failed:", error);
    return fail(500, "No se pudo completar la operación.");
  }
});
