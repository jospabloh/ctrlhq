import React from "react";
import { cn } from "@/lib/utils";

export default function StatCard({ label, value, sublabel, icon: Icon, variant = "default" }) {
  const variantStyles = {
    default: "text-foreground",
    positive: "text-emerald-600",
    negative: "text-rose-600",
    warning: "text-amber-600",
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn("w-5 h-5", variantStyles[variant])} />}
      </div>
      <p className={cn("text-2xl font-heading font-bold tracking-tight", variantStyles[variant])}>
        {value}
      </p>
      {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
    </div>
  );
}