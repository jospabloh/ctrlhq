import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, KeyRound, Loader2, Wallet } from "lucide-react";

// The one screen between "logged in" and "has a tenant" (Module 2): every
// CtrlHQ user either creates a Business (becomes business_admin) or joins
// one with an invite code (becomes staff). Both go through the
// complete-onboarding Safe function — see its header comment for why this
// isn't a plain auth.updateMe() call.
export default function Onboarding() {
  const { user, checkUserAuth, refreshBusiness } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const finishOnboarding = async (mode) => {
    setError("");
    setLoading(true);
    try {
      await base44.functions.invoke("complete-onboarding", {
        mode,
        businessName: mode === "create" ? businessName : undefined,
        inviteCode: mode === "join" ? inviteCode : undefined,
      });
      await checkUserAuth();
      await refreshBusiness();
    } catch (err) {
      setError(err.message || "No se pudo completar el registro.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <Wallet className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-heading font-semibold text-sm">Bienvenido, {user?.full_name || user?.email}</p>
            <p className="text-xs text-muted-foreground">Un paso más para empezar</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
        )}

        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="create">Crear negocio</TabsTrigger>
            <TabsTrigger value="join">Unirme con código</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Crea tu negocio y quedarás como administrador. Empiezas en periodo de prueba.
            </p>
            <div>
              <Label>Nombre del negocio</Label>
              <div className="relative mt-1.5">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-10"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Ej: Café Acacia"
                />
              </div>
            </div>
            <Button className="w-full h-11" disabled={loading || !businessName.trim()} onClick={() => finishOnboarding("create")}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Crear negocio
            </Button>
          </TabsContent>
          <TabsContent value="join" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Pide el código de invitación al administrador de tu negocio y únete como personal.
            </p>
            <div>
              <Label>Código de invitación</Label>
              <div className="relative mt-1.5">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-10 uppercase"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Ej: AB12CD34"
                />
              </div>
            </div>
            <Button className="w-full h-11" disabled={loading || !inviteCode.trim()} onClick={() => finishOnboarding("join")}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Unirme
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
