import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { guardedCreate, guardedUpdate, guardedDelete } from "@/lib/guardedWrite";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/PermissionContext";

const formatCurrency = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0);

const formatDate = (d) => (d ? new Date(d).toLocaleDateString("es-MX") : "");

const emptyForm = {
  date: new Date().toISOString().split("T")[0],
  collaborator: "",
  base_salary: "",
  overtime_hours: 0,
  overtime_pay: 0,
  vacation_days: 0,
  absences: 0,
  deductions: 0,
  total: 0,
  notes: "",
};

export default function Nomina() {
  const [records, setRecords] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canView = can("Nomina:view");

  useEffect(() => {
    if (canView) loadData();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const loadData = async () => {
    try {
      const [pay, col] = await Promise.all([
        base44.entities.Payroll.list("-date", 1000),
        base44.entities.Collaborator.list("name", 500),
      ]);
      setRecords(pay);
      setCollaborators(col);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const computeTotal = (f) =>
    (Number(f.base_salary) || 0) + (Number(f.overtime_pay) || 0) - (Number(f.deductions) || 0);

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (record) => {
    setForm({
      date: record.date ? record.date.split("T")[0] : "",
      collaborator: record.collaborator || "",
      base_salary: record.base_salary || "",
      overtime_hours: record.overtime_hours || 0,
      overtime_pay: record.overtime_pay || 0,
      vacation_days: record.vacation_days || 0,
      absences: record.absences || 0,
      deductions: record.deductions || 0,
      total: record.total || 0,
      notes: record.notes || "",
    });
    setEditingId(record.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.date || !form.collaborator || !form.base_salary) {
      toast({ title: "Faltan campos obligatorios", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, total: computeTotal(form), business_id: user.business_id };
      if (editingId) {
        await guardedUpdate("Payroll", editingId, payload);
      } else {
        await guardedCreate("Payroll", payload);
      }
      toast({ title: editingId ? "Nómina actualizada" : "Nómina registrada" });
      setDialogOpen(false);
      loadData();
    } catch (e) {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este registro?")) return;
    try {
      await guardedDelete("Payroll", id);
      toast({ title: "Registro eliminado" });
      loadData();
    } catch (e) {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const totalNomina = records.reduce((s, r) => s + (r.total || r.base_salary || 0), 0);
  const totalOvertime = records.reduce((s, r) => s + (r.overtime_pay || 0), 0);

  // Nómina is sensitive (Module 3): staff has no access at all, matching
  // Payroll's RLS (base44/entities/Payroll.jsonc) which excludes them from
  // even reading — this mirrors that server-side rule, not a substitute for it.
  if (!canView) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        No tienes acceso a Nómina. Solicita a un administrador del negocio que
        te otorgue este permiso.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Nómina"
        description={`${records.length} registros · Total: ${formatCurrency(totalNomina)} · Horas extra: ${formatCurrency(totalOvertime)}`}
        action={
          can("Nomina:create") && (
            <Button onClick={openAdd}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo Registro
            </Button>
          )
        }
      />

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead className="text-right">Salario Base</TableHead>
              <TableHead className="text-right">Hrs. Extra</TableHead>
              <TableHead className="text-right">Pago Extra</TableHead>
              <TableHead className="text-center">Vacaciones</TableHead>
              <TableHead className="text-center">Faltas</TableHead>
              <TableHead className="text-right">Deducciones</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Cargando...</TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No hay registros de nómina
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  <TableCell className="font-medium">{r.collaborator}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(r.base_salary)}</TableCell>
                  <TableCell className="text-right">{r.overtime_hours || 0}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-amber-600">{formatCurrency(r.overtime_pay)}</TableCell>
                  <TableCell className="text-center">{r.vacation_days || 0}</TableCell>
                  <TableCell className="text-center">{r.absences || 0}</TableCell>
                  <TableCell className="text-right text-rose-600 whitespace-nowrap">{formatCurrency(r.deductions)}</TableCell>
                  <TableCell className="text-right font-bold whitespace-nowrap">{formatCurrency(r.total || r.base_salary)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {can("Nomina:edit") && (
                        <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-muted rounded-lg">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {can("Nomina:delete") && (
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 hover:bg-muted rounded-lg text-rose-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Nómina" : "Nuevo Registro de Nómina"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-4">
              <div>
                <Label>Fecha *</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <Label>Colaborador *</Label>
                <Select value={form.collaborator} onValueChange={(v) => setForm({ ...form, collaborator: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>
                    {collaborators.map((c) => (
                      <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Salario Base *</Label>
              <Input type="number" step="0.01" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} placeholder="0.00" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Horas Extra</Label>
                <Input type="number" value={form.overtime_hours} onChange={(e) => setForm({ ...form, overtime_hours: e.target.value })} placeholder="0" />
              </div>
              <div>
                <Label>Pago por Horas Extra</Label>
                <Input type="number" step="0.01" value={form.overtime_pay} onChange={(e) => setForm({ ...form, overtime_pay: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Días de Vacaciones</Label>
                <Input type="number" value={form.vacation_days} onChange={(e) => setForm({ ...form, vacation_days: e.target.value })} placeholder="0" />
              </div>
              <div>
                <Label>Inasistencias</Label>
                <Input type="number" value={form.absences} onChange={(e) => setForm({ ...form, absences: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label>Deducciones</Label>
              <Input type="number" step="0.01" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas adicionales" />
            </div>
            <div className="p-3 bg-muted rounded-lg flex items-center justify-between">
              <span className="font-medium">Total a pagar:</span>
              <span className="text-lg font-bold">{formatCurrency(computeTotal(form))}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}