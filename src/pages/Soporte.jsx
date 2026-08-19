import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle2, Clock, LifeBuoy } from "lucide-react";

const emptyForm = { subject: "", category: "soporte", message: "" };

// Module 8: writes to CtrlHQ's own SupportTicket entity first (never lost if
// the sync to Mission Control lags), tagged implicitly by business_id via
// RLS. Mission Control's own sync job (acacia-mission-control, config
// ticket_entity: "SupportTicket") pulls these into its shared tickets
// bodega — this page intentionally has no per-app triage UI beyond
// submitted/resolved; triage happens from Mission Control's panel.
export default function Soporte() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      const list = await base44.entities.SupportTicket.list("-created_date", 200);
      setTickets(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.subject.trim() || !form.message.trim()) {
      toast({ title: "Completa el asunto y el mensaje", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.SupportTicket.create({ ...form, business_id: user.business_id });
      toast({ title: "Enviado. Te responderemos pronto." });
      setForm(emptyForm);
      loadTickets();
    } catch (e) {
      toast({ title: "Error al enviar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Soporte" description="Reporta un problema o sugiere una mejora" />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-card rounded-xl border border-border p-5 shadow-sm space-y-4">
          <div>
            <Label>Tipo</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="soporte">Soporte (algo no funciona)</SelectItem>
                <SelectItem value="mejora">Sugerir una mejora</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Asunto</Label>
            <Input className="mt-1.5" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Resumen breve" />
          </div>
          <div>
            <Label>Mensaje</Label>
            <Textarea className="mt-1.5" rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Describe el problema o la mejora que te gustaría ver" />
          </div>
          <Button onClick={handleSubmit} disabled={saving} className="w-full">
            {saving ? "Enviando..." : "Enviar"}
          </Button>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <LifeBuoy className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Aún no has enviado tickets
            </div>
          ) : (
            tickets.map((t) => (
              <div key={t.id} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-sm">{t.subject}</p>
                  {t.status === "resolved" ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> Resuelto</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-600"><Clock className="w-3.5 h-3.5" /> Enviado</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{t.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
