import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Percent,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import StatCard from "@/components/StatCard";
import PageHeader from "@/components/PageHeader";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#10b981", "#f43f5e", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

const formatCurrency = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0);

export default function Dashboard() {
  const [incomes, setIncomes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payrolls, setPayrolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [inc, exp, pay] = await Promise.all([
        base44.entities.Income.list("-date", 1000),
        base44.entities.Expense.list("-date", 1000),
        base44.entities.Payroll.list("-date", 1000),
      ]);
      setIncomes(inc);
      setExpenses(exp);
      setPayrolls(pay);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const filteredIncomes = useMemo(
    () => incomes.filter((i) => new Date(i.date).getMonth() === currentMonth && new Date(i.date).getFullYear() === currentYear),
    [incomes, currentMonth, currentYear]
  );
  const filteredExpenses = useMemo(
    () => expenses.filter((e) => new Date(e.date).getMonth() === currentMonth && new Date(e.date).getFullYear() === currentYear),
    [expenses, currentMonth, currentYear]
  );
  const filteredPayrolls = useMemo(
    () => payrolls.filter((p) => new Date(p.date).getMonth() === currentMonth && new Date(p.date).getFullYear() === currentYear),
    [payrolls, currentMonth, currentYear]
  );

  const totalIncome = filteredIncomes.reduce((s, i) => s + (i.amount || 0), 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalPayroll = filteredPayrolls.reduce((s, p) => s + (p.total || p.base_salary || 0), 0);
  const profit = totalIncome - totalExpenses - totalPayroll;
  const costPercent = totalIncome > 0 ? ((totalExpenses + totalPayroll) / totalIncome) * 100 : 0;

  // Payment method breakdown (stock flow style)
  const paymentBreakdown = useMemo(() => {
    const map = {};
    filteredIncomes.forEach((i) => {
      const m = i.payment_method || "Sin especificar";
      map[m] = (map[m] || 0) + (i.amount || 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredIncomes]);

  // Invoice status breakdown
  const invoiceBreakdown = useMemo(() => {
    const statuses = { pendiente: 0, recibida: 0, no_requerida: 0 };
    filteredExpenses.forEach((e) => {
      const s = e.invoice_status || "pendiente";
      statuses[s] = (statuses[s] || 0) + (e.amount || 0);
    });
    return statuses;
  }, [filteredExpenses]);

  // Monthly chart data for selected year
  const monthlyData = useMemo(() => {
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return months.map((month, idx) => {
      const inc = incomes
        .filter((i) => new Date(i.date).getMonth() === idx && new Date(i.date).getFullYear() === selectedYear)
        .reduce((s, i) => s + (i.amount || 0), 0);
      const exp = expenses
        .filter((e) => new Date(e.date).getMonth() === idx && new Date(e.date).getFullYear() === selectedYear)
        .reduce((s, e) => s + (e.amount || 0), 0);
      const pay = payrolls
        .filter((p) => new Date(p.date).getMonth() === idx && new Date(p.date).getFullYear() === selectedYear)
        .reduce((s, p) => s + (p.total || p.base_salary || 0), 0);
      return { month, Ingresos: inc, Egresos: exp, Nómina: pay };
    });
  }, [incomes, expenses, payrolls, selectedYear]);

  const availableYears = useMemo(() => {
    const years = new Set([currentYear]);
    [...incomes, ...expenses, ...payrolls].forEach((r) => {
      if (r.date) years.add(new Date(r.date).getFullYear());
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [incomes, expenses, payrolls, currentYear]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  const monthName = new Date(currentYear, currentMonth).toLocaleDateString("es-MX", { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Resumen Financiero"
        description={`Visión general de ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Ingresos del mes" value={formatCurrency(totalIncome)} icon={TrendingUp} variant="positive" />
        <StatCard label="Egresos del mes" value={formatCurrency(totalExpenses)} icon={TrendingDown} variant="negative" />
        <StatCard label="Nómina del mes" value={formatCurrency(totalPayroll)} icon={Wallet} variant="warning" />
        <StatCard
          label="Utilidad neta"
          value={formatCurrency(profit)}
          sublabel={`${costPercent.toFixed(1)}% costo operativo`}
          icon={Percent}
          variant={profit >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Stock Flow - Payment Method Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
          <h3 className="font-heading font-semibold mb-4">Flujo por Método de Pago</h3>
          {paymentBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin ingresos registrados este mes</p>
          ) : (
            <div className="space-y-3">
              {paymentBreakdown.map((item, idx) => {
                const pct = totalIncome > 0 ? (item.value / totalIncome) * 100 : 0;
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-sm font-semibold">{formatCurrency(item.value)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Invoice Status */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
          <h3 className="font-heading font-semibold mb-4">Estado de Facturas (Egresos)</h3>
          <div className="space-y-3">
            <InvoiceStatusRow icon={Clock} label="Pendientes" amount={invoiceBreakdown.pendiente} total={totalExpenses} color="text-amber-600" bg="bg-amber-100" />
            <InvoiceStatusRow icon={CheckCircle2} label="Recibidas" amount={invoiceBreakdown.recibida} total={totalExpenses} color="text-emerald-600" bg="bg-emerald-100" />
            <InvoiceStatusRow icon={XCircle} label="No requeridas" amount={invoiceBreakdown.no_requerida} total={totalExpenses} color="text-slate-500" bg="bg-slate-100" />
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span>Total facturado (recibidas): {formatCurrency(invoiceBreakdown.recibida)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Chart */}
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold">Comparativo Mensual {selectedYear}</h3>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))" }} />
            <Legend />
            <Bar dataKey="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Egresos" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Nómina" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InvoiceStatusRow({ icon: Icon, label, amount, total, color, bg }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold">{formatCurrency(amount)}</p>
        <p className="text-xs text-muted-foreground">{pct.toFixed(1)}%</p>
      </div>
    </div>
  );
}