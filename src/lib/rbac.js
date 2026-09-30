// Single source of truth for CtrlHQ's OWN role model — separate from Mission
// Control's operator roles (owner | admin | viewer in the bodega `members`
// table, which govern who can drive the central panel, not this app).
//
// See jospabloh/acacia-app-standard STANDARD.md Module 2. Mirrors
// base44/entities/User.jsonc's `role` enum exactly — if you add a role here,
// add it to that enum (and re-deploy) too, or RLS and the client will disagree.

export const ROLES = {
  // Platform/ACACIA owner. Used as the service-role admin branch in every
  // entity's RLS (Module 4) — never assigned to a tenant's own staff.
  ADMIN: "admin",
  // Tenant owner/manager — full access within their own business_id.
  BUSINESS_ADMIN: "business_admin",
  // Tenant employee — day-to-day operational access only.
  STAFF: "staff",
};

export const ROLE_LABELS = {
  [ROLES.ADMIN]: "Administrador ACACIA",
  [ROLES.BUSINESS_ADMIN]: "Administrador del negocio",
  [ROLES.STAFF]: "Personal",
};

// Roles a business_admin may hand out when approving a join request or
// changing a teammate's role. Never ADMIN (platform tier). Mirrored by
// ASSIGNABLE_ROLES in base44/functions/manage-member/_joinRules.ts; a unit
// test fails if the two drift.
export const ASSIGNABLE_ROLES = [ROLES.BUSINESS_ADMIN, ROLES.STAFF];

export function isPlatformAdmin(user) {
  return user?.role === ROLES.ADMIN;
}

export function isBusinessAdmin(user) {
  return user?.role === ROLES.BUSINESS_ADMIN || isPlatformAdmin(user);
}

export function isStaff(user) {
  return user?.role === ROLES.STAFF;
}

// Has this user completed onboarding (created or joined a business)?
export function hasBusiness(user) {
  return Boolean(user?.business_id);
}
