import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

// Bump on every meaningful change — see CLAUDE.md on why `deployed (Ns)` is
// not evidence a change is live, and read this off a real response instead.
const BUILD = "2026-08-21.export-business-data.1";

/**
 * Module 7's data export. Cuenta.jsx used to build the download in the browser
 * from the single `business` object it already had on screen — which is the
 * tenant's *profile*, not its data: none of the Ingresos, Egresos, Nómina or
 * Consumos rows a business would actually need before deleting its account
 * were in that file.
 *
 * Runs as service role, but every read is explicitly filtered by the caller's
 * OWN business_id, re-derived from `auth.me()` and never taken from the
 * request body, so this can never reach another tenant's rows. A failure on
 * any single entity does not fail the whole export — that entity comes back
 * empty plus an entry in `errors`, so a partial export still gets the user
 * their data instead of nothing.
 *
 * `User` is deliberately NOT exported (other members' PII; the roster is
 * already visible in Cuenta's members tab).
 */
const EXPORTED_ENTITIES = [
  "Collaborator",
  "Expense",
  "Income",
  "PaymentMethod",
  "Payroll",
  "PermissionProfile",
  "SaleType",
  "Supplier",
  "SupportTicket",
  "SupportTicketMessage",
  "TeamConsumption",
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    // `message` — NOT `error`: @base44/sdk's axios interceptor only reads
    // data.message / data.detail. See CLAUDE.md.
    if (!caller) return Response.json({ message: "unauthorized", build: BUILD }, { status: 401 });

    const isPlatformAdmin = caller.role === "admin";
    // Same gate as the rest of the danger zone (Cuenta:danger_zone is
    // business_admin-only by registry default) — a full dump of the tenant's
    // books is owner-tier, not day-to-day staff access.
    if (!isPlatformAdmin && caller.role !== "business_admin") {
      return Response.json({ message: "No autorizado.", build: BUILD }, { status: 403 });
    }

    const businessId = caller.business_id;
    if (!businessId) {
      return Response.json({ message: "No perteneces a ningún negocio.", build: BUILD }, { status: 400 });
    }

    // Read-only: deliberately NO billing gate. A view_only/suspended tenant
    // must keep being able to take its data out — that is the whole point.
    const businesses = await base44.asServiceRole.entities.Business.filter({ id: businessId }, null, 1);
    const business = businesses?.[0] ?? null;

    const data: Record<string, unknown[]> = {};
    const errors: Record<string, string> = {};

    for (const entity of EXPORTED_ENTITIES) {
      try {
        const rows = await base44.asServiceRole.entities[entity].filter({ business_id: businessId });
        data[entity] = rows || [];
      } catch (error) {
        data[entity] = [];
        errors[entity] = (error as Error).message;
      }
    }

    return Response.json({
      exported_at: new Date().toISOString(),
      business_id: businessId,
      business,
      data,
      ...(Object.keys(errors).length ? { errors } : {}),
      build: BUILD,
    });
  } catch (error) {
    console.error("export-business-data failed:", error);
    return Response.json({ message: "No se pudo exportar.", build: BUILD }, { status: 500 });
  }
});
