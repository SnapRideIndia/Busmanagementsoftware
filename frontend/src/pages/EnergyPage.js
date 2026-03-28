import { useState, useEffect } from "react";
import API, { formatApiError } from "../lib/api";
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
  const [busFilter, setBusFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ bus_id: "", date: "", units_charged: "", tariff_rate: "8.5" });
  const [tab, setTab] = useState("data");

  const load = async () => {
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (busFilter) params.bus_id = busFilter;
      const [e, b] = await Promise.all([API.get("/energy", { params }), API.get("/buses")]);
      setData(e.data); setBuses(b.data);
    } catch {}
  };

  const loadReport = async () => {
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data: r } = await API.get("/energy/report", { params });
      setReport(r);
    } catch {}
  };

  useEffect(() => { load(); }, []);

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
        <Button onClick={() => setAddOpen(true)} className="bg-[#134219] hover:bg-[#0E3213]" data-testid="add-energy-btn">
          <Plus size={16} className="mr-1.5" /> Add Charging Data
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="energy-date-from" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="energy-date-to" />
        <Select value={busFilter} onValueChange={setBusFilter}>
          <SelectTrigger className="w-36" data-testid="energy-bus-filter"><SelectValue placeholder="All Buses" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Buses</SelectItem>{buses.map(b => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
        </Select>
        <Button onClick={load} variant="outline" data-testid="energy-filter-btn">Filter</Button>
        <Button onClick={() => { loadReport(); setTab("report"); }} className="bg-[#BA9149] hover:bg-[#A67F3B] text-white" data-testid="view-energy-report-btn">
          <TrendingUp size={14} className="mr-1.5" /> View Report
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <Button variant={tab === "data" ? "default" : "outline"} onClick={() => setTab("data")} className={tab === "data" ? "bg-[#134219] hover:bg-[#0E3213]" : ""} data-testid="energy-tab-data">Charging Data</Button>
        <Button variant={tab === "report" ? "default" : "outline"} onClick={() => { setTab("report"); loadReport(); }} className={tab === "report" ? "bg-[#134219] hover:bg-[#0E3213]" : ""} data-testid="energy-tab-report">Report</Button>
      </div>

      {tab === "data" && (
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header">
                <TableHead>Bus ID</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Units (kWh)</TableHead><TableHead className="text-right">Tariff (Rs/kWh)</TableHead><TableHead className="text-right">Cost (Rs)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.slice(0, 100).map((e, i) => (
                  <TableRow key={i} className="hover:bg-gray-50">
                    <TableCell className="font-mono">{e.bus_id}</TableCell>
                    <TableCell>{e.date}</TableCell>
                    <TableCell className="text-right font-mono">{e.units_charged?.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{e.tariff_rate}</TableCell>
                    <TableCell className="text-right font-mono">{(e.units_charged * e.tariff_rate).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-8">No data</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "report" && report && (
        <div className="space-y-6">
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
                    <Bar dataKey="allowed_kwh" fill="#134219" name="Allowed kWh" />
                    <Bar dataKey="actual_kwh" fill="#BA9149" name="Actual kWh" />
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
                  {report.report.map((r) => (
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
            </CardContent>
          </Card>
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
            <Button onClick={handleAdd} className="w-full bg-[#134219] hover:bg-[#0E3213]" data-testid="energy-save-btn">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
