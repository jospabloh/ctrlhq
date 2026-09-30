// Pure rules for approving / rejecting a join request. Import-free on purpose
// so `deno test` can load it in a sandbox where jsr.io / deno.land are
// blocked (same reasoning as the rest of this portfolio's pure-logic files).

// Roles a business_admin may assign. NEVER "admin": that is the ACACIA
// platform tier. Mirrors ASSIGNABLE_ROLES in src/lib/rbac.js (a unit test
// fails if the two drift).
export const ASSIGNABLE_ROLES = ["business_admin", "staff"] as const;

export function isAssignableRole(role: unknown): role is (typeof ASSIGNABLE_ROLES)[number] {
  return typeof role === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

export type Denied = { ok: false; status: number; message: string };
export type Allowed = { ok: true; businessId: string };

// Decide whether `caller` may resolve `target`'s pending request.
// Both objects are FRESH service-role reads, never the client's view.
//  - a business_admin can only resolve requests aimed at their OWN business;
//  - the platform admin (role "admin") can resolve any, targeting whatever
//    business the stored request names;
//  - anyone else is refused, with the same message whether the request is
//    missing or belongs to another business (no existence oracle).
export function decidePendingAccess(
  caller: { role?: string; business_id?: string | null } | null | undefined,
  target: { pending_business_id?: string | null; business_id?: string | null } | null | undefined,
): Allowed | Denied {
  const denied: Denied = { ok: false, status: 403, message: "No autorizado." };
  if (!caller) return denied;
  const isPlatform = caller.role === "admin";
  if (!isPlatform && (caller.role !== "business_admin" || !caller.business_id)) return denied;
  if (!target || !target.pending_business_id) {
    return { ok: false, status: 404, message: "Solicitud no encontrada." };
  }
  if (!isPlatform && target.pending_business_id !== caller.business_id) {
    return { ok: false, status: 404, message: "Solicitud no encontrada." };
  }
  return { ok: true, businessId: target.pending_business_id };
}

// ---- Last-admin guard (module 2) ------------------------------------------
// A tenant must never be left without someone who can approve requests, change
// roles and run the danger zone: there is no support-ticket-free way back in.
// The platform owner ("admin") counts as present when he is a member.

export function countTenantAdmins(members: Array<{ role?: string | null }>): number {
  return members.filter((m) => m.role === "business_admin" || m.role === "admin").length;
}

// Pre-check, from a fresh read of the tenant's members (before the write):
// true when changing `target` to `nextRole` (null = removal) would leave nobody.
export function wouldLeaveNoAdmin(
  members: Array<{ role?: string | null }>,
  target: { role?: string | null },
  nextRole: string | null,
): boolean {
  if (target.role !== "business_admin") return false;
  if (nextRole === "business_admin") return false;
  return countTenantAdmins(members) <= 1;
}

// Recount after the write: two admins demoted at the same moment can each pass
// the pre-check. True means "undo your write". Only a write that took an admin
// away can be blamed, so a tenant that already had none does not start refusing.
export function lostAllAdmins(
  membersAfter: Array<{ role?: string | null }>,
  targetWasBusinessAdmin: boolean,
): boolean {
  return targetWasBusinessAdmin && countTenantAdmins(membersAfter) === 0;
}
