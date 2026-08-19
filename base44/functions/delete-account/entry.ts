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

    // Memberships for this tenant go too, otherwise the tenant picker would
    // keep offering a business that no longer exists.
    const memberships = await base44.asServiceRole.entities.Membership.filter(
      { business_id: businessId }, null, 500
    );
    for (const m of memberships || []) {
      await base44.asServiceRole.entities.Membership.delete(m.id);
    }

    // Anyone sitting in this tenant has to land somewhere. If they belong to
    // another business, drop them into it with the role it grants; otherwise
    // they fall back to onboarding, which is the documented behaviour — this
    // function has never deleted login identities.
    const members = await base44.asServiceRole.entities.User.filter({ business_id: businessId });
    for (const member of members) {
      const elsewhere = await base44.asServiceRole.entities.Membership.filter(
        { user_id: member.id }, null, 1
      );
      const fallback = elsewhere?.[0];
      await base44.asServiceRole.entities.User.update(member.id, {
        // The platform owner keeps "admin" — writing role on that account
        // fails, and demoting them would be wrong anyway (see
        // complete-onboarding's header).
        ...(member.role === "admin" ? {} : { role: fallback ? fallback.role : "staff" }),
        business_id: fallback ? fallback.business_id : null,
      });
    }

    await base44.asServiceRole.entities.Business.delete(businessId);

    return Response.json({ success: true, deletedCounts, releasedMembers: members.length });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
