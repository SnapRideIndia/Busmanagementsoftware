import { useState, useEffect, useCallback } from "react";
import API, { buildQuery, unwrapListResponse, formatApiError, fetchAllPaginated } from "../lib/api";
import AsyncPanel from "../components/AsyncPanel";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { BarChart3, TrendingUp, Gauge, Zap, MapPin, AlertTriangle, Clock, Activity } from "lucide-react";

export default function KpiPage() {
  const [kpi, setKpi] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [allBuses, setAllBuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const inNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));

  useEffect(() => {
    (async () => {
      try {
        const items = await fetchAllPaginated("/buses", {});
        setAllBuses(items);
      } catch { setAllBuses([]); }
    })();
  }, []);

  const depotsList = [...new Set(allBuses.map((b) => b.depot).filter(Boolean))].sort();
  const busesForSelect = depot ? allBuses.filter((b) => b.depot === depot) : allBuses;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        depot,
        bus_id: busId,
      });
      const { data } = await API.get("/kpi", { params });
      setKpi(data);
    } catch (err) {
      setFetchError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load KPI");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, depot, busId]);

  useEffect(() => {
    load();
    // Intentionally mount-only; filters apply via Generate / Apply buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = kpi ? [
    { label: "Fleet Availability", value: `${kpi.fleet_availability}%`, icon: Activity, color: kpi.fleet_availability >= 90 ? "#16A34A" : "#F59E0B" },
    { label: "KM Efficiency", value: `${kpi.km_efficiency}%`, icon: TrendingUp, color: "#134219" },
    { label: "Energy per KM", value: `${kpi.energy_per_km} kWh`, icon: Zap, color: "#BA9149" },
    { label: "Total KM Operated", value: inNum(kpi.total_km_operated), icon: MapPin, color: "#2563EB" },
    { label: "Scheduled KM", value: inNum(kpi.total_scheduled_km), icon: Gauge, color: "#6B7280" },
    { label: "Energy Consumed", value: `${inNum(kpi.total_energy_consumed)} kWh`, icon: Zap, color: "#F59E0B" },
    { label: "Active Fleet", value: kpi.active_fleet, icon: BarChart3, color: "#134219" },
    { label: "Open Incidents", value: kpi.open_incidents, icon: AlertTriangle, color: "#DC2626" },
    { label: "Avg Speed", value: `${kpi.avg_speed} km/h`, icon: Clock, color: "#8B5CF6" },
    { label: "On-time %", value: `${kpi.on_time_pct}%`, icon: Clock, color: "#16A34A" },
  ] : [];

  return (
    <div data-testid="kpi-page">
      <div className="page-header">
        <h1 className="page-title">KPI Dashboard</h1>
        <Button onClick={load} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="generate-kpi-btn">
          <BarChart3 size={14} className="mr-1.5" /> Generate Report
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="kpi-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="kpi-date-to" />
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
            <SelectTrigger className="w-44" data-testid="kpi-depot"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {depotsList.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36" data-testid="kpi-bus"><SelectValue placeholder="All Buses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buses</SelectItem>
              {busesForSelect.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={load} variant="outline" data-testid="kpi-filter-btn">Apply</Button>
      </div>

      {fetchError && !loading ? (
        <div className="mb-6">
          <AsyncPanel error={fetchError} onRetry={load} />
        </div>
      ) : null}

      {loading && !kpi ? (
        <AsyncPanel loading minHeight="min-h-[240px]" />
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {metrics.map((m) => (
          <Card key={m.label} className="kpi-card border-gray-200" data-testid={`kpi-metric-${m.label.toLowerCase().replace(/[\s%]/g, "-")}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">{m.label}</p>
                  <p className="text-lg font-bold" style={{ fontFamily: 'Inter', color: m.color }}>
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
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">Operations</h4>
                <p className="text-gray-600">Total KM Operated: <span className="font-mono font-medium text-gray-900">{inNum(kpi.total_km_operated)} km</span></p>
                <p className="text-gray-600">Scheduled KM: <span className="font-mono font-medium text-gray-900">{inNum(kpi.total_scheduled_km)} km</span></p>
                <p className="text-gray-600">Missed KM: <span className="font-mono font-medium text-red-600">{inNum((kpi.total_scheduled_km || 0) - (kpi.total_km_operated || 0))} km</span></p>
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
