import { useCallback, useEffect, useMemo, useState } from "react";
import API, { buildQuery, fetchAllPaginated, formatApiError, getBackendOrigin } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import AsyncPanel from "../components/AsyncPanel";
import TablePaginationBar from "../components/TablePaginationBar";
import ReportDownloads from "../components/ReportDownloads";
import { AlertTriangle, Bell, CheckCircle2, Search, Filter, RotateCcw } from "lucide-react";

const SEV_STYLES = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

const ALERT_CODES = [
  { value: "panic", label: "Panic" },
  { value: "overspeed_user", label: "Overspeed" },
  { value: "gps_breakage", label: "GPS breakage" },
  { value: "idle", label: "Idle" },
  { value: "route_deviation", label: "Route deviation" },
  { value: "bunching_user", label: "Bunching" },
  { value: "harness_removal", label: "Harness removal" },
];

function formatTs(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).replace("T", " ").slice(0, 19);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function severityLeftBar(sev) {
  if (sev === "high") return "border-l-red-500";
  if (sev === "medium") return "border-l-amber-500";
  return "border-l-slate-400";
}

function StatCard({ label, value, icon: Icon, tone = "slate" }) {
  const toneClass =
    tone === "danger"
      ? "from-red-50 to-white border-red-200"
      : tone === "success"
        ? "from-emerald-50 to-white border-emerald-200"
        : "from-slate-50 to-white border-gray-200";
  return (
    <Card className={`bg-gradient-to-br ${toneClass} shadow-sm`}>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900 leading-tight">{value}</p>
        </div>
        <div className="h-10 w-10 rounded-full bg-white/80 border border-gray-100 flex items-center justify-center">
          <Icon className="w-5 h-5 text-gray-600" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AlertsCenterPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ active: 0, resolved: 0, high: 0, medium: 0, low: 0 });
  const [depots, setDepots] = useState([]);
  const [allBuses, setAllBuses] = useState([]);
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [severity, setSeverity] = useState("");
  const [alertCode, setAlertCode] = useState("");
  const [resolved, setResolved] = useState("");
  const [search, setSearch] = useState("");
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const busOptions = useMemo(() => {
    if (!depot) return allBuses;
    return allBuses.filter((b) => b.depot === depot);
  }, [allBuses, depot]);

  useEffect(() => {
    (async () => {
      try {
        const buses = await fetchAllPaginated(Endpoints.masters.buses.list(), {});
        setAllBuses(buses);
        setDepots([...new Set(buses.map((b) => b.depot).filter(Boolean))].sort());
      } catch {
        setAllBuses([]);
        setDepots([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (busId && !busOptions.some((b) => b.bus_id === busId)) setBusId("");
  }, [busId, busOptions]);

  const load = useCallback(
    async (pageOverride = 1) => {
      setLoading(true);
      setErr(null);
      try {
        const params = buildQuery({
          depot,
          bus_id: busId,
          severity,
          alert_code: alertCode,
          resolved,
          search,
          page: pageOverride,
          limit: 20,
        });
        const { data } = await API.get(Endpoints.alerts.center(), { params });
        setRows(data.items || []);
        setSummary(data.summary || { active: 0, resolved: 0, high: 0, medium: 0, low: 0 });
        setMeta({
          total: Number(data.total) || 0,
          page: Number(data.page) || 1,
          pages: Number(data.pages) || 1,
          limit: Number(data.limit) || 20,
        });
      } catch (e) {
        setErr(formatApiError(e.response?.data?.detail) || e.message || "Failed to load alerts");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [depot, busId, severity, alertCode, resolved, search],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  const clearFilters = () => {
    setDepot("");
    setBusId("");
    setSeverity("");
    setAlertCode("");
    setResolved("");
    setSearch("");
  };

  const reportParams = useMemo(
    () =>
      buildQuery({
        report_type: "alerts",
        depot,
        bus_id: busId,
        alert_code: alertCode,
        severity,
        resolved,
      }),
    [depot, busId, alertCode, severity, resolved],
  );
  const reportPdfHref = useMemo(() => {
    const q = new URLSearchParams({ ...reportParams, fmt: "pdf" });
    const origin = getBackendOrigin();
    return `${origin || ""}/api/reports/download?${q.toString()}`;
  }, [reportParams]);
  const reportExcelHref = useMemo(() => {
    const q = new URLSearchParams({ ...reportParams, fmt: "excel" });
    const origin = getBackendOrigin();
    return `${origin || ""}/api/reports/download?${q.toString()}`;
  }, [reportParams]);

  return (
    <div data-testid="alerts-center-page" className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-[#FFF6F7] via-white to-white p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Alerts Center</h1>
            <p className="text-sm text-gray-600 mt-1">
              Monitor all operational alerts with severity and status filters.
            </p>
          </div>
          <Badge variant="outline" className="text-xs border-gray-300 text-gray-700 bg-white/90">
            {meta.total} total alerts
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard label="Active" value={summary.active || 0} icon={AlertTriangle} tone="danger" />
        <StatCard label="Resolved" value={summary.resolved || 0} icon={CheckCircle2} tone="success" />
        <StatCard label="High" value={summary.high || 0} icon={Bell} />
        <StatCard label="Medium" value={summary.medium || 0} icon={Bell} />
        <StatCard label="Low" value={summary.low || 0} icon={Bell} />
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
            <div className="relative xl:col-span-2 2xl:col-span-2">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bus, alert, depot, route..."
                className="pl-8"
              />
            </div>
            <Select value={depot || "all"} onValueChange={(v) => setDepot(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All depots" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All depots</SelectItem>
                {depots.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All buses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All buses</SelectItem>
                {busOptions.map((b) => (
                  <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={alertCode || "all"} onValueChange={(v) => setAlertCode(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ALERT_CODES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Select value={severity || "all"} onValueChange={(v) => setSeverity(v === "all" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severity</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={resolved || "all"} onValueChange={(v) => setResolved(v === "all" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="false">Active</SelectItem>
                  <SelectItem value="true">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button onClick={() => load(1)} className="bg-[#C8102E] hover:bg-[#A50E25]">
              Refresh
            </Button>
            <ReportDownloads pdfHref={reportPdfHref} excelHref={reportExcelHref} />
            <Button type="button" variant="outline" onClick={clearFilters}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {err && !loading ? <AsyncPanel error={err} onRetry={() => load(meta.page || 1)} /> : null}

      <Card className="border-gray-200 shadow-sm overflow-hidden">
        <CardHeader className="pb-2 border-b border-gray-100">
          <CardTitle className="text-sm">Alert Feed</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <AsyncPanel loading />
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">No alerts found for selected filters</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {rows.map((a) => (
                <div
                  key={a.id}
                  className={`px-4 py-3 border-l-4 ${severityLeftBar(a.severity)} hover:bg-gray-50/80 transition-colors`}
                  data-testid={`alert-row-${a.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{a.message || a.alert_type}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[11px] text-gray-500 font-mono">{a.id}</span>
                        <Badge variant="outline" className={`text-[10px] border ${SEV_STYLES[a.severity] || SEV_STYLES.low}`}>
                          {a.severity}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] bg-gray-50">{a.alert_code}</Badge>
                        {a.incident_type ? (
                          <Badge variant="outline" className="text-[10px] border-violet-200 bg-violet-50 text-violet-900 font-mono">
                            {a.incident_type}
                          </Badge>
                        ) : null}
                        {a.default_infraction_code ? (
                          <Badge variant="outline" className="text-[10px] font-mono border-amber-200 bg-amber-50 text-amber-900">
                            {a.default_infraction_code}
                          </Badge>
                        ) : null}
                        <span className="text-[11px] text-gray-600 font-mono">{a.bus_id}</span>
                        <span className="text-[11px] text-gray-500">{a.depot || "-"}</span>
                        <span className="text-[11px] text-gray-500">{a.route || "-"}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            a.resolved
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }`}
                        >
                          {a.resolved ? "Resolved" : "Active"}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-500 shrink-0">{formatTs(a.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <TablePaginationBar
            page={meta.page || 1}
            pages={meta.pages || 1}
            total={meta.total || 0}
            limit={meta.limit || 20}
            onPageChange={(p) => load(p)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
