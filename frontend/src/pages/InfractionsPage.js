import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { formatDateIN, formatDateTimeIN } from "../lib/dates";
import { Card, CardContent } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { ChevronDown, FileText, CheckCircle2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
const catColors = {
  A: "bg-gray-100 text-gray-700", B: "bg-blue-100 text-blue-700",
  C: "bg-yellow-100 text-yellow-700", D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700", F: "bg-red-200 text-red-800",
  G: "bg-red-300 text-red-900"
};

function capRuleLabel(row) {
  return row?.is_capped_non_safety ? "Capped (5%)" : "Non-capped";
}

function escalationLabel(row) {
  const cat = String(row?.category || "").toUpperCase();
  if (!row?.repeat_escalation) return "None";
  if (["A", "B", "C", "D", "E"].includes(cat)) return "Next slab if not rectified (max Rs.3,000)";
  return "Next slab if not rectified";
}

const fl = "text-xs font-medium text-gray-500";

/** Select dropdown inside log dialog: viewport height, trigger width, no wider than screen */
const logModalSelectContentClass =
  "z-[1300] max-h-[min(70svh,22rem)] w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] p-0 shadow-lg";

export default function InfractionsPage() {
  const [catalogue, setCatalogue] = useState([]);
  const [logged, setLogged] = useState([]);
  const [tab, setTab] = useState("catalogue");
  const [logOpen, setLogOpen] = useState(false);
  const emptyLogForm = () => ({
    bus_id: "",
    driver_id: "",
    infraction_code: "",
    date: "",
    remarks: "",
    depot: "",
    route_name: "",
    route_id: "",
    trip_id: "",
    duty_id: "",
    location_text: "",
    cause_code: "",
    deductible: "",
    related_incident_id: "",
  });
  const [logForm, setLogForm] = useState(emptyLogForm);
  const [buses, setBuses] = useState([]);
  const [catalogueAll, setCatalogueAll] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [logDepot, setLogDepot] = useState("");
  const [logBusId, setLogBusId] = useState("");
  const [logCategory, setLogCategory] = useState("");
  const [logDriverId, setLogDriverId] = useState("");
  const [logInfractionCode, setLogInfractionCode] = useState("");
  const [logRouteId, setLogRouteId] = useState("");
  const [logRouteName, setLogRouteName] = useState("");
  const [logRelatedIncident, setLogRelatedIncident] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [catPage, setCatPage] = useState(1);
  const [catMeta, setCatMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [logPage, setLogPage] = useState(1);
  const [logMeta, setLogMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [logAdvancedOpen, setLogAdvancedOpen] = useState(false);
  const [logFiltersExpanded, setLogFiltersExpanded] = useState(false);
  const [closeInfractionOpen, setCloseInfractionOpen] = useState(false);
  const [closeInfractionId, setCloseInfractionId] = useState("");
  const [closeInfractionRemarks, setCloseInfractionRemarks] = useState("");

  const load = useCallback(async () => {
    setCatLoading(true);
    setCatError(null);
    try {
      const [c, busItems] = await Promise.all([
        API.get("/infractions/catalogue", { params: buildQuery({ page: catPage, limit: 20 }) }),
        fetchAllPaginated("/buses", {}),
      ]);
      const cu = unwrapListResponse(c.data);
      setCatalogue(cu.items);
      setCatMeta({ total: cu.total, pages: cu.pages, limit: cu.limit });
      setBuses(busItems);
    } catch (err) {
      setCatError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load catalogue");
      setCatalogue([]);
    } finally {
      setCatLoading(false);
    }
  }, [catPage]);

  useEffect(() => {
    (async () => {
      try {
        setCatalogueAll(await fetchAllPaginated("/infractions/catalogue", {}));
      } catch {
        setCatalogueAll([]);
      }
    })();
  }, []);

  const loadLogged = useCallback(async () => {
    setLogLoading(true);
    setLogError(null);
    try {
      const params = buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        depot: logDepot,
        bus_id: logBusId,
        category: logCategory,
        driver_id: logDriverId,
        infraction_code: logInfractionCode,
        route_id: logRouteId,
        route_name: logRouteName,
        related_incident_id: logRelatedIncident,
        status: logStatus,
        page: logPage,
        limit: 20,
      });
      const { data } = await API.get("/infractions/logged", { params });
      const u = unwrapListResponse(data);
      setLogged(u.items);
      setLogMeta({ total: u.total, pages: u.pages, limit: u.limit });
    } catch (err) {
      setLogError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load logged infractions");
      setLogged([]);
    } finally {
      setLogLoading(false);
    }
  }, [dateFrom, dateTo, logDepot, logBusId, logCategory, logDriverId, logInfractionCode, logRouteId, logRouteName, logRelatedIncident, logStatus, logPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setLogPage(1);
  }, [dateFrom, dateTo, logDepot, logBusId, logCategory, logDriverId, logInfractionCode, logRouteId, logRouteName, logRelatedIncident, logStatus]);
  useEffect(() => {
    if (tab === "logged") loadLogged();
  }, [tab, loadLogged]);

  useEffect(() => {
    const bid = logForm.bus_id;
    if (!bid) return;
    const b = buses.find((x) => x.bus_id === bid);
    const depot = b?.depot != null ? String(b.depot).trim() : "";
    setLogForm((prev) => {
      if (prev.bus_id !== bid) return prev;
      return { ...prev, depot };
    });
  }, [logForm.bus_id, buses]);

  const handleLog = async () => {
    if (!logForm.infraction_code) {
      toast.error("Select an infraction code");
      return;
    }
    if (!logForm.bus_id) {
      toast.error("Select a bus");
      return;
    }
    try {
      const payload = {
        infraction_code: logForm.infraction_code,
        bus_id: logForm.bus_id || undefined,
        driver_id: logForm.driver_id || undefined,
        date: logForm.date || undefined,
        remarks: logForm.remarks || undefined,
        depot: logForm.depot || undefined,
        route_name: logForm.route_name || undefined,
        route_id: logForm.route_id || undefined,
        trip_id: logForm.trip_id || undefined,
        duty_id: logForm.duty_id || undefined,
        location_text: logForm.location_text || undefined,
        cause_code: logForm.cause_code || undefined,
        related_incident_id: logForm.related_incident_id || undefined,
      };
      if (logForm.deductible === "true") payload.deductible = true;
      else if (logForm.deductible === "false") payload.deductible = false;
      await API.post("/infractions/log", payload);
      toast.success("Infraction logged");
      setLogOpen(false);
      setLogForm(emptyLogForm());
      loadLogged();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const openCloseInfractionDialog = (id) => {
    setCloseInfractionId(id);
    setCloseInfractionRemarks("");
    setCloseInfractionOpen(true);
  };

  const submitCloseInfraction = async () => {
    if (!closeInfractionId) return;
    try {
      await API.post(`/infractions/${closeInfractionId}/close`, {
        status: "closed",
        close_remarks: closeInfractionRemarks.trim(),
      });
      toast.success("Infraction closed");
      setCloseInfractionOpen(false);
      setCloseInfractionId("");
      loadLogged();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const handleUnderReview = async (id) => {
    try {
      await API.post(`/infractions/${id}/close`, { status: "under_review" });
      toast.success("Set to under review");
      loadLogged();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const selectedBusForLog = buses.find((b) => b.bus_id === logForm.bus_id);
  const depotFromBusLocked = Boolean(logForm.bus_id && String(selectedBusForLog?.depot || "").trim());

  return (
    <div data-testid="infractions-page">
      <div className="page-header">
        <h1 className="page-title">Infractions</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLogOpen(true)} data-testid="log-infraction-btn">
            <FileText size={14} className="mr-1.5" /> Log Infraction
          </Button>
        </div>
      </div>

      <p className="page-lead">
        Schedule-S <strong>fine catalogue</strong> and <strong>logged penalties</strong>. Non-safety A–D capped at 5% of monthly due; safety and E/F/G are not.{" "}
        <Link to="/incidents" className="text-[#C8102E] font-medium hover:underline">Incidents</Link>
        {" · "}
        <Link to="/gcc-kpi" className="text-[#C8102E] font-medium hover:underline">GCC KPI</Link>
        {" · "}
        <Link to="/deductions" className="text-gray-700 underline hover:text-[#C8102E]">Deductions</Link>.
      </p>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <Button variant={tab === "catalogue" ? "default" : "outline"} onClick={() => setTab("catalogue")} className={tab === "catalogue" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>Catalogue ({catMeta.total})</Button>
        <Button variant={tab === "logged" ? "default" : "outline"} onClick={() => setTab("logged")} className={tab === "logged" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>Logged ({logMeta.total})</Button>
      </div>

      {tab === "catalogue" && (
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header">
                <TableHead>Code</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead>
                <TableHead className="text-right">Amount (Rs)</TableHead><TableHead>Safety</TableHead><TableHead className="text-right">Resolve days</TableHead><TableHead>Cap rule</TableHead><TableHead>Escalation</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableLoadRows
                  colSpan={9}
                  loading={catLoading}
                  error={catError}
                  onRetry={load}
                  isEmpty={catalogue.length === 0}
                  emptyMessage="No catalogue entries"
                >
                  {catalogue.map((c) => (
                    <TableRow key={c.id} className="hover:bg-[#FAFAFA]" data-testid={`cat-row-${c.code}`}>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell><Badge className={`${catColors[c.category]} hover:${catColors[c.category]}`}>{c.category}</Badge></TableCell>
                      <TableCell className="text-sm">{c.description}</TableCell>
                      <TableCell className="text-right font-mono font-medium text-[#DC2626]">Rs.{c.amount?.toLocaleString()}</TableCell>
                      <TableCell>{c.safety_flag ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Safety</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                      <TableCell className="text-right font-mono">{c.resolve_days ?? "—"}</TableCell>
                      <TableCell className="text-xs">{capRuleLabel(c)}</TableCell>
                      <TableCell className="text-xs">{escalationLabel(c)}</TableCell>
                    </TableRow>
                  ))}
                </TableLoadRows>
              </TableBody>
            </Table>
            <TablePaginationBar
              page={catPage}
              pages={catMeta.pages}
              total={catMeta.total}
              limit={catMeta.limit}
              onPageChange={setCatPage}
            />
          </CardContent>
        </Card>
      )}

      {tab === "logged" && (
        <>
          <TooltipProvider delayDuration={300}>
          <div className="mb-4 space-y-2">
            <Collapsible open={logFiltersExpanded} onOpenChange={setLogFiltersExpanded}>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <span className={fl}>From</span>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" aria-label="Date from" />
                </div>
                <div className="space-y-1">
                  <span className={fl}>To</span>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" aria-label="Date to" />
                </div>
                <div className="space-y-1">
                  <span className={fl}>Depot</span>
                  <Select value={logDepot || "all"} onValueChange={(v) => { setLogDepot(v === "all" ? "" : v); setLogBusId(""); }}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Depots</SelectItem>
                      {[...new Set(buses.map((b) => b.depot).filter(Boolean))].sort().map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className={fl}>Bus</span>
                  <Select value={logBusId || "all"} onValueChange={(v) => setLogBusId(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Buses</SelectItem>
                      {(logDepot ? buses.filter((b) => b.depot === logDepot) : buses).map((b) => (
                        <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className={fl}>Infraction code</span>
                  <Select value={logInfractionCode || "all"} onValueChange={(v) => setLogInfractionCode(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All codes</SelectItem>
                      {[...catalogueAll].sort((a, b) => a.code.localeCompare(b.code)).map((c) => (
                        <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className={fl}>Status</span>
                  <Select value={logStatus || "all"} onValueChange={(v) => setLogStatus(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="under_review">Under review</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={loadLogged} variant="outline">
                  Refresh
                </Button>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" type="button" className="flex h-9 items-center gap-1 px-2 text-gray-600 hover:text-gray-900">
                    <span className="text-sm font-medium text-gray-700">More filters</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${logFiltersExpanded ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="flex flex-wrap gap-3 pt-3 mt-2 border-t border-gray-100">
                  <div className="space-y-1">
                    <span className={fl}>Category</span>
                    <Select value={logCategory || "all"} onValueChange={(v) => setLogCategory(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-24"><SelectValue placeholder="All" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {Object.keys(catColors).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className={fl}>Driver</span>
                    <Input value={logDriverId} onChange={(e) => setLogDriverId(e.target.value)} className="w-32 font-mono text-xs" placeholder="License no." />
                  </div>
                  <div className="space-y-1">
                    <span className={fl}>Route ID</span>
                    <Input value={logRouteId} onChange={(e) => setLogRouteId(e.target.value)} className="w-28 font-mono text-xs" placeholder="Route ID" />
                  </div>
                  <div className="space-y-1">
                    <span className={fl}>Route name</span>
                    <Input value={logRouteName} onChange={(e) => setLogRouteName(e.target.value)} className="w-32 text-xs" placeholder="Contains…" />
                  </div>
                  <div className="space-y-1">
                    <span className={fl}>Incident ID</span>
                    <Input value={logRelatedIncident} onChange={(e) => setLogRelatedIncident(e.target.value)} className="w-36 font-mono text-xs" placeholder="INC-…" />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <Card className="border-gray-200 shadow-sm overflow-x-auto">
            <CardContent className="p-0 min-w-[1040px]">
              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>Detected</TableHead>
                  <TableHead>Logged at</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Bus</TableHead>
                  <TableHead>Depot</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Resolve by</TableHead>
                  <TableHead>Logged by</TableHead>
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center justify-end gap-1 ml-auto w-full cursor-help rounded-sm bg-transparent p-0 text-left font-semibold text-inherit hover:opacity-90"
                        >
                          Action
                          <HelpCircle className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[260px] text-left font-normal leading-snug">
                        Close fixes the penalty amount (no further slab escalation). Under review is workflow-only; escalation can still apply until you close.
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableLoadRows
                    colSpan={12}
                    loading={logLoading}
                    error={logError}
                    onRetry={loadLogged}
                    isEmpty={logged.length === 0}
                    emptyMessage="No infractions logged"
                  >
                    {logged.map((l) => (
                      <TableRow key={l.id} className="hover:bg-[#FAFAFA]" title={l.id}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDateIN(l.date)}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap tabular-nums">{formatDateTimeIN(l.created_at)}</TableCell>
                        <TableCell className="font-mono" title={l.id}>{l.infraction_code}</TableCell>
                        <TableCell><Badge className={`${catColors[l.category]} hover:${catColors[l.category]}`}>{l.category}</Badge></TableCell>
                        <TableCell className="font-mono">{l.bus_id || "—"}</TableCell>
                        <TableCell className="text-sm max-w-[100px] truncate">{l.depot || "—"}</TableCell>
                        <TableCell className="text-sm max-w-[200px]">{l.description}</TableCell>
                        <TableCell className="text-right font-mono text-[#DC2626] whitespace-nowrap">Rs.{l.amount?.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={l.status === "closed" ? "secondary" : "outline"}>{l.status || "open"}</Badge>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{l.resolve_by ? formatDateIN(l.resolve_by) : "—"}</TableCell>
                        <TableCell className="text-sm max-w-[100px] truncate">{l.logged_by}</TableCell>
                        <TableCell className="text-right">
                          {l.status !== "closed" ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {(l.status || "open") === "open" ? (
                                <Button variant="secondary" size="sm" type="button" onClick={() => handleUnderReview(l.id)} aria-label="Mark under review">
                                  Under review
                                </Button>
                              ) : null}
                              <Button variant="outline" size="sm" type="button" onClick={() => openCloseInfractionDialog(l.id)}>
                                <CheckCircle2 size={13} className="mr-1" /> Close
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-500">Closed</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableLoadRows>
                </TableBody>
              </Table>
              <TablePaginationBar
                page={logPage}
                pages={logMeta.pages}
                total={logMeta.total}
                limit={logMeta.limit}
                onPageChange={setLogPage}
              />
            </CardContent>
          </Card>
          </TooltipProvider>
        </>
      )}

      <Dialog
        open={closeInfractionOpen}
        onOpenChange={(open) => {
          setCloseInfractionOpen(open);
          if (!open) {
            setCloseInfractionId("");
            setCloseInfractionRemarks("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="close-infraction-dialog">
          <DialogHeader>
            <DialogTitle>Close infraction</DialogTitle>
            <DialogDescription>
              Stops further slab escalation for billing. Remarks are optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="close-infraction-remarks">Remarks</Label>
            <Input
              id="close-infraction-remarks"
              value={closeInfractionRemarks}
              onChange={(e) => setCloseInfractionRemarks(e.target.value)}
              placeholder="Optional note"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloseInfractionOpen(false)}>
              Cancel
            </Button>
            <Button type="button" className="bg-[#C8102E] hover:bg-[#A50E25]" onClick={submitCloseInfraction}>
              Confirm close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Infraction Dialog */}
      <Dialog
        open={logOpen}
        onOpenChange={(open) => {
          setLogOpen(open);
          if (!open) setLogAdvancedOpen(false);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden w-[calc(100vw-1.5rem)] sm:w-full" data-testid="log-infraction-dialog">
          <DialogHeader>
            <DialogTitle>Log infraction</DialogTitle>
            <DialogDescription>
              Code and bus are required. Detected date is when it occurred (date only; defaults to today). Logged date/time is stored when you submit.{" "}
              <Link to="/incidents" className="text-[#C8102E] font-medium hover:underline">Incidents</Link>
              {" "}if a ticket exists.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 min-w-0">
              <Label>Infraction code <span className="text-red-600" aria-hidden>*</span></Label>
              <Select value={logForm.infraction_code} onValueChange={(v) => setLogForm({ ...logForm, infraction_code: v })}>
                <SelectTrigger data-testid="log-inf-code" className="w-full min-h-9 h-auto min-w-0 py-2 text-left [&>span]:line-clamp-none [&>span]:whitespace-normal">
                  <SelectValue placeholder="Choose code" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  sideOffset={6}
                  align="start"
                  collisionPadding={20}
                  className={logModalSelectContentClass}
                >
                  {(catalogueAll.length ? catalogueAll : catalogue).map((c) => (
                    <SelectItem
                      key={c.code}
                      value={c.code}
                      className="group items-start whitespace-normal break-words py-2.5 pl-2 pr-8 text-left leading-snug focus:bg-gray-100 focus:text-gray-900 data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900 dark:focus:bg-gray-800 dark:focus:text-gray-100 dark:data-[highlighted]:bg-gray-800 dark:data-[highlighted]:text-gray-100"
                    >
                      <span className="block">
                        <span className="font-mono font-semibold">{c.code}</span>
                        <span className="infraction-desc mt-0.5 block text-xs text-gray-600 group-data-[highlighted]:text-gray-800 dark:text-gray-400 dark:group-data-[highlighted]:text-gray-300">
                          {c.description} · Rs.{c.amount?.toLocaleString?.() ?? c.amount}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-3 min-w-0">
              <div className="space-y-2 min-w-0">
                <Label>Bus <span className="text-red-600" aria-hidden>*</span></Label>
                <Select value={logForm.bus_id || "none"} onValueChange={(v) => setLogForm({ ...logForm, bus_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="log-inf-bus" className="w-full min-w-0">
                    <SelectValue placeholder="Select bus" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    sideOffset={6}
                    align="start"
                    collisionPadding={20}
                    className={logModalSelectContentClass}
                  >
                    <SelectItem value="none">—</SelectItem>
                    {buses.map((b) => (
                      <SelectItem key={b.bus_id} value={b.bus_id}>
                        {b.bus_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Detected date</Label>
                <Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} className="min-w-0" aria-label="Detected date" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Depot</Label>
              <Input
                value={logForm.depot}
                onChange={(e) => setLogForm({ ...logForm, depot: e.target.value })}
                disabled={depotFromBusLocked}
                placeholder={depotFromBusLocked ? "Filled from bus" : "If no bus selected"}
                className={depotFromBusLocked ? "bg-muted" : ""}
              />
            </div>
            <p className="text-xs font-medium text-gray-500">Optional</p>
            <div className="space-y-2">
              <Label>Driver</Label>
              <Input className="font-mono text-xs" value={logForm.driver_id} onChange={(e) => setLogForm({ ...logForm, driver_id: e.target.value })} placeholder="License number" />
            </div>
            <div className="space-y-2">
              <Label>Incident ID</Label>
              <Input className="font-mono text-xs" value={logForm.related_incident_id} onChange={(e) => setLogForm({ ...logForm, related_incident_id: e.target.value })} placeholder="INC-…" />
            </div>
            <div className="space-y-2">
              <Label>Remarks</Label>
              <Input value={logForm.remarks} onChange={(e) => setLogForm({ ...logForm, remarks: e.target.value })} placeholder="Notes" />
            </div>
            <Collapsible open={logAdvancedOpen} onOpenChange={setLogAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" type="button" className="flex h-9 w-full items-center justify-between px-2 font-medium hover:bg-muted/80">
                  <span className="text-sm text-gray-700">More fields</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${logAdvancedOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Route ID</Label>
                    <Input className="font-mono text-xs" value={logForm.route_id} onChange={(e) => setLogForm({ ...logForm, route_id: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>Route name</Label>
                    <Input value={logForm.route_name} onChange={(e) => setLogForm({ ...logForm, route_name: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Trip ID</Label>
                    <Input className="font-mono text-xs" value={logForm.trip_id} onChange={(e) => setLogForm({ ...logForm, trip_id: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>Duty ID</Label>
                    <Input className="font-mono text-xs" value={logForm.duty_id} onChange={(e) => setLogForm({ ...logForm, duty_id: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2"><Label>Location</Label>
                  <Input value={logForm.location_text} onChange={(e) => setLogForm({ ...logForm, location_text: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Cause code</Label>
                    <Input className="font-mono text-xs" value={logForm.cause_code} onChange={(e) => setLogForm({ ...logForm, cause_code: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>Deductible</Label>
                    <Select value={logForm.deductible || "unset"} onValueChange={(v) => setLogForm({ ...logForm, deductible: v === "unset" ? "" : v })}>
                      <SelectTrigger className="w-full min-w-0"><SelectValue placeholder="Unset" /></SelectTrigger>
                      <SelectContent
                        position="popper"
                        sideOffset={6}
                        align="start"
                        collisionPadding={20}
                        className={logModalSelectContentClass}
                      >
                        <SelectItem value="unset">Unset</SelectItem>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <Button onClick={handleLog} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="log-inf-submit-btn">Log infraction</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
