// Client-side permission registry (Module 3). One place listing every gated
// action as "Section:action" with a per-role default. This alone is NOT the
// enforcement boundary — every one of these keys has an independent,
// server-side re-check that mirrors the same precedence:
//   1. platform-owner (role: admin) → always allowed (see every entity's RLS
//      admin branch, and every base44/functions/* Safe function).
//   2. billing_status suspended → every write rejected regardless of role
//      (checked in the Safe functions; entity RLS does not have visibility
//      into a *different* entity's billing_status, which is exactly why
//      writes that must respect it go through a function, not raw RLS).
//   3. this registry's default for the role.
//
// CtrlHQ has no per-tenant permission override entity (unlike stockflow's
// PermissionProfile) — every business shares the same defaults today. If
// that changes, add the override lookup here AND in the functions that
// re-check it, in that order, so client and server never disagree.
import { ROLES } from "./rbac";

export const PERMISSION_REGISTRY = {
  "Ingresos:create": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: true },
  "Ingresos:delete": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Egresos:create": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: true },
  "Egresos:delete": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "ConsumosEquipo:create": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: true },
  "ConsumosEquipo:delete": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Nomina:view": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Nomina:create": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Nomina:edit": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Nomina:delete": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Configuracion:manage_catalogs": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Cuenta:manage_members": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Cuenta:edit_profile": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Cuenta:danger_zone": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: false },
  "Soporte:create": { [ROLES.BUSINESS_ADMIN]: true, [ROLES.STAFF]: true },
};

export function registryDefault(key, role) {
  return Boolean(PERMISSION_REGISTRY[key]?.[role]);
}
