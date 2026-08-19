import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { ROLES } from "@/lib/rbac";
import { resolvePermission } from "@/lib/permissionRegistry";

// UI-gating only (Module 3). The same precedence is independently re-checked
// server-side by RLS (entity writes, including PermissionProfile itself,
// scoped to the caller's own business_id) or by a base44/functions/* Safe
// function (anything RLS can't express, e.g. billing_status gates or member
// management) — see permissionRegistry.js's header comment. Hiding a button
// here is a UX nicety, never the security boundary.
const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
  const { user, business } = useAuth();
  const [overrides, setOverrides] = useState({});

  const loadOverrides = async () => {
    if (!user?.business_id) {
      setOverrides({});
      return;
    }
    try {
      // Only 'staff' can ever be overridden (business_admin is always full
      // access within its own tenant) — see PermissionProfile.jsonc.
      const rows = await base44.entities.PermissionProfile.filter({
        business_id: user.business_id,
        role: ROLES.STAFF,
      });
      setOverrides(rows?.[0]?.permissions || {});
    } catch (e) {
      console.error("Failed to load permission overrides:", e);
      setOverrides({});
    }
  };

  useEffect(() => {
    loadOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.business_id]);

  const can = useMemo(() => {
    return (key) => {
      if (!user) return false;
      if (user.role === ROLES.ADMIN) return true;
      // billing_status gate mirrors the Safe functions: view_only/suspended
      // tenants can't write anything (read-only degrade, not a 500 — Module 1).
      const blockedStatuses = ["view_only", "suspended"];
      if (key !== "read" && blockedStatuses.includes(business?.billing_status)) return false;
      const roleOverrides = user.role === ROLES.STAFF ? overrides : null;
      return resolvePermission(key, user.role, roleOverrides);
    };
  }, [user, business, overrides]);

  const value = useMemo(
    () => ({ can, user, business, overrides, refreshOverrides: loadOverrides }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, user, business, overrides]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionContext);
  if (!ctx) {
    throw new Error("usePermissions must be used within a PermissionProvider");
  }
  return ctx;
}
