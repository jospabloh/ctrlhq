// Client-side permission registry (Module 3). One place listing every gated
// action as "Section:action" with a per-role default. This alone is NOT the
// enforcement boundary — every one of these keys has an independent,
// server-side re-check that mirrors the same precedence:
//   1. platform-owner (role: admin) → always allowed (see every entity's RLS
//      admin branch, and every base44/functions/* Safe function).
//   2. an explicit true/false override for (business_id, role, key) in
//      PermissionProfile wins — a business_admin tunes their own tenant's
//      'staff' role beyond the hardcoded default here (see Permisos.jsx).
//      Enforced server-side by RLS scoping PermissionProfile to its own
//      business_id — a tenant can only ever change its OWN staff's access.
//   3. billing_status suspended/view_only → every write rejected regardless
//      of role or override (see PermissionContext.can()).
//   4. else this registry's default for the role.
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

// Grouped, human-readable view of the registry for the Permisos.jsx matrix.
// Only 'staff' is ever shown as editable — business_admin is definitionally
// the tenant owner and always has full access within their own business_id.
export const PERMISSION_SECTIONS = [
  {
    section: "Ingresos",
    keys: [
      { key: "Ingresos:create", label: "Registrar ingresos" },
      { key: "Ingresos:delete", label: "Eliminar ingresos" },
    ],
  },
  {
    section: "Egresos",
    keys: [
      { key: "Egresos:create", label: "Registrar egresos" },
      { key: "Egresos:delete", label: "Eliminar egresos" },
    ],
  },
  {
    section: "Consumos Equipo",
    keys: [
      { key: "ConsumosEquipo:create", label: "Registrar consumos" },
      { key: "ConsumosEquipo:delete", label: "Eliminar consumos" },
    ],
  },
  {
    section: "Nómina",
    keys: [
      { key: "Nomina:view", label: "Ver nómina" },
      { key: "Nomina:create", label: "Registrar nómina" },
      { key: "Nomina:edit", label: "Editar nómina" },
      { key: "Nomina:delete", label: "Eliminar nómina" },
    ],
  },
  {
    section: "Configuración",
    keys: [{ key: "Configuracion:manage_catalogs", label: "Gestionar catálogos" }],
  },
  {
    section: "Soporte",
    keys: [{ key: "Soporte:create", label: "Enviar tickets de soporte" }],
  },
];

export function registryDefault(key, role) {
  return Boolean(PERMISSION_REGISTRY[key]?.[role]);
}

// Precedence step 2 above: an explicit override wins over the registry
// default when present; `undefined`/missing falls through to the default.
export function resolvePermission(key, role, overrides) {
  const override = overrides?.[key];
  if (override === true || override === false) return override;
  return registryDefault(key, role);
}
