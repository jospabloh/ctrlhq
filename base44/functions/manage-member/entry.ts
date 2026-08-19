import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

// Safe function backing Cuenta:manage_members (Module 7 member management +
// Module 3's server-side re-check). Only a business_admin of the SAME
// business (or the platform admin) may change a teammate's role or remove
// them — re-checked here independently of the client's permission registry
// (src/lib/permissionRegistry.js), which only hides the button.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ message: "Unauthorized" }, { status: 401 });

    const isPlatformAdmin = caller.role === "admin";
    if (!isPlatformAdmin && caller.role !== "business_admin") {
      return Response.json({ message: "No autorizado." }, { status: 403 });
    }

    const { action, memberId, role } = await req.json();
    if (!memberId) {
      return Response.json({ message: "memberId es obligatorio." }, { status: 400 });
    }

    const member = await base44.asServiceRole.entities.User.get(memberId);
    if (!member) return Response.json({ message: "Miembro no encontrado." }, { status: 404 });
    if (!isPlatformAdmin && member.business_id !== caller.business_id) {
      return Response.json({ message: "No autorizado." }, { status: 403 });
    }
    if (!isPlatformAdmin && member.id === caller.id) {
      return Response.json({ message: "No puedes modificar tu propio acceso aquí." }, { status: 400 });
    }

    if (action === "change_role") {
      if (!["business_admin", "staff"].includes(role)) {
        return Response.json({ message: "role inválido." }, { status: 400 });
      }
      // Membership.role is the durable record — User.role only reflects the
      // member's role in whatever tenant they are in right now. Updating just
      // User.role would silently revert the change the next time they switched
      // away and back, because switch-tenant restores role from Membership.
      const rows = await base44.asServiceRole.entities.Membership.filter(
        { user_id: memberId, business_id: member.business_id }, null, 1
      );
      if (rows?.[0]) {
        await base44.asServiceRole.entities.Membership.update(rows[0].id, { role });
      }
      const updated = await base44.asServiceRole.entities.User.update(memberId, { role });
      return Response.json({ member: updated });
    }

    if (action === "remove") {
      // Drop the Membership FIRST, and treat it as the removal. Clearing
      // business_id alone would not remove anyone: the membership is what
      // grants the right to re-enter, so switch-tenant would happily let them
      // straight back in through the tenant picker.
      const rows = await base44.asServiceRole.entities.Membership.filter(
        { user_id: memberId, business_id: member.business_id }, null, 100
      );
      for (const m of rows || []) {
        await base44.asServiceRole.entities.Membership.delete(m.id);
      }
      // Only evict them from the tenant they are actually sitting in. Someone
      // removed from tenant A while working in tenant B keeps working in B.
      const stillElsewhere = await base44.asServiceRole.entities.Membership.filter(
        { user_id: memberId }, null, 1
      );
      const fallback = stillElsewhere?.[0];
      const updated = await base44.asServiceRole.entities.User.update(memberId, {
        role: fallback ? fallback.role : "staff",
        business_id: fallback ? fallback.business_id : null,
      });
      return Response.json({ member: updated });
    }

    return Response.json({ message: "action debe ser 'change_role' o 'remove'." }, { status: 400 });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
