import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Building2, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// The sidebar's business name, made switchable when there is somewhere to
// switch to. With a single membership it stays plain text — a dropdown arrow
// that opens a menu of one is a lie about what the app can do.
//
// Switching goes through switchTenant() -> the switch-tenant function, which
// re-derives membership server-side before repointing business_id. Everything
// on screen here is a label.
export default function TenantSwitcher() {
  const { business, memberships, switchTenant } = useAuth();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const ref = useRef(null);

  const others = (memberships || []).filter((m) => m.business_id !== business?.id);
  const canSwitch = (memberships || []).length > 1;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !others.length) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        others.map(async (m) => {
          try {
            const b = await base44.entities.Business.get(m.business_id);
            return [m.business_id, b?.name || "Negocio sin nombre"];
          } catch {
            return [m.business_id, "Negocio sin nombre"];
          }
        })
      );
      if (!cancelled) setNames(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [open, memberships, business?.id]);

  const go = async (businessId) => {
    setError("");
    setBusyId(businessId);
    try {
      await switchTenant(businessId);
      // Full reload: every page's data belongs to the tenant that was active
      // when it loaded, so re-mounting the tree is the honest way to make sure
      // nothing from the previous tenant survives on screen.
      window.location.reload();
    } catch (err) {
      const serverMessage = err?.data?.message || err?.originalError?.response?.data?.message;
      setError(serverMessage || "No pudimos cambiar de negocio.");
      setBusyId("");
    }
  };

  const label = business?.name || "CtrlHQ";
  const subtitle = business?.name ? "CtrlHQ · Gestión Financiera" : "Gestión Financiera";

  if (!canSwitch) {
    return (
      <div className="min-w-0">
        <p className="font-heading font-semibold text-sm text-sidebar-foreground truncate" title={label}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="w-full flex items-center gap-1 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/60 transition-colors"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span
              className="font-heading font-semibold text-sm text-sidebar-foreground truncate"
              title={label}
            >
              {label}
            </span>
            <ChevronDown
              className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </span>
          <span className="block text-xs text-muted-foreground truncate">{subtitle}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-60 z-50 rounded-lg border border-border bg-card shadow-lg p-1"
        >
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Cambiar de negocio</p>
          {error && (
            <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>
          )}
          <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-muted/50">
            <Check className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
            <span className="text-sm truncate">{label}</span>
          </div>
          {others.map((m) => (
            <button
              key={m.id || m.business_id}
              role="menuitem"
              disabled={!!busyId}
              onClick={() => go(m.business_id)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-muted/60 disabled:opacity-60 text-left transition-colors"
            >
              {busyId === m.business_id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              )}
              <span className="text-sm truncate">
                {names[m.business_id] || "Cargando…"}
              </span>
            </button>
          ))}
          <a
            href="/onboarding"
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-muted/60 text-left border-t border-border mt-1 pt-2"
          >
            <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="text-sm">Crear o unirme a otro</span>
          </a>
        </div>
      )}
    </div>
  );
}
