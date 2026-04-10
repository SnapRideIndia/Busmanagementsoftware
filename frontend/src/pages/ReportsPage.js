import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import API, { buildQuery, formatApiError, fetchAllPaginated, getBackendOrigin } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { SIMPLE_REPORT_NAMES, columnsForPreview, formatReportCellValue, headerLabel } from "../lib/reportPreview";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import RingLoader from "../components/RingLoader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import {
  BarChart3,
  Search,
  Download,
  Play,
  FileText,
  MapPin,
  AlertTriangle,
  DollarSign,
  Shield,
  Database,
  Zap,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

const CATEGORY_ICONS = {
  Operational: Play,
  Energy: Zap,
  Incident: AlertTriangle,
  Billing: DollarSign,
  Revenue: DollarSign,
  Infraction: Shield,
  Statistical: BarChart3,
  SLA: Shield,
  Security: Database,
  "Map Tracking": MapPin,
};

const CATEGORY_COLORS = {
  Operational: "bg-green-50 text-green-700 border-green-200",
  Energy: "bg-amber-50 text-amber-800 border-amber-200",
  Incident: "bg-orange-50 text-orange-700 border-orange-200",
  Billing: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Revenue: "bg-violet-50 text-violet-700 border-violet-200",
  Infraction: "bg-yellow-50 text-yellow-800 border-yellow-200",
  Statistical: "bg-purple-50 text-purple-700 border-purple-200",
  SLA: "bg-indigo-50 text-indigo-700 border-indigo-200",
  Security: "bg-gray-50 text-gray-700 border-gray-200",
  "Map Tracking": "bg-blue-50 text-blue-700 border-blue-200",
};

const BILLING_WORKFLOW_STATES = ["draft", "submitted", "paid"];

export default function ReportsPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [route, setRoute] = useState("");
  const [revenuePeriod, setRevenuePeriod] = useState("daily");
  const [queue, setQueue] = useState("all");
  const [incStatus, setIncStatus] = useState("");
  const [incType, setIncType] = useState("");
  const [incSeverity, setIncSeverity] = useState("");
  const [workflowState, setWorkflowState] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [tripId, setTripId] = useState("");
  const [dutyId, setDutyId] = useState("");
  const [incOccurredFrom, setIncOccurredFrom] = useState("");
  const [incOccurredTo, setIncOccurredTo] = useState("");
  const [infCategory, setInfCategory] = useState("");
  const [driverId, setDriverId] = useState("");
  const [infractionCode, setInfractionCode] = useState("");
  const [routeId, setRouteId] = useState("");
  const [infractionRouteName, setInfractionRouteName] = useState("");
  const [relatedIncidentId, setRelatedIncidentId] = useState("");

  const [allBuses, setAllBuses] = useState([]);
  const [meta, setMeta] = useState(null);
  const [routesList, setRoutesList] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [generateError, setGenerateError] = useState(null);
  const [pageError, setPageError] = useState(null);

  const selected = useMemo(
    () => catalog.find((r) => r.id === selectedId) || null,
    [catalog, selectedId],
  );
  const simpleReportName = useCallback((entry) => {
    if (!entry) return "";
    return SIMPLE_REPORT_NAMES[entry.report_type] || entry.name;
  }, []);
  const reportType = selected?.report_type || "operations";
  const filters = useMemo(() => selected?.filters || [], [selected]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await API.get(Endpoints.reports.catalog());
        setCatalog(Array.isArray(data) ? data : []);
        setCatalogError(null);
      } catch (e) {
        setCatalog([]);
        setCatalogError(formatApiError(e.response?.data?.detail) || e.message || "Failed to load report list");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [buses, m] = await Promise.all([
          fetchAllPaginated(Endpoints.masters.buses.list(), {}),
          API.get(Endpoints.incidents.meta()),
        ]);
        setAllBuses(buses);
        setMeta(m.data);
      } catch {
        setAllBuses([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!catalog.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => (prev && catalog.some((r) => r.id === prev) ? prev : catalog[0].id));
  }, [catalog]);

  useEffect(() => {
    if (!filters.includes("route")) return;
    (async () => {
      try {
        const { data } = await API.get(Endpoints.revenue.details(), { params: { limit: 1, page: 1 } });
        setRoutesList(data.routes || []);
      } catch {
        setRoutesList([]);
      }
    })();
  }, [filters, selectedId]);

  const depotsList = useMemo(
    () => [...new Set(allBuses.map((b) => b.depot).filter(Boolean))].sort(),
    [allBuses],
  );
  const busesForSelect = depot ? allBuses.filter((b) => b.depot === depot) : allBuses;

  const categories = useMemo(() => ["all", ...new Set(catalog.map((r) => r.category))], [catalog]);
  const filteredCatalog = useMemo(() => {
    return catalog.filter((r) => {
      if (activeCategory !== "all" && r.category !== activeCategory) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !r.description?.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [catalog, activeCategory, search]);

  useEffect(() => {
    if (!filteredCatalog.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => (prev && filteredCatalog.some((r) => r.id === prev) ? prev : filteredCatalog[0].id));
  }, [filteredCatalog]);

  const formatReportCell = useCallback((col, val) => {
    return formatReportCellValue(col, val);
  }, []);

  const buildParamsForEntry = useCallback(
    (entry, pageOverride) => {
      const pg = pageOverride ?? page;
      if (!entry) return buildQuery({});
      const rt = entry.report_type;
      const fl = entry.filters || [];
      const p = {
        report_type: rt,
        date_from: dateFrom,
        date_to: dateTo,
        page: pg,
        limit: 20,
      };
      if (fl.includes("depot")) p.depot = depot;
      if (fl.includes("bus_id")) p.bus_id = busId;
      if (fl.includes("route")) p.route = route;
      if (fl.includes("period")) p.period = revenuePeriod;
      if (fl.includes("queue")) p.queue = queue;
      if (fl.includes("status")) p.status = incStatus;
      if (fl.includes("workflow_state")) p.workflow_state = workflowState;
      if (fl.includes("invoice_id")) p.invoice_id = invoiceId;
      if (fl.includes("trip_id")) p.trip_id = tripId;
      if (fl.includes("duty_id")) p.duty_id = dutyId;
      if (fl.includes("incident_type")) p.incident_type = incType;
      if (fl.includes("severity")) p.severity = incSeverity;
      if (fl.includes("category")) p.category = infCategory;
      if (fl.includes("driver_id")) p.driver_id = driverId;
      if (fl.includes("infraction_code")) p.infraction_code = infractionCode;
      if (fl.includes("route_id")) p.route_id = routeId;
      if (fl.includes("infraction_route_name")) p.infraction_route_name = infractionRouteName;
      if (fl.includes("related_incident_id")) p.related_incident_id = relatedIncidentId;
      if (fl.includes("occurred_from")) p.occurred_from = incOccurredFrom;
      if (fl.includes("occurred_to")) p.occurred_to = incOccurredTo;
      return buildQuery(p);
    },
    [
      page,
      dateFrom,
      dateTo,
      depot,
      busId,
      route,
      revenuePeriod,
      queue,
      incStatus,
      incType,
      incSeverity,
      workflowState,
      invoiceId,
      tripId,
      dutyId,
      incOccurredFrom,
      incOccurredTo,
      infCategory,
      driverId,
      infractionCode,
      routeId,
      infractionRouteName,
      relatedIncidentId,
    ],
  );

  const generate = async (entryOverride) => {
    const isReportEntry =
      entryOverride &&
      typeof entryOverride === "object" &&
      !("preventDefault" in entryOverride) &&
      "report_type" in entryOverride;
    const entry = isReportEntry ? entryOverride : selected;
    if (!entry || !entry.report_type) {
      toast.error("Choose a report first");
      return;
    }
    const params = buildParamsForEntry(entry, 1);
    params.report_type = entry.report_type;
    const displayName = simpleReportName(entry);
    const q = new URLSearchParams({
      ...params,
      ...(displayName && displayName !== "undefined" ? { report_name: displayName } : {}),
    });
    navigate(`/reports/view?${q.toString()}`);
  };

  useEffect(() => {
    setPage(1);
    setReport(null);
  }, [
    selectedId,
    reportType,
    dateFrom,
    dateTo,
    depot,
    busId,
    route,
    revenuePeriod,
    queue,
    incStatus,
    incType,
    incSeverity,
    workflowState,
    invoiceId,
    tripId,
    dutyId,
    infCategory,
    driverId,
    infractionCode,
    routeId,
    infractionRouteName,
    relatedIncidentId,
  ]);

  const goReportPage = async (p) => {
    if (!report || !selected) return;
    setLoading(true);
    setPageError(null);
    try {
      const { data } = await API.get(Endpoints.reports.run(), { params: buildParamsForEntry(selected, p) });
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

  const download = (fmt, entryOverride) => {
    const entry = entryOverride ?? selected;
    if (!entry) {
      toast.error("Choose a report first");
      return;
    }
    const q = new URLSearchParams({ ...buildParamsForEntry(entry, 1), fmt });
    const o = getBackendOrigin();
    window.open(`${o || ""}/api/reports/download?${q}`, "_blank");
  };

  const previewCols = columnsForPreview(reportType, revenuePeriod);

  return (
    <div data-testid="reports-page" className="space-y-4">
      <div className="page-header flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="page-title text-2xl font-bold text-[#1A1A1A] tracking-tight">Reports &amp; MIS center</h1>
          <p className="text-sm text-gray-500 mt-1">
            {catalog.length ? `${catalog.length} reports available` : catalogError ? "Report list unavailable" : "Loading…"}
          </p>
        </div>
      </div>

      {catalogError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">{catalogError}</div>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200 flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 min-w-0"
            data-testid="report-search"
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? "bg-[#C8102E] text-white border-[#C8102E]"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
            data-testid={`cat-${cat}`}
          >
            {cat === "all" ? "All reports" : cat}
          </button>
        ))}
      </div>

      {catalog.length > 0 && selected ? (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2 border-b border-gray-100 bg-gray-50/50">
            <CardTitle className="text-sm font-semibold text-[#1A1A1A]">Filters</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1.5 w-full sm:w-auto basis-full sm:basis-auto">
                <label className="text-xs font-medium uppercase text-gray-500">Report</label>
                <Select value={selectedId || ""} onValueChange={setSelectedId}>
                  <SelectTrigger className="w-full sm:w-[min(100%,280px)]" data-testid="report-type-select">
                    <SelectValue placeholder="Select report" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {simpleReportName(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {filters.includes("date_from") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">From</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="report-date-from" />
                </div>
              ) : null}
              {filters.includes("date_to") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">To</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="report-date-to" />
                </div>
              ) : null}
              {filters.includes("occurred_from") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Occurred from</label>
                  <Input type="date" value={incOccurredFrom} onChange={(e) => setIncOccurredFrom(e.target.value)} className="w-40" />
                </div>
              ) : null}
              {filters.includes("occurred_to") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Occurred to</label>
                  <Input type="date" value={incOccurredTo} onChange={(e) => setIncOccurredTo(e.target.value)} className="w-40" />
                </div>
              ) : null}
              {filters.includes("depot") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
                  <Select
                    value={depot || "all"}
                    onValueChange={(v) => {
                      setDepot(v === "all" ? "" : v);
                      setBusId("");
                    }}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="All depots" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All depots</SelectItem>
                      {depotsList.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("bus_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
                  <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="All buses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All buses</SelectItem>
                      {busesForSelect.map((b) => (
                        <SelectItem key={b.bus_id} value={b.bus_id}>
                          {b.bus_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("route") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Route</label>
                  <Select value={route || "all"} onValueChange={(v) => setRoute(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="All routes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All routes</SelectItem>
                      {routesList.map((rt) => (
                        <SelectItem key={rt} value={rt}>
                          {rt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("period") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Period</label>
                  <Select value={revenuePeriod} onValueChange={setRevenuePeriod}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("queue") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Queue</label>
                  <Select value={queue} onValueChange={setQueue}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="traffic_pending">First verification pending</SelectItem>
                      <SelectItem value="maintenance_pending">Final verification pending</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("status") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Status</label>
                  <Select value={incStatus || "all"} onValueChange={(v) => setIncStatus(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {(reportType === "billing" ? BILLING_WORKFLOW_STATES : (meta?.statuses || [])).map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("workflow_state") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Workflow state</label>
                  <Select value={workflowState || "all"} onValueChange={(v) => setWorkflowState(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {BILLING_WORKFLOW_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("invoice_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Invoice ID</label>
                  <Input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="INV-..." className="w-40 font-mono text-xs" />
                </div>
              ) : null}
              {filters.includes("trip_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Trip ID</label>
                  <Input value={tripId} onChange={(e) => setTripId(e.target.value)} className="w-40 text-xs" />
                </div>
              ) : null}
              {filters.includes("duty_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Duty ID</label>
                  <Input value={dutyId} onChange={(e) => setDutyId(e.target.value)} className="w-40 text-xs" />
                </div>
              ) : null}
              {filters.includes("severity") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Severity</label>
                  <Select value={incSeverity || "all"} onValueChange={(v) => setIncSeverity(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {(meta?.severities || []).map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {filters.includes("incident_type") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Type code</label>
                  <Input value={incType} onChange={(e) => setIncType(e.target.value)} placeholder="e.g. OVERSPEED" className="w-36 font-mono text-xs" />
                </div>
              ) : null}
              {filters.includes("category") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Category</label>
                  <Input value={infCategory} onChange={(e) => setInfCategory(e.target.value)} placeholder="e.g. SAFETY" className="w-32 font-mono text-xs" />
                </div>
              ) : null}
              {filters.includes("driver_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Driver ID</label>
                  <Input value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="License no." className="w-36 text-xs" />
                </div>
              ) : null}
              {filters.includes("infraction_code") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Infraction code</label>
                  <Input value={infractionCode} onChange={(e) => setInfractionCode(e.target.value)} className="w-36 font-mono text-xs" />
                </div>
              ) : null}
              {filters.includes("route_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Route ID</label>
                  <Input value={routeId} onChange={(e) => setRouteId(e.target.value)} className="w-36 text-xs" />
                </div>
              ) : null}
              {filters.includes("infraction_route_name") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Route name contains</label>
                  <Input value={infractionRouteName} onChange={(e) => setInfractionRouteName(e.target.value)} className="w-44 text-xs" />
                </div>
              ) : null}
              {filters.includes("related_incident_id") ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase text-gray-500">Related incident</label>
                  <Input value={relatedIncidentId} onChange={(e) => setRelatedIncidentId(e.target.value)} className="w-40 font-mono text-xs" />
                </div>
              ) : null}

              <Button onClick={generate} disabled={loading} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="generate-report-btn">
                <Play size={14} className="mr-1.5" /> {loading ? "Loading…" : "Run preview"}
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
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredCatalog.map((r) => {
          const IconComp = CATEGORY_ICONS[r.category] || FileText;
          const catCls = CATEGORY_COLORS[r.category] || "bg-gray-50 text-gray-600 border-gray-200";
          const isSel = selectedId === r.id;
          return (
            <Card
              key={r.id}
              className={`border rounded-lg transition-shadow cursor-pointer ${isSel ? "ring-2 ring-[#C8102E] border-[#C8102E]" : "border-gray-200 hover:shadow-sm"}`}
              data-testid={`report-card-${r.id}`}
              onClick={() => setSelectedId(r.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                    <IconComp className="w-4 h-4 text-[#C8102E]" strokeWidth={1.5} />
                  </div>
                  <Badge variant="outline" className={`text-[9px] border ${catCls}`}>
                    {r.category}
                  </Badge>
                </div>
                <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">{simpleReportName(r)}</h3>
                <p className="text-xs text-gray-500 mb-3 line-clamp-3">{r.description}</p>
                <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-[#C8102E] hover:bg-[#A50E25] text-white"
                    onClick={() => {
                      setSelectedId(r.id);
                      void generate(r);
                    }}
                    disabled={loading && selectedId === r.id}
                    data-testid={`view-${r.id}`}
                  >
                    <Eye className="w-3 h-3 mr-1" /> View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setSelectedId(r.id);
                      download("excel", r);
                    }}
                    data-testid={`excel-${r.id}`}
                  >
                    <Download className="w-3 h-3 mr-1 text-green-600" /> Excel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setSelectedId(r.id);
                      download("pdf", r);
                    }}
                    data-testid={`pdf-${r.id}`}
                  >
                    <Download className="w-3 h-3 mr-1 text-red-500" /> PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {generateError && !loading && !report ? <AsyncPanel error={generateError} onRetry={generate} /> : null}

      {report && selected ? (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span>{selected.name} — preview</span>
              <span className="text-sm font-normal text-gray-500">
                {report.count} records (page {report.page} of {report.pages})
              </span>
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
                  <TableHeader>
                    <TableRow className="table-header">
                      {previewCols.map((c) => (
                        <TableHead key={c} className="whitespace-nowrap">
                          {headerLabel(reportType, c)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.data?.map((row, i) => (
                      <TableRow key={i} className="hover:bg-gray-50">
                        {previewCols.map((c) => (
                          <TableCell key={c} className="font-mono text-sm">
                            {formatReportCell(c, row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {report.data?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={Math.max(1, previewCols.length)} className="text-center text-gray-400 py-8">
                          No data
                        </TableCell>
                      </TableRow>
                    )}
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
      ) : null}
    </div>
  );
}
