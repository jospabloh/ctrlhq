import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Pencil, Trash2, TrendingUp } from "lucide-react";
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

const emptyForm = { date: new Date().toISOString().split("T")[0], amount: "", payment_method: "", sale_type: "", description: "" };

export default function Ingresos() {
  const [records, setRecords] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [saleTypes, setSaleTypes] = useState([]);
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
      const [inc, pm, st] = await Promise.all([
        base44.entities.Income.list("-date", 1000),
        base44.entities.PaymentMethod.list("name", 500),
        base44.entities.SaleType.list("name", 500),
      ]);
      setRecords(inc);
      setPaymentMethods(pm);
      setSaleTypes(st);
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
      amount: record.amount || "",
      payment_method: record.payment_method || "",
      sale_type: record.sale_type || "",
      description: record.description || "",
    });
    setEditingId(record.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.date || !form.amount || !form.payment_method) {
      toast({ title: "Faltan campos obligatorios", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), business_id: user.business_id };
      if (editingId) {
        await base44.entities.Income.update(editingId, payload);
      } else {
        await base44.entities.Income.create(payload);
      }
      toast({ title: editingId ? "Ingreso actualizado" : "Ingreso registrado" });
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
      await base44.entities.Income.delete(id);
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
        title="Ingresos"
        description={`${records.length} registros · Total: ${formatCurrency(total)}`}
        action={
          can("Ingresos:create") && (
            <Button onClick={openAdd}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo Ingreso
            </Button>
          )
        }
      />

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Método de Pago</TableHead>
              <TableHead>Tipo de Venta</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Cargando...</TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No hay ingresos registrados
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  <TableCell>{r.payment_method || "—"}</TableCell>
                  <TableCell>{r.sale_type || "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{r.description || "—"}</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-600 whitespace-nowrap">{formatCurrency(r.amount)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-muted rounded-lg">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {can("Ingresos:delete") && (
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
            <DialogTitle>{editingId ? "Editar Ingreso" : "Nuevo Ingreso"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label>Monto *</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Método de Pago *</Label>
              <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de Venta</Label>
              <Select value={form.sale_type} onValueChange={(v) => setForm({ ...form, sale_type: v })}>
                <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent>
                  {saleTypes.map((s) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Descripción</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Notas adicionales" />
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