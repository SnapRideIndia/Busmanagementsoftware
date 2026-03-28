import { useState, useEffect } from "react";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { BarChart3, TrendingUp, Gauge, Zap, MapPin, AlertTriangle, Clock, Activity } from "lucide-react";

export default function KpiPage() {
  const [kpi, setKpi] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await API.get("/kpi", { params });
      setKpi(data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const metrics = kpi ? [
    { label: "Fleet Availability", value: `${kpi.fleet_availability}%`, icon: Activity, color: kpi.fleet_availability >= 90 ? "#16A34A" : "#F59E0B" },
    { label: "KM Efficiency", value: `${kpi.km_efficiency}%`, icon: TrendingUp, color: "#134219" },
    { label: "Energy per KM", value: `${kpi.energy_per_km} kWh`, icon: Zap, color: "#BA9149" },
    { label: "Total KM Operated", value: kpi.total_km_operated?.toLocaleString(), icon: MapPin, color: "#2563EB" },
    { label: "Scheduled KM", value: kpi.total_scheduled_km?.toLocaleString(), icon: Gauge, color: "#6B7280" },
    { label: "Energy Consumed", value: `${kpi.total_energy_consumed?.toLocaleString()} kWh`, icon: Zap, color: "#F59E0B" },
    { label: "Active Fleet", value: kpi.active_fleet, icon: BarChart3, color: "#134219" },
    { label: "Open Incidents", value: kpi.open_incidents, icon: AlertTriangle, color: "#DC2626" },
    { label: "Avg Speed", value: `${kpi.avg_speed} km/h`, icon: Clock, color: "#8B5CF6" },
    { label: "On-time %", value: `${kpi.on_time_pct}%`, icon: Clock, color: "#16A34A" },
  ] : [];

  return (
    <div data-testid="kpi-page">
      <div className="page-header">
        <h1 className="page-title">KPI Dashboard</h1>
        <Button onClick={load} className="bg-[#134219] hover:bg-[#0E3213]" data-testid="generate-kpi-btn">
          <BarChart3 size={14} className="mr-1.5" /> Generate Report
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="kpi-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="kpi-date-to" />
        <Button onClick={load} variant="outline" data-testid="kpi-filter-btn">Apply</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {metrics.map((m) => (
          <Card key={m.label} className="kpi-card border-gray-200" data-testid={`kpi-metric-${m.label.toLowerCase().replace(/[\s%]/g, "-")}`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">{m.label}</p>
                  <p className="text-2xl font-semibold" style={{ fontFamily: 'JetBrains Mono', color: m.color }}>
                    {loading ? "..." : m.value}
                  </p>
                </div>
                <m.icon size={18} style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {kpi && (
        <Card className="mt-6 border-gray-200 shadow-sm">
          <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">Operations</h4>
                <p className="text-gray-600">Total KM Operated: <span className="font-mono font-medium text-gray-900">{kpi.total_km_operated?.toLocaleString()} km</span></p>
                <p className="text-gray-600">Scheduled KM: <span className="font-mono font-medium text-gray-900">{kpi.total_scheduled_km?.toLocaleString()} km</span></p>
                <p className="text-gray-600">Missed KM: <span className="font-mono font-medium text-red-600">{(kpi.total_scheduled_km - kpi.total_km_operated)?.toLocaleString()} km</span></p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">Fleet & Incidents</h4>
                <p className="text-gray-600">Active Fleet: <span className="font-mono font-medium text-gray-900">{kpi.active_fleet} buses</span></p>
                <p className="text-gray-600">Total Incidents: <span className="font-mono font-medium text-gray-900">{kpi.total_incidents}</span></p>
                <p className="text-gray-600">Open Incidents: <span className="font-mono font-medium text-red-600">{kpi.open_incidents}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
