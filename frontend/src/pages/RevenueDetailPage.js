import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { IndianRupee, ArrowLeft, TrendingUp, Users, Bus } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useNavigate } from "react-router-dom";

export default function RevenueDetailPage() {
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
      const { data: d } = await API.get("/revenue/details", { params });
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
      if (!agg[key]) agg[key] = { period: key, revenue: 0, passengers: 0 };
      agg[key].revenue += r.revenue_amount || 0;
      agg[key].passengers += r.passengers || 0;
    });
    return Object.values(agg).sort((a, b) => a.period.localeCompare(b.period));
  })() : [];

  // Top buses
  const topBuses = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      if (!agg[r.bus_id]) agg[r.bus_id] = { bus_id: r.bus_id, depot: r.depot, revenue: 0, passengers: 0 };
      agg[r.bus_id].revenue += r.revenue_amount || 0;
      agg[r.bus_id].passengers += r.passengers || 0;
    });
    return Object.values(agg).sort((a, b) => b.revenue - a.revenue);
  })() : [];

  const avgDaily = chartData.length > 0 ? (data?.total_revenue || 0) / chartData.length : 0;

  return (
    <div data-testid="revenue-detail-page">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} data-testid="revenue-back-btn">
            <ArrowLeft size={18} />
          </Button>
          <h1 className="page-title">Revenue Details</h1>
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs">Source: Ticket Issuing Machine API</Badge>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Period</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-36" data-testid="revenue-period-select"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="w-48" data-testid="revenue-depot-filter"><SelectValue placeholder="All Depots" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Depots</SelectItem>
                  {data?.depots?.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
              <Select value={busId} onValueChange={setBusId}>
                <SelectTrigger className="w-36" data-testid="revenue-bus-filter"><SelectValue placeholder="All Buses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buses</SelectItem>
                  {data?.bus_ids?.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="revenue-date-from" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="revenue-date-to" />
            </div>
            <Button onClick={load} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="revenue-apply-btn">Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Total Revenue</p>
            <p className="text-2xl font-semibold text-[#C8102E]" style={{ fontFamily: 'Inter' }}>Rs.{(data?.total_revenue || 0).toLocaleString()}</p></div>
            <IndianRupee size={18} className="text-[#C8102E]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Avg {period === "daily" ? "Daily" : period === "monthly" ? "Monthly" : "Quarterly"}</p>
            <p className="text-2xl font-semibold text-[#2563EB]" style={{ fontFamily: 'Inter' }}>Rs.{Math.round(avgDaily).toLocaleString()}</p></div>
            <TrendingUp size={18} className="text-[#2563EB]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Total Records</p>
            <p className="text-2xl font-semibold text-gray-900" style={{ fontFamily: 'Inter' }}>{data?.data?.length || 0}</p></div>
            <Bus size={18} className="text-gray-400" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Top Bus</p>
            <p className="text-2xl font-semibold text-[#16A34A]" style={{ fontFamily: 'Inter' }}>{topBuses[0]?.bus_id || "-"}</p>
            <p className="text-xs text-gray-400 mt-0.5">Rs.{(topBuses[0]?.revenue || 0).toLocaleString()}</p></div>
            <Users size={18} className="text-[#16A34A]" />
          </div>
        </CardContent></Card>
      </div>

      {/* Chart */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Revenue Trend ({period})</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              {period === "daily" ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => `Rs.${v.toLocaleString()}`} />
                  <Line type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={2} dot={false} name="Revenue" />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => `Rs.${v.toLocaleString()}`} />
                  <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} name="Revenue" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Bus-wise Revenue Table */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Bus-wise Revenue Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Depot</TableHead>
              <TableHead className="text-right">Total Revenue (Rs)</TableHead>
              <TableHead className="text-right">Total Passengers</TableHead>
              <TableHead className="text-right">Avg Revenue/Day</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {topBuses.map((b) => (
                <TableRow key={b.bus_id} className="hover:bg-gray-50" data-testid={`rev-bus-${b.bus_id}`}>
                  <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                  <TableCell>{b.depot}</TableCell>
                  <TableCell className="text-right font-mono font-medium text-[#2563EB]">Rs.{b.revenue?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{b.passengers?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">Rs.{chartData.length > 0 ? Math.round(b.revenue / chartData.length).toLocaleString() : 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detailed Data Table */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Detailed {period === "daily" ? "Day-wise" : period === "monthly" ? "Month-wise" : "Quarter-wise"} Data</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow className="table-header sticky top-0">
                <TableHead>Bus ID</TableHead><TableHead>Depot</TableHead>
                <TableHead>{period === "daily" ? "Date" : "Period"}</TableHead>
                {period === "daily" && <TableHead>Route</TableHead>}
                <TableHead className="text-right">Revenue (Rs)</TableHead>
                <TableHead className="text-right">Passengers</TableHead>
                {period !== "daily" && <TableHead className="text-right">Days</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {(data?.data || []).slice(0, 200).map((r, i) => (
                  <TableRow key={i} className="hover:bg-[#FAFAFA]">
                    <TableCell className="font-mono text-sm">{r.bus_id}</TableCell>
                    <TableCell className="text-sm">{r.depot}</TableCell>
                    <TableCell className="text-sm">{r.date || r.period}</TableCell>
                    {period === "daily" && <TableCell className="text-sm text-gray-500">{r.route}</TableCell>}
                    <TableCell className="text-right font-mono font-medium">Rs.{r.revenue_amount?.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{r.passengers?.toLocaleString()}</TableCell>
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
