import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, getBackendOrigin } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { formatDateIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Receipt, FileText, Download, Eye, IndianRupee, MoreVertical, Pencil, Copy, BarChart3, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const WORKFLOW_STATES = ["draft", "submitted", "paid"];

async function copyInvoiceId(id) {
  const s = String(id || "");
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s);
    toast.success("Invoice ID copied");
  } catch {
    toast.error("Could not copy ID");
  }
}

const STATUS_BADGE_CLASS = {
  draft: "bg-gray-100 text-gray-700 hover:bg-gray-100",
  submitted: "bg-blue-100 text-blue-700 hover:bg-blue-100",
  paid: "bg-green-100 text-green-700 hover:bg-green-100",
};

function dateInputFromIso(iso) {
  if (!iso || typeof iso !== "string") return "";
  return iso.slice(0, 10);
}

export default function BillingPage() {
  const [invoices, setInvoices] = useState([]);
  const [genOpen, setGenOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ period_start: "", period_end: "", depot: "", bus_id: "", trip_id: "" });
  const [generating, setGenerating] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterInvoiceId, setFilterInvoiceId] = useState("");
  const [filterBusId, setFilterBusId] = useState("");
  const [filterTripId, setFilterTripId] = useState("");
  const [filterSubmittedFrom, setFilterSubmittedFrom] = useState("");
  const [filterSubmittedTo, setFilterSubmittedTo] = useState("");
  const [filterPaidFrom, setFilterPaidFrom] = useState("");
  const [filterPaidTo, setFilterPaidTo] = useState("");
  const [depotNames, setDepotNames] = useState([]);
  const [allBuses, setAllBuses] = useState([]);
  const [tripOptions, setTripOptions] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [editForm, setEditForm] = useState({ status: "draft", submitted_at: "", paid_at: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await API.get(Endpoints.billing.root(), {
        params: buildQuery({
          date_from: filterFrom,
          date_to: filterTo,
          depot: filterDepot,
          status: filterStatus,
          invoice_id: filterInvoiceId,
          bus_id: filterBusId,
          trip_id: filterTripId,
          submitted_from: filterSubmittedFrom,
          submitted_to: filterSubmittedTo,
          paid_from: filterPaidFrom,
          paid_to: filterPaidTo,
          page,
          limit: 20,
        }),
      });
      const u = unwrapListResponse(data);
      setInvoices(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
    } catch (err) {
      setFetchError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load invoices");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [filterFrom, filterTo, filterDepot, filterStatus, filterInvoiceId, filterBusId, filterTripId, filterSubmittedFrom, filterSubmittedTo, filterPaidFrom, filterPaidTo, page]);
  useEffect(() => {
    (async () => {
      try {
        const [depots, buses] = await Promise.all([
          fetchAllPaginated(Endpoints.masters.depots.list(), {}),
          fetchAllPaginated(Endpoints.masters.buses.list(), {}),
        ]);
        setDepotNames(depots.map((d) => d.name).filter(Boolean).sort());
        setAllBuses(buses);
      } catch {
        setDepotNames([]);
        setAllBuses([]);
      }
    })();
  }, []);
  useEffect(() => {
    (async () => {
      if (!form.period_start || !form.period_end || !form.bus_id) {
        setTripOptions([]);
        setForm((prev) => ({ ...prev, trip_id: "" }));
        return;
      }
      try {
        const { data } = await API.get(Endpoints.billing.tripIds(), {
          params: buildQuery({
            period_start: form.period_start,
            period_end: form.period_end,
            depot: form.depot,
            bus_id: form.bus_id,
          }),
        });
        const ids = Array.isArray(data?.trip_ids) ? data.trip_ids : [];
        setTripOptions(ids);
        setForm((prev) => (prev.trip_id && !ids.includes(prev.trip_id) ? { ...prev, trip_id: "" } : prev));
      } catch {
        setTripOptions([]);
      }
    })();
  }, [form.period_start, form.period_end, form.depot, form.bus_id]);
  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    if (!form.period_start || !form.period_end) { toast.error("Select period"); return; }
    setGenerating(true);
    try {
      const { data } = await API.post(Endpoints.billing.generate(), form);
      toast.success(`Invoice ${data.invoice_id} generated`);
      setGenOpen(false); load(); setSelected(data); setViewOpen(true);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    finally { setGenerating(false); }
  };

  const viewInvoice = async (id) => {
    try { const { data } = await API.get(Endpoints.billing.get(id)); setSelected(data); setViewOpen(true); }
    catch {}
  };

  const exportPdf = (id) => {
    const o = getBackendOrigin();
    window.open(`${o || ""}/api/billing/${id}/export-pdf`, "_blank");
  };
  const exportExcel = (id) => {
    const o = getBackendOrigin();
    window.open(`${o || ""}/api/billing/${id}/export-excel`, "_blank");
  };

  const openEditInvoice = (inv) => {
    setEditingInvoice(inv);
    setEditForm({
      status: inv.status || "draft",
      submitted_at: dateInputFromIso(inv.approval_dates?.submitted_at),
      paid_at: dateInputFromIso(inv.approval_dates?.paid_at),
    });
    setEditOpen(true);
  };

  const saveEditInvoice = async () => {
    if (!editingInvoice?.invoice_id) return;
    const invId = editingInvoice.invoice_id;
    setSavingEdit(true);
    try {
      const { data } = await API.patch(Endpoints.billing.patch(invId), {
        status: editForm.status,
        submitted_at: editForm.submitted_at,
        paid_at: editForm.paid_at,
      });
      toast.success("Invoice updated");
      setEditOpen(false);
      setEditingInvoice(null);
      await load();
      if (viewOpen && selected?.invoice_id === invId) {
        setSelected(data);
      }
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  const busesForFilter = filterDepot ? allBuses.filter((b) => b.depot === filterDepot) : allBuses;
  const busesForGenerate = form.depot ? allBuses.filter((b) => b.depot === form.depot) : allBuses;
  const [billingTab, setBillingTab] = useState("invoices");
  const [qData, setQData] = useState(null);
  const loadQuarterly = useCallback(async () => {
    try { const { data } = await API.get("/billing-quarterly-summary"); setQData(data); } catch {}
  }, []);

  return (
    <div data-testid="billing-page" className="text-[12px] [&_*]:text-[12px]">
      <div className="page-header">
        <h1 className="page-title">Billing</h1>
        <Button onClick={() => setGenOpen(true)} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="generate-invoice-btn">
          <Receipt size={16} className="mr-1.5" /> Generate Invoice
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <Button variant={billingTab === "invoices" ? "default" : "outline"} size="sm" onClick={() => setBillingTab("invoices")} className={billingTab === "invoices" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""} data-testid="billing-tab-invoices">
          Invoices
        </Button>
        <Button variant={billingTab === "quarterly" ? "default" : "outline"} size="sm" onClick={() => { setBillingTab("quarterly"); loadQuarterly(); }} className={billingTab === "quarterly" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""} data-testid="billing-tab-quarterly">
          <BarChart3 size={14} className="mr-1" /> Quarterly Summary
        </Button>
      </div>

      {billingTab === "quarterly" && qData && (
        <div className="space-y-6 mb-6">
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Total Invoices", value: qData.totals.invoice_count, color: "#1A1A1A" },
              { label: "Base Payment", value: `Rs.${(qData.totals.base_payment / 100000).toFixed(1)}L`, color: "#1A1A1A" },
              { label: "Final Payable", value: `Rs.${(qData.totals.final_payable / 100000).toFixed(1)}L`, color: "#C8102E" },
              { label: "Total Deductions", value: `Rs.${(qData.totals.total_deduction / 100000).toFixed(1)}L`, color: "#DC2626" },
              { label: "KPI Damages", value: `Rs.${(qData.totals.kpi_damages / 100000).toFixed(1)}L`, color: "#DC2626" },
              { label: "KPI Incentives", value: `Rs.${(qData.totals.kpi_incentives / 100000).toFixed(1)}L`, color: "#16A34A" },
              { label: "Infractions", value: `Rs.${(qData.totals.infractions_deduction / 100000).toFixed(1)}L`, color: "#F59E0B" },
            ].map((kpi) => (
              <Card key={kpi.label} className="kpi-card border-gray-200">
                <CardContent className="p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">{kpi.label}</p>
                  <p className="text-lg font-bold" style={{ color: kpi.color, fontFamily: "Inter" }}>{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Revenue vs Deductions Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-semibold mb-3">Base Payment vs Final Payable (Quarterly)</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qData.quarters}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                      <Tooltip formatter={(v) => `Rs.${v.toLocaleString()}`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="base_payment" fill="#1F2937" name="Base Payment" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="final_payable" fill="#C8102E" name="Final Payable" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-semibold mb-3">Deduction Breakdown (Quarterly)</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qData.quarters}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                      <Tooltip formatter={(v) => `Rs.${v.toLocaleString()}`} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="availability_deduction" fill="#6B7280" name="Availability" stackId="ded" />
                      <Bar dataKey="performance_deduction" fill="#F59E0B" name="Performance" stackId="ded" />
                      <Bar dataKey="system_deduction" fill="#2563EB" name="System" stackId="ded" />
                      <Bar dataKey="infractions_deduction" fill="#D97706" name="Infractions" stackId="ded" />
                      <Bar dataKey="kpi_damages" fill="#DC2626" name="KPI Damages" stackId="ded" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* KPI Damages vs Incentives Trend */}
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm font-semibold mb-3">KPI Damages vs Incentives Trend</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={qData.quarters}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v) => `Rs.${v.toLocaleString()}`} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="kpi_damages" stroke="#DC2626" strokeWidth={2} dot name="KPI Damages" />
                    <Line type="monotone" dataKey="kpi_incentives" stroke="#16A34A" strokeWidth={2} dot name="KPI Incentives" />
                    <Line type="monotone" dataKey="infractions_deduction" stroke="#F59E0B" strokeWidth={2} dot name="Infractions" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Quarterly Table */}
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-0 overflow-x-auto">
              <Table className="text-[11px]">
                <TableHeader><TableRow className="table-header">
                  <TableHead>Quarter</TableHead><TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Base (Rs)</TableHead><TableHead className="text-right">Energy</TableHead>
                  <TableHead className="text-right">Infr. Ded.</TableHead><TableHead className="text-right">KPI Dam.</TableHead>
                  <TableHead className="text-right text-green-700">KPI Inc.</TableHead><TableHead className="text-right">Total Ded.</TableHead>
                  <TableHead className="text-right font-bold">Final (Rs)</TableHead>
                  <TableHead className="text-right">KM Operated</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {qData.quarters.map((q) => (
                    <TableRow key={q.quarter} className="hover:bg-gray-50">
                      <TableCell className="font-bold">{q.quarter}</TableCell>
                      <TableCell className="text-right font-mono">{q.invoice_count}</TableCell>
                      <TableCell className="text-right font-mono">{q.base_payment.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-blue-600">{q.energy_adjustment.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-amber-600">{q.infractions_deduction.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{q.kpi_damages.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">+{q.kpi_incentives.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-red-700 font-bold">{q.total_deduction.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-[#C8102E]">{q.final_payable.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{q.total_km.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {billingTab === "invoices" && (
      <>
      <Card className="border-gray-200 shadow-sm mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Period from</label>
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="w-40" data-testid="billing-filter-from" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Period to</label>
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="w-40" data-testid="billing-filter-to" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
            <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-44" data-testid="billing-filter-depot"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Depots</SelectItem>
                {depotNames.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Status</label>
            <Select value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-36" data-testid="billing-filter-status"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {WORKFLOW_STATES.map((state) => (
                  <SelectItem key={state} value={state}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Invoice ID</label>
            <Input value={filterInvoiceId} onChange={(e) => { setFilterInvoiceId(e.target.value); setPage(1); }} className="w-44" placeholder="INV-..." />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Bus ID</label>
            <Select value={filterBusId || "all"} onValueChange={(v) => { setFilterBusId(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All buses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All buses</SelectItem>
                {busesForFilter.map((b) => (
                  <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Trip ID</label>
            <Input value={filterTripId} onChange={(e) => { setFilterTripId(e.target.value); setPage(1); }} className="w-44" placeholder="Trip ID" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Submitted from</label>
            <Input type="date" value={filterSubmittedFrom} onChange={(e) => { setFilterSubmittedFrom(e.target.value); setPage(1); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Submitted to</label>
            <Input type="date" value={filterSubmittedTo} onChange={(e) => { setFilterSubmittedTo(e.target.value); setPage(1); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Paid from</label>
            <Input type="date" value={filterPaidFrom} onChange={(e) => { setFilterPaidFrom(e.target.value); setPage(1); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">Paid to</label>
            <Input type="date" value={filterPaidTo} onChange={(e) => { setFilterPaidTo(e.target.value); setPage(1); }} className="w-40" />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterDepot(""); setFilterStatus(""); setFilterInvoiceId(""); setFilterBusId(""); setFilterTripId(""); setFilterSubmittedFrom(""); setFilterSubmittedTo(""); setFilterPaidFrom(""); setFilterPaidTo(""); setPage(1); }}>Clear filters</Button>
        </CardContent>
      </Card>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table className="text-[12px]">
            <TableHeader><TableRow className="table-header">
              <TableHead>Invoice ID</TableHead><TableHead>Period</TableHead><TableHead>Depot</TableHead><TableHead>Concessionaire</TableHead>
              <TableHead className="text-right">Base (Rs)</TableHead><TableHead className="text-right">Energy Adj.</TableHead>
              <TableHead className="text-right">Infractions</TableHead><TableHead className="text-right">KPI Damages</TableHead><TableHead className="text-right text-green-700">KPI Incentives</TableHead>
              <TableHead className="text-right">Total Ded.</TableHead><TableHead className="text-right">Final (Rs)</TableHead>
              <TableHead>Status</TableHead><TableHead>Submitted</TableHead><TableHead>Paid</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={15}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={invoices.length === 0}
                emptyMessage="No invoices yet. Generate one to get started."
              >
                {invoices.map((inv) => (
                <TableRow key={inv.invoice_id} className="hover:bg-gray-50" data-testid={`invoice-row-${inv.invoice_id}`}>
                  <TableCell className="p-2 align-middle max-w-[132px]">
                    <div className="group flex items-center gap-0.5">
                      <span
                        className="truncate font-mono text-[11px] font-medium text-[#C8102E] min-w-0 flex-1"
                        title={inv.invoice_id}
                      >
                        {inv.invoice_id}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-900 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-gray-300"
                        aria-label="Copy invoice ID"
                        data-testid={`copy-invoice-id-${inv.invoice_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyInvoiceId(inv.invoice_id);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{formatDateIN(inv.period_start)} – {formatDateIN(inv.period_end)}</TableCell>
                  <TableCell>{inv.depot}</TableCell>
                  <TableCell>{inv.concessionaire || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{inv.base_payment?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-blue-600">{inv.energy_adjustment?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-amber-600">{(inv.infractions_deduction || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-red-600">{(inv.kpi_damages || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-green-600">+{(inv.kpi_incentives || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-red-700 font-medium">{inv.total_deduction?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-semibold text-[#C8102E]">{inv.final_payable?.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE_CLASS[inv.status] || STATUS_BADGE_CLASS.draft}>
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{inv.approval_dates?.submitted_at ? formatDateIN(inv.approval_dates.submitted_at.slice(0, 10)) : "—"}</TableCell>
                  <TableCell className="text-xs">{inv.approval_dates?.paid_at ? formatDateIN(inv.approval_dates.paid_at.slice(0, 10)) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          data-testid={`invoice-actions-${inv.invoice_id}`}
                          aria-label="Invoice actions"
                        >
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 text-xs">
                        <DropdownMenuItem
                          className="gap-2"
                          onClick={() => openEditInvoice(inv)}
                          data-testid={`edit-invoice-${inv.invoice_id}`}
                        >
                          <Pencil className="h-3.5 w-3.5 opacity-70" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2">
                            <Receipt className="h-3.5 w-3.5 opacity-70" /> Billing
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent className="text-xs">
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => viewInvoice(inv.invoice_id)}
                                data-testid={`view-invoice-${inv.invoice_id}`}
                              >
                                <Eye className="h-3.5 w-3.5 opacity-70" /> View
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => exportPdf(inv.invoice_id)}
                                data-testid={`pdf-invoice-${inv.invoice_id}`}
                              >
                                <FileText className="h-3.5 w-3.5 text-red-500 opacity-90" /> PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => exportExcel(inv.invoice_id)}
                                data-testid={`excel-invoice-${inv.invoice_id}`}
                              >
                                <Download className="h-3.5 w-3.5 text-green-600 opacity-90" /> Excel
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>
      </>
      )}

      {/* Generate Dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent data-testid="billing-generate-dialog">
          <DialogHeader><DialogTitle>Generate Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Period Start</Label><Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value, trip_id: "" })} data-testid="billing-period-start" /></div>
            <div className="space-y-2"><Label>Period End</Label><Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value, trip_id: "" })} data-testid="billing-period-end" /></div>
            <div className="space-y-2">
              <Label>Depot (optional)</Label>
              <Select value={form.depot || "all"} onValueChange={(v) => setForm({ ...form, depot: v === "all" ? "" : v, bus_id: "", trip_id: "" })}>
                <SelectTrigger data-testid="billing-depot"><SelectValue placeholder="All depots" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All depots</SelectItem>
                  {depotNames.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Bus (optional)</Label>
              <Select value={form.bus_id || "all"} onValueChange={(v) => setForm({ ...form, bus_id: v === "all" ? "" : v, trip_id: "" })}>
                <SelectTrigger data-testid="billing-bus"><SelectValue placeholder="All buses in scope" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All buses</SelectItem>
                  {busesForGenerate.map((b) => (
                    <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Trip ID (optional)</Label>
              <Select value={form.trip_id || "all"} onValueChange={(v) => setForm({ ...form, trip_id: v === "all" ? "" : v })} disabled={!form.bus_id || tripOptions.length === 0}>
                <SelectTrigger data-testid="billing-trip"><SelectValue placeholder={!form.bus_id ? "Select bus first" : "All trips"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All trips</SelectItem>
                  {tripOptions.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGenerate} disabled={generating} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="billing-generate-submit">
              {generating ? "Generating..." : "Generate Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Invoice Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="invoice-detail-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 min-w-0 pr-8">
              <IndianRupee size={18} className="shrink-0" />
              <span className="shrink-0">Invoice</span>
              {selected?.invoice_id ? (
                <div className="group flex min-w-0 flex-1 items-center gap-0.5">
                  <span
                    className="truncate font-mono text-sm font-semibold text-[#C8102E]"
                    title={selected.invoice_id}
                  >
                    {selected.invoice_id}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-900 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    aria-label="Copy invoice ID"
                    data-testid="copy-invoice-id-dialog"
                    onClick={() => copyInvoiceId(selected.invoice_id)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-md">
                <div><span className="text-gray-500 text-xs uppercase">Period</span><p className="font-medium">{selected.period_start} - {selected.period_end}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Depot</span><p className="font-medium">{selected.depot}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Concessionaire</span><p className="font-medium">{selected.concessionaire || "—"}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Generated</span><p className="font-medium">{selected.created_at?.slice(0, 10)}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Status</span><p className="font-medium">{selected.status}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Submitted</span><p className="font-medium">{selected.approval_dates?.submitted_at ? formatDateIN(selected.approval_dates.submitted_at.slice(0, 10)) : "—"}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Paid</span><p className="font-medium">{selected.approval_dates?.paid_at ? formatDateIN(selected.approval_dates.paid_at.slice(0, 10)) : "—"}</p></div>
              </div>

              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b"><td className="p-3 text-gray-600">Total KM Operated</td><td className="p-3 text-right font-mono font-medium">{selected.total_km?.toLocaleString()} km</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Scheduled KM</td><td className="p-3 text-right font-mono">{selected.scheduled_km?.toLocaleString()} km</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Avg PK Rate</td><td className="p-3 text-right font-mono">Rs. {selected.avg_pk_rate}/km</td></tr>
                    <tr className="border-b bg-green-50"><td className="p-3 font-medium">Base Payment (KM x PK Rate)</td><td className="p-3 text-right font-mono font-semibold">Rs. {selected.base_payment?.toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Allowed Energy</td><td className="p-3 text-right font-mono">{selected.allowed_energy_kwh?.toLocaleString()} kWh</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Actual Energy</td><td className="p-3 text-right font-mono">{selected.actual_energy_kwh?.toLocaleString()} kWh</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Tariff Rate</td><td className="p-3 text-right font-mono">Rs. {selected.tariff_rate}/kWh</td></tr>
                    <tr className="border-b bg-blue-50"><td className="p-3 font-medium">Energy Adjustment</td><td className="p-3 text-right font-mono font-semibold text-blue-700">Rs. {selected.energy_adjustment?.toLocaleString()}</td></tr>
                    <tr className="border-b bg-emerald-50"><td className="p-3 font-medium">KM Incentive</td><td className="p-3 text-right font-mono font-semibold text-emerald-700">Rs. {selected.km_incentive?.toLocaleString() || "0"}</td></tr>
                    <tr className="border-b bg-green-50"><td className="p-3 font-medium text-green-800">GCC KPI Incentives (§18)</td><td className="p-3 text-right font-mono font-semibold text-green-700">+ Rs. {(selected.kpi_incentives || 0).toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Missed KM</td><td className="p-3 text-right font-mono text-red-600">{selected.missed_km?.toLocaleString()} km</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Availability Deduction</td><td className="p-3 text-right font-mono text-red-600">- Rs. {selected.availability_deduction?.toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Performance Deduction</td><td className="p-3 text-right font-mono text-red-600">- Rs. {selected.performance_deduction?.toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">System Deduction</td><td className="p-3 text-right font-mono text-red-600">- Rs. {selected.system_deduction?.toLocaleString()}</td></tr>
                    <tr className="border-b bg-amber-50"><td className="p-3 font-medium text-amber-900">Infractions Deduction (Schedule-S)</td><td className="p-3 text-right font-mono font-semibold text-amber-700">- Rs. {(selected.infractions_deduction || 0).toLocaleString()}</td></tr>
                    <tr className="border-b bg-red-50"><td className="p-3 font-medium text-red-900">GCC KPI Damages (§18)</td><td className="p-3 text-right font-mono font-semibold text-red-600">- Rs. {(selected.kpi_damages || 0).toLocaleString()}</td></tr>
                    <tr className="border-b bg-red-100"><td className="p-3 font-bold">Total Deductions</td><td className="p-3 text-right font-mono font-bold text-red-700">- Rs. {selected.total_deduction?.toLocaleString()}</td></tr>
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#C8102E] text-white"><td className="p-4 font-bold text-base">FINAL PAYABLE</td><td className="p-4 text-right font-mono font-bold text-lg">Rs. {selected.final_payable?.toLocaleString()}</td></tr>
                  </tfoot>
                </table>
              </div>

              {/* KPI Breakdown Sub-table */}
              {selected.kpi_breakdown && Object.keys(selected.kpi_breakdown).length > 0 && (
                <div className="border rounded-md overflow-hidden" data-testid="kpi-breakdown-table">
                  <div className="p-3 bg-red-50 border-b">
                    <p className="font-semibold text-sm text-red-900">GCC KPI Breakdown (§18)</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                        <th className="p-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Value</th>
                        <th className="p-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Target</th>
                        <th className="p-2.5 text-right text-xs font-semibold text-red-500 uppercase">Damages (Rs)</th>
                        <th className="p-2.5 text-right text-xs font-semibold text-green-500 uppercase">Incentive (Rs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { key: "reliability", label: "Reliability (BF)", getVal: (c) => c?.bf, getTarget: (c) => c?.target },
                        { key: "availability", label: "Availability", getVal: (c) => `${c?.pct}%`, getTarget: (c) => `${c?.target}%` },
                        { key: "punctuality", label: "Punctuality", getVal: (c) => `S:${c?.start_pct}% A:${c?.arrival_pct}%`, getTarget: () => "S:90% A:80%" },
                        { key: "frequency", label: "Frequency", getVal: (c) => `${c?.trip_freq_pct}%`, getTarget: (c) => `${c?.target}%` },
                        { key: "safety", label: "Safety (MAF)", getVal: (c) => c?.maf, getTarget: (c) => c?.target || "0.01" },
                      ].map(({ key, label, getVal, getTarget }) => {
                        const cat = selected.kpi_breakdown[key];
                        if (!cat) return null;
                        return (
                          <tr key={key} className="border-t hover:bg-gray-50">
                            <td className="p-2.5 font-medium">{label}</td>
                            <td className="p-2.5 text-right font-mono">{getVal(cat)}</td>
                            <td className="p-2.5 text-right font-mono text-gray-500">{getTarget(cat)}</td>
                            <td className="p-2.5 text-right font-mono text-red-600 font-medium">{cat.damages > 0 ? `- ${cat.damages.toLocaleString()}` : "0"}</td>
                            <td className="p-2.5 text-right font-mono text-green-600 font-medium">{cat.incentive > 0 ? `+ ${cat.incentive.toLocaleString()}` : "0"}</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                        <td className="p-2.5" colSpan={3}>Totals (capped at 10% / 5%)</td>
                        <td className="p-2.5 text-right font-mono text-red-700">- Rs.{(selected.kpi_damages || 0).toLocaleString()}</td>
                        <td className="p-2.5 text-right font-mono text-green-700">+ Rs.{(selected.kpi_incentives || 0).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <div className="border rounded-md p-3 text-xs space-y-1 bg-gray-50">
                <p className="font-semibold text-gray-700">Billing Artifacts</p>
                <p>Payment processing note: {selected.artifact_refs?.payment_processing_note || "—"}</p>
                <p>Proposal note: {selected.artifact_refs?.proposal_note || "—"}</p>
                <p>Show-cause notice: {selected.artifact_refs?.show_cause_notice || "—"}</p>
                <p>GST proof: {selected.artifact_refs?.gst_proof_ref || "—"}</p>
                <p>Tax withholding ref: {selected.artifact_refs?.tax_withholding_ref || "—"}</p>
              </div>

              <div className="border rounded-md overflow-hidden">
                <div className="p-3 bg-gray-50 border-b">
                  <p className="font-semibold text-sm">Bus-wise summary</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">Bus</th>
                        <th className="p-2 text-right">Trips</th>
                        <th className="p-2 text-right">Sch KM</th>
                        <th className="p-2 text-right">Optd KM</th>
                        <th className="p-2 text-right">Passengers</th>
                        <th className="p-2 text-right">Revenue (Rs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.bus_wise_summary || []).map((r) => (
                        <tr key={r.bus_id} className="border-t">
                          <td className="p-2 font-mono">{r.bus_id}</td>
                          <td className="p-2 text-right">{r.trip_count?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.scheduled_km?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.actual_km?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.passengers?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.revenue_amount?.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border rounded-md overflow-hidden">
                <div className="p-3 bg-gray-50 border-b">
                  <p className="font-semibold text-sm">Trip-wise details</p>
                </div>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Bus</th>
                        <th className="p-2 text-left">Trip</th>
                        <th className="p-2 text-left">Duty</th>
                        <th className="p-2 text-right">Sch KM</th>
                        <th className="p-2 text-right">Optd KM</th>
                        <th className="p-2 text-right">Passengers</th>
                        <th className="p-2 text-right">Revenue (Rs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.trip_wise_details || []).map((r, idx) => (
                        <tr key={`${r.trip_id || "trip"}-${idx}`} className="border-t">
                          <td className="p-2">{r.date ? formatDateIN(r.date) : "—"}</td>
                          <td className="p-2 font-mono">{r.bus_id}</td>
                          <td className="p-2 font-mono">{r.trip_id || "—"}</td>
                          <td className="p-2 font-mono">{r.duty_id || "—"}</td>
                          <td className="p-2 text-right">{r.scheduled_km?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.actual_km?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.passengers?.toLocaleString()}</td>
                          <td className="p-2 text-right">{r.revenue_amount?.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => exportPdf(selected.invoice_id)} variant="outline" className="flex-1" data-testid="export-pdf-btn">
                  <FileText size={14} className="mr-1.5 text-red-500" /> Export PDF
                </Button>
                <Button onClick={() => exportExcel(selected.invoice_id)} variant="outline" className="flex-1" data-testid="export-excel-btn">
                  <Download size={14} className="mr-1.5 text-green-600" /> Export Excel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="billing-edit-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editingInvoice?.invoice_id || "invoice"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm((p) => ({ ...p, status: v }))}
              >
                <SelectTrigger data-testid="billing-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Submitted date</Label>
              <Input
                type="date"
                value={editForm.submitted_at}
                onChange={(e) => setEditForm((p) => ({ ...p, submitted_at: e.target.value }))}
                data-testid="billing-edit-submitted"
              />
            </div>
            <div className="space-y-2">
              <Label>Paid date</Label>
              <Input
                type="date"
                value={editForm.paid_at}
                onChange={(e) => setEditForm((p) => ({ ...p, paid_at: e.target.value }))}
                data-testid="billing-edit-paid"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-[#C8102E] hover:bg-[#A50E25]"
                disabled={savingEdit}
                onClick={saveEditInvoice}
                data-testid="billing-edit-save"
              >
                {savingEdit ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
