import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API, { buildQuery, formatApiError } from "../lib/api";
import { formatChartAxisDate, rechartsDateLabelFormatter } from "../lib/dates";
import AsyncPanel from "../components/AsyncPanel";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Bus, Users, Zap, AlertTriangle, TrendingUp, RefreshCw, MapPin, IndianRupee, UsersRound } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
      const { data: d } = await API.get("/dashboard", { params });
      setData(d);
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

  const kpis = data
    ? [
        { label: "Total Buses", value: data.total_buses, sub: `${data.active_buses} active`, icon: Bus, color: "#1A1A1A", clickable: false },
        { label: "Active Drivers", value: data.active_drivers, sub: `${data.total_drivers} total`, icon: Users, color: "#2563EB", clickable: false },
        { label: "KM Operated", value: data.total_km?.toLocaleString("en-IN"), sub: `${data.availability_pct}% availability`, icon: MapPin, color: "#16A34A", clickable: true, link: "/km-details" },
        { label: "Energy (kWh)", value: data.total_energy?.toLocaleString("en-IN"), sub: "This period", icon: Zap, color: "#F59E0B", clickable: false },
        { label: "Revenue", value: `Rs.${(data.total_ticket_revenue / 100000).toFixed(1)}L`, sub: "Ticket collection", icon: IndianRupee, color: "#C8102E", clickable: true, link: "/revenue-details" },
        { label: "Passengers", value: data.total_passengers?.toLocaleString("en-IN"), sub: "Ticket machine data", icon: UsersRound, color: "#8B5CF6", clickable: true, link: "/passenger-details" },
        { label: "Open Incidents", value: data.active_incidents, sub: "Needs attention", icon: AlertTriangle, color: "#DC2626", clickable: false },
      ]
    : [];

  return (
    <div data-testid="dashboard-page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button onClick={fetchDashboard} variant="outline" size="sm" data-testid="dashboard-refresh-btn" className="rounded-lg" disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-2" data-testid="dashboard-filters">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 rounded-lg" data-testid="filter-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 rounded-lg" data-testid="filter-date-to" />
        <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
          <SelectTrigger className="w-48 rounded-lg" data-testid="filter-depot">
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
          <SelectTrigger className="w-36 rounded-lg" data-testid="filter-bus">
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
        <Button onClick={fetchDashboard} className="bg-[#C8102E] hover:bg-[#A50E25] rounded-lg" data-testid="filter-apply-btn" disabled={loading}>
          <TrendingUp size={14} className="mr-1.5" /> Filter
        </Button>
      </div>
      <p className="text-xs text-gray-500 mb-6">Chart axis and tooltips use dates in DD/MM/YYYY (Indian format).</p>

      {error ? <div className="mb-6"><AsyncPanel error={error} onRetry={fetchDashboard} minHeight="min-h-[120px]" /></div> : null}

      {loading && !data ? <AsyncPanel loading minHeight="min-h-[280px]" /> : null}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
            {kpis.map((kpi) => (
              <Card
                key={kpi.label}
                className={`kpi-card border-gray-200 ${kpi.clickable ? "cursor-pointer hover:border-[#C8102E] hover:shadow-lg transition-all" : ""} ${loading ? "opacity-70" : ""}`}
                onClick={() => kpi.clickable && navigate(kpi.link)}
                data-testid={`kpi-${kpi.label.toLowerCase().replace(/[\s()\/]/g, "-").replace(/-+/g, "-").replace(/-$/, "")}`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">{kpi.label}</p>
                      <p className="text-2xl font-semibold text-[#1A1A1A]" style={{ fontFamily: "Inter" }}>
                        {loading ? "…" : kpi.value}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
                      {kpi.clickable && <p className="text-[10px] text-[#C8102E] mt-1.5 font-medium">Click for details &rarr;</p>}
                    </div>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: kpi.color + "12" }}>
                      <kpi.icon size={18} style={{ color: kpi.color }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">KM Operated (Daily)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.km_chart || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={formatChartAxisDate} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip labelFormatter={rechartsDateLabelFormatter} />
                      <Line type="monotone" dataKey="actual_km" stroke="#16A34A" strokeWidth={2} dot={false} name="Actual KM" />
                      <Line type="monotone" dataKey="scheduled_km" stroke="#9CA3AF" strokeWidth={2} dot={false} name="Scheduled KM" strokeDasharray="5 5" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Energy Consumption (Daily kWh)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.energy_chart || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={formatChartAxisDate} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip labelFormatter={rechartsDateLabelFormatter} />
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
