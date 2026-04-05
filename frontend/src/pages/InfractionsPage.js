import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { formatDateIN } from "../lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Plus, Pencil, Trash2, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";
const catColors = {
  A: "bg-gray-100 text-gray-700", B: "bg-blue-100 text-blue-700",
  C: "bg-yellow-100 text-yellow-700", D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700", F: "bg-red-200 text-red-800",
  G: "bg-red-300 text-red-900"
};
const catAmounts = { A: 100, B: 500, C: 1000, D: 1500, E: 3000, F: 10000, G: 200000 };
const emptyForm = { code: "", category: "A", description: "", amount: 100, safety_flag: false, repeat_escalation: true, active: true };

export default function InfractionsPage() {
  const [catalogue, setCatalogue] = useState([]);
  const [logged, setLogged] = useState([]);
  const [tab, setTab] = useState("catalogue");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
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
  const [catPage, setCatPage] = useState(1);
  const [catMeta, setCatMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [logPage, setLogPage] = useState(1);
  const [logMeta, setLogMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);

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
  }, [dateFrom, dateTo, logDepot, logBusId, logCategory, logDriverId, logInfractionCode, logRouteId, logRouteName, logRelatedIncident, logPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setLogPage(1);
  }, [dateFrom, dateTo, logDepot, logBusId, logCategory, logDriverId, logInfractionCode, logRouteId, logRouteName, logRelatedIncident]);
  useEffect(() => {
    if (tab === "logged") loadLogged();
  }, [tab, loadLogged]);

  const handleSave = async () => {
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (editing) { await API.put(`/infractions/catalogue/${editing}`, payload); toast.success("Updated"); }
      else { await API.post("/infractions/catalogue", payload); toast.success("Added"); }
      setOpen(false); setEditing(null); setForm(emptyForm); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete?")) return;
    try { await API.delete(`/infractions/catalogue/${id}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleLog = async () => {
    if (!logForm.infraction_code) {
      toast.error("Select an infraction code");
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

  return (
    <div data-testid="infractions-page">
      <div className="page-header">
        <h1 className="page-title">Infractions</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLogOpen(true)} data-testid="log-infraction-btn">
            <FileText size={14} className="mr-1.5" /> Log Infraction
          </Button>
          <Button onClick={() => { setForm(emptyForm); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-infraction-btn">
            <Plus size={16} className="mr-1.5" /> Add to Catalogue
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4 max-w-4xl">
        Fine catalogue and <strong>logged penalties</strong> with depot, bus, route, and optional link to an incident. Operational cases stay on{" "}
        <Link to="/incidents" className="text-[#C8102E] font-medium hover:underline">
          Incidents
        </Link>
        . KPI-based amounts:{" "}
        <Link to="/gcc-kpi" className="text-[#C8102E] font-medium hover:underline">
          GCC KPI
        </Link>
        . Whole-period percentage totals:{" "}
        <Link to="/deductions" className="text-gray-700 underline hover:text-[#C8102E]">
          Deductions
        </Link>
        .
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
                <TableHead className="text-right">Amount (Rs)</TableHead><TableHead>Safety</TableHead><TableHead>Repeat Esc.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableLoadRows
                  colSpan={7}
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
                      <TableCell>{c.repeat_escalation ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setForm(c); setEditing(c.id); setOpen(true); }}><Pencil size={14} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}><Trash2 size={14} className="text-red-500" /></Button>
                        </div>
                      </TableCell>
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
          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase text-gray-500">Depot</span>
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
              <span className="text-xs font-medium uppercase text-gray-500">Bus</span>
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
              <span className="text-xs font-medium uppercase text-gray-500">Category</span>
              <Select value={logCategory || "all"} onValueChange={(v) => setLogCategory(v === "all" ? "" : v)}>
                <SelectTrigger className="w-24"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {Object.keys(catColors).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase text-gray-500">Driver ID</span>
              <Input value={logDriverId} onChange={(e) => setLogDriverId(e.target.value)} className="w-32 font-mono text-xs" placeholder="License" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase text-gray-500">Code</span>
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
              <span className="text-xs font-medium uppercase text-gray-500">Route ID</span>
              <Input value={logRouteId} onChange={(e) => setLogRouteId(e.target.value)} className="w-28 font-mono text-xs" placeholder="ID" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase text-gray-500">Route name</span>
              <Input value={logRouteName} onChange={(e) => setLogRouteName(e.target.value)} className="w-32 text-xs" placeholder="Contains" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase text-gray-500">Incident</span>
              <Input value={logRelatedIncident} onChange={(e) => setLogRelatedIncident(e.target.value)} className="w-36 font-mono text-xs" placeholder="INC-…" />
            </div>
            <Button onClick={loadLogged} variant="outline">
              Refresh
            </Button>
          </div>
          <Card className="border-gray-200 shadow-sm overflow-x-auto">
            <CardContent className="p-0 min-w-[1100px]">
              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>ID</TableHead><TableHead>Code</TableHead><TableHead>Cat</TableHead><TableHead>Depot</TableHead><TableHead>Bus</TableHead>
                  <TableHead>Route</TableHead><TableHead>Location</TableHead><TableHead>Rel. incident</TableHead>
                  <TableHead>Description</TableHead><TableHead className="text-right">Amt</TableHead><TableHead className="text-right">Snap</TableHead><TableHead>Date</TableHead><TableHead>By</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableLoadRows
                    colSpan={13}
                    loading={logLoading}
                    error={logError}
                    onRetry={loadLogged}
                    isEmpty={logged.length === 0}
                    emptyMessage="No infractions logged"
                  >
                    {logged.map((l) => (
                      <TableRow key={l.id} className="hover:bg-[#FAFAFA]">
                        <TableCell className="font-mono text-xs whitespace-nowrap">{l.id}</TableCell>
                        <TableCell className="font-mono">{l.infraction_code}</TableCell>
                        <TableCell><Badge className={`${catColors[l.category]} hover:${catColors[l.category]}`}>{l.category}</Badge></TableCell>
                        <TableCell className="text-sm max-w-[100px] truncate">{l.depot || "—"}</TableCell>
                        <TableCell className="font-mono">{l.bus_id || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[120px]">
                          {l.route_id || l.route_name ? (
                            <>
                              {l.route_id ? <span className="font-mono block">{l.route_id}</span> : null}
                              {l.route_name ? <span className="text-gray-600 truncate block">{l.route_name}</span> : null}
                            </>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[100px] truncate">{l.location_text || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{l.related_incident_id || "—"}</TableCell>
                        <TableCell className="text-sm max-w-[160px]">{l.description}</TableCell>
                        <TableCell className="text-right font-mono text-[#DC2626] whitespace-nowrap">Rs.{l.amount?.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-gray-600 text-xs whitespace-nowrap">
                          {l.amount_snapshot != null ? `Rs.${Number(l.amount_snapshot).toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDateIN(l.date)}</TableCell>
                        <TableCell className="text-sm max-w-[80px] truncate">{l.logged_by}</TableCell>
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
        </>
      )}

      {/* Add/Edit Catalogue Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="infraction-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Infraction" : "Add Infraction to Catalogue"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. A01" data-testid="inf-code" /></div>
              <div className="space-y-2"><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v, amount: catAmounts[v] || form.amount })}>
                  <SelectTrigger data-testid="inf-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{["A","B","C","D","E","F","G"].map(c => <SelectItem key={c} value={c}>Cat {c} (Rs.{catAmounts[c]?.toLocaleString()})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="inf-description" /></div>
            <div className="space-y-2"><Label>Amount (Rs)</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="inf-amount" /></div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2"><Switch checked={form.safety_flag} onCheckedChange={(v) => setForm({ ...form, safety_flag: v })} data-testid="inf-safety" /><Label>Safety Flag</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.repeat_escalation} onCheckedChange={(v) => setForm({ ...form, repeat_escalation: v })} /><Label>Repeat Escalation</Label></div>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="inf-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Infraction Dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="log-infraction-dialog">
          <DialogHeader><DialogTitle>Log Infraction</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Link to an incident when the same event is tracked there:{" "}
              <Link to="/incidents" className="text-[#C8102E] font-medium hover:underline">Incidents</Link>
              .
            </p>
            <div className="space-y-2"><Label>Infraction code</Label>
              <Select value={logForm.infraction_code} onValueChange={(v) => setLogForm({ ...logForm, infraction_code: v })}>
                <SelectTrigger data-testid="log-inf-code"><SelectValue placeholder="Select code" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(catalogueAll.length ? catalogueAll : catalogue).map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.code} — {c.description} (Rs.{c.amount})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Bus</Label>
                <Select value={logForm.bus_id || "none"} onValueChange={(v) => setLogForm({ ...logForm, bus_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Driver (license)</Label>
                <Input className="font-mono text-xs" value={logForm.driver_id} onChange={(e) => setLogForm({ ...logForm, driver_id: e.target.value })} placeholder="DRV-…" />
              </div>
              <div className="space-y-2"><Label>Depot</Label>
                <Input value={logForm.depot} onChange={(e) => setLogForm({ ...logForm, depot: e.target.value })} placeholder="Optional; must match bus if both set" />
              </div>
            </div>
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
                  <SelectTrigger><SelectValue placeholder="Unset" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Unset</SelectItem>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Related incident ID</Label>
              <Input className="font-mono text-xs" value={logForm.related_incident_id} onChange={(e) => setLogForm({ ...logForm, related_incident_id: e.target.value })} placeholder="INC-…" />
            </div>
            <div className="space-y-2"><Label>Remarks</Label><Input value={logForm.remarks} onChange={(e) => setLogForm({ ...logForm, remarks: e.target.value })} /></div>
            <Button onClick={handleLog} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="log-inf-submit-btn">Log Infraction</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
