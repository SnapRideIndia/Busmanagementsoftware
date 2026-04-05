import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, getBackendOrigin } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { formatDateIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Receipt, FileText, Download, Eye, IndianRupee } from "lucide-react";
import { toast } from "sonner";

export default function BillingPage() {
  const [invoices, setInvoices] = useState([]);
  const [genOpen, setGenOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ period_start: "", period_end: "", depot: "" });
  const [generating, setGenerating] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [depotNames, setDepotNames] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await API.get("/billing", {
        params: buildQuery({
          date_from: filterFrom,
          date_to: filterTo,
          depot: filterDepot,
          status: filterStatus,
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
  }, [filterFrom, filterTo, filterDepot, filterStatus, page]);
  useEffect(() => {
    (async () => {
      try {
        const depots = await fetchAllPaginated("/depots", {});
        setDepotNames(depots.map((d) => d.name).filter(Boolean).sort());
      } catch {
        setDepotNames([]);
      }
    })();
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    if (!form.period_start || !form.period_end) { toast.error("Select period"); return; }
    setGenerating(true);
    try {
      const { data } = await API.post("/billing/generate", form);
      toast.success(`Invoice ${data.invoice_id} generated`);
      setGenOpen(false); load(); setSelected(data); setViewOpen(true);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    finally { setGenerating(false); }
  };

  const viewInvoice = async (id) => {
    try { const { data } = await API.get(`/billing/${id}`); setSelected(data); setViewOpen(true); }
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

  return (
    <div data-testid="billing-page">
      <div className="page-header">
        <h1 className="page-title">Billing</h1>
        <Button onClick={() => setGenOpen(true)} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="generate-invoice-btn">
          <Receipt size={16} className="mr-1.5" /> Generate Invoice
        </Button>
      </div>

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
                <SelectItem value="draft">draft</SelectItem>
                <SelectItem value="submitted">submitted</SelectItem>
                <SelectItem value="paid">paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterDepot(""); setFilterStatus(""); setPage(1); }}>Clear filters</Button>
        </CardContent>
      </Card>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Invoice ID</TableHead><TableHead>Period</TableHead><TableHead>Depot</TableHead>
              <TableHead className="text-right">Base (Rs)</TableHead><TableHead className="text-right">Energy Adj.</TableHead>
              <TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Final (Rs)</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={9}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={invoices.length === 0}
                emptyMessage="No invoices yet. Generate one to get started."
              >
                {invoices.map((inv) => (
                <TableRow key={inv.invoice_id} className="hover:bg-gray-50" data-testid={`invoice-row-${inv.invoice_id}`}>
                  <TableCell className="font-mono font-medium text-[#C8102E]">{inv.invoice_id}</TableCell>
                  <TableCell className="text-sm">{formatDateIN(inv.period_start)} – {formatDateIN(inv.period_end)}</TableCell>
                  <TableCell>{inv.depot}</TableCell>
                  <TableCell className="text-right font-mono">{inv.base_payment?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-blue-600">{inv.energy_adjustment?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-red-600">{inv.total_deduction?.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-semibold text-[#C8102E]">{inv.final_payable?.toLocaleString()}</TableCell>
                  <TableCell><Badge className="bg-green-100 text-green-700 hover:bg-green-100">{inv.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => viewInvoice(inv.invoice_id)} data-testid={`view-invoice-${inv.invoice_id}`}><Eye size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => exportPdf(inv.invoice_id)} data-testid={`pdf-invoice-${inv.invoice_id}`}><FileText size={14} className="text-red-500" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => exportExcel(inv.invoice_id)} data-testid={`excel-invoice-${inv.invoice_id}`}><Download size={14} className="text-green-600" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      {/* Generate Dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent data-testid="billing-generate-dialog">
          <DialogHeader><DialogTitle>Generate Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Period Start</Label><Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} data-testid="billing-period-start" /></div>
            <div className="space-y-2"><Label>Period End</Label><Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} data-testid="billing-period-end" /></div>
            <div className="space-y-2"><Label>Depot (optional)</Label><Input value={form.depot} onChange={(e) => setForm({ ...form, depot: e.target.value })} placeholder="Leave empty for all" data-testid="billing-depot" /></div>
            <Button onClick={handleGenerate} disabled={generating} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="billing-generate-submit">
              {generating ? "Generating..." : "Generate Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Invoice Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="invoice-detail-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><IndianRupee size={18} /> Invoice {selected?.invoice_id}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3 bg-gray-50 p-4 rounded-md">
                <div><span className="text-gray-500 text-xs uppercase">Period</span><p className="font-medium">{selected.period_start} - {selected.period_end}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Depot</span><p className="font-medium">{selected.depot}</p></div>
                <div><span className="text-gray-500 text-xs uppercase">Generated</span><p className="font-medium">{selected.created_at?.slice(0, 10)}</p></div>
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
                    <tr className="border-b bg-green-50"><td className="p-3 font-medium">Subsidy</td><td className="p-3 text-right font-mono font-semibold text-green-700">Rs. {selected.subsidy?.toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Missed KM</td><td className="p-3 text-right font-mono text-red-600">{selected.missed_km?.toLocaleString()} km</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Availability Deduction</td><td className="p-3 text-right font-mono text-red-600">Rs. {selected.availability_deduction?.toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">Performance Deduction</td><td className="p-3 text-right font-mono text-red-600">Rs. {selected.performance_deduction?.toLocaleString()}</td></tr>
                    <tr className="border-b"><td className="p-3 text-gray-600">System Deduction</td><td className="p-3 text-right font-mono text-red-600">Rs. {selected.system_deduction?.toLocaleString()}</td></tr>
                    <tr className="border-b bg-red-50"><td className="p-3 font-medium">Total Deductions</td><td className="p-3 text-right font-mono font-semibold text-red-600">Rs. {selected.total_deduction?.toLocaleString()}</td></tr>
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#C8102E] text-white"><td className="p-4 font-bold text-base">FINAL PAYABLE</td><td className="p-4 text-right font-mono font-bold text-lg">Rs. {selected.final_payable?.toLocaleString()}</td></tr>
                  </tfoot>
                </table>
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
    </div>
  );
}
