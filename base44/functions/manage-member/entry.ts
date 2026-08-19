import { createClientFromRequest } from "npm:@base44/sdk";

// Safe function backing Cuenta:manage_members (Module 7 member management +
// Module 3's server-side re-check). Only a business_admin of the SAME
// business (or the platform admin) may change a teammate's role or remove
// them — re-checked here independently of the client's permission registry
// (src/lib/permissionRegistry.js), which only hides the button.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const isPlatformAdmin = caller.role === "admin";
    if (!isPlatformAdmin && caller.role !== "business_admin") {
      return Response.json({ error: "No autorizado." }, { status: 403 });
    }

    const { action, memberId, role } = await req.json();
    if (!memberId) {
      return Response.json({ error: "memberId es obligatorio." }, { status: 400 });
    }

    const member = await base44.asServiceRole.entities.User.get(memberId);
    if (!member) return Response.json({ error: "Miembro no encontrado." }, { status: 404 });
    if (!isPlatformAdmin && member.business_id !== caller.business_id) {
      return Response.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!isPlatformAdmin && member.id === caller.id) {
      return Response.json({ error: "No puedes modificar tu propio acceso aquí." }, { status: 400 });
    }

    if (action === "change_role") {
      if (!["business_admin", "staff"].includes(role)) {
        return Response.json({ error: "role inválido." }, { status: 400 });
      }
      const updated = await base44.asServiceRole.entities.User.update(memberId, { role });
      return Response.json({ member: updated });
    }

    if (action === "remove") {
      const updated = await base44.asServiceRole.entities.User.update(memberId, {
        role: "staff",
        business_id: null,
      });
      return Response.json({ member: updated });
    }

    return Response.json({ error: "action debe ser 'change_role' o 'remove'." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
