import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, KeyRound, Loader2 } from "lucide-react";

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
  const [errorDetail, setErrorDetail] = useState("");

  // TEMPORARY diagnostic wrapper (systematic-debugging: gather evidence before
  // another blind fix attempt) — labels which of the three awaited calls
  // actually failed and surfaces the real HTTP status/URL/response body,
  // since the generic "Request failed with status code NNN" toast alone
  // wasn't enough to root-cause the live 404. Remove once root-caused.
  const describeError = (err) => {
    const url = err?.originalError?.config?.url || err?.config?.url || "unknown-url";
    const method = (err?.originalError?.config?.method || err?.config?.method || "?").toUpperCase();
    const status = err?.status ?? err?.originalError?.response?.status ?? "no-status";
    const data = err?.data ? JSON.stringify(err.data) : (err?.originalError?.response?.data ? JSON.stringify(err.originalError.response.data) : "no-body");
    return `${method} ${url} -> ${status} | body: ${data}`;
  };

  const finishOnboarding = async (mode) => {
    setError("");
    setErrorDetail("");
    setLoading(true);
    try {
      try {
        await base44.functions.invoke("complete-onboarding", {
          mode,
          businessName: mode === "create" ? businessName : undefined,
          inviteCode: mode === "join" ? inviteCode : undefined,
        });
      } catch (err) {
        console.error("[Onboarding] complete-onboarding invoke failed", err);
        setErrorDetail(`[complete-onboarding] ${describeError(err)}`);
        throw err;
      }
      try {
        await checkUserAuth();
      } catch (err) {
        console.error("[Onboarding] checkUserAuth failed", err);
        setErrorDetail(`[checkUserAuth] ${describeError(err)}`);
        throw err;
      }
      try {
        await refreshBusiness();
      } catch (err) {
        console.error("[Onboarding] refreshBusiness failed", err);
        setErrorDetail(`[refreshBusiness] ${describeError(err)}`);
        throw err;
      }
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
          <img src="/logo-192.png" alt="CtrlHQ" className="w-9 h-9" />
          <div>
            <p className="font-heading font-semibold text-sm">Bienvenido, {user?.full_name || user?.email}</p>
            <p className="text-xs text-muted-foreground">Un paso más para empezar</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm space-y-1">
            <p>{error}</p>
            {errorDetail && (
              <p className="font-mono text-xs opacity-80 break-all">{errorDetail}</p>
            )}
          </div>
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
