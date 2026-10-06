import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2, Settings } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/PermissionContext";

export default function Configuracion() {
  return (
    <div>
      <PageHeader
        title="Configuración"
        description="Administra tus catálogos personalizados"
      />
      <Tabs defaultValue="payment_methods" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-6">
          <TabsTrigger value="payment_methods" className="whitespace-normal text-center">Métodos de Pago</TabsTrigger>
          <TabsTrigger value="sale_types" className="whitespace-normal text-center">Tipos de Venta</TabsTrigger>
          <TabsTrigger value="collaborators" className="whitespace-normal text-center">Colaboradores</TabsTrigger>
          <TabsTrigger value="suppliers" className="whitespace-normal text-center">Proveedores</TabsTrigger>
        </TabsList>
        <TabsContent value="payment_methods">
          <CatalogManager entityName="PaymentMethod" label="Método de Pago" />
        </TabsContent>
        <TabsContent value="sale_types">
          <CatalogManager entityName="SaleType" label="Tipo de Venta" />
        </TabsContent>
        <TabsContent value="collaborators">
          <CatalogManager entityName="Collaborator" label="Colaborador" extraFields={["position"]} />
        </TabsContent>
        <TabsContent value="suppliers">
          <CatalogManager entityName="Supplier" label="Proveedor" extraFields={["category"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CatalogManager({ entityName, label, extraFields = [] }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState({ name: "", ...Object.fromEntries(extraFields.map((f) => [f, ""])) });
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canManage = can("Configuracion:manage_catalogs");

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const data = await base44.entities[entityName].list("name", 500);
      setItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newItem.name.trim()) {
      toast({ title: "El nombre es obligatorio", variant: "destructive" });
      return;
    }
    try {
      await base44.entities[entityName].create({ ...newItem, business_id: user.business_id });
      toast({ title: `${label} agregado` });
      setNewItem({ name: "", ...Object.fromEntries(extraFields.map((f) => [f, ""])) });
      loadItems();
    } catch (e) {
      toast({ title: "Error al agregar", variant: "destructive" });
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(`¿Eliminar este ${label.toLowerCase()}?`)) return;
    try {
      await base44.entities[entityName].delete(id);
      toast({ title: `${label} eliminado` });
      loadItems();
    } catch (e) {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const fieldLabels = { position: "Puesto", category: "Categoría" };

  return (
    <div className="space-y-4">
      {/* Add form — Module 3: catalog management is business_admin-only
          (permissionRegistry "Configuracion:manage_catalogs"); staff still
          reads these lists for the dropdowns elsewhere in the app. */}
      {canManage && (
        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <Label className="mb-1.5">Nuevo {label}</Label>
              <Input
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                placeholder={`Nombre del ${label.toLowerCase()}`}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            {extraFields.map((field) => (
              <div key={field} className="flex-1 w-full">
                <Label className="mb-1.5">{fieldLabels[field]}</Label>
                <Input
                  value={newItem[field]}
                  onChange={(e) => setNewItem({ ...newItem, [field]: e.target.value })}
                  placeholder={fieldLabels[field]}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
              </div>
            ))}
            <Button onClick={handleAdd} className="shrink-0">
              <Plus className="w-4 h-4 mr-2" /> Agregar
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              {extraFields.map((f) => (
                <TableHead key={f}>{fieldLabels[f]}</TableHead>
              ))}
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={extraFields.length + 2} className="text-center py-8 text-muted-foreground">Cargando...</TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={extraFields.length + 2} className="text-center py-8 text-muted-foreground">
                  <Settings className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No hay {label.toLowerCase()}s registrados
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  {extraFields.map((f) => (
                    <TableCell key={f} className="text-muted-foreground">{item[f] || "—"}</TableCell>
                  ))}
                  <TableCell>
                    {canManage && (
                      <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-muted rounded-lg text-rose-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}