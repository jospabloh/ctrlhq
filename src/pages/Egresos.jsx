import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Pencil, Trash2, TrendingDown, Clock, CheckCircle2, XCircle } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/PermissionContext";

const formatCurrency = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0);

const formatDate = (d) => (d ? new Date(d).toLocaleDateString("es-MX") : "");

const statusConfig = {
  pendiente: { label: "Pendiente", icon: Clock, color: "text-amber-600", bg: "bg-amber-100" },
  recibida: { label: "Recibida", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100" },
  no_requerida: { label: "No requerida", icon: XCircle, color: "text-slate-500", bg: "bg-slate-100" },
};

const emptyForm = {
  date: new Date().toISOString().split("T")[0],
  supplier_name: "",
  amount: "",
  invoice_status: "pendiente",
  invoice_number: "",
  category: "",
  notes: "",
};

export default function Egresos() {
  const [records, setRecords] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = usePermissions();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [exp, sup] = await Promise.all([
        base44.entities.Expense.list("-date", 1000),
        base44.entities.Supplier.list("name", 500),
      ]);
      setRecords(exp);
      setSuppliers(sup);
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
      supplier_name: record.supplier_name || "",
      amount: record.amount || "",
      invoice_status: record.invoice_status || "pendiente",
      invoice_number: record.invoice_number || "",
      category: record.category || "",
      notes: record.notes || "",
    });
    setEditingId(record.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.date || !form.supplier_name || !form.amount) {
      toast({ title: "Faltan campos obligatorios", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        invoice_number: form.invoice_status === "no_requerida" ? "NA" : form.invoice_number,
        business_id: user.business_id,
      };
      if (editingId) {
        await base44.entities.Expense.update(editingId, payload);
      } else {
        await base44.entities.Expense.create(payload);
      }
      toast({ title: editingId ? "Egreso actualizado" : "Egreso registrado" });
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
      await base44.entities.Expense.delete(id);
      toast({ title: "Registro eliminado" });
      loadData();
    } catch (e) {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const filteredRecords = filterStatus === "all"
    ? records
    : records.filter((r) => r.invoice_status === filterStatus);

  const total = filteredRecords.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Egresos"
        description={`${filteredRecords.length} registros · Total: ${formatCurrency(total)}`}
        action={
          can("Egresos:create") && (
            <Button onClick={openAdd}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo Egreso
            </Button>
          )
        }
      />

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        <FilterChip label="Todos" active={filterStatus === "all"} onClick={() => setFilterStatus("all")} />
        <FilterChip label="Pendientes" active={filterStatus === "pendiente"} onClick={() => setFilterStatus("pendiente")} />
        <FilterChip label="Recibidas" active={filterStatus === "recibida"} onClick={() => setFilterStatus("recibida")} />
        <FilterChip label="No requeridas" active={filterStatus === "no_requerida"} onClick={() => setFilterStatus("no_requerida")} />
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Estado Factura</TableHead>
              <TableHead>N° Factura</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Cargando...</TableCell>
              </TableRow>
            ) : filteredRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <TrendingDown className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No hay egresos registrados
                </TableCell>
              </TableRow>
            ) : (
              filteredRecords.map((r) => {
                const cfg = statusConfig[r.invoice_status] || statusConfig.pendiente;
                const StatusIcon = cfg.icon;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell className="font-medium">{r.supplier_name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.category || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusIcon className={cn("w-4 h-4", cfg.color)} />
                        <span className="text-sm">{cfg.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{r.invoice_number || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-rose-600 whitespace-nowrap">{formatCurrency(r.amount)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-muted rounded-lg">
                          <Pencil className="w-4 h-4" />
                        </button>
                        {can("Egresos:delete") && (
                          <button onClick={() => handleDelete(r.id)} className="p-1.5 hover:bg-muted rounded-lg text-rose-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Egreso" : "Nuevo Egreso"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label>Nombre del Proveedor *</Label>
              <Input
                value={form.supplier_name}
                onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                placeholder="Nombre del proveedor"
                list="suppliers-list"
              />
              <datalist id="suppliers-list">
                {suppliers.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div>
              <Label>Monto *</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Estado de Factura *</Label>
              <Select value={form.invoice_status} onValueChange={(v) => setForm({ ...form, invoice_status: v, invoice_number: v === "no_requerida" ? "NA" : form.invoice_number })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="recibida">Recibida</SelectItem>
                  <SelectItem value="no_requerida">No requerida</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.invoice_status !== "no_requerida" && (
              <div>
                <Label>Número de Factura</Label>
                <Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} placeholder="N° de factura" />
              </div>
            )}
            <div>
              <Label>Categoría</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ej: Insumos, Servicios, Renta" />
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas adicionales" />
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

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}