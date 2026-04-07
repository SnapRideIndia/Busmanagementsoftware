import { useState, useEffect, useCallback, useMemo } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { formatDateIN } from "../lib/dates";
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
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Plus,
  ClipboardList,
  UserPlus,
  MoreHorizontal,
  PlayCircle,
  ArrowRightCircle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

function localDatetimeInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  related_infraction_id: "",
  severity: "medium",
  channel: "web",
  telephonic_reference: "",
});

export default function IncidentPage() {
  const [incidents, setIncidents] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [listMeta, setListMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [buses, setBuses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selected, setSelected] = useState(null);
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
      const { data } = await API.get("/incidents/meta");
      setMeta(data);
    } catch {
      toast.error("Could not load incident metadata");
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
        limit: 20,
      });
      const [i, busItems, driverItems] = await Promise.all([
        API.get("/incidents", { params }),
        fetchAllPaginated("/buses", {}),
        fetchAllPaginated("/drivers", {}),
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
  }, [filterStatus, filterDepot, filterBusId, filterSeverity, filterType, filterDateFrom, filterDateTo, page]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterDepot, filterBusId, filterSeverity, filterType, filterDateFrom, filterDateTo]);

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
      await API.post("/incidents", {
        ...form,
        occurred_at: String(form.occurred_at).trim(),
        vehicles_affected: vehicles,
        vehicles_affected_count: vehiclesCount,
        damage_summary: form.damage_summary || "",
        engineer_action: form.engineer_action || "",
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
      await API.put(`/incidents/${id}`, { status });
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
      await API.put(`/incidents/${selected.id}`, {
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
      await API.post(`/incidents/${selected.id}/notes`, { note: noteText.trim() });
      toast.success("Note added");
      setNoteText("");
      const { data } = await API.get(`/incidents/${selected.id}`);
      setSelected(data);
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

  return (
    <div data-testid="incident-page">
      <div className="page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">Incidents</h1>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="report-incident-btn"
        >
          <Plus size={16} className="mr-1.5" /> Report incident
        </Button>
      </div>

      <p className="text-sm text-gray-600 mb-4 max-w-4xl">Log, assign, and track incident cases.</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500 uppercase">Status</Label>
          <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[160px]" data-testid="incident-filter-status">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {(meta?.statuses || ["open", "investigating", "resolved"]).map((st) => (
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
              {[...new Set(buses.map((x) => x.depot).filter(Boolean))].sort().map((dep) => (
                <SelectItem key={dep} value={dep}>{dep}</SelectItem>
              ))}
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
          <Table className="min-w-max">
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Bus</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reported</TableHead>
                <TableHead>Resolved</TableHead>
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
                  <TableRow
                    key={inc.id}
                    className="hover:bg-gray-50"
                    data-testid={`incident-row-${inc.id}`}
                  >
                    <TableCell className="font-mono text-sm whitespace-nowrap">{inc.id}</TableCell>
                    <TableCell className="text-sm max-w-[200px]">
                      <span className="font-medium">{typeLabels[inc.incident_type] || inc.incident_type}</span>
                      <span className="block text-xs text-gray-500 font-mono">{inc.incident_type}</span>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{inc.channel || "—"}</TableCell>
                    <TableCell className="text-sm">{inc.depot || "—"}</TableCell>
                    <TableCell className="text-sm max-w-[120px] truncate whitespace-nowrap">{inc.assigned_team || "—"}</TableCell>
                    <TableCell className="font-mono text-sm whitespace-nowrap">{inc.bus_id || "—"}</TableCell>
                    <TableCell>
                      <Badge className={severityColor(inc.severity)}>{inc.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColor(inc.status)}>{inc.status?.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                      {formatDateIN(inc.created_at?.slice(0, 10))}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                      {(inc.status === "resolved" || inc.status === "closed")
                        ? formatDateIN((inc.resolved_at || inc.updated_at || "").slice(0, 10))
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right p-2">
                      <div className="inline-flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-600 hover:text-[#1F2937]"
                          onClick={() => openDetail(inc)}
                          title="Activity log & notes"
                          data-testid={`incident-log-${inc.id}`}
                        >
                          <ClipboardList className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-600 hover:text-[#1F2937]"
                          onClick={() => openAssign(inc)}
                          title="Assign team"
                          data-testid={`incident-assign-${inc.id}`}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-600 hover:text-[#1F2937]"
                              aria-label="Status actions"
                              data-testid={`incident-more-${inc.id}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel className="text-xs font-normal text-gray-500">
                              Update status
                            </DropdownMenuLabel>
                            {inc.status === "open" && (
                              <DropdownMenuItem
                                onClick={() => setStatus(inc.id, "investigating")}
                                className="gap-2"
                              >
                                <PlayCircle className="h-4 w-4 text-amber-600" />
                                Start investigation
                              </DropdownMenuItem>
                            )}
                            {(inc.status === "investigating" || inc.status === "assigned") && (
                              <DropdownMenuItem
                                onClick={() => setStatus(inc.id, "in_progress")}
                                className="gap-2"
                              >
                                <ArrowRightCircle className="h-4 w-4 text-cyan-600" />
                                Mark in progress
                              </DropdownMenuItem>
                            )}
                            {inc.status !== "resolved" && inc.status !== "closed" && (
                              <DropdownMenuItem
                                onClick={() => setStatus(inc.id, "resolved")}
                                className="gap-2"
                              >
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Mark resolved
                              </DropdownMenuItem>
                            )}
                            {inc.status === "resolved" && (
                              <DropdownMenuItem
                                onClick={() => setStatus(inc.id, "closed")}
                                className="gap-2"
                              >
                                <Lock className="h-4 w-4 text-gray-600" />
                                Close case
                              </DropdownMenuItem>
                            )}
                            {inc.status === "closed" && (
                              <div className="px-2 py-1.5 text-sm text-gray-400">Case closed</div>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={listMeta.pages} total={listMeta.total} limit={listMeta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="incident-dialog">
          <DialogHeader>
            <DialogTitle>Report incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.incident_type}
                onValueChange={(v) => setForm({ ...form, incident_type: v })}
                disabled={!meta?.incident_types?.length}
              >
                <SelectTrigger data-testid="incident-type-select">
                  <SelectValue
                    placeholder={meta?.incident_types?.length ? "Select type" : "Loading types…"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-[min(24rem,70vh)]">
                  {incidentTypeGroups.map(({ key, label, items }) => (
                    <SelectGroup key={key}>
                      <SelectLabel className="text-xs font-normal text-gray-500">{label}</SelectLabel>
                      {items.map((t) => (
                        <SelectItem key={t.code} value={t.code}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select
                  value={form.channel}
                  onValueChange={(v) => setForm({ ...form, channel: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.channels || ["web", "telephonic", "other"]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) => setForm({ ...form, severity: v })}
                >
                  <SelectTrigger data-testid="incident-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.severities || ["low", "medium", "high"]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.channel === "telephonic" && (
              <div className="space-y-2">
                <Label>Telephonic reference (no full phone #)</Label>
                <Input
                  value={form.telephonic_reference}
                  onChange={(e) => setForm({ ...form, telephonic_reference: e.target.value })}
                  placeholder="e.g. control room ticket TC-1024"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
                data-testid="incident-description"
                placeholder="What happened, location context, immediate actions…"
              />
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Occurred</Label>
                  <Input
                    type="datetime-local"
                    value={form.occurred_at}
                    onChange={(e) => setForm({ ...form, occurred_at: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vehicles affected</Label>
                  <div className="text-sm text-gray-700">
                    {(Array.isArray(form.vehicles_affected) ? form.vehicles_affected.length : 0) || (form.bus_id ? 1 : 1)}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Add affected bus</Label>
                <Select
                  value="none"
                  onValueChange={(v) => {
                    if (!v || v === "none") return;
                    const cur = Array.isArray(form.vehicles_affected) ? form.vehicles_affected : [];
                    if (cur.includes(v)) return;
                    setForm({ ...form, vehicles_affected: [...cur, v] });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select bus" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[18rem]">
                    <SelectItem value="none">—</SelectItem>
                    {buses.map((b) => (
                      <SelectItem key={b.bus_id} value={b.bus_id}>
                        {b.bus_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(form.vehicles_affected || []).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {form.vehicles_affected.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="px-2 py-1 rounded-md border text-xs font-mono text-gray-700 hover:bg-gray-50"
                        title="Remove"
                        onClick={() =>
                          setForm({
                            ...form,
                            vehicles_affected: form.vehicles_affected.filter((x) => x !== id),
                          })
                        }
                      >
                        {id} ×
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Damage</Label>
                <Textarea value={form.damage_summary} onChange={(e) => setForm({ ...form, damage_summary: e.target.value })} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Engineer action</Label>
                <Textarea value={form.engineer_action} onChange={(e) => setForm({ ...form, engineer_action: e.target.value })} rows={2} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Depot</Label>
                <Select
                  value={form.depot || "none"}
                  onValueChange={(v) => setForm({ ...form, depot: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {depotsFromBuses.map((dep) => (
                      <SelectItem key={dep} value={dep}>
                        {dep}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Route name</Label>
                <Input
                  value={form.route_name}
                  onChange={(e) => setForm({ ...form, route_name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Route ID</Label>
                <Input
                  className="font-mono text-xs"
                  value={form.route_id}
                  onChange={(e) => setForm({ ...form, route_id: e.target.value })}
                  placeholder="Stable route id"
                />
              </div>
              <div className="space-y-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Trip ID</Label>
                <Input
                  className="font-mono text-xs"
                  value={form.trip_id}
                  onChange={(e) => setForm({ ...form, trip_id: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Duty ID</Label>
                <Input
                  className="font-mono text-xs"
                  value={form.duty_id}
                  onChange={(e) => setForm({ ...form, duty_id: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location / landmark</Label>
              <Input
                value={form.location_text}
                onChange={(e) => setForm({ ...form, location_text: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Bus</Label>
                <Select
                  value={form.bus_id || "none"}
                  onValueChange={(v) => setForm({ ...form, bus_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger data-testid="incident-bus">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {buses.map((b) => (
                      <SelectItem key={b.bus_id} value={b.bus_id}>
                        {b.bus_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Driver</Label>
                <Select
                  value={form.driver_id || "none"}
                  onValueChange={(v) => setForm({ ...form, driver_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {drivers.map((dr) => (
                      <SelectItem key={dr.license_number} value={dr.license_number}>
                        {dr.name} ({dr.license_number})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAdd} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="incident-save-btn">
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign team — {selected?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Team</Label>
              <Select value={assignTeam || "none"} onValueChange={(v) => setAssignTeam(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {(meta?.assignment_teams || []).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assignee name (optional)</Label>
              <Input value={assignTo} onChange={(e) => setAssignTo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveAssign}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity log — {selected?.id}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-600">{selected.description}</p>
              <ul className="border rounded-md divide-y max-h-64 overflow-y-auto">
                {(selected.activity_log || []).length === 0 && (
                  <li className="p-3 text-gray-400">No activity yet</li>
                )}
                {[...(selected.activity_log || [])].reverse().map((e, idx) => (
                  <li key={idx} className="p-3">
                    <div className="font-medium text-gray-800">{e.action}</div>
                    <div className="text-gray-600">{e.detail}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {e.by} · {e.at?.replace("T", " ").slice(0, 19)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="space-y-2">
                <Label>Add note</Label>
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} />
                <Button size="sm" variant="secondary" onClick={addNote}>
                  Add note
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


