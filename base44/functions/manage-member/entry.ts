import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";
import { decidePendingAccess, isAssignableRole, lostAllAdmins, wouldLeaveNoAdmin } from "./_joinRules.ts";

// Safe function backing Cuenta:manage_members (Module 7 member management +
// Module 3's server-side re-check). Only a business_admin of the SAME
// business (or the platform admin) may change a teammate's role or remove
// them — re-checked here independently of the client's permission registry
// (src/lib/permissionRegistry.js), which only hides the button.
//
// Join requests (2026-09-30): redeeming an invite_code no longer grants access.
// complete-onboarding only stamps User.pending_business_id; the actions
// "list_pending", "approve" and "reject" below are the ONLY place that turns a
// request into a business_id/role (approve) or discards it (reject). Both
// caller and target are re-read fresh with service role, the request is
// checked against the STORED pending_business_id, and the role the admin picks
// is checked against a whitelist that never includes the platform "admin".
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

    if (action === "list_pending" || action === "approve" || action === "reject") {
      // Fresh read: never decide who may grant access from the cached session.
      const freshCaller = await base44.asServiceRole.entities.User.get(caller.id).catch(() => null);

      if (action === "list_pending") {
        // Requests are always for the caller's OWN business (the platform
        // owner included: they list the business they belong to).
        if (!freshCaller || (freshCaller.role !== "business_admin" && freshCaller.role !== "admin")) {
          return Response.json({ message: "No autorizado." }, { status: 403 });
        }
        if (!freshCaller.business_id) return Response.json({ requests: [] });
        const businessId = freshCaller.business_id;
        const pending = (await base44.asServiceRole.entities.User.filter({
          pending_business_id: businessId,
        })) as Array<{ id: string; email?: string; full_name?: string; created_date?: string; business_id?: string | null }>;
        return Response.json({
          requests: pending
            .filter((u) => !u.business_id)
            .map((u) => ({
              id: u.id,
              email: u.email,
              full_name: u.full_name,
              created_date: u.created_date,
            })),
        });
      }

      if (!memberId) return Response.json({ message: "memberId es obligatorio." }, { status: 400 });
      if (action === "approve" && !isAssignableRole(role)) {
        return Response.json({ message: "role inválido." }, { status: 400 });
      }
      if (memberId === caller.id) {
        return Response.json({ message: "No puedes resolver tu propia solicitud." }, { status: 400 });
      }

      const target = await base44.asServiceRole.entities.User.get(memberId).catch(() => null);
      const gate = decidePendingAccess(freshCaller, target);
      if (!gate.ok) return Response.json({ message: gate.message }, { status: gate.status });

      if (action === "reject") {
        await base44.asServiceRole.entities.User.update(memberId, { pending_business_id: null });
        return Response.json({ ok: true });
      }

      // approve. The request may point at a business that has since been
      // deleted, or the person may already belong to one (one user, one
      // tenant): in both cases discard the request instead of granting.
      const business = await base44.asServiceRole.entities.Business.get(gate.businessId).catch(() => null);
      if (!business) {
        await base44.asServiceRole.entities.User.update(memberId, { pending_business_id: null });
        return Response.json({ message: "El negocio de esta solicitud ya no existe." }, { status: 404 });
      }
      if (target.business_id) {
        await base44.asServiceRole.entities.User.update(memberId, { pending_business_id: null });
        return Response.json({ message: "Esta persona ya pertenece a un negocio." }, { status: 409 });
      }
      // Best-effort conditional write: re-read the target's STORED request
      // right before updating and abort if it no longer points at this
      // business (rejected/cancelled/moved meanwhile). Base44 has no atomic
      // conditional write, so a small race window remains between this read
      // and the update; it only narrows the window, it cannot close it.
      const recheck = await base44.asServiceRole.entities.User.get(memberId).catch(() => null);
      if (!recheck || recheck.pending_business_id !== gate.businessId || recheck.business_id) {
        return Response.json(
          { message: "La solicitud cambió mientras se resolvía. Actualiza la lista e intenta de nuevo." },
          { status: 409 }
        );
      }
      // The platform owner keeps "admin" (writing role away from it hangs; see
      // complete-onboarding's rolePatchFor). Everyone else gets the chosen role.
      const updated = await base44.asServiceRole.entities.User.update(memberId, {
        ...(target.role === "admin" ? {} : { role }),
        business_id: gate.businessId,
        pending_business_id: null,
      });
      return Response.json({ member: updated });
    }

    if (!memberId) {
      return Response.json({ message: "memberId es obligatorio." }, { status: 400 });
    }

    const member = await base44.asServiceRole.entities.User.get(memberId);
    if (!member) return Response.json({ message: "Miembro no encontrado." }, { status: 404 });
    // `!caller.business_id` matters: without it two people with NO business
    // would compare equal and pass this gate.
    if (!isPlatformAdmin && (!caller.business_id || member.business_id !== caller.business_id)) {
      return Response.json({ message: "No autorizado." }, { status: 403 });
    }
    if (!isPlatformAdmin && member.role === "admin") {
      // The platform tier is not something a business's own admin can touch.
      return Response.json({ message: "No autorizado." }, { status: 403 });
    }
    if (!isPlatformAdmin && member.id === caller.id) {
      return Response.json({ message: "No puedes modificar tu propio acceso aquí." }, { status: 400 });
    }

    if (action === "change_role") {
      if (!isAssignableRole(role)) {
        return Response.json({ message: "role inválido." }, { status: 400 });
      }
      // One user, one tenant: `User.role` IS the durable record. There is no
      // second copy of it to keep in sync any more — the `Membership` entity
      // that used to hold one went away with the tenant picker.
      const tenantMembers = member.business_id
        ? await base44.asServiceRole.entities.User.filter({ business_id: member.business_id })
        : [];
      if (wouldLeaveNoAdmin(tenantMembers, member, role)) {
        return Response.json({ message: "El negocio no puede quedarse sin administrador." }, { status: 409 });
      }
      const updated = await base44.asServiceRole.entities.User.update(memberId, { role });
      // Recount: a concurrent demotion can slip past the pre-check; undo ours.
      if (member.business_id) {
        const after = await base44.asServiceRole.entities.User.filter({ business_id: member.business_id });
        if (lostAllAdmins(after, member.role === "business_admin")) {
          await base44.asServiceRole.entities.User.update(memberId, { role: member.role });
          return Response.json({ message: "El negocio no puede quedarse sin administrador." }, { status: 409 });
        }
      }
      return Response.json({ member: updated });
    }

    if (action === "remove") {
      // Clearing `business_id` IS the removal: one user, one tenant, and no
      // separate membership record that could grant a way back in. The user
      // lands back on `/onboarding` and can create or join a business again.
      // The platform owner is never demoted here (see complete-onboarding).
      const tenantMembers = member.business_id
        ? await base44.asServiceRole.entities.User.filter({ business_id: member.business_id })
        : [];
      if (wouldLeaveNoAdmin(tenantMembers, member, null)) {
        return Response.json({ message: "El negocio no puede quedarse sin administrador." }, { status: 409 });
      }
      const updated = await base44.asServiceRole.entities.User.update(memberId, {
        ...(member.role === "admin" ? {} : { role: "staff" }),
        business_id: null,
        pending_business_id: null,
      });
      if (member.business_id) {
        const after = await base44.asServiceRole.entities.User.filter({ business_id: member.business_id });
        if (lostAllAdmins(after, member.role === "business_admin")) {
          await base44.asServiceRole.entities.User.update(memberId, { role: member.role, business_id: member.business_id });
          return Response.json({ message: "El negocio no puede quedarse sin administrador." }, { status: 409 });
        }
      }
      return Response.json({ member: updated });
    }

    return Response.json({ message: "action debe ser 'change_role', 'remove', 'list_pending', 'approve' o 'reject'." }, { status: 400 });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
