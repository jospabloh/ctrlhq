import React, { useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Users,
  Utensils,
  Settings,
  Menu,
  X,
  UserCircle,
  LifeBuoy,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/PermissionContext";

const BILLING_BANNER = {
  view_only: {
    text: "Tu negocio está en modo de solo lectura. Ve a Cuenta para revisar tu plan.",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  suspended: {
    text: "Tu negocio está suspendido. Ve a Cuenta o contacta a Soporte para reactivarlo.",
    className: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  },
};

const navItems = [
  { path: "/", label: "Resumen", icon: LayoutDashboard },
  { path: "/ingresos", label: "Ingresos", icon: TrendingUp },
  { path: "/egresos", label: "Egresos", icon: TrendingDown },
  // Nómina hidden below for staff — Payroll's RLS excludes them from even
  // reading (base44/entities/Payroll.jsonc), so showing the link would just
  // open a page that immediately says "no access".
  { path: "/nomina", label: "Nómina", icon: Users, permission: "Nomina:view" },
  { path: "/consumos-equipo", label: "Consumos Equipo", icon: Utensils },
  { path: "/configuracion", label: "Configuración", icon: Settings },
  { path: "/cuenta", label: "Cuenta", icon: UserCircle },
  { path: "/soporte", label: "Soporte", icon: LifeBuoy },
];

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { can, business } = usePermissions();
  const visibleNavItems = navItems.filter((item) => !item.permission || can(item.permission));
  // Module 1: billing_status is read-only here — Mission Control's cron is
  // the only writer. This banner is the UI-degrade the module requires,
  // never a place to self-serve a status change.
  const billingBanner = BILLING_BANNER[business?.billing_status];

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b border-border h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <img src="/logo-192.png" alt="CtrlHQ" className="w-6 h-6" />
          <span className="font-heading font-semibold">CtrlHQ</span>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-64 bg-sidebar border-r border-sidebar-border transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border">
          <img src="/logo-192.png" alt="CtrlHQ" className="w-9 h-9" />
          <div>
            <p className="font-heading font-semibold text-sm text-sidebar-foreground">CtrlHQ</p>
            <p className="text-xs text-muted-foreground">Gestión Financiera</p>
          </div>
        </div>
        <nav className="p-3 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
        {billingBanner && (
          <div className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-medium", billingBanner.className)}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {billingBanner.text}
          </div>
        )}
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}