import React, { createContext, useContext, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { ROLES } from "@/lib/rbac";
import { registryDefault } from "@/lib/permissionRegistry";

// UI-gating only (Module 3). The same precedence is independently re-checked
// server-side by RLS (entity writes) or by a base44/functions/* Safe
// function (anything RLS can't express, e.g. billing_status gates or member
// management) — see permissionRegistry.js's header comment. Hiding a button
// here is a UX nicety, never the security boundary.
const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
  const { user, business } = useAuth();

  const can = useMemo(() => {
    return (key) => {
      if (!user) return false;
      if (user.role === ROLES.ADMIN) return true;
      // billing_status gate mirrors the Safe functions: view_only/suspended
      // tenants can't write anything (read-only degrade, not a 500 — Module 1).
      const blockedStatuses = ["view_only", "suspended"];
      if (key !== "read" && blockedStatuses.includes(business?.billing_status)) return false;
      return registryDefault(key, user.role);
    };
  }, [user, business]);

  const value = useMemo(() => ({ can, user, business }), [can, user, business]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionContext);
  if (!ctx) {
    throw new Error("usePermissions must be used within a PermissionProvider");
  }
  return ctx;
}
