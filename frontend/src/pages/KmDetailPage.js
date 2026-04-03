import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { MapPin, ArrowLeft, TrendingUp, Bus, Gauge } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function KmDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [depot, setDepot] = useState(searchParams.get("depot") || "");
  const [busId, setBusId] = useState(searchParams.get("bus") || "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("to") || "");
  const [period, setPeriod] = useState("daily");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { period };
      if (depot) params.depot = depot;
      if (busId) params.bus_id = busId;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data: d } = await API.get("/km/details", { params });
      setData(d);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [depot, busId, dateFrom, dateTo, period]);

  useEffect(() => { load(); }, [load]);

  // Aggregate for charts
  const chartData = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      const key = period === "daily" ? r.date : r.period;
      if (!agg[key]) agg[key] = { period: key, actual_km: 0, scheduled_km: 0 };
      agg[key].actual_km += r.actual_km || 0;
      agg[key].scheduled_km += r.scheduled_km || 0;
    });
    return Object.values(agg).sort((a, b) => a.period.localeCompare(b.period));
  })() : [];

  // Top buses by KM
  const topBuses = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      if (!agg[r.bus_id]) agg[r.bus_id] = { bus_id: r.bus_id, depot: r.depot, actual_km: 0, scheduled_km: 0, days: 0 };
      agg[r.bus_id].actual_km += r.actual_km || 0;
      agg[r.bus_id].scheduled_km += r.scheduled_km || 0;
      agg[r.bus_id].days += (period === "daily" ? 1 : r.days || 1);
    });
    return Object.values(agg).sort((a, b) => b.actual_km - a.actual_km);
  })() : [];

  const totalScheduled = chartData.reduce((s, d) => s + (d.scheduled_km || 0), 0);
  const availPct = totalScheduled > 0 ? ((data?.total_km || 0) / totalScheduled * 100).toFixed(1) : 0;

  return (
    <div data-testid="km-detail-page">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} data-testid="km-back-btn">
            <ArrowLeft size={18} />
          </Button>
          <h1 className="page-title">KM Details</h1>
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">Source: GPS API</Badge>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Period</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-36" data-testid="km-period-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
              <Select value={depot} onValueChange={setDepot}>
                <SelectTrigger className="w-48" data-testid="km-depot-filter"><SelectValue placeholder="All Depots" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Depots</SelectItem>
                  {data?.depots?.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
              <Select value={busId} onValueChange={setBusId}>
                <SelectTrigger className="w-36" data-testid="km-bus-filter"><SelectValue placeholder="All Buses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buses</SelectItem>
                  {data?.bus_ids?.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="km-date-from" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="km-date-to" />
            </div>
            <Button onClick={load} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="km-apply-btn">Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Total KM</p>
            <p className="text-2xl font-semibold text-[#16A34A]" style={{ fontFamily: 'Inter' }}>{(data?.total_km || 0).toLocaleString()} km</p></div>
            <MapPin size={18} className="text-[#16A34A]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Scheduled KM</p>
            <p className="text-2xl font-semibold text-gray-600" style={{ fontFamily: 'Inter' }}>{totalScheduled.toLocaleString()} km</p></div>
            <Gauge size={18} className="text-gray-400" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Availability %</p>
            <p className={`text-2xl font-semibold ${Number(availPct) >= 90 ? "text-[#16A34A]" : "text-[#F59E0B]"}`} style={{ fontFamily: 'Inter' }}>{availPct}%</p></div>
            <TrendingUp size={18} className="text-[#16A34A]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Top Bus</p>
            <p className="text-2xl font-semibold text-[#2563EB]" style={{ fontFamily: 'Inter' }}>{topBuses[0]?.bus_id || "-"}</p>
            <p className="text-xs text-gray-400 mt-0.5">{(topBuses[0]?.actual_km || 0).toLocaleString()} km</p></div>
            <Bus size={18} className="text-[#2563EB]" />
          </div>
        </CardContent></Card>
      </div>

      {/* Chart */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">KM Trend ({period})</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              {period === "daily" ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="actual_km" stroke="#16A34A" strokeWidth={2} dot={false} name="Actual KM" />
                  <Line type="monotone" dataKey="scheduled_km" stroke="#9CA3AF" strokeWidth={2} dot={false} name="Scheduled KM" strokeDasharray="5 5" />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="actual_km" fill="#16A34A" radius={[4, 4, 0, 0]} name="Actual KM" />
                  <Bar dataKey="scheduled_km" fill="#E5E7EB" radius={[4, 4, 0, 0]} name="Scheduled KM" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Bus-wise KM Table */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Bus-wise KM Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Depot</TableHead>
              <TableHead className="text-right">Actual KM</TableHead>
              <TableHead className="text-right">Scheduled KM</TableHead>
              <TableHead className="text-right">Missed KM</TableHead>
              <TableHead className="text-right">Availability %</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {topBuses.map((b) => {
                const missed = Math.max(0, b.scheduled_km - b.actual_km);
                const avail = b.scheduled_km > 0 ? (b.actual_km / b.scheduled_km * 100).toFixed(1) : 0;
                return (
                  <TableRow key={b.bus_id} className="hover:bg-gray-50" data-testid={`km-bus-${b.bus_id}`}>
                    <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                    <TableCell>{b.depot}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-[#16A34A]">{b.actual_km?.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{b.scheduled_km?.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-[#DC2626]">{missed.toLocaleString()}</TableCell>
                    <TableCell className="text-right"><Badge className={Number(avail) >= 90 ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"}>{avail}%</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Detailed {period === "daily" ? "Day-wise" : period === "monthly" ? "Month-wise" : "Quarter-wise"} Data</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow className="table-header sticky top-0">
                <TableHead>Bus ID</TableHead><TableHead>Depot</TableHead>
                <TableHead>{period === "daily" ? "Date" : "Period"}</TableHead>
                {period === "daily" && <TableHead>Driver</TableHead>}
                <TableHead className="text-right">Actual KM</TableHead>
                <TableHead className="text-right">Scheduled KM</TableHead>
                {period !== "daily" && <TableHead className="text-right">Days</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {(data?.data || []).slice(0, 200).map((r, i) => (
                  <TableRow key={i} className="hover:bg-[#FAFAFA]">
                    <TableCell className="font-mono text-sm">{r.bus_id}</TableCell>
                    <TableCell className="text-sm">{r.depot}</TableCell>
                    <TableCell className="text-sm">{r.date || r.period}</TableCell>
                    {period === "daily" && <TableCell className="text-sm text-gray-500">{r.driver_id || "-"}</TableCell>}
                    <TableCell className="text-right font-mono font-medium">{r.actual_km?.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{r.scheduled_km?.toLocaleString()}</TableCell>
                    {period !== "daily" && <TableCell className="text-right font-mono">{r.days}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
