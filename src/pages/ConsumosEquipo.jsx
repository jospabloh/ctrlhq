import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { guardedCreate, guardedUpdate, guardedDelete } from "@/lib/guardedWrite";
import { Plus, Pencil, Trash2, Utensils } from "lucide-react";
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
  dish: "",
  amount: "",
};

export default function ConsumosEquipo() {
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [con, col] = await Promise.all([
        base44.entities.TeamConsumption.list("-date", 1000),
        base44.entities.Collaborator.list("name", 500),
      ]);
      setRecords(con);
      setCollaborators(col);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (record) => {
    setForm({
      date: record.date ? record.date.split("T")[0] : "",
      collaborator: record.collaborator || "",
      dish: record.dish || "",
      amount: record.amount || "",
    });
    setEditingId(record.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.date || !form.collaborator || !form.dish || !form.amount) {
      toast({ title: "Faltan campos obligatorios", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), business_id: user.business_id };
      if (editingId) {
        await guardedUpdate("TeamConsumption", editingId, payload);
      } else {
        await guardedCreate("TeamConsumption", payload);
      }
      toast({ title: editingId ? "Consumo actualizado" : "Consumo registrado" });
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
      await guardedDelete("TeamConsumption", id);
      toast({ title: "Registro eliminado" });
      loadData();
    } catch (e) {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const total = records.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Consumos Equipo"
        description={`${records.length} registros · Total: ${formatCurrency(total)}`}
        action={
          can("ConsumosEquipo:create") && (
            <Button onClick={openAdd}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo Consumo
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
              <TableHead>Platillo</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando...</TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  <Utensils className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No hay consumos registrados
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  <TableCell className="font-medium">{r.collaborator}</TableCell>
                  <TableCell>{r.dish}</TableCell>
                  <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(r.amount)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {can("ConsumosEquipo:create") && (
                        <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-muted rounded-lg">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {can("ConsumosEquipo:delete") && (
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Consumo" : "Nuevo Consumo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
            <div>
              <Label>Platillo *</Label>
              <Input value={form.dish} onChange={(e) => setForm({ ...form, dish: e.target.value })} placeholder="Nombre del platillo" />
            </div>
            <div>
              <Label>Monto *</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
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