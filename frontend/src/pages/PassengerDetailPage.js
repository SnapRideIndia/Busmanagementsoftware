import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import API, { buildQuery, formatApiError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import { formatChartAxisDate, formatDateIN, rechartsDateLabelFormatter } from "../lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Users, ArrowLeft, TrendingUp, Bus, MapPin } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function PassengerDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [depot, setDepot] = useState(searchParams.get("depot") || "");
  const [busId, setBusId] = useState(searchParams.get("bus") || "");
  const [route, setRoute] = useState("");
  const [dateFrom, setDateFrom] = useState(searchParams.get("from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("to") || "");
  const [period, setPeriod] = useState("daily");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [fetchError, setFetchError] = useState(null);

  const inNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildQuery({
        period,
        depot,
        bus_id: busId,
        route,
        date_from: dateFrom,
        date_to: dateTo,
        page,
        limit: 20,
      });
      const { data: d } = await API.get(Endpoints.passengers.details(), { params });
      setData(d);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [depot, busId, route, dateFrom, dateTo, period, page]);

  useEffect(() => { setPage(1); }, [depot, busId, route, dateFrom, dateTo, period]);

  useEffect(() => { load(); }, [load]);

  // Chart aggregation
  const chartData = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      const key = period === "daily" ? r.date : r.period;
      if (!agg[key]) agg[key] = { period: key, passengers: 0, revenue: 0 };
      agg[key].passengers += r.passengers || 0;
      agg[key].revenue += r.revenue_amount || 0;
    });
    return Object.values(agg).sort((a, b) => a.period.localeCompare(b.period));
  })() : [];

  // Top buses
  const topBuses = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      if (!agg[r.bus_id]) agg[r.bus_id] = { bus_id: r.bus_id, depot: r.depot, passengers: 0, revenue: 0 };
      agg[r.bus_id].passengers += r.passengers || 0;
      agg[r.bus_id].revenue += r.revenue_amount || 0;
    });
    return Object.values(agg).sort((a, b) => b.passengers - a.passengers);
  })() : [];

  // Route-wise
  const routeData = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      const rt = r.route || "Unknown";
      if (!agg[rt]) agg[rt] = { route: rt, passengers: 0, revenue: 0 };
      agg[rt].passengers += r.passengers || 0;
      agg[rt].revenue += r.revenue_amount || 0;
    });
    return Object.values(agg).sort((a, b) => b.passengers - a.passengers);
  })() : [];

  const avgDaily = chartData.length > 0 ? (data?.total_passengers || 0) / chartData.length : 0;

  return (
    <div data-testid="passenger-detail-page">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} data-testid="pax-back-btn"><ArrowLeft size={18} /></Button>
          <h1 className="page-title">Passengers Traveled</h1>
          <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-xs">Source: Ticket Issuing Machine API</Badge>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1"><label className="text-xs font-medium uppercase text-gray-500">Period</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-36" data-testid="pax-period-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><label className="text-xs font-medium uppercase text-gray-500">Depot</label>
              <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
                <SelectTrigger className="w-48" data-testid="pax-depot-filter"><SelectValue placeholder="All Depots" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Depots</SelectItem>{data?.depots?.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><label className="text-xs font-medium uppercase text-gray-500">Bus</label>
              <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36" data-testid="pax-bus-filter"><SelectValue placeholder="All Buses" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Buses</SelectItem>{data?.bus_ids?.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><label className="text-xs font-medium uppercase text-gray-500">Route</label>
              <Select value={route || "all"} onValueChange={(v) => setRoute(v === "all" ? "" : v)}>
                <SelectTrigger className="w-56" data-testid="pax-route-filter"><SelectValue placeholder="All Routes" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Routes</SelectItem>{data?.routes?.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><label className="text-xs font-medium uppercase text-gray-500">From</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="pax-date-from" /></div>
            <div className="space-y-1"><label className="text-xs font-medium uppercase text-gray-500">To</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="pax-date-to" /></div>
            <Button onClick={load} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="pax-apply-btn">Apply</Button>
          </div>
        </CardContent>
      </Card>

      {fetchError && !loading ? (
        <div className="mb-6">
          <AsyncPanel error={fetchError} onRetry={load} />
        </div>
      ) : null}
      {loading && !data ? (
        <div className="mb-6">
          <AsyncPanel loading minHeight="min-h-[200px]" />
        </div>
      ) : null}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Total Passengers</p>
            <p className="text-lg font-bold text-[#8B5CF6]" style={{ fontFamily: 'Inter' }}>{inNum(data?.total_passengers ?? 0)}</p></div>
            <Users size={18} className="text-[#8B5CF6]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Avg {period === "daily" ? "Daily" : period === "monthly" ? "Monthly" : "Quarterly"}</p>
            <p className="text-lg font-bold text-[#2563EB]" style={{ fontFamily: 'Inter' }}>{inNum(Math.round(avgDaily))}</p></div>
            <TrendingUp size={18} className="text-[#2563EB]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Top Bus</p>
            <p className="text-lg font-bold text-[#16A34A]" style={{ fontFamily: 'Inter' }}>{topBuses[0]?.bus_id || "-"}</p>
            <p className="text-xs text-gray-400 mt-0.5">{inNum(topBuses[0]?.passengers ?? 0)} pax</p></div>
            <Bus size={18} className="text-[#16A34A]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Top Route</p>
            <p className="text-base font-bold text-[#F59E0B]" style={{ fontFamily: 'Inter' }}>{routeData[0]?.route?.split("-")[0] || "-"}</p>
            <p className="text-xs text-gray-400 mt-0.5">{inNum(routeData[0]?.passengers ?? 0)} pax</p></div>
            <MapPin size={18} className="text-[#F59E0B]" />
          </div>
        </CardContent></Card>
      </div>

      {/* Chart */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardHeader className="pb-2"><CardTitle className="font-medium">Passenger Trend ({period})</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              {period === "daily" ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={(v) => (period === "daily" ? formatChartAxisDate(v) : v)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inNum(v)} labelFormatter={(l) => (period === "daily" ? rechartsDateLabelFormatter(l) : l)} />
                  <Line type="monotone" dataKey="passengers" stroke="#8B5CF6" strokeWidth={2} dot={false} name="Passengers" />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inNum(v)} />
                  <Bar dataKey="passengers" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Passengers" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Route-wise Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="font-medium">Route-wise Passengers</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header"><TableHead>Route</TableHead><TableHead className="text-right">Passengers</TableHead><TableHead className="text-right">Revenue (Rs)</TableHead></TableRow></TableHeader>
              <TableBody>
                {routeData.map((r) => (
                  <TableRow key={r.route} className="hover:bg-gray-50">
                    <TableCell className="text-sm">{r.route}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-[#8B5CF6]">{inNum(r.passengers)}</TableCell>
                    <TableCell className="text-right font-mono">Rs.{inNum(r.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="font-medium">Bus-wise Passengers</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header"><TableHead>Bus</TableHead><TableHead>Depot</TableHead><TableHead className="text-right">Passengers</TableHead></TableRow></TableHeader>
              <TableBody>
                {topBuses.map((b) => (
                  <TableRow key={b.bus_id} className="hover:bg-gray-50" data-testid={`pax-bus-${b.bus_id}`}>
                    <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                    <TableCell className="text-sm">{b.depot}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-[#8B5CF6]">{inNum(b.passengers)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail Table */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="font-medium">Detailed {period === "daily" ? "Day-wise" : period === "monthly" ? "Month-wise" : "Quarter-wise"} Data</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow className="table-header sticky top-0">
                <TableHead>Bus</TableHead><TableHead>Depot</TableHead><TableHead>{period === "daily" ? "Date" : "Period"}</TableHead>
                {period === "daily" && <TableHead>Route</TableHead>}
                <TableHead className="text-right">Passengers</TableHead><TableHead className="text-right">Revenue (Rs)</TableHead>
                {period !== "daily" && <TableHead className="text-right">Days</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {(data?.data || []).map((r, i) => (
                  <TableRow key={i} className="hover:bg-[#FAFAFA]">
                    <TableCell className="font-mono text-sm">{r.bus_id}</TableCell>
                    <TableCell className="text-sm">{r.depot}</TableCell>
                    <TableCell className="text-sm">{formatDateIN(r.date || r.period)}</TableCell>
                    {period === "daily" && <TableCell className="text-sm text-gray-500">{r.route}</TableCell>}
                    <TableCell className="text-right font-mono font-medium">{inNum(r.passengers)}</TableCell>
                    <TableCell className="text-right font-mono">Rs.{inNum(r.revenue_amount)}</TableCell>
                    {period !== "daily" && <TableCell className="text-right font-mono">{r.days}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePaginationBar
            page={data?.page ?? page}
            pages={data?.pages ?? 1}
            total={data?.row_total ?? 0}
            limit={data?.limit ?? 20}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
