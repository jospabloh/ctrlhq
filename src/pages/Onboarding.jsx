import React, { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Clock, KeyRound, LifeBuoy, Loader2 } from "lucide-react";

// The one screen between "logged in" and "has a tenant" (Module 2): every
// CtrlHQ user either creates a Business (becomes business_admin) or asks to
// join one with its invite code. Joining is a REQUEST: the person has no
// access until a business_admin approves it (and picks their role) from
// Cuenta > Miembros. The pending state lives on the server, so this screen
// rebuilds it from complete-onboarding's "status" after any reload. Both go
// through the complete-onboarding Safe function — see its header comment for
// why this isn't a plain auth.updateMe() call.
const POLL_MS = 15000;

export default function Onboarding() {
  const { user, checkUserAuth, refreshBusiness } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [errorIsUnexpected, setErrorIsUnexpected] = useState(false);
  // { businessName } while a join request waits for approval, else null.
  const [pending, setPending] = useState(null);
  const [checking, setChecking] = useState(true);

  // Asks the server where this person stands. Approved -> refresh the session
  // so App.jsx lets them in; still pending -> keep the waiting screen.
  // AuthProvider recreates checkUserAuth on every render; keep the latest in a
  // ref so syncStatus stays stable and the polling effect below does not
  // restart (or loop) on each re-render.
  const checkUserAuthRef = useRef(checkUserAuth);
  checkUserAuthRef.current = checkUserAuth;

  const syncStatus = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("complete-onboarding", { mode: "status" });
      const data = res?.data ?? res;
      if (data?.hasBusiness) {
        // checkUserAuth also loads the Business for the refreshed user.
        await checkUserAuthRef.current();
        return;
      }
      setPending(data?.pending || null);
    } catch (err) {
      // A failed status check must not trap anyone on a blank screen: they
      // can still use the forms below (the server re-validates everything).
      console.error("[Onboarding] status check failed", err);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    syncStatus();
  }, [syncStatus]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(syncStatus, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, syncStatus]);

  const cancelRequest = async () => {
    setError("");
    setLoading(true);
    try {
      await base44.functions.invoke("complete-onboarding", { mode: "cancel_join" });
      setPending(null);
      setInviteCode("");
    } catch (err) {
      setError(err?.data?.message || err?.originalError?.response?.data?.message || "No se pudo cancelar la solicitud. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

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
    setErrorIsUnexpected(false);
    setLoading(true);
    try {
      try {
        const res = await base44.functions.invoke("complete-onboarding", {
          mode,
          businessName: mode === "create" ? businessName : undefined,
          inviteCode: mode === "join" ? inviteCode : undefined,
        });
        if (mode === "join") {
          // Request recorded; no access yet. Show the waiting screen.
          const data = res?.data ?? res;
          setPending(data?.pending || { businessName: "" });
          return;
        }
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
      // Module 10: no dead ends. Two different cases need two different
      // messages — conflating them (flagged in review) told a user with a
      // real, correctable mistake (bad invite code, already has a business)
      // to "wait and contact support" instead of just fixing their input.
      // The signal that tells them apart: complete-onboarding's own
      // validation errors always carry a real body ({message: "..."} — see
      // that function's entry.ts); a request that never reached the
      // function at all (the platform-level 404 this screen is built to
      // survive) comes back with no body. Real body → show it verbatim,
      // it's actionable. No body → generic message + support link.
      const serverMessage = err?.data?.message || err?.originalError?.response?.data?.message;
      if (serverMessage) {
        // A real, actionable validation message from complete-onboarding
        // itself — show it as-is, no support link needed, this is
        // something the user can just fix (bad invite code, etc.).
        setError(serverMessage);
      } else {
        setErrorIsUnexpected(true);
        setError(
          "No pudimos completar tu registro. Intenta de nuevo en unos minutos — si el problema sigue, contacta a soporte con el detalle de abajo."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const supportMailto = () => {
    const subject = encodeURIComponent("CtrlHQ: no puedo completar el registro de mi negocio");
    const body = encodeURIComponent(
      `Hola,\n\nNo pude crear/unirme a un negocio en CtrlHQ.\n\nCorreo: ${user?.email || ""}\nDetalle técnico: ${errorDetail || "(sin detalle)"}\n`
    );
    return `mailto:soporte@acaciaco.com.mx?subject=${subject}&body=${body}`;
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Cargando" />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8 text-center space-y-4">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Clock className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <h1 className="font-heading text-xl font-semibold">Solicitud enviada</h1>
          <p className="text-sm text-muted-foreground">
            Estamos esperando la aprobación del administrador
            {pending.businessName ? <> de <strong className="text-foreground">{pending.businessName}</strong></> : null}.
            Cuando la apruebe podrás entrar; esta pantalla se actualiza sola.
          </p>
          {error && <p className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</p>}
          <div className="flex flex-col gap-2 pt-2">
            <Button className="h-11" onClick={syncStatus} disabled={loading}>Revisar ahora</Button>
            <Button variant="outline" className="h-11" onClick={cancelRequest} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Cancelar solicitud
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm space-y-2">
            <p>{error}</p>
            {errorIsUnexpected && (
              <>
                {errorDetail && (
                  <p className="font-mono text-xs opacity-80 break-all">{errorDetail}</p>
                )}
                <a
                  href={supportMailto()}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <LifeBuoy className="w-3.5 h-3.5" aria-hidden="true" />
                  Contactar soporte
                </a>
              </>
            )}
          </div>
        )}

        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="create">Crear negocio</TabsTrigger>
            <TabsTrigger value="join">Unirme con código</TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            {/* A real <form>, so Enter submits. These were bare inputs next to a
                button: typing a name and pressing Enter did nothing, with no
                hint why. */}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading && businessName.trim()) finishOnboarding("create");
              }}
            >
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
            <Button type="submit" className="w-full h-11" disabled={loading || !businessName.trim()}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Crear negocio
            </Button>
            </form>
          </TabsContent>
          <TabsContent value="join">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading && inviteCode.trim()) finishOnboarding("join");
              }}
            >
            <p className="text-sm text-muted-foreground">
              Pide el código de invitación al administrador de tu negocio y solicita unirte. El administrador debe aprobar tu solicitud para darte acceso.
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
            <Button type="submit" className="w-full h-11" disabled={loading || !inviteCode.trim()}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Solicitar unirme
            </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
