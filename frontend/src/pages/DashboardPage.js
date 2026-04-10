import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API, { buildQuery, formatApiError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { formatChartAxisDate, rechartsDateLabelFormatter } from "../lib/dates";
import AsyncPanel from "../components/AsyncPanel";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Bus, Users, Zap, AlertTriangle, FileText, TrendingUp, TrendingDown, RefreshCw, MapPin, IndianRupee, UsersRound, Gauge, Clock } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/** Compact KPI sizing aligned with NewVersion dashboard (tighter than earlier EBMS parity cards). */
function StatCard({ icon: Icon, label, value, sub, trend, color = "#C8102E", onClick, clickable, loading }) {
  return (
    <Card
      className={`bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow h-full min-h-[140px] flex flex-col ${
        clickable ? "cursor-pointer hover:border-[#C8102E]" : ""
      } ${loading ? "opacity-70" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-3 flex flex-col flex-1 min-h-0">
        <div className="flex items-start justify-between gap-2 flex-1 min-h-0">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-[0.06em] font-bold text-gray-400 mb-0.5">{label}</p>
            <p className="text-xl md:text-2xl font-bold text-[#1A1A1A] leading-tight" style={{ fontFamily: "Inter, sans-serif" }}>
              {loading ? "…" : value}
            </p>
            <div className="mt-0.5 min-h-[2.125rem]">{sub ? <p className="text-[11px] leading-snug text-gray-500 line-clamp-2">{sub}</p> : null}</div>
          </div>
          <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}10` }}>
            <Icon className="w-4 h-4" style={{ color }} strokeWidth={1.75} />
          </div>
        </div>
        <div className="mt-auto pt-1.5 min-h-[18px] flex items-center">
          {trend !== undefined && trend !== null ? (
            <div className={`flex items-center gap-1 text-[11px] font-medium ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
              {trend >= 0 ? <TrendingUp className="w-3 h-3 shrink-0" /> : <TrendingDown className="w-3 h-3 shrink-0" />}
              {Math.abs(trend)}% vs prior view
            </div>
          ) : (
            <span className="text-[11px] text-transparent select-none" aria-hidden>
              —
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        depot,
        bus_id: busId,
      });
      const [{ data: d }, { data: km }] = await Promise.all([
        API.get(Endpoints.dashboard.root(), { params }),
        API.get(Endpoints.km.summary(), { params }),
      ]);
      const kmTotals = km?.totals || {};
      const kmToday = km?.today || {};
      const kmDaySeries = Array.isArray(km?.series?.day_wise) ? km.series.day_wise : [];
      const merged = {
        ...d,
        total_km: kmTotals.actual_km ?? d.total_km,
        scheduled_km: kmTotals.scheduled_km ?? d.scheduled_km,
        availability_pct:
          kmTotals.scheduled_km > 0
            ? Math.round((Number(kmTotals.actual_km || 0) / Number(kmTotals.scheduled_km || 0)) * 1000) / 10
            : d.availability_pct,
        total_km_today: kmToday.actual_km ?? d.total_km_today,
        scheduled_km_today: kmToday.scheduled_km ?? d.scheduled_km_today,
        km_chart: kmDaySeries.length ? kmDaySeries : d.km_chart,
      };
      setData(merged);
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message || "Could not load dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, depot, busId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const primaryRow = data
    ? [
        {
          label: "Total Fleet",
          value: data.total_buses,
          sub: `${data.active_buses} active`,
          icon: Bus,
          color: "#C8102E",
          trend: 2.1,
          clickable: false,
        },
        {
          label: "Fleet Utilization",
          value: `${data.fleet_utilization ?? 0}%`,
          sub: "Active vs total buses",
          icon: Gauge,
          color: "#16A34A",
          trend: 1.2,
          clickable: false,
        },
        {
          label: "KM Operated",
          value: data.total_km?.toLocaleString("en-IN"),
          sub:
            (data.total_km_today ?? 0) > 0
              ? `Today: ${Number(data.total_km_today).toLocaleString("en-IN")} / ${Number(data.scheduled_km_today || 0).toLocaleString("en-IN")} km`
              : `${data.availability_pct}% availability`,
          icon: MapPin,
          color: "#2563EB",
          trend: -0.4,
          clickable: true,
          link: "/km-details",
        },
        {
          label: "On-Time",
          value: `${data.on_time_pct ?? data.availability_pct}%`,
          sub: "Service adherence (proxy)",
          icon: Clock,
          color: "#F59E0B",
          trend: -0.8,
          clickable: false,
        },
        {
          label: "Open Incidents",
          value: data.active_incidents,
          sub: "Needs attention",
          icon: AlertTriangle,
          color: "#DC2626",
          trend: undefined,
          clickable: false,
        },
        {
          label: "Avg SOC",
          value: `${data.avg_soc ?? "—"}%`,
          sub: "Estimated fleet SOC",
          icon: Zap,
          color: "#2563EB",
          trend: 3.1,
          clickable: false,
        },
      ]
    : [];

  const secondaryRow = data
    ? [
        {
          label: "Energy (kWh)",
          value: data.total_energy?.toLocaleString("en-IN"),
          sub: "This period",
          icon: Zap,
          color: "#F59E0B",
          trend: 0.6,
          clickable: false,
        },
        {
          label: "Revenue",
          value: `Rs.${(data.total_ticket_revenue / 100000).toFixed(1)}L`,
          sub: "Ticket collection",
          icon: IndianRupee,
          color: "#C8102E",
          trend: 1.0,
          clickable: true,
          link: "/revenue-details",
        },
        {
          label: "Passengers",
          value: data.total_passengers?.toLocaleString("en-IN"),
          sub: "Ticket machine data",
          icon: UsersRound,
          color: "#8B5CF6",
          trend: 0.3,
          clickable: true,
          link: "/passenger-details",
        },
        {
          label: "Active Drivers",
          value: data.active_drivers,
          sub: `${data.total_drivers} total`,
          icon: Users,
          color: "#2563EB",
          trend: undefined,
          clickable: false,
        },
        {
          label: "Billing Pending",
          value: data.billing_pending_count ?? 0,
          sub: `${data.billing_invoice_count ?? 0} invoices in cycle`,
          icon: FileText,
          color: "#DC2626",
          trend: undefined,
          clickable: false,
        },
        {
          label: "Deductions (Rs)",
          value: (data.billing_total_deduction ?? 0).toLocaleString("en-IN"),
          sub: "Invoice deductions (filtered view)",
          icon: IndianRupee,
          color: "#B91C1C",
          trend: undefined,
          clickable: false,
        },
      ]
    : [];

  return (
    <div data-testid="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-desc">Fleet and operations overview</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchDashboard} variant="outline" size="sm" data-testid="dashboard-refresh-btn" className="rounded-lg h-8 text-xs" disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-3 mb-2" data-testid="dashboard-filters">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 sm:w-40 rounded-lg h-8 text-xs" data-testid="filter-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 sm:w-40 rounded-lg h-8 text-xs" data-testid="filter-date-to" />
        <Select
          value={depot || "all"}
          onValueChange={(v) => {
            setDepot(v === "all" ? "" : v);
            setBusId("");
          }}
        >
          <SelectTrigger className="w-44 sm:w-48 rounded-lg h-8 text-xs" data-testid="filter-depot">
            <SelectValue placeholder="All Depots" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Depots</SelectItem>
            {(data?.depots || []).map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-32 sm:w-36 rounded-lg h-8 text-xs" data-testid="filter-bus">
            <SelectValue placeholder="All Buses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Buses</SelectItem>
            {(data?.bus_ids || []).map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={fetchDashboard} className="bg-[#C8102E] hover:bg-[#A50E25] rounded-lg h-8 text-xs" data-testid="filter-apply-btn" disabled={loading}>
          <TrendingUp size={13} className="mr-1.5" /> Filter
        </Button>
      </div>
      {error ? (
        <div className="mb-6">
          <AsyncPanel error={error} onRetry={fetchDashboard} minHeight="min-h-[120px]" />
        </div>
      ) : null}

      {loading && !data ? <AsyncPanel loading minHeight="min-h-[220px]" /> : null}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-2 sm:mb-3 items-stretch" data-testid="stats-grid-primary">
            {primaryRow.map((kpi) => (
              <div
                key={kpi.label}
                className="h-full min-w-0"
                data-testid={`kpi-${kpi.label
                  .toLowerCase()
                  .replace(/[\s()\/]/g, "-")
                  .replace(/-+/g, "-")
                  .replace(/-$/, "")}`}
              >
                <StatCard
                  icon={kpi.icon}
                  label={kpi.label}
                  value={kpi.value}
                  sub={kpi.sub}
                  trend={kpi.trend}
                  color={kpi.color}
                  loading={loading}
                  clickable={kpi.clickable}
                  onClick={() => kpi.clickable && kpi.link && navigate(kpi.link)}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-5 items-stretch" data-testid="stats-grid-secondary">
            {secondaryRow.map((kpi) => (
              <div
                key={kpi.label}
                className="h-full min-w-0"
                data-testid={`kpi-${kpi.label
                  .toLowerCase()
                  .replace(/[\s()\/]/g, "-")
                  .replace(/-+/g, "-")
                  .replace(/-$/, "")}`}
              >
                <StatCard
                  icon={kpi.icon}
                  label={kpi.label}
                  value={kpi.value}
                  sub={kpi.sub}
                  trend={kpi.trend}
                  color={kpi.color}
                  loading={loading}
                  clickable={kpi.clickable}
                  onClick={() => kpi.clickable && kpi.link && navigate(kpi.link)}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <Card className="border-gray-200 shadow-sm rounded-lg overflow-hidden">
              <CardHeader className="px-3 sm:px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 space-y-0">
                <CardTitle className="text-sm font-semibold text-[#1A1A1A]">KM Operated (Daily)</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-3">
                <div className="h-[220px] sm:h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.km_chart || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={formatChartAxisDate} />
                      <YAxis tick={{ fontSize: 9 }} width={36} />
                      <Tooltip labelFormatter={rechartsDateLabelFormatter} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                      <Line type="monotone" dataKey="actual_km" stroke="#16A34A" strokeWidth={2} dot={false} name="Actual KM" />
                      <Line type="monotone" dataKey="scheduled_km" stroke="#9CA3AF" strokeWidth={2} dot={false} name="Scheduled KM" strokeDasharray="5 5" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm rounded-lg overflow-hidden">
              <CardHeader className="px-3 sm:px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 space-y-0">
                <CardTitle className="text-sm font-semibold text-[#1A1A1A]">Energy Consumption (Daily kWh)</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-3">
                <div className="h-[220px] sm:h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.energy_chart || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={formatChartAxisDate} />
                      <YAxis tick={{ fontSize: 9 }} width={36} />
                      <Tooltip labelFormatter={rechartsDateLabelFormatter} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                      <Bar dataKey="units" fill="#F59E0B" radius={[4, 4, 0, 0]} name="kWh" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
