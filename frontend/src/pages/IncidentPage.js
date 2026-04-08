import { useState, useEffect, useCallback, useMemo } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { formatDateIN } from "../lib/dates";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Card, CardContent } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from "../components/ui/dropdown-menu";
import {
  Plus,
  ClipboardList,
  UserPlus,
  Pencil,
  MoreHorizontal,
  PlayCircle,
  ArrowRightCircle,
  CheckCircle2,
  Lock,
  User,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

function localDatetimeInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocalValue(isoLike) {
  if (!isoLike) return "";
  const dt = new Date(isoLike);
  if (Number.isNaN(dt.getTime())) return "";
  return localDatetimeInputValue(dt);
}

const emptyForm = () => ({
  incident_type: "",
  description: "",
  occurred_at: localDatetimeInputValue(),
  vehicles_affected: [],
  vehicles_affected_count: 1,
  damage_summary: "",
  engineer_action: "",
  bus_id: "",
  driver_id: "",
  depot: "",
  route_name: "",
  route_id: "",
  trip_id: "",
  duty_id: "",
  location_text: "",
  telephonic_reference: "",
  infractions: [],
});

export default function IncidentPage() {
  const [incidents, setIncidents] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [listMeta, setListMeta] = useState({ total: 0, pages: 1, limit: 30 });
  const [buses, setBuses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editIncidentId, setEditIncidentId] = useState("");
  const [editForm, setEditForm] = useState({
    description: "",
    occurred_at: "",
    damage_summary: "",
    engineer_action: "",
    infractions: [],
  });
  const [form, setForm] = useState(emptyForm);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const [filterBusId, setFilterBusId] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [assignTeam, setAssignTeam] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [catLoading, setCatLoading] = useState(false);

  const typeLabels = useMemo(() => {
    const m = {};
    (meta?.incident_types || []).forEach((t) => {
      m[t.code] = t.label;
    });
    return m;
  }, [meta]);

  const incidentTypeGroups = useMemo(() => {
    const types = meta?.incident_types || [];
    const order = ["alerts", "speed_rules", "reports", "extended"];
    const labels = {
      alerts: "Alert types (dashboard / email)",
      speed_rules: "Speed rules",
      reports: "Breakdown, accident & trips",
      extended: "Other incidents",
    };
    const map = new Map();
    order.forEach((g) => map.set(g, []));
    types.forEach((t) => {
      const g = t.ui_group && map.has(t.ui_group) ? t.ui_group : "extended";
      map.get(g).push(t);
    });
    return order
      .filter((g) => (map.get(g) || []).length > 0)
      .map((g) => ({ key: g, label: labels[g] || g, items: map.get(g) }));
  }, [meta?.incident_types]);

  const loadMeta = useCallback(async () => {
    try {
      setCatLoading(true);
      const [{ data: metaData }, { data: catData }] = await Promise.all([
        API.get(Endpoints.incidents.meta()),
        API.get(Endpoints.infractions.catalogue()),
      ]);
      setMeta(metaData);
      setCatalogue(catData.items || []);
    } catch {
      toast.error("Could not load incident metadata");
    } finally {
      setCatLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = buildQuery({
        status: filterStatus,
        depot: filterDepot,
        bus_id: filterBusId,
        severity: filterSeverity,
        incident_type: filterType,
        date_from: filterDateFrom,
        date_to: filterDateTo,
        page,
        limit: listMeta.limit,
      });
      const [i, busItems, driverItems] = await Promise.all([
        API.get(Endpoints.incidents.list(), { params }),
        fetchAllPaginated(Endpoints.masters.buses.list(), {}),
        fetchAllPaginated(Endpoints.masters.drivers.list(), {}),
      ]);
      const iu = unwrapListResponse(i.data);
      setIncidents(iu.items);
      setListMeta({ total: iu.total, pages: iu.pages, limit: iu.limit });
      setBuses(busItems);
      setDrivers(driverItems);
    } catch (err) {
      const msg = formatApiError(err.response?.data?.detail) || err.message || "Could not load incidents";
      setFetchError(msg);
      toast.error(msg);
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterDepot, filterBusId, filterSeverity, filterType, filterDateFrom, filterDateTo, page, listMeta.limit]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterDepot, filterBusId, filterSeverity, filterType, filterDateFrom, filterDateTo, listMeta.limit]);

  const handleAdd = async () => {
    if (!form.incident_type || !form.description.trim()) {
      toast.error("Type and description are required");
      return;
    }
    if (!form.occurred_at || !String(form.occurred_at).trim()) {
      toast.error("Occurred time is required");
      return;
    }
    try {
      const vehicles = Array.isArray(form.vehicles_affected) ? form.vehicles_affected.filter(Boolean) : [];
      const vehiclesCount = vehicles.length || (form.bus_id ? 1 : Number(form.vehicles_affected_count) || 1);
      await API.post(Endpoints.incidents.create(), {
        ...form,
        occurred_at: String(form.occurred_at).trim(),
        vehicles_affected: vehicles,
        vehicles_affected_count: vehiclesCount,
        damage_summary: form.damage_summary || "",
        engineer_action: form.engineer_action || "",
        infractions: form.infractions || [],
      });
      toast.success("Incident reported");
      setOpen(false);
      setForm(emptyForm());
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const setStatus = async (id, status) => {
    try {
      await API.put(Endpoints.incidents.update(id), { status });
      toast.success("Status updated");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const openDetail = (inc) => {
    setSelected(inc);
    setNoteText("");
    setDetailOpen(true);
  };

  const openAssign = (inc) => {
    setSelected(inc);
    setAssignTeam(inc.assigned_team || "");
    setAssignTo(inc.assigned_to || "");
    setAssignOpen(true);
  };

  const saveAssign = async () => {
    if (!selected) return;
    try {
      await API.put(Endpoints.incidents.update(selected.id), {
        assigned_team: assignTeam,
        assigned_to: assignTo,
      });
      toast.success("Assignment saved");
      setAssignOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const addNote = async () => {
    if (!selected || !noteText.trim()) return;
    try {
      await API.post(Endpoints.incidents.addNote(selected.id), { note: noteText.trim() });
      toast.success("Note added");
      setNoteText("");
      const { data } = await API.get(Endpoints.incidents.get(selected.id));
      setSelected(data);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const handleCloseInfraction = async (idx) => {
    if (!selected) return;
    const remarks = prompt("Enter closure remarks:");
    if (remarks === null) return;
    try {
      await API.put(`${Endpoints.incidents.get(selected.id)}/infractions/${idx}/close`, { close_remarks: remarks });
      toast.success("Infraction closed");
      const { data } = await API.get(Endpoints.incidents.get(selected.id));
      setSelected(data);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const openEdit = (inc) => {
    setEditIncidentId(inc.id);
    setEditForm({
      description: inc.description || "",
      occurred_at: toDatetimeLocalValue(inc.occurred_at || inc.created_at),
      vehicles_affected_count: String(inc.vehicles_affected_count || 1),
      damage_summary: inc.damage_summary || "",
      engineer_action: inc.engineer_action || "",
      infractions: Array.isArray(inc.infractions) ? inc.infractions.map(inf => ({
        infraction_code: inf.infraction_code,
        description: inf.description
      })) : [],
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editIncidentId) return;
    if (!editForm.description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (!editForm.occurred_at) {
      toast.error("Occurred time is required");
      return;
    }
    try {
      await API.put(Endpoints.incidents.update(editIncidentId), {
        description: editForm.description.trim(),
        occurred_at: editForm.occurred_at,
        vehicles_affected_count: Number(editForm.vehicles_affected_count) || 1,
        damage_summary: editForm.damage_summary || "",
        engineer_action: editForm.engineer_action || "",
        infractions: editForm.infractions || [],
      });
      toast.success("Incident updated");
      setEditOpen(false);
      setEditIncidentId("");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const severityColor = (s) =>
    ({
      high: "bg-red-100 text-red-700 hover:bg-red-100",
      medium: "bg-amber-100 text-amber-800 hover:bg-amber-100",
      low: "bg-blue-100 text-blue-700 hover:bg-blue-100",
    }[s] || "");

  const statusColor = (s) =>
    ({
      open: "bg-red-100 text-red-700",
      investigating: "bg-amber-100 text-amber-800",
      assigned: "bg-indigo-100 text-indigo-800",
      in_progress: "bg-cyan-100 text-cyan-800",
      resolved: "bg-green-100 text-green-700",
      closed: "bg-gray-200 text-gray-700",
    }[s] || "");

  const depotsFromBuses = useMemo(() => {
    const s = new Set();
    buses.forEach((b) => {
      if (b.depot) s.add(b.depot);
    });
    return Array.from(s).sort();
  }, [buses]);

  const finalizedDeduction = (inc) => {
    if ((inc?.status || "") !== "closed") return "—";
    const total = (inc?.infractions || []).reduce((sum, inf) => {
      if (inf?.deductible === false) return sum;
      return sum + Number(inf?.amount_current ?? inf?.amount_snapshot ?? inf?.amount ?? 0);
    }, 0);
    return `Rs.${total.toLocaleString()}`;
  };

  return (
    <div data-testid="incident-page">
      <div className="page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">Incidents</h1>
        <Button
          onClick={() => { setForm(emptyForm()); setOpen(true); }}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="report-incident-btn"
        >
          <Plus size={16} className="mr-1.5" /> Report incident
        </Button>
      </div>

      <p className="text-sm text-gray-600 mb-4 max-w-4xl">Log, assign, and track incident cases.</p>

      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-gray-500">
            Total incidents: <span className="font-semibold text-gray-800">{listMeta.total}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Status</Label>
              <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[160px]" data-testid="incident-filter-status"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(meta?.statuses || ["open", "investigating", "resolved", "closed"]).map((st) => (
                    <SelectItem key={st} value={st}>{st.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Depot</Label>
              <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setFilterBusId(""); }}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {depotsFromBuses.map((dep) => <SelectItem key={dep} value={dep}>{dep}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Bus</Label>
              <Select value={filterBusId || "all"} onValueChange={(v) => setFilterBusId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(filterDepot ? buses.filter((x) => x.depot === filterDepot) : buses).map((x) => (
                    <SelectItem key={x.bus_id} value={x.bus_id}>{x.bus_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Severity</Label>
              <Select value={filterSeverity || "all"} onValueChange={(v) => setFilterSeverity(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(meta?.severities || ["low", "medium", "high"]).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Type code</Label>
              <Input className="w-28 font-mono text-xs h-9" value={filterType} onChange={(e) => setFilterType(e.target.value)} placeholder="Code" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">From</Label>
              <Input type="date" className="w-36 h-9" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">To</Label>
              <Input type="date" className="w-36 h-9" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
        </div>

        <Card className="border-gray-200 shadow-sm overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-max text-[12px]">
                <TableHeader>
                  <TableRow className="table-header">
                    <TableHead>ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Depot</TableHead>
                    <TableHead>Infractions</TableHead>
                    <TableHead>Bus</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right w-[108px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableLoadRows
                    colSpan={11}
                    loading={loading}
                    error={fetchError}
                    onRetry={load}
                    isEmpty={incidents.length === 0}
                    emptyMessage="No incidents"
                  >
                    {incidents.map((inc) => (
                      <TableRow key={inc.id} className="hover:bg-gray-50" data-testid={`incident-row-${inc.id}`}>
                        <TableCell className="font-mono whitespace-nowrap">{inc.id}</TableCell>
                        <TableCell className="py-3">
                          <span className="font-medium text-gray-900 block leading-snug">{typeLabels[inc.incident_type] || inc.incident_type}</span>
                          <span className="block text-[10px] text-gray-500 font-mono mt-0.5">{inc.incident_type}</span>
                        </TableCell>
                        <TableCell className="capitalize">{inc.channel || "—"}</TableCell>
                        <TableCell>{inc.depot || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(inc.infractions || []).map(inf => (
                              <Badge key={inf.infraction_code} variant="outline" className="text-[10px] py-0 border-amber-200 bg-amber-50 text-amber-800">
                                {inf.infraction_code}
                              </Badge>
                            ))}
                            {(!inc.infractions || inc.infractions.length === 0) && <span className="text-gray-300">—</span>}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono whitespace-nowrap">{inc.bus_id || "—"}</TableCell>
                        <TableCell><Badge className={cn("px-2 py-0.5", severityColor(inc.severity))}>{inc.severity}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={cn("px-2 py-0.5", statusColor(inc.status))}>{inc.status?.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-gray-500 whitespace-nowrap text-[12px]">{formatDateIN(inc.created_at?.slice(0, 10))}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">{finalizedDeduction(inc)}</TableCell>
                        <TableCell className="text-right p-2">
                           <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 text-xs text-gray-700">
                              <DropdownMenuItem onClick={() => openDetail(inc)} className="gap-2"><ClipboardList className="h-4 w-4 opacity-70" /> Details & Log</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAssign(inc)} className="gap-2"><UserPlus className="h-4 w-4 opacity-70" /> Assign team</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(inc)} className="gap-2"><Pencil className="h-4 w-4 opacity-70" /> Edit metadata</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger className="gap-2"><PlayCircle className="h-4 w-4 opacity-70" /> Update status</DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                  <DropdownMenuSubContent className="text-xs">
                                    {inc.status === 'open' && <DropdownMenuItem onClick={() => setStatus(inc.id, 'investigating')}>Start investigation</DropdownMenuItem>}
                                    {inc.status !== 'resolved' && inc.status !== 'closed' && <DropdownMenuItem onClick={() => setStatus(inc.id, 'resolved')}>Mark resolved</DropdownMenuItem>}
                                    {inc.status === 'resolved' && <DropdownMenuItem onClick={() => setStatus(inc.id, 'closed')}>Close case</DropdownMenuItem>}
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
            <TablePaginationBar 
              page={page} 
              pages={listMeta.pages} 
              total={listMeta.total} 
              limit={listMeta.limit} 
              onPageChange={setPage} 
              onLimitChange={(l) => setListMeta(prev => ({ ...prev, limit: l }))}
            />
          </CardContent>
        </Card>
      </div>

       <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto" data-testid="incident-dialog">
          <DialogHeader><DialogTitle>Report incident</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Incident Type</Label>
              <Select value={form.incident_type} onValueChange={(v) => setForm({ ...form, incident_type: v })} disabled={!meta?.incident_types?.length}>
                <SelectTrigger data-testid="incident-type-select">
                  <SelectValue placeholder={meta?.incident_types?.length ? "Select type" : "Loading types..."} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {incidentTypeGroups.map(({ key, label, items }) => (
                    <SelectGroup key={key}>
                      <SelectLabel className="text-[10px] text-gray-400 uppercase border-b pb-1 mb-1">{label}</SelectLabel>
                      {items.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(meta?.channels || ["web", "telephonic", "mobile", "other"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger data-testid="incident-severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="What happened..." />
            </div>

            {/* Unified Infraction Linker */}
            <div className="rounded-md border border-amber-200 bg-amber-50/20 p-3 space-y-3">
              <Label className="text-amber-900 font-bold flex items-center gap-2"> <ClipboardList className="h-4 w-4" /> Link Penalties </Label>
              <div className="space-y-2">
                <Select value="none" onValueChange={(v) => {
                    if (!v || v === "none") return;
                    const cat = catalogue.find(c => c.code === v);
                    if (!cat) return;
                    if ((form.infractions || []).some(x => x.infraction_code === v)) return;
                    setForm({ ...form, infractions: [...(form.infractions || []), { infraction_code: v, description: cat.description }] });
                  }}>
                  <SelectTrigger className="h-8 text-xs border-amber-200 bg-white"><SelectValue placeholder="Add infraction code..." /></SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="none">— Select Code —</SelectItem>
                    {catalogue.map(c => (
                      <SelectItem key={c.code} value={c.code} className="text-[11px]">
                         <span className="font-mono font-bold mr-2">{c.code}</span> — {c.description.slice(0, 40)}...
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(form.infractions || []).map(inf => (
                    <Badge key={inf.infraction_code} className="bg-amber-100 text-amber-900 border-amber-200 gap-2 px-2 py-1">
                      {inf.infraction_code}
                      <button type="button" onClick={() => setForm({ ...form, infractions: form.infractions.filter(x => x.infraction_code !== inf.infraction_code) })}>×</button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Occurrence Time</Label>
                <Input type="datetime-local" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Driver Code</Label>
                <Select value={form.driver_id || "none"} onValueChange={(v) => setForm({ ...form, driver_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {drivers.map(dr => <SelectItem key={dr.license_number} value={dr.license_number}>{dr.name} ({dr.license_number})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Depot</Label>
                <Select value={form.depot || "none"} onValueChange={(v) => setForm({ ...form, depot: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {depotsFromBuses.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bus ID</Label>
                <Select value={form.bus_id || "none"} onValueChange={(v) => setForm({ ...form, bus_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(form.depot ? buses.filter(b => b.depot === form.depot) : buses).map(b => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} className="bg-[#C8102E] hover:bg-[#A50E25]">Report Incident</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign team — {selected?.id}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-3">
             <div className="p-3 bg-gray-50 rounded border text-[11px] leading-relaxed text-gray-600 italic">
               Select the team responsible for managing this incident. Escalation emails will be sent to members of the selected team.
             </div>
             <div className="space-y-2">
                <Label>Resolution Team</Label>
                <Select value={assignTeam || "none"} onValueChange={(v) => setAssignTeam(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent>
                    {(meta?.assignment_teams || ["depot_manager", "safety_cell", "technical_team"]).map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>
             <div className="space-y-2">
                <Label>Individual Assignee (Optional)</Label>
                <Input value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="Personnel name" className="text-sm" />
             </div>
          </div>
          <DialogFooter><Button onClick={saveAssign} className="w-full bg-[#1F2937]">Confirm Assignment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Incident Meta — {editIncidentId}</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-4">
            <div className="space-y-2">
              <Label>Incident Description</Label>
              <Textarea rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/20 p-4 space-y-3">
              <Label className="text-amber-900 font-bold flex items-center gap-2 px-1"><ClipboardList className="h-4 w-4" /> Manage Penalties</Label>
              <div className="space-y-3">
                <Select value="none" onValueChange={(v) => {
                    if (!v || v === "none") return;
                    const cat = catalogue.find(c => c.code === v);
                    if (!cat) return;
                    if (editForm.infractions?.some(x => x.infraction_code === v)) return;
                    setEditForm({ ...editForm, infractions: [...(editForm.infractions || []), { infraction_code: v, description: cat.description }] });
                  }}>
                  <SelectTrigger className="h-9 text-xs border-amber-200 bg-white"><SelectValue placeholder="Add penalty code..." /></SelectTrigger>
                  <SelectContent className="max-h-[240px]">
                    {catalogue.map(c => (
                      <SelectItem key={c.code} value={c.code} className="text-[11px] py-1.5 border-b border-gray-50 last:border-0 text-gray-700">
                         <div className="flex flex-col">
                            <span className="font-mono font-bold text-amber-800">{c.code} — ₹{c.amount}</span>
                            <span className="text-gray-500 text-[10px] leading-snug">{c.description}</span>
                         </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(editForm.infractions || []).map(inf => (
                    <Badge key={inf.infraction_code} className="bg-white text-gray-700 border-amber-200 px-2 py-1 gap-2 shadow-sm font-medium">
                      <span className="font-mono text-amber-900">{inf.infraction_code}</span>
                      <button type="button" onClick={() => setEditForm({ ...editForm, infractions: editForm.infractions.filter(x => x.infraction_code !== inf.infraction_code) })}
                        className="text-red-400 hover:text-red-600 text-lg leading-[0]">×</button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Occurrence Time</Label>
                <Input type="datetime-local" value={editForm.occurred_at} onChange={(e) => setEditForm({ ...editForm, occurred_at: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Affected Count</Label>
                <Input type="number" min="1" value={editForm.vehicles_affected_count} onChange={(e) => setEditForm({ ...editForm, vehicles_affected_count: e.target.value })} />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Damage Summary</Label>
                <Textarea rows={2} value={editForm.damage_summary} onChange={(e) => setEditForm({ ...editForm, damage_summary: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Engineer Action</Label>
                <Textarea rows={2} value={editForm.engineer_action} onChange={(e) => setEditForm({ ...editForm, engineer_action: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter className="mt-6 border-t pt-4">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} className="bg-[#1F2937]">Update Case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto p-0 border-none bg-gray-50 shadow-2xl">
          <div className="flex flex-col md:flex-row h-full min-h-[600px]">
            <div className="flex-1 p-8 bg-white overflow-y-auto">
               <DialogHeader className="mb-8 p-0">
                 <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-gray-400 border-gray-200"># {selected?.id}</Badge>
                    <DialogTitle className="text-2xl font-black tracking-tight text-gray-900">Incident Workspace</DialogTitle>
                 </div>
               </DialogHeader>

               <div className="grid grid-cols-2 gap-x-12 gap-y-6 mb-10">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Category</Label>
                    <p className="text-base font-bold text-gray-800">{typeLabels[selected?.incident_type] || selected?.incident_type}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Status</Label>
                    <div><Badge className={cn("px-2.5 py-1 text-[10px] uppercase font-bold", statusColor(selected?.status))}>{selected?.status}</Badge></div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Registration</Label>
                    <p className="font-mono text-base font-bold text-gray-700">{selected?.bus_id || "NOT-SET"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Depot Context</Label>
                    <p className="text-base font-bold text-gray-700">{selected?.depot || "General Pool"}</p>
                  </div>
               </div>

               <div className="mb-10">
                  <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black block mb-3">Incident Narrative</Label>
                  <div className="p-5 bg-gray-50 rounded-xl text-sm text-gray-700 leading-relaxed border border-gray-100 italic shadow-inner">
                    "{selected?.description || "No description provided."}"
                  </div>
               </div>

               <div className="space-y-5">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h4 className="text-sm font-black text-amber-900 flex items-center gap-2"> <ClipboardList className="h-4 w-4" /> Linked Penalties</h4>
                    <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-3 py-1 rounded-full border border-amber-100">Flattened Deductions</span>
                  </div>
                  <div className="grid gap-4">
                    {(selected?.infractions || []).map((inf, idx) => (
                      <div key={idx} className="bg-white border border-amber-100 rounded-xl p-4 shadow-sm flex items-start justify-between hover:shadow-md transition-shadow">
                         <div className="space-y-2 flex-1 pr-6">
                           <div className="flex items-center gap-2">
                             <Badge className="font-mono text-[10px] bg-amber-600 text-white border-none px-2">{inf.infraction_code}</Badge>
                             <Badge variant="outline" className={cn("text-[9px] font-black h-5 px-2 tracking-tight", inf.status === 'closed' ? "text-green-700 border-green-200 bg-green-50" : "text-amber-700 border-amber-200 bg-amber-50")}>
                                {inf.status?.toUpperCase() || 'OPEN'}
                             </Badge>
                           </div>
                           <p className="text-xs text-gray-800 font-bold leading-snug">{inf.description}</p>
                           <div className="flex items-center gap-3">
                              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Fine Amount:</span>
                              <span className="text-sm font-black text-gray-900 font-mono">₹{(inf.amount_current || inf.amount).toLocaleString()}</span>
                           </div>
                           {inf.closed_at && (
                             <div className="mt-3 pt-3 border-t border-dashed border-gray-100">
                                <div className="flex items-center gap-2 text-green-700">
                                   <CheckCircle2 className="h-3 w-3" />
                                   <span className="text-[10px] font-bold">Verified by Depot on {inf.closed_at.slice(0,10)}</span>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1 pl-5">Remarks: {inf.close_remarks}</p>
                             </div>
                           )}
                         </div>
                         {inf.status !== 'closed' && (
                           <Button variant="outline" size="sm" className="h-8 text-[11px] border-amber-200 text-amber-700 hover:bg-amber-600 hover:text-white transition-colors shrink-0 font-black px-4" onClick={() => handleCloseInfraction(idx)}>
                             Verify & Resolve
                           </Button>
                         )}
                      </div>
                    ))}
                    {(!selected?.infractions || selected.infractions.length === 0) && (
                      <div className="py-12 text-center border-2 border-dashed border-gray-100 rounded-2xl text-gray-400 text-xs italic">
                         No penalties attached to this instance.
                      </div>
                    )}
                  </div>
               </div>
            </div>

            {/* Right Column: Activity Stream */}
            <div className="w-full md:w-[360px] bg-gray-50 border-l border-gray-200 p-8 flex flex-col">
              <div className="flex items-center gap-2 mb-8 border-b border-gray-200 pb-4">
                 <h4 className="font-black text-xs uppercase tracking-[0.2em] text-gray-400">Activity Stream</h4>
              </div>
              <ul className="flex-1 space-y-8 overflow-y-auto pr-2 scrollbar-hide">
                {[...(selected?.activity_log || [])].reverse().map((e, idx) => (
                  <li key={idx} className="relative pl-6 border-l-2 border-gray-200 group">
                    <div className="absolute -left-[7px] top-0 w-3 h-3 rounded-full bg-white border-2 border-gray-300 group-hover:border-[#C8102E] transition-colors shadow-sm" />
                    <div className="text-[12px] font-black text-gray-900 leading-tight">{e.action}</div>
                    <div className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">{e.detail}</div>
                    <div className="text-[10px] text-gray-400 mt-2 uppercase font-black tracking-tighter flex items-center gap-2">
                       <User size={10} /> {e.by} <span className="opacity-30">|</span> <Clock size={10} /> {e.at?.split('T')[0]}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-8 pt-8 border-t border-gray-200 space-y-4">
                <Label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Internal Dispatch Note</Label>
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} className="text-xs bg-white border-none shadow-sm resize-none focus-visible:ring-1 focus-visible:ring-gray-300 p-3 rounded-lg" placeholder="Enter remarks for the log..." />
                <Button size="sm" className="w-full text-[11px] h-10 bg-gray-900 hover:bg-black text-white font-black uppercase tracking-widest border-none transition-all shadow-lg active:scale-95" onClick={addNote}>Post Entry</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

