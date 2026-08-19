import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/PermissionContext";
import { ROLE_LABELS } from "@/lib/rbac";
import { APP_VERSION, RELEASE_DATE, CHANGELOG } from "@/lib/appConfig";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, Download, Loader2, ShieldAlert, Users2 } from "lucide-react";

const BILLING_LABELS = {
  trial: "Prueba",
  active: "Activo",
  view_only: "Solo lectura",
  suspended: "Suspendido",
};

// Module 7 (Account & danger zone). Every write here goes through a
// base44/functions/* Safe function — member management and account
// deletion are exactly the actions RLS alone can't safely express (see
// their entry.ts header comments), never a raw entity write from this page.
export default function Cuenta() {
  const { user, business, refreshBusiness } = useAuth();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canManageMembers = can("Cuenta:manage_members");
  const canDangerZone = can("Cuenta:danger_zone");

  useEffect(() => {
    if (canManageMembers && user?.business_id) loadMembers();
    else setLoadingMembers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageMembers, user?.business_id]);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const list = await base44.entities.User.filter({ business_id: user.business_id });
      setMembers(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMembers(false);
    }
  };

  const changeRole = async (memberId, role) => {
    try {
      await base44.functions.invoke("manage-member", { action: "change_role", memberId, role });
      toast({ title: "Rol actualizado" });
      loadMembers();
    } catch (e) {
      toast({ title: e.message || "Error al actualizar el rol", variant: "destructive" });
    }
  };

  const removeMember = async (memberId) => {
    if (!confirm("¿Quitar a esta persona del negocio?")) return;
    try {
      await base44.functions.invoke("manage-member", { action: "remove", memberId });
      toast({ title: "Miembro removido" });
      loadMembers();
    } catch (e) {
      toast({ title: e.message || "Error al remover", variant: "destructive" });
    }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ business, exported_at: new Date().toISOString() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ctrlhq-${business?.name || "negocio"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!business || confirmName.trim() !== business.name) return;
    setDeleting(true);
    try {
      await base44.functions.invoke("delete-account", { businessId: business.id, confirmName });
      toast({ title: "Negocio eliminado" });
      window.location.href = "/";
    } catch (e) {
      toast({ title: e.message || "Error al eliminar", variant: "destructive" });
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Cuenta" description={business?.name || "Tu negocio"} />

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="members">Miembros</TabsTrigger>
          <TabsTrigger value="changelog">Novedades</TabsTrigger>
          {canDangerZone && <TabsTrigger value="danger" className="text-rose-600">Zona de peligro</TabsTrigger>}
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Negocio</span>
              <span className="font-medium">{business?.name || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan</span>
              <span className="font-medium">{business?.license_plan || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              {/* Read-only — Module 1: only Mission Control's unified cron
                  writes billing_status. This screen never lets a user
                  self-serve a status change. */}
              <span className="text-sm text-muted-foreground">Estatus de licencia</span>
              <span className="font-medium">{BILLING_LABELS[business?.billing_status] || business?.billing_status || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tu rol</span>
              <span className="font-medium">{ROLE_LABELS[user?.role] || user?.role}</span>
            </div>
            {business?.invite_code && canManageMembers && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Código de invitación</span>
                <span className="font-mono font-medium">{business.invite_code}</span>
              </div>
            )}
          </div>
          <Button variant="outline" onClick={exportData}>
            <Download className="w-4 h-4 mr-2" /> Exportar datos del negocio
          </Button>
        </TabsContent>

        <TabsContent value="members">
          {!canManageMembers ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center text-muted-foreground">
              Solo un administrador del negocio puede ver y gestionar miembros.
            </div>
          ) : loadingMembers ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : (
            <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Users2 className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{m.full_name || m.email}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.id === user.id ? (
                      <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                    ) : (
                      <>
                        <Select value={m.role} onValueChange={(v) => changeRole(m.id, v)}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business_admin">Administrador</SelectItem>
                            <SelectItem value="staff">Personal</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" onClick={() => removeMember(m.id)}>Quitar</Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="changelog" className="space-y-4">
          <p className="text-sm text-muted-foreground">Versión actual: v{APP_VERSION} · {RELEASE_DATE}</p>
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="bg-card rounded-xl border border-border p-4 shadow-sm">
              <p className="font-semibold text-sm mb-2">v{entry.version} · {entry.date}</p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                {entry.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          ))}
        </TabsContent>

        {canDangerZone && (
          <TabsContent value="danger">
            <div className="bg-card rounded-xl border border-rose-200 dark:border-rose-900 p-5 shadow-sm space-y-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-rose-600">Eliminar negocio</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Esto elimina permanentemente todos los registros de Ingresos, Egresos, Nómina,
                    Consumos de Equipo y catálogos de <strong>{business?.name}</strong>. Las cuentas
                    de los miembros no se eliminan, pero perderán acceso a este negocio. Esta acción
                    no se puede deshacer.
                  </p>
                </div>
              </div>
              <div>
                <Label>Escribe <span className="font-mono">{business?.name}</span> para confirmar</Label>
                <Input
                  className="mt-1.5"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={business?.name}
                />
              </div>
              <Button
                variant="destructive"
                disabled={deleting || confirmName.trim() !== business?.name}
                onClick={handleDelete}
              >
                {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
                Eliminar negocio permanentemente
              </Button>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
