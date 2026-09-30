import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

const TENANT_ENTITIES = [
  "Income", "Expense", "Payroll", "TeamConsumption",
  "Collaborator", "Supplier", "PaymentMethod", "SaleType",
  "SupportTicketMessage", "SupportTicket",
];

// Danger zone (Module 7): irreversible. Only the business's own business_admin
// (or the platform admin) may trigger it, and only for their own tenant, and
// only after typing the business's exact name as confirmation.
//
// Cascades every business_id-scoped entity, then the Business row itself.
// Does NOT delete member User accounts — it clears their business_id/role
// back to staff/null so they fall back to onboarding. Login identities
// outliving a closed tenant is the documented, intentional exception here
// (STANDARD.md Module 7: "explicitly document what it does not touch").
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ message: "Unauthorized" }, { status: 401 });

    const { businessId, confirmName } = await req.json();
    if (!businessId) {
      return Response.json({ message: "businessId es obligatorio." }, { status: 400 });
    }

    const isPlatformAdmin = caller.role === "admin";
    if (!isPlatformAdmin && (caller.role !== "business_admin" || caller.business_id !== businessId)) {
      return Response.json({ message: "No autorizado." }, { status: 403 });
    }

    const business = await base44.asServiceRole.entities.Business.get(businessId);
    if (!business) return Response.json({ message: "Negocio no encontrado." }, { status: 404 });
    if ((confirmName || "").trim() !== business.name) {
      return Response.json(
        { message: "El nombre no coincide. Escribe el nombre exacto del negocio para confirmar." },
        { status: 400 }
      );
    }

    const deletedCounts = {};
    for (const entityName of TENANT_ENTITIES) {
      const result = await base44.asServiceRole.entities[entityName].deleteMany({ business_id: businessId });
      deletedCounts[entityName] = result?.deleted ?? 0;
    }

    // Anyone sitting in this tenant lands back on onboarding, where they can
    // create or join a business again — this function has never deleted login
    // identities. One user, one tenant: there is no other business to fall
    // back into.
    const members = await base44.asServiceRole.entities.User.filter({ business_id: businessId });
    for (const member of members) {
      await base44.asServiceRole.entities.User.update(member.id, {
        // The platform owner keeps "admin" — writing role on that account
        // fails, and demoting them would be wrong anyway (see
        // complete-onboarding's header).
        ...(member.role === "admin" ? {} : { role: "staff" }),
        business_id: null,
      });
    }

    // Join requests still waiting on this business would point at nothing.
    const waiting = await base44.asServiceRole.entities.User.filter({ pending_business_id: businessId });
    for (const person of waiting) {
      await base44.asServiceRole.entities.User.update(person.id, { pending_business_id: null });
    }

    await base44.asServiceRole.entities.Business.delete(businessId);

    return Response.json({ success: true, deletedCounts, releasedMembers: members.length });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
