import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import AsyncPanel from "../components/AsyncPanel";
import { formatDateIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Plus, Zap, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

export default function EnergyPage() {
  const [data, setData] = useState([]);
  const [report, setReport] = useState(null);
  const [buses, setBuses] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [depotFilter, setDepotFilter] = useState("");
  const [busFilter, setBusFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ bus_id: "", date: "", units_charged: "", tariff_rate: "8.5" });
  const [tab, setTab] = useState("data");
  const [dataPage, setDataPage] = useState(1);
  const [dataMeta, setDataMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [reportPage, setReportPage] = useState(1);
  const [reportMeta, setReportMeta] = useState({ row_total: 0, pages: 1, limit: 20 });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);

  const load = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        bus_id: busFilter,
        depot: depotFilter,
        page: dataPage,
        limit: 20,
      });
      const [e, busItems] = await Promise.all([API.get("/energy", { params }), fetchAllPaginated("/buses", {})]);
      const eu = unwrapListResponse(e.data);
      setData(eu.items);
      setDataMeta({ total: eu.total, pages: eu.pages, limit: eu.limit });
      setBuses(busItems);
    } catch (err) {
      setListError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load energy data");
      setData([]);
    } finally {
      setListLoading(false);
    }
  }, [dateFrom, dateTo, busFilter, depotFilter, dataPage]);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const params = buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        depot: depotFilter,
        bus_id: busFilter,
        page: reportPage,
        limit: 20,
      });
      const { data: r } = await API.get("/energy/report", { params });
      setReport(r);
      setReportMeta({
        row_total: r.row_total ?? (r.report || []).length,
        pages: r.pages ?? 1,
        limit: r.limit ?? 20,
      });
    } catch (err) {
      setReportError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load report");
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [reportPage, dateFrom, dateTo, depotFilter, busFilter]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (tab === "report") loadReport();
  }, [tab, loadReport]);

  const handleAdd = async () => {
    try {
      await API.post("/energy", { ...form, units_charged: Number(form.units_charged), tariff_rate: Number(form.tariff_rate) });
      toast.success("Charging data added"); setAddOpen(false); setForm({ bus_id: "", date: "", units_charged: "", tariff_rate: "8.5" }); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div data-testid="energy-page">
      <div className="page-header">
        <h1 className="page-title">Energy Management</h1>
        <Button onClick={() => setAddOpen(true)} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-energy-btn">
          <Plus size={16} className="mr-1.5" /> Add Charging Data
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="energy-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="energy-date-to" />
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={depotFilter || "all"} onValueChange={(v) => { setDepotFilter(v === "all" ? "" : v); setBusFilter(""); setDataPage(1); setReportPage(1); }}>
            <SelectTrigger className="w-44" data-testid="energy-depot-filter"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {[...new Set(buses.map((b) => b.depot).filter(Boolean))].sort().map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={busFilter || "all"} onValueChange={(v) => { setBusFilter(v === "all" ? "" : v); setDataPage(1); setReportPage(1); }}>
            <SelectTrigger className="w-36" data-testid="energy-bus-filter"><SelectValue placeholder="All Buses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buses</SelectItem>
              {(depotFilter ? buses.filter((b) => b.depot === depotFilter) : buses).map((b) => (
                <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => load()} variant="outline" data-testid="energy-filter-btn">
          Refresh
        </Button>
        <Button onClick={() => { setReportPage(1); setTab("report"); }} className="bg-[#C8102E] hover:bg-[#A50E25] text-white" data-testid="view-energy-report-btn">
          <TrendingUp size={14} className="mr-1.5" /> View Report
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <Button variant={tab === "data" ? "default" : "outline"} onClick={() => setTab("data")} className={tab === "data" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""} data-testid="energy-tab-data">Charging Data</Button>
        <Button variant={tab === "report" ? "default" : "outline"} onClick={() => { setTab("report"); }} className={tab === "report" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""} data-testid="energy-tab-report">Report</Button>
      </div>

      {tab === "data" && (
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header">
                <TableHead>Bus ID</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Units (kWh)</TableHead><TableHead className="text-right">Tariff (Rs/kWh)</TableHead><TableHead className="text-right">Cost (Rs)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableLoadRows
                  colSpan={5}
                  loading={listLoading}
                  error={listError}
                  onRetry={load}
                  isEmpty={data.length === 0}
                  emptyMessage="No charging data"
                >
                  {data.map((e, i) => (
                    <TableRow key={i} className="hover:bg-gray-50">
                      <TableCell className="font-mono">{e.bus_id}</TableCell>
                      <TableCell>{formatDateIN(e.date)}</TableCell>
                      <TableCell className="text-right font-mono">{e.units_charged?.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{e.tariff_rate}</TableCell>
                      <TableCell className="text-right font-mono">{(e.units_charged * e.tariff_rate).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableLoadRows>
              </TableBody>
            </Table>
            <TablePaginationBar page={dataPage} pages={dataMeta.pages} total={dataMeta.total} limit={dataMeta.limit} onPageChange={setDataPage} />
          </CardContent>
        </Card>
      )}

      {tab === "report" && (
        <div className="space-y-6">
          {reportError ? <AsyncPanel error={reportError} onRetry={loadReport} /> : null}
          {reportLoading && !reportError && !report ? <AsyncPanel loading minHeight="min-h-[240px]" /> : null}
          {report && !reportError ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Allowed Energy</p>
              <p className="text-2xl font-mono font-semibold">{report.summary.total_allowed_kwh?.toLocaleString()} kWh</p>
            </CardContent></Card>
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Actual Energy</p>
              <p className="text-2xl font-mono font-semibold">{report.summary.total_actual_kwh?.toLocaleString()} kWh</p>
            </CardContent></Card>
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Efficiency</p>
              <p className={`text-2xl font-mono font-semibold ${report.summary.total_efficiency <= 100 ? "text-green-600" : "text-red-600"}`}>{report.summary.total_efficiency}%</p>
            </CardContent></Card>
          </div>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-base">Energy by Bus</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={report.report}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="bus_id" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="allowed_kwh" fill="#2563EB" name="Allowed kWh" />
                    <Bar dataKey="actual_kwh" fill="#F59E0B" name="Actual kWh" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>Bus</TableHead><TableHead>Type</TableHead><TableHead className="text-right">KM</TableHead><TableHead className="text-right">kWh/km</TableHead>
                  <TableHead className="text-right">Allowed</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Efficiency</TableHead><TableHead className="text-right">Adjustment</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(report.report || []).map((r) => (
                    <TableRow key={r.bus_id} className="hover:bg-gray-50">
                      <TableCell className="font-mono font-medium">{r.bus_id}</TableCell>
                      <TableCell>{r.bus_type}</TableCell>
                      <TableCell className="text-right font-mono">{r.km_operated?.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{r.kwh_per_km}</TableCell>
                      <TableCell className="text-right font-mono">{r.allowed_kwh?.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{r.actual_kwh?.toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-mono font-medium ${r.efficiency <= 100 ? "text-green-600" : "text-red-600"}`}>{r.efficiency}%</TableCell>
                      <TableCell className="text-right font-mono">Rs.{r.adjustment?.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePaginationBar
                page={reportPage}
                pages={reportMeta.pages}
                total={reportMeta.row_total}
                limit={reportMeta.limit}
                onPageChange={setReportPage}
              />
            </CardContent>
          </Card>
        </>
          ) : null}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="energy-dialog">
          <DialogHeader><DialogTitle>Add Charging Data</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bus</Label>
              <Select value={form.bus_id} onValueChange={(v) => setForm({ ...form, bus_id: v })}>
                <SelectTrigger data-testid="energy-bus-select"><SelectValue placeholder="Select bus" /></SelectTrigger>
                <SelectContent>{buses.map(b => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="energy-date" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Units (kWh)</Label><Input type="number" value={form.units_charged} onChange={(e) => setForm({ ...form, units_charged: e.target.value })} data-testid="energy-units" /></div>
              <div className="space-y-2"><Label>Tariff (Rs/kWh)</Label><Input type="number" value={form.tariff_rate} onChange={(e) => setForm({ ...form, tariff_rate: e.target.value })} data-testid="energy-tariff" /></div>
            </div>
            <Button onClick={handleAdd} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="energy-save-btn">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
