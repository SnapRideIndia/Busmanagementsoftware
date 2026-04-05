import { useState, useEffect, useCallback } from "react";
import API, { buildQuery, unwrapListResponse, formatApiError, fetchAllPaginated, getBackendOrigin } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import RingLoader from "../components/RingLoader";
import { formatDateIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { FileBarChart, Download } from "lucide-react";
import { toast } from "sonner";

export default function ReportsPage() {
  const [reportType, setReportType] = useState("operations");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [incStatus, setIncStatus] = useState("");
  const [incType, setIncType] = useState("");
  const [incSeverity, setIncSeverity] = useState("");
  const [allBuses, setAllBuses] = useState([]);
  const [meta, setMeta] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [generateError, setGenerateError] = useState(null);
  const [pageError, setPageError] = useState(null);

  const formatReportCell = useCallback((col, val) => {
    if (val == null || val === "") return "-";
    if (typeof val === "number") return val.toLocaleString("en-IN");
    if (["date", "period_start", "period_end"].includes(col) && typeof val === "string") return formatDateIN(val);
    return String(val);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [buses, m] = await Promise.all([fetchAllPaginated("/buses", {}), API.get("/incidents/meta")]);
        setAllBuses(buses);
        setMeta(m.data);
      } catch {
        setAllBuses([]);
      }
    })();
  }, []);

  const depotsList = [...new Set(allBuses.map((b) => b.depot).filter(Boolean))].sort();
  const busesForSelect = depot ? allBuses.filter((b) => b.depot === depot) : allBuses;

  const reportParams = (pageOverride) => {
    const pg = pageOverride ?? page;
    const p = { report_type: reportType, date_from: dateFrom, date_to: dateTo, page: pg, limit: 20 };
    if (["operations", "energy", "incidents"].includes(reportType)) {
      p.depot = depot;
      p.bus_id = busId;
    }
    if (reportType === "billing") p.depot = depot;
    if (reportType === "incidents") {
      p.status = incStatus;
      p.incident_type = incType;
      p.severity = incSeverity;
    }
    return buildQuery(p);
  };

  const generate = async () => {
    setPage(1);
    setLoading(true);
    setGenerateError(null);
    setPageError(null);
    try {
      const { data } = await API.get("/reports", { params: reportParams(1) });
      setReport(data);
      toast.success(`${data.count} records found`);
    } catch (err) {
      const msg = formatApiError(err.response?.data?.detail) || err.message || "Failed to generate report";
      setGenerateError(msg);
      setReport(null);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setReport(null);
  }, [reportType, dateFrom, dateTo, depot, busId, incStatus, incType, incSeverity]);

  const goReportPage = async (p) => {
    if (!report) return;
    setLoading(true);
    setPageError(null);
    try {
      const { data } = await API.get("/reports", { params: reportParams(p) });
      setReport(data);
      setPage(p);
    } catch (err) {
      const msg = formatApiError(err.response?.data?.detail) || err.message || "Failed to load page";
      setPageError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const download = (fmt) => {
    const q = new URLSearchParams({ ...reportParams(1), fmt });
    const o = getBackendOrigin();
    window.open(`${o || ""}/api/reports/download?${q}`, "_blank");
  };

  const cols = {
    operations: ["bus_id", "driver_id", "date", "scheduled_km", "actual_km"],
    energy: ["bus_id", "date", "units_charged", "tariff_rate"],
    incidents: ["id", "incident_type", "bus_id", "severity", "status"],
    billing: ["invoice_id", "period_start", "period_end", "base_payment", "final_payable"],
  };

  return (
    <div data-testid="reports-page">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
      </div>

      <Card className="border-gray-200 shadow-sm mb-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase text-gray-500">Report Type</label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger className="w-48" data-testid="report-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="energy">Energy</SelectItem>
                  <SelectItem value="incidents">Incidents</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="report-date-from" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="report-date-to" />
            </div>
            {(reportType === "operations" || reportType === "energy") && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
                  <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="All Depots" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Depots</SelectItem>
                      {depotsList.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
                  <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="All Buses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Buses</SelectItem>
                      {busesForSelect.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {reportType === "incidents" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
                  <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="All Depots" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Depots</SelectItem>
                      {depotsList.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
                  <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="All Buses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Buses</SelectItem>
                      {busesForSelect.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Status</label>
                  <Select value={incStatus || "all"} onValueChange={(v) => setIncStatus(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {(meta?.statuses || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Severity</label>
                  <Select value={incSeverity || "all"} onValueChange={(v) => setIncSeverity(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-32"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {(meta?.severities || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Type code</label>
                  <Input value={incType} onChange={(e) => setIncType(e.target.value)} placeholder="e.g. OVERSPEED" className="w-36 font-mono text-xs" />
                </div>
              </>
            )}
            {reportType === "billing" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
                <Select value={depot || "all"} onValueChange={(v) => setDepot(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="All Depots" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Depots</SelectItem>
                    {depotsList.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={generate} disabled={loading} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="generate-report-btn">
              <FileBarChart size={14} className="mr-1.5" /> {loading ? "Loading..." : "Generate"}
            </Button>
            <Button onClick={() => download("excel")} variant="outline" data-testid="download-excel-btn">
              <Download size={14} className="mr-1.5 text-green-600" /> Excel
            </Button>
            <Button onClick={() => download("pdf")} variant="outline" data-testid="download-pdf-btn">
              <Download size={14} className="mr-1.5 text-red-500" /> PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {generateError && !loading && !report ? (
        <AsyncPanel error={generateError} onRetry={generate} />
      ) : null}

      {report && (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{report.type?.charAt(0).toUpperCase() + report.type?.slice(1)} Report</span>
              <span className="text-sm font-normal text-gray-500">{report.count} records (page {report.page} of {report.pages})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pageError && !loading ? (
              <div className="mx-4 mt-4 rounded-lg border border-red-100 bg-red-50/90 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-sm text-red-800">{pageError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => goReportPage(page)}>
                  Retry
                </Button>
              </div>
            ) : null}
            {loading && report ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2">
                <RingLoader />
                <p className="text-xs text-gray-500">Loading…</p>
              </div>
            ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="table-header">
                  {(cols[reportType] || []).map((c) => <TableHead key={c} className="capitalize">{c.replace(/_/g, " ")}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {report.data?.map((row, i) => (
                    <TableRow key={i} className="hover:bg-gray-50">
                      {(cols[reportType] || []).map((c) => (
                        <TableCell key={c} className="font-mono text-sm">{formatReportCell(c, row[c])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {report.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-8">No data</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
            )}
            <TablePaginationBar
              page={report.page ?? 1}
              pages={report.pages ?? 1}
              total={report.count ?? 0}
              limit={report.limit ?? 20}
              onPageChange={goReportPage}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
