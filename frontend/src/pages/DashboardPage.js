import { useState, useEffect, useCallback } from "react";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Bus, Users, Zap, AlertTriangle, TrendingUp, RefreshCw, MapPin, IndianRupee } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [depot, setDepot] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (depot) params.depot = depot;
      const { data: d } = await API.get("/dashboard", { params });
      setData(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, depot]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const kpis = data ? [
    { label: "Total Buses", value: data.total_buses, sub: `${data.active_buses} active`, icon: Bus, color: "#134219" },
    { label: "Active Drivers", value: data.active_drivers, sub: `${data.total_drivers} total`, icon: Users, color: "#2563EB" },
    { label: "KM Operated", value: data.total_km?.toLocaleString(), sub: `${data.availability_pct}% availability`, icon: MapPin, color: "#16A34A" },
    { label: "Energy (kWh)", value: data.total_energy?.toLocaleString(), sub: "This period", icon: Zap, color: "#F59E0B" },
    { label: "Revenue", value: `Rs.${(data.total_revenue / 100000).toFixed(1)}L`, sub: "Total billed", icon: IndianRupee, color: "#BA9149" },
    { label: "Open Incidents", value: data.active_incidents, sub: "Needs attention", icon: AlertTriangle, color: "#DC2626" },
  ] : [];

  return (
    <div data-testid="dashboard-page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button onClick={fetchDashboard} variant="outline" size="sm" data-testid="dashboard-refresh-btn">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6" data-testid="dashboard-filters">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="filter-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="filter-date-to" />
        <Select value={depot} onValueChange={setDepot}>
          <SelectTrigger className="w-48" data-testid="filter-depot">
            <SelectValue placeholder="All Depots" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Depots</SelectItem>
            {data?.depots?.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={fetchDashboard} className="bg-[#134219] hover:bg-[#0E3213]" data-testid="filter-apply-btn">
          <TrendingUp size={14} className="mr-1.5" /> Filter
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="kpi-card border-gray-200" data-testid={`kpi-${kpi.label.toLowerCase().replace(/[\s()\/]/g, "-").replace(/-+/g, "-").replace(/-$/, "")}`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">{kpi.label}</p>
                  <p className="text-2xl font-semibold text-gray-900" style={{ fontFamily: 'JetBrains Mono' }}>
                    {loading ? "..." : kpi.value}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
                </div>
                <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ backgroundColor: kpi.color + "12" }}>
                  <kpi.icon size={18} style={{ color: kpi.color }} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
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
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="actual_km" stroke="#134219" strokeWidth={2} dot={false} name="Actual KM" />
                  <Line type="monotone" dataKey="scheduled_km" stroke="#BA9149" strokeWidth={2} dot={false} name="Scheduled KM" strokeDasharray="5 5" />
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
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="units" fill="#134219" radius={[3, 3, 0, 0]} name="kWh" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
