import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Building2, Check, Loader2, Plus } from "lucide-react";

// Asked once per session when the caller belongs to more than one business.
// Someone who belongs to exactly one never sees it — being made to confirm a
// choice you do not have is just a click in the way.
//
// Only ever a *chooser*: the actual move is switchTenant(), which calls the
// switch-tenant function, which re-derives membership server-side. Nothing here
// is trusted. Rendering a row for a business grants no access to it.
export const TENANT_CHOSEN_KEY = "ctrlhq.tenantChosen";

export default function SelectTenant({ onChosen }) {
  const { user, memberships, switchTenant } = useAuth();
  const [businesses, setBusinesses] = useState({});
  const [loadingNames, setLoadingNames] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  // Membership carries ids, not names. Read the names the caller is entitled
  // to see; a name that cannot be read still renders as a usable row rather
  // than vanishing, so a permissions hiccup never hides a tenant from its own
  // member.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        (memberships || []).map(async (m) => {
          try {
            const b = await base44.entities.Business.get(m.business_id);
            return [m.business_id, b?.name || "Negocio sin nombre"];
          } catch {
            return [m.business_id, "Negocio sin nombre"];
          }
        })
      );
      if (!cancelled) {
        setBusinesses(Object.fromEntries(entries));
        setLoadingNames(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memberships]);

  const choose = async (businessId) => {
    setError("");
    setBusyId(businessId);
    try {
      await switchTenant(businessId);
      sessionStorage.setItem(TENANT_CHOSEN_KEY, businessId);
      onChosen?.(businessId);
    } catch (err) {
      const serverMessage = err?.data?.message || err?.originalError?.response?.data?.message;
      setError(serverMessage || "No pudimos abrir ese negocio. Intenta de nuevo.");
    } finally {
      setBusyId("");
    }
  };

  const ROLE_LABEL = {
    business_admin: "Administrador",
    staff: "Personal",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <img src="/logo-192.png" alt="CtrlHQ" className="w-9 h-9" />
          <div>
            <p className="font-heading font-semibold text-sm">
              Hola, {user?.full_name || user?.email}
            </p>
            <p className="text-xs text-muted-foreground">¿A qué negocio quieres entrar?</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {loadingNames ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {(memberships || []).map((m) => {
              const isCurrent = user?.business_id === m.business_id;
              const busy = busyId === m.business_id;
              return (
                <button
                  key={m.id || m.business_id}
                  onClick={() => choose(m.business_id)}
                  disabled={!!busyId}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/60 disabled:opacity-60 text-left transition-colors"
                >
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">
                      {businesses[m.business_id]}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {ROLE_LABEL[m.role] || m.role}
                    </span>
                  </span>
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : isCurrent ? (
                    <Check className="w-4 h-4 text-primary shrink-0" aria-label="Negocio actual" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <Button
          variant="outline"
          className="w-full mt-4"
          disabled={!!busyId}
          onClick={() => {
            sessionStorage.setItem(TENANT_CHOSEN_KEY, "new");
            window.location.href = "/onboarding";
          }}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
          Crear o unirme a otro negocio
        </Button>
      </div>
    </div>
  );
}
