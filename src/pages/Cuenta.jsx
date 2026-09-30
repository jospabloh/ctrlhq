import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/PermissionContext";
import { ROLE_LABELS, ROLES, ASSIGNABLE_ROLES } from "@/lib/rbac";
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
import { AlertTriangle, Download, Loader2, ShieldAlert, UserCheck, Users2 } from "lucide-react";

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
  // Join requests waiting for this business's admin (see manage-member).
  const [requests, setRequests] = useState([]);
  const [requestRoles, setRequestRoles] = useState({});
  const [resolvingId, setResolvingId] = useState(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canManageMembers = can("Cuenta:manage_members");
  const canDangerZone = can("Cuenta:danger_zone");

  useEffect(() => {
    if (canManageMembers && user?.business_id) {
      loadMembers();
      loadRequests();
    } else setLoadingMembers(false);
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

  const loadRequests = async () => {
    try {
      const res = await base44.functions.invoke("manage-member", { action: "list_pending" });
      setRequests(res?.data?.requests ?? []);
    } catch (e) {
      console.error(e);
    }
  };

  // The admin CHOOSES the role at approval time; the server checks it against
  // the assignable whitelist (never the platform admin) and re-reads the stored
  // request, so nothing here grants access by itself.
  const resolveRequest = async (requestId, action) => {
    setResolvingId(requestId);
    try {
      await base44.functions.invoke("manage-member", {
        action,
        memberId: requestId,
        role: action === "approve" ? requestRoles[requestId] || ROLES.STAFF : undefined,
      });
      toast({ title: action === "approve" ? "Solicitud aprobada" : "Solicitud rechazada" });
      await Promise.all([loadRequests(), loadMembers()]);
    } catch (e) {
      const msg = e?.data?.message || e?.originalError?.response?.data?.message || e?.message;
      toast({ title: msg || "No se pudo resolver la solicitud", variant: "destructive" });
      loadRequests();
    } finally {
      setResolvingId(null);
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

  // Module 7's data export. The payload is built SERVER-side by
  // export-business-data, not from what this page happens to have loaded:
  // `business` alone is the tenant's profile, not its Ingresos/Egresos/
  // Nómina/Consumos rows, which is what a business actually needs before
  // deleting its account. The response still becomes a client-side download —
  // no server-side file storage is involved.
  const exportData = async () => {
    setExporting(true);
    try {
      const response = await base44.functions.invoke("export-business-data", {});
      const payload = response?.data ?? {};
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `ctrlhq-${business?.name || "negocio"}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (payload.errors) {
        toast({
          title: "Exportación parcial",
          description: 'Algunas secciones fallaron. Revisa "errors" en el archivo.',
        });
      } else {
        toast({ title: "Datos exportados" });
      }
    } catch (e) {
      toast({ title: e.message || "No se pudo exportar", variant: "destructive" });
    } finally {
      setExporting(false);
    }
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
          <TabsTrigger value="members">
            Miembros{requests.length > 0 ? ` (${requests.length} por aprobar)` : ""}
          </TabsTrigger>
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
          {canDangerZone && (
            <Button variant="outline" onClick={exportData} disabled={exporting}>
              {exporting
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Download className="w-4 h-4 mr-2" />}
              {exporting ? "Exportando…" : "Exportar datos del negocio"}
            </Button>
          )}
        </TabsContent>

        <TabsContent value="members">
          {!canManageMembers ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center text-muted-foreground">
              Solo un administrador del negocio puede ver y gestionar miembros.
            </div>
          ) : loadingMembers ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : (
            <div className="space-y-4">
            {requests.length > 0 && (
              <div className="bg-card rounded-xl border border-primary/40 shadow-sm">
                <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                  <UserCheck className="w-4 h-4 text-primary" />
                  <p className="font-semibold text-sm">Solicitudes para unirse ({requests.length})</p>
                </div>
                <p className="px-4 pb-3 text-xs text-muted-foreground">
                  Estas personas usaron el código de invitación. No tienen acceso hasta que las apruebes y elijas su rol.
                </p>
                <div className="divide-y divide-border border-t border-border">
                  {requests.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium text-sm">{r.full_name || r.email}</p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={requestRoles[r.id] || ROLES.STAFF}
                          onValueChange={(v) => setRequestRoles((prev) => ({ ...prev, [r.id]: v }))}
                        >
                          <SelectTrigger className="w-40" aria-label="Rol al aprobar"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" disabled={resolvingId === r.id} onClick={() => resolveRequest(r.id, "approve")}>
                          Aprobar
                        </Button>
                        <Button variant="outline" size="sm" disabled={resolvingId === r.id} onClick={() => resolveRequest(r.id, "reject")}>
                          Rechazar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
