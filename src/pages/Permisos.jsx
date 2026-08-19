import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/PermissionContext";
import { PERMISSION_SECTIONS, registryDefault } from "@/lib/permissionRegistry";
import { ROLES } from "@/lib/rbac";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Shield } from "lucide-react";

// Module 3's tenant-admin permissions page: lets a business_admin tune what
// their own 'staff' can do, beyond the hardcoded default in
// permissionRegistry.js. Writes a PermissionProfile row scoped to the
// caller's own business_id — RLS enforces that scoping independently (see
// PermissionProfile.jsonc), so this page can never touch another tenant's
// staff permissions even if the client were bypassed.
export default function Permisos() {
  const { user } = useAuth();
  const { can, refreshOverrides } = usePermissions();
  const { toast } = useToast();
  const [perms, setPerms] = useState({});
  const [profileId, setProfileId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = can("Cuenta:manage_members"); // same "runs the tenant" gate as member management

  useEffect(() => {
    if (canManage && user?.business_id) loadProfile();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, user?.business_id]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const rows = await base44.entities.PermissionProfile.filter({
        business_id: user.business_id,
        role: ROLES.STAFF,
      });
      const profile = rows?.[0];
      setProfileId(profile?.id || null);
      setPerms(profile?.permissions || {});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key, checked) => {
    setPerms((prev) => ({ ...prev, [key]: checked }));
  };

  const resetKey = (key) => {
    setPerms((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (profileId) {
        await base44.entities.PermissionProfile.update(profileId, { permissions: perms });
      } else {
        const created = await base44.entities.PermissionProfile.create({
          business_id: user.business_id,
          role: ROLES.STAFF,
          permissions: perms,
        });
        setProfileId(created.id);
      }
      toast({ title: "Permisos guardados" });
      await refreshOverrides();
    } catch (e) {
      toast({ title: e.message || "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        Solo un administrador del negocio puede configurar permisos.
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando...</div>;
  }

  return (
    <div>
      <PageHeader
        title="Permisos"
        description="Configura qué puede hacer el personal (Personal) de tu negocio. El administrador siempre tiene acceso completo."
      />

      <div className="space-y-4">
        {PERMISSION_SECTIONS.map((section) => (
          <div key={section.section} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/40">
              <p className="font-medium text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" /> {section.section}
              </p>
            </div>
            <div className="divide-y divide-border">
              {section.keys.map(({ key, label }) => {
                const isOverridden = perms[key] !== undefined;
                const value = isOverridden ? perms[key] : registryDefault(key, ROLES.STAFF);
                return (
                  <div key={key} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm">{label}</p>
                      {isOverridden && (
                        <button
                          onClick={() => resetKey(key)}
                          className="text-xs text-muted-foreground hover:text-primary hover:underline"
                        >
                          Personalizado — restablecer al valor por defecto
                        </button>
                      )}
                    </div>
                    <Switch checked={value} onCheckedChange={(checked) => toggle(key, checked)} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Guardar permisos
        </Button>
      </div>
    </div>
  );
}
