import { useState, useEffect, useCallback, useMemo } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import ReportDownloads from "../components/ReportDownloads";
import { getBackendOrigin } from "../lib/api";
import { formatDateTimeINAmPm } from "../lib/dates";
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
  SelectItem,
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
  Copy,
  AlertTriangle,
  Timer,
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

// /** Unique resolve_days from linked infractions (catalogue / incident rows). */
// function resolveDaysSummary(inc) {
//   const rows = inc?.infractions || [];
//   if (!rows.length) return null;
//   const nums = [
//     ...new Set(
//       rows
//         .map((r) => r.resolve_days)
//         .filter((d) => d != null && d !== "")
//         .map((d) => Number(d))
//         .filter((n) => !Number.isNaN(n) && n > 0),
//     ),
//   ].sort((a, b) => a - b);
//   if (!nums.length) return null;
//   if (nums.length === 1) return `${nums[0]} day${nums[0] === 1 ? "" : "s"}`;
//   return nums.map((n) => `${n}d`).join(" · ");
// }

/** Blank / legacy generic: show O08 when code missing in stored data. */
function displayInfractionCode(code) {
  const s = code != null ? String(code).trim() : "";
  return s || "O08";
}

/** Schedule-S group (safety / operations / quality). API: schedule_group; legacy: pillar. */
function infractionScheduleGroupLabel(inf) {
  const p = String(inf?.schedule_group || inf?.pillar || "").toLowerCase();
  if (p === "safety") return "Safety";
  if (p === "quality") return "Quality";
  if (p === "operations") return "Operations";
  return "";
}

async function copyIncidentId(id) {
  const s = String(id || "");
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s);
    toast.success("Incident ID copied");
  } catch {
    toast.error("Could not copy ID");
  }
}

const emptyForm = () => ({
  description: "",
  severity: "medium",
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
  channel: "manual",
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
  const [filterOccurredFrom, setFilterOccurredFrom] = useState("");
  const [filterOccurredTo, setFilterOccurredTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [assignTeam, setAssignTeam] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [penaltyCategory, setPenaltyCategory] = useState("");
  const [penaltyCodePick, setPenaltyCodePick] = useState("none");
  const [editPenaltyCategory, setEditPenaltyCategory] = useState("");
  const [editPenaltyCodePick, setEditPenaltyCodePick] = useState("none");
  const [escalationData, setEscalationData] = useState(null);

  const typeLabels = useMemo(() => {
    const m = {};
    (meta?.incident_types || []).forEach((t) => {
      m[t.code] = t.label;
    });
    return m;
  }, [meta]);

  const loadMeta = useCallback(async () => {
    try {
      setCatLoading(true);
      const [{ data: metaData }, { data: catData }] = await Promise.all([
        API.get(Endpoints.incidents.meta()),
        API.get(Endpoints.infractions.catalogue(), { params: { limit: 100, page: 1 } }),
      ]);
      setMeta(metaData);
      setCatalogue(catData.items || []);
    } catch {
      toast.error("Could not load incident metadata");
    } finally {
      setCatLoading(false);
    }
    // Load escalation data
    try {
      const { data: escData } = await API.get("/escalation-check");
      setEscalationData(escData);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = buildQuery({
        search: filterSearch,
        status: filterStatus,
        depot: filterDepot,
        bus_id: filterBusId,
        severity: filterSeverity,
        incident_type: filterType,
        date_from: filterDateFrom,
        date_to: filterDateTo,
        occurred_from: filterOccurredFrom,
        occurred_to: filterOccurredTo,
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
  }, [
    filterStatus,
    filterSearch,
    filterDepot,
    filterBusId,
    filterSeverity,
    filterType,
    filterDateFrom,
    filterDateTo,
    filterOccurredFrom,
    filterOccurredTo,
    page,
    listMeta.limit,
  ]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [
    filterStatus,
    filterSearch,
    filterDepot,
    filterBusId,
    filterSeverity,
    filterType,
    filterDateFrom,
    filterDateTo,
    filterOccurredFrom,
    filterOccurredTo,
    listMeta.limit,
  ]);

  const infractionCategories = useMemo(() => {
    const s = new Set((catalogue || []).map((c) => c.category).filter(Boolean));
    return [...s].sort();
  }, [catalogue]);

  const codesForCategory = useMemo(() => {
    if (!penaltyCategory) return [];
    return (catalogue || [])
      .filter((c) => c.category === penaltyCategory)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [catalogue, penaltyCategory]);

  const editCodesForCategory = useMemo(() => {
    if (!editPenaltyCategory) return [];
    return (catalogue || [])
      .filter((c) => c.category === editPenaltyCategory)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [catalogue, editPenaltyCategory]);

  const handleAdd = async () => {
    if (!form.description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (!(form.infractions || []).length) {
      toast.error("Link at least one penalty: choose category, then code.");
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
        incident_type: "",
        occurred_at: String(form.occurred_at).trim(),
        vehicles_affected: vehicles,
        vehicles_affected_count: vehiclesCount,
        damage_summary: form.damage_summary || "",
        engineer_action: form.engineer_action || "",
        infractions: (form.infractions || []).map((x) => ({
          code: x.infraction_code,
          deductible: true,
        })),
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
      await API.put(Endpoints.incidents.closeInfraction(selected.id, idx), { close_remarks: remarks });
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
    setEditPenaltyCategory("");
    setEditPenaltyCodePick("none");
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
        infractions: (editForm.infractions || []).map((x) => ({
          code: x.infraction_code,
          deductible: true,
        })),
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
    const rows = inc?.infractions || [];
    if (!rows.length) return "—";
    const total = rows.reduce((sum, inf) => {
      if (inf?.deductible === false) return sum;
      return sum + Number(inf?.amount_current ?? inf?.amount_snapshot ?? inf?.amount ?? 0);
    }, 0);
    if (total === 0) return "—";
    const isClosed = inc?.status === "closed";
    return (
      <span className={isClosed ? "text-[#DC2626] font-bold" : "text-amber-700 font-medium"}>
        Rs.{total.toLocaleString()}
        {!isClosed && <span className="text-[9px] text-gray-400 ml-1">(est)</span>}
      </span>
    );
  };

  const reportParams = useMemo(
    () =>
      buildQuery({
        report_type: "incidents",
        status: filterStatus,
        depot: filterDepot,
        bus_id: filterBusId,
        severity: filterSeverity,
        incident_type: filterType,
        date_from: filterDateFrom,
        date_to: filterDateTo,
        occurred_from: filterOccurredFrom,
        occurred_to: filterOccurredTo,
      }),
    [
      filterStatus,
      filterDepot,
      filterBusId,
      filterSeverity,
      filterType,
      filterDateFrom,
      filterDateTo,
      filterOccurredFrom,
      filterOccurredTo,
    ],
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
    <div data-testid="incident-page">
      <div className="page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">Incidents</h1>
        <div className="flex items-center gap-2">
          <ReportDownloads pdfHref={reportPdfHref} excelHref={reportExcelHref} disabled={loading && incidents.length === 0} />
          <Button
            onClick={() => {
              setForm(emptyForm());
              setPenaltyCategory("");
              setPenaltyCodePick("none");
              setOpen(true);
            }}
            className="bg-[#C8102E] hover:bg-[#A50E25]"
            data-testid="report-incident-btn"
          >
            <Plus size={16} className="mr-1.5" /> Report incident
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4 max-w-4xl">Log, assign, and track incident cases.</p>

      <div className="space-y-4">
        {/* Auto-Escalation Alert Banner */}
        {escalationData && escalationData.total_overdue > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-4" data-testid="escalation-banner">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={20} className="text-[#DC2626]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#DC2626] mb-1">
                {escalationData.total_overdue} Overdue Infraction{escalationData.total_overdue !== 1 ? "s" : ""} — Auto-Escalation Active
              </p>
              <p className="text-xs text-red-700 mb-2">
                Total escalated penalty: <span className="font-bold font-mono">Rs.{escalationData.total_escalated_amount?.toLocaleString()}</span>
                {" "}— Penalties increase automatically for each resolve period that elapses without closure.
              </p>
              <div className="flex flex-wrap gap-2">
                {escalationData.items.slice(0, 6).map((e, i) => (
                  <Badge key={i} className="bg-red-100 text-red-800 text-[10px] px-2 py-0.5 gap-1 border border-red-200 hover:bg-red-100">
                    <span className="font-mono font-bold">{e.infraction_code}</span>
                    <span className="text-red-500">{e.category}&rarr;{e.escalated_category}</span>
                    <span className="font-bold">Rs.{e.escalated_amount.toLocaleString()}</span>
                    <span className="text-red-400">({e.overdue_days}d overdue)</span>
                  </Badge>
                ))}
                {escalationData.items.length > 6 && (
                  <Badge variant="outline" className="text-[10px] text-red-500 border-red-200">+{escalationData.items.length - 6} more</Badge>
                )}
              </div>
            </div>
          </div>
        )}

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
              <Label className="text-xs text-gray-500 uppercase">Reported from</Label>
              <Input type="date" className="w-36 h-9" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Reported to</Label>
              <Input type="date" className="w-36 h-9" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Occurred from</Label>
              <Input type="date" className="w-36 h-9" value={filterOccurredFrom} onChange={(e) => setFilterOccurredFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Occurred to</Label>
              <Input type="date" className="w-36 h-9" value={filterOccurredTo} onChange={(e) => setFilterOccurredTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase">Search</Label>
              <Input
                className="w-40 text-xs h-9"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="ID, type, code, bus..."
              />
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
                    {/* <TableHead className="whitespace-nowrap">Resolve days</TableHead> */}
                    <TableHead>Bus</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Occurred</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead>Resolved</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right w-[108px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableLoadRows
                    colSpan={14}
                    loading={loading}
                    error={fetchError}
                    onRetry={load}
                    isEmpty={incidents.length === 0}
                    emptyMessage="No incidents"
                  >
                    {incidents.map((inc) => (
                      <TableRow key={inc.id} className="hover:bg-gray-50" data-testid={`incident-row-${inc.id}`}>
                        <TableCell className="p-2 align-middle max-w-[120px]">
                          <div className="group flex items-center gap-0.5">
                            <span
                              className="truncate font-mono text-[11px] text-gray-800 min-w-0 flex-1"
                              title={inc.id}
                            >
                              {inc.id}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-900 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-gray-300"
                              aria-label="Copy incident ID"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyIncidentId(inc.id);
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="font-medium text-gray-900 block leading-snug">{typeLabels[inc.incident_type] || inc.incident_type}</span>
                          <span className="block text-[10px] text-gray-500 font-mono mt-0.5">{inc.incident_type}</span>
                        </TableCell>
                        <TableCell className="text-gray-800">
                          {inc.channel === "system" ? "System" : inc.channel === "manual" ? "Manual" : (inc.channel || "—")}
                        </TableCell>
                        <TableCell>{inc.depot || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(inc.infractions || []).map((inf, ixf) => {
                              const amt = Number(inf?.amount_current ?? inf?.amount_snapshot ?? inf?.amount ?? 0);
                              return (
                                <Badge
                                  key={`${displayInfractionCode(inf.infraction_code)}-${ixf}`}
                                  variant="outline"
                                  className="text-[10px] py-0.5 px-1.5 border-amber-200 bg-amber-50 text-amber-800 gap-1"
                                  title={`${inf.description || displayInfractionCode(inf.infraction_code)} — Rs.${amt.toLocaleString()}`}
                                >
                                  {displayInfractionCode(inf.infraction_code)}
                                  {amt > 0 && <span className="text-[9px] font-bold text-[#DC2626]">Rs.{amt.toLocaleString()}</span>}
                                </Badge>
                              );
                            })}
                            {(!inc.infractions || inc.infractions.length === 0) && <span className="text-gray-300">—</span>}
                          </div>
                        </TableCell>
                        {/* <TableCell className="text-gray-700 text-[11px] whitespace-nowrap max-w-[100px]" title={resolveDaysSummary(inc) || ""}>
                          {resolveDaysSummary(inc) ?? "—"}
                        </TableCell> */}
                        <TableCell className="font-mono whitespace-nowrap">{inc.bus_id || "—"}</TableCell>
                        <TableCell><Badge className={cn("px-2 py-0.5", severityColor(inc.severity))}>{inc.severity}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={cn("px-2 py-0.5", statusColor(inc.status))}>{inc.status?.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-gray-700 max-w-[140px] text-[11px] leading-snug">
                          {inc.assigned_team || inc.assigned_to ? (
                            <span className="block truncate" title={[inc.assigned_team, inc.assigned_to].filter(Boolean).join(" · ")}>
                              {[inc.assigned_team, inc.assigned_to].filter(Boolean).join(" · ") || "—"}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-gray-600 whitespace-nowrap text-[11px]">
                          {inc.occurred_at ? formatDateTimeINAmPm(inc.occurred_at) : "—"}
                        </TableCell>
                        <TableCell className="text-gray-500 whitespace-nowrap text-[12px]">{formatDateTimeINAmPm(inc.created_at)}</TableCell>
                        <TableCell className="text-gray-500 whitespace-nowrap text-[12px]">
                          {inc.resolved_at ? formatDateTimeINAmPm(inc.resolved_at) : (inc.closed_at ? formatDateTimeINAmPm(inc.closed_at) : "—")}
                        </TableCell>
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
                                  <DropdownMenuSubContent className="text-xs max-h-[280px] overflow-y-auto">
                                    {(meta?.statuses || ["open", "investigating", "assigned", "in_progress", "resolved", "closed"])
                                      .filter((st) => st && st !== inc.status)
                                      .map((st) => (
                                      <DropdownMenuItem key={st} onClick={() => setStatus(inc.id, st)}>
                                        Set to {String(st).replace(/_/g, " ")}
                                      </DropdownMenuItem>
                                    ))}
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

       <Dialog open={open} onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPenaltyCategory("");
          setPenaltyCodePick("none");
        }
      }}>
        <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto" data-testid="incident-dialog">
          <DialogHeader><DialogTitle>Report incident</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-[11px] text-gray-500 leading-snug">
              IRMS incident type is derived from the <span className="font-semibold text-gray-700">first linked penalty code</span> (Schedule-S). Link at least one code below.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(meta?.channels || ["manual", "system"]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c === "system" ? "System" : "Manual"}
                      </SelectItem>
                    ))}
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

            {/* Unified Infraction Linker — category then code (full catalogue; API default limit was 20). */}
            <div className="rounded-md border border-amber-200 bg-amber-50/20 p-3 space-y-3">
              <Label className="text-amber-900 font-bold flex items-center gap-2"> <ClipboardList className="h-4 w-4" /> Link penalties (Schedule-S) </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-gray-500 uppercase">Category</Label>
                  <Select
                    value={penaltyCategory || "none"}
                    onValueChange={(v) => {
                      const next = v === "none" ? "" : v;
                      setPenaltyCategory(next);
                      setPenaltyCodePick("none");
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs border-amber-200 bg-white"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Category —</SelectItem>
                      {infractionCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>Category {cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-gray-500 uppercase">Code</Label>
                  <Select
                    value={penaltyCodePick}
                    disabled={!penaltyCategory || catLoading}
                    onValueChange={(v) => {
                      setPenaltyCodePick("none");
                      if (!v || v === "none" || !penaltyCategory) return;
                      const cat = catalogue.find((c) => c.code === v);
                      if (!cat) return;
                      if ((form.infractions || []).some((x) => x.infraction_code === v)) return;
                      setForm({
                        ...form,
                        infractions: [...(form.infractions || []), { infraction_code: v, description: cat.description }],
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs border-amber-200 bg-white"><SelectValue placeholder={penaltyCategory ? "Add code…" : "Pick category first"} /></SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      <SelectItem value="none">— Code —</SelectItem>
                      {codesForCategory.map((c) => (
                        <SelectItem key={c.code} value={c.code} className="text-[11px]">
                          <span className="font-mono font-bold mr-1">{c.code}</span>
                          <span className="text-gray-600">{c.description.slice(0, 42)}{c.description.length > 42 ? "…" : ""}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(form.infractions || []).map(inf => (
                    <Badge key={`${displayInfractionCode(inf.infraction_code)}-${inf.infraction_code}`} className="bg-amber-100 text-amber-900 border-amber-200 gap-2 px-2 py-1">
                      {displayInfractionCode(inf.infraction_code)}
                      <button type="button" onClick={() => setForm({ ...form, infractions: form.infractions.filter(x => x.infraction_code !== inf.infraction_code) })}>×</button>
                    </Badge>
                  ))}
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

      <Dialog open={editOpen} onOpenChange={(o) => {
        setEditOpen(o);
        if (!o) {
          setEditPenaltyCategory("");
          setEditPenaltyCodePick("none");
        }
      }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Incident Meta — {editIncidentId}</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-4">
            <div className="space-y-2">
              <Label>Incident Description</Label>
              <Textarea rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/20 p-4 space-y-3">
              <Label className="text-amber-900 font-bold flex items-center gap-2 px-1"><ClipboardList className="h-4 w-4" /> Manage penalties</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-gray-500 uppercase">Category</Label>
                  <Select
                    value={editPenaltyCategory || "none"}
                    onValueChange={(v) => {
                      const next = v === "none" ? "" : v;
                      setEditPenaltyCategory(next);
                      setEditPenaltyCodePick("none");
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs border-amber-200 bg-white"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Category —</SelectItem>
                      {infractionCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>Category {cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-gray-500 uppercase">Code</Label>
                  <Select
                    value={editPenaltyCodePick}
                    disabled={!editPenaltyCategory}
                    onValueChange={(v) => {
                      setEditPenaltyCodePick("none");
                      if (!v || v === "none" || !editPenaltyCategory) return;
                      const cat = catalogue.find((c) => c.code === v);
                      if (!cat) return;
                      if (editForm.infractions?.some((x) => x.infraction_code === v)) return;
                      setEditForm({
                        ...editForm,
                        infractions: [...(editForm.infractions || []), { infraction_code: v, description: cat.description }],
                      });
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs border-amber-200 bg-white"><SelectValue placeholder={editPenaltyCategory ? "Add code…" : "Pick category first"} /></SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      <SelectItem value="none">— Code —</SelectItem>
                      {editCodesForCategory.map((c) => (
                        <SelectItem key={c.code} value={c.code} className="text-[11px] py-1.5 border-b border-gray-50 last:border-0 text-gray-700">
                          <div className="flex flex-col">
                            <span className="font-mono font-bold text-amber-800">{c.code} — ₹{c.amount}</span>
                            <span className="text-gray-500 text-[10px] leading-snug">{c.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(editForm.infractions || []).map(inf => (
                    <Badge key={`${displayInfractionCode(inf.infraction_code)}-${inf.infraction_code}`} className="bg-white text-gray-700 border-amber-200 px-2 py-1 gap-2 shadow-sm font-medium">
                      <span className="font-mono text-amber-900">{displayInfractionCode(inf.infraction_code)}</span>
                      <button type="button" onClick={() => setEditForm({ ...editForm, infractions: editForm.infractions.filter(x => x.infraction_code !== inf.infraction_code) })}
                        className="text-red-400 hover:text-red-600 text-lg leading-[0]">×</button>
                    </Badge>
                  ))}
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
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Occurred</Label>
                    <p className="text-sm font-semibold text-gray-800">{selected?.occurred_at ? formatDateTimeINAmPm(selected.occurred_at) : "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Reported</Label>
                    <p className="text-sm font-semibold text-gray-800">{selected?.created_at ? formatDateTimeINAmPm(selected.created_at) : "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Resolved</Label>
                    <p className="text-sm font-semibold text-gray-800">{selected?.resolved_at ? formatDateTimeINAmPm(selected.resolved_at) : "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Driver</Label>
                    <p className="font-mono text-sm font-bold text-gray-800">{selected?.driver_id || "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Route / duty / trip</Label>
                    <p className="text-xs text-gray-600">{selected?.route_name || "—"}</p>
                    <p className="text-xs text-gray-800 leading-relaxed font-mono">
                      {(selected?.route_id || "—")} · {(selected?.duty_id || "—")} · {(selected?.trip_id || "—")}
                    </p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Location</Label>
                    <p className="text-sm text-gray-800">{selected?.location_text || "—"}</p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Assignment</Label>
                    <p className="text-sm font-bold text-gray-800">
                      {(selected?.assigned_team || selected?.assigned_to)
                        ? [selected?.assigned_team, selected?.assigned_to].filter(Boolean).join(" · ")
                        : "—"}
                    </p>
                  </div>
                  {/* <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Resolve days (linked penalties)</Label>
                    <p className="text-sm font-semibold text-gray-800">{resolveDaysSummary(selected) ?? "—"}</p>
                  </div> */}
               </div>

               <div className="mb-10">
                  <Label className="text-[10px] text-gray-400 uppercase tracking-widest font-black block mb-3">Incident Narrative</Label>
                  <div className="p-5 bg-gray-50 rounded-xl text-sm text-gray-700 leading-relaxed border border-gray-100 italic shadow-inner">
                    "{selected?.description || "No description provided."}"
                  </div>
               </div>

               <div className="space-y-5">
                  {/* Deduction Summary Card */}
                  {(selected?.infractions || []).length > 0 && (() => {
                    const infRows = selected?.infractions || [];
                    const deductibleRows = infRows.filter(inf => inf?.deductible !== false);
                    const totalDeduction = deductibleRows.reduce((sum, inf) =>
                      sum + Number(inf?.amount_current ?? inf?.amount_snapshot ?? inf?.amount ?? 0), 0);
                    const nonDeductible = infRows.length - deductibleRows.length;
                    return (
                      <div className="bg-gradient-to-r from-red-50 to-amber-50 border border-red-200 rounded-xl p-5 mb-2" data-testid="deduction-summary-card">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[10px] text-red-400 uppercase tracking-widest font-black mb-1">Total Deduction for this Incident</p>
                            <p className="text-3xl font-black text-[#DC2626] tracking-tight" style={{ fontFamily: 'Inter' }}>
                              Rs.{totalDeduction.toLocaleString()}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-1">
                              {deductibleRows.length} infraction{deductibleRows.length !== 1 ? "s" : ""} applied
                              {nonDeductible > 0 && <span className="text-gray-400"> · {nonDeductible} non-deductible</span>}
                              {selected?.status !== "closed" && <span className="text-amber-600 font-bold ml-2">(estimated — pending closure)</span>}
                            </p>
                          </div>
                          <div className="text-right space-y-1">
                            {deductibleRows.map((inf, idx) => (
                              <div key={idx} className="text-[10px] flex items-center justify-end gap-2">
                                <span className="font-mono text-gray-500">{displayInfractionCode(inf.infraction_code)}</span>
                                <span className="font-bold text-[#DC2626]">Rs.{Number(inf?.amount_current ?? inf?.amount_snapshot ?? inf?.amount ?? 0).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h4 className="text-sm font-black text-amber-900 flex items-center gap-2"> <ClipboardList className="h-4 w-4" /> Linked Penalties</h4>
                    <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-3 py-1 rounded-full border border-amber-100">Flattened Deductions</span>
                  </div>
                  <div className="grid gap-4">
                    {(selected?.infractions || []).map((inf, idx) => {
                      const groupLbl = infractionScheduleGroupLabel(inf);
                      return (
                      <div key={idx} className="bg-white border border-amber-100 rounded-xl p-4 shadow-sm flex items-start justify-between hover:shadow-md transition-shadow">
                         <div className="space-y-2 flex-1 pr-6">
                           <div className="flex items-center gap-2 flex-wrap">
                             <Badge className="font-mono text-[10px] bg-amber-600 text-white border-none px-2">{displayInfractionCode(inf.infraction_code)}</Badge>
                             {inf.category && (
                               <Badge variant="outline" className="text-[9px] font-bold uppercase text-gray-600 border-gray-200 bg-gray-50 px-1.5 py-0">
                                 Cat {inf.category}
                               </Badge>
                             )}
                             {groupLbl ? (
                               <Badge variant="outline" className="text-[8px] font-bold uppercase text-gray-700 border-gray-200 bg-gray-50 px-1.5 py-0">
                                 {groupLbl}
                               </Badge>
                             ) : null}
                             {inf.safety_flag && (
                               <Badge className="text-[8px] font-bold uppercase bg-red-100 text-red-700 border-red-200 px-1.5 py-0">
                                 Safety
                               </Badge>
                             )}
                             <Badge variant="outline" className={cn("text-[9px] font-black h-5 px-2 tracking-tight", inf.status === 'closed' ? "text-green-700 border-green-200 bg-green-50" : "text-amber-700 border-amber-200 bg-amber-50")}>
                                {inf.status?.toUpperCase() || 'OPEN'}
                             </Badge>
                           </div>
                           <p className="text-xs text-gray-800 font-bold leading-snug">{inf.description}</p>
                           <div className="flex items-center gap-4 mt-1 bg-red-50/50 rounded-lg px-3 py-2 border border-red-100">
                              <div>
                                <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter block">Deduction Amount</span>
                                <span className="text-lg font-black text-[#DC2626] font-mono">Rs.{(inf.amount_current || inf.amount_snapshot || inf.amount || 0).toLocaleString()}</span>
                              </div>
                              {inf.deductible === false && (
                                <Badge className="bg-gray-100 text-gray-500 text-[8px]">NON-DEDUCTIBLE</Badge>
                              )}
                           </div>
                           {/* Resolve-day Countdown Timer */}
                           {inf.status !== "closed" && inf.resolve_by && (() => {
                             const today = new Date();
                             today.setHours(0,0,0,0);
                             const deadline = new Date(inf.resolve_by + "T23:59:59");
                             deadline.setHours(0,0,0,0);
                             const diffMs = deadline - today;
                             const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                             const isOverdue = daysLeft < 0;
                             const overdueDays = Math.abs(daysLeft);
                             const resolveDays = inf.resolve_days || 1;
                             const escalationSteps = isOverdue ? Math.floor(overdueDays / resolveDays) : 0;
                             const escChain = {"A":"B","B":"C","C":"D","D":"E","E":"E"};
                             let escCat = String(inf.category || "").toUpperCase();
                             for (let s = 0; s < escalationSteps; s++) { escCat = escChain[escCat] || escCat; }
                             const slabAmounts = {"A":100,"B":500,"C":1000,"D":1500,"E":3000,"F":10000,"G":200000};
                             const escalatedAmt = Math.min(slabAmounts[escCat] || 0, 3000);
                             const originalAmt = Number(inf.amount_snapshot || inf.amount || 0);
                             return (
                               <div className={`mt-2 rounded-lg px-3 py-2 border ${isOverdue ? "bg-red-50 border-red-200" : daysLeft <= 1 ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"}`}>
                                 <div className="flex items-center gap-2 mb-1">
                                   <Timer size={12} className={isOverdue ? "text-red-500" : daysLeft <= 1 ? "text-amber-500" : "text-blue-500"} />
                                   <span className={`text-[10px] font-black uppercase tracking-wider ${isOverdue ? "text-red-600" : daysLeft <= 1 ? "text-amber-600" : "text-blue-600"}`}>
                                     {isOverdue ? `OVERDUE by ${overdueDays} day${overdueDays !== 1 ? "s" : ""}` : daysLeft === 0 ? "DUE TODAY" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`}
                                   </span>
                                 </div>
                                 <p className="text-[10px] text-gray-600">
                                   Resolve by: <strong>{inf.resolve_by}</strong>
                                   {inf.resolve_days && <span className="text-gray-400"> ({inf.resolve_days}-day period)</span>}
                                 </p>
                                 {isOverdue && escalationSteps > 0 && (
                                   <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                                     <Badge className="bg-red-200 text-red-900 text-[9px] px-1.5 py-0">AUTO-ESCALATED</Badge>
                                     <span className="text-red-700 font-bold">
                                       Cat {inf.category} &rarr; Cat {escCat} | Rs.{originalAmt.toLocaleString()} &rarr; Rs.{escalatedAmt.toLocaleString()}
                                     </span>
                                     <span className="text-red-400">({escalationSteps} step{escalationSteps !== 1 ? "s" : ""})</span>
                                   </div>
                                 )}
                               </div>
                             );
                           })()}
                           {inf.closed_at && (
                             <div className="mt-3 pt-3 border-t border-dashed border-gray-100">
                                <div className="flex items-center gap-2 text-green-700">
                                   <CheckCircle2 className="h-3 w-3" />
                                   <span className="text-[10px] font-bold">Verified by Depot on {formatDateTimeINAmPm(inf.closed_at)}</span>
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
                    );
                    })}
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
                    <div className="text-[10px] text-gray-400 mt-2 font-semibold tracking-tight flex items-center gap-2">
                       <User size={10} /> {e.by} <span className="opacity-30">|</span> <Clock size={10} /> {e.at ? formatDateTimeINAmPm(e.at) : "—"}
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

