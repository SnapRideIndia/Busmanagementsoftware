import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import DutyTripsReadOnlyTable from "../components/DutyTripsReadOnlyTable";
import { formatDateIN } from "../lib/dates";
import {
  defaultTripsForNewDuty,
  normalizeTripsFromApi,
  TRIP_STATUS_OPTIONS,
  CANCEL_REASON_OPTIONS,
  tripStatusNeedsReason,
  emptyTripRow,
  renumberTrips,
} from "../lib/dutyTrips";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Plus, Send, Trash2, Pencil, MessageSquare, Phone, LayoutList, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const today = new Date().toISOString().slice(0, 10);

export default function DutyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [duties, setDuties] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [conductors, setConductors] = useState([]);
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterDate, setFilterDate] = useState(today);
  const [filterDepot, setFilterDepot] = useState("");
  const [filterBusId, setFilterBusId] = useState("");
  const [filterSearchQ, setFilterSearchQ] = useState("");
  const [page, setPage] = useState(1);
  const [listMeta, setListMeta] = useState({ total: 0, pages: 1, limit: 30 });
  const [form, setForm] = useState({
    driver_license: "",
    conductor_id: "",
    bus_id: "",
    route_id: "",
    route_name: "",
    start_point: "",
    end_point: "",
    punctuality_scheduled_departure: "",
    punctuality_scheduled_arrival: "",
    punctuality_actual_departure: "",
    punctuality_actual_arrival: "",
    date: today,
    trips: defaultTripsForNewDuty(),
  });
  /** Snapshot when opening edit — used to send partial PUT bodies */
  const [editBaseline, setEditBaseline] = useState(null);
  /** Duty route row(s) not present in master list (e.g. inactive route filtered out before fix) — keeps Radix Select value valid */
  const [routeSelectExtra, setRouteSelectExtra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [tripsOpenByDutyId, setTripsOpenByDutyId] = useState({});

  const summaryQuery = () => {
    const q = new URLSearchParams();
    q.set("date", filterDate || today);
    if (filterDepot) q.set("depot", filterDepot);
    if (filterBusId) q.set("bus_id", filterBusId);
    if (filterSearchQ.trim()) q.set("q", filterSearchQ.trim());
    return q.toString();
  };

  const setDutyTripsOpen = (dutyId, isOpen) => {
    setTripsOpenByDutyId((prev) => ({ ...prev, [dutyId]: isOpen }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = buildQuery({
        date: filterDate,
        depot: filterDepot,
        bus_id: filterBusId,
        q: filterSearchQ.trim(),
        page,
        limit: listMeta.limit,
      });
      const [d, drItems, condItems, busItems, routeItems] = await Promise.all([
        API.get(Endpoints.operations.duties.list(), { params }),
        fetchAllPaginated(Endpoints.masters.drivers.list(), {}),
        fetchAllPaginated(Endpoints.masters.conductors.list(), {}),
        fetchAllPaginated(Endpoints.masters.buses.list(), {}),
        /* All routes: editing a duty must show its route even if master row is inactive */
        fetchAllPaginated(Endpoints.masters.routes.list(), {}),
      ]);
      const du = unwrapListResponse(d.data);
      setDuties(du.items);
      setListMeta({ total: du.total, pages: du.pages, limit: du.limit });
      setDrivers(drItems);
      setConductors(condItems);
      setBuses(busItems);
      setRoutes(Array.isArray(routeItems) ? routeItems : []);
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load duties"));
      setDuties([]);
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterDepot, filterBusId, filterSearchQ, page, listMeta.limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!searchParams.toString()) return;
    const d = searchParams.get("date");
    const dep = searchParams.get("depot");
    const bus = searchParams.get("bus_id");
    const qq = searchParams.get("q");
    if (d) setFilterDate(d);
    if (dep !== null) setFilterDepot(dep);
    if (bus !== null) setFilterBusId(bus);
    if (qq !== null) setFilterSearchQ(qq);
  }, [searchParams]);

  const routesForSelect = useMemo(() => {
    const seen = new Set(routes.map((r) => String(r.route_id ?? "").trim()));
    const out = [...routes];
    for (const ex of routeSelectExtra) {
      const id = String(ex.route_id ?? "").trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(ex);
      }
    }
    return out;
  }, [routes, routeSelectExtra]);

  const resetForm = () => {
    setEditBaseline(null);
    setRouteSelectExtra([]);
    setForm({
      driver_license: "", conductor_id: "", bus_id: "", route_id: "", route_name: "",
      start_point: "", end_point: "",
      punctuality_scheduled_departure: "", punctuality_scheduled_arrival: "",
      punctuality_actual_departure: "", punctuality_actual_arrival: "",
      date: filterDate || today,
      trips: defaultTripsForNewDuty(),
    });
  };

  const dutyTripsSignature = (trips) => JSON.stringify(renumberTrips(trips || []));

  const buildDutyPatch = (baseline, current) => {
    if (!baseline) return {};
    const patch = {};
    if ((current.driver_license || "") !== (baseline.driver_license || "")) patch.driver_license = current.driver_license;
    if ((current.conductor_id || "") !== (baseline.conductor_id || "")) patch.conductor_id = current.conductor_id;
    if ((current.bus_id || "") !== (baseline.bus_id || "")) patch.bus_id = current.bus_id;
    if (String(current.route_id || "") !== String(baseline.route_id || "")) {
      patch.route_id = String(current.route_id || "");
    }
    if ((current.date || "") !== (baseline.date || "")) patch.date = current.date;
    if ((current.punctuality_scheduled_departure || "") !== (baseline.punctuality_scheduled_departure || "")) patch.punctuality_scheduled_departure = current.punctuality_scheduled_departure;
    if ((current.punctuality_scheduled_arrival || "") !== (baseline.punctuality_scheduled_arrival || "")) patch.punctuality_scheduled_arrival = current.punctuality_scheduled_arrival;
    if ((current.punctuality_actual_departure || "") !== (baseline.punctuality_actual_departure || "")) patch.punctuality_actual_departure = current.punctuality_actual_departure;
    if ((current.punctuality_actual_arrival || "") !== (baseline.punctuality_actual_arrival || "")) patch.punctuality_actual_arrival = current.punctuality_actual_arrival;
    if (dutyTripsSignature(current.trips) !== dutyTripsSignature(baseline.trips)) {
      patch.trips = renumberTrips(current.trips);
    }
    return patch;
  };

  const validateTrips = () => {
    if (!form.trips.length) {
      toast.error("Add at least one trip");
      return false;
    }
    for (let i = 0; i < form.trips.length; i++) {
      const t = form.trips[i];
      if (tripStatusNeedsReason(t.trip_status)) {
        const code = (t.cancel_reason_code || "none").toLowerCase();
        if (code === "none" || !code) {
          toast.error(`Trip ${i + 1}: choose a cancellation reason`);
          return false;
        }
        if (code === "other" && !(t.cancel_reason_custom || "").trim()) {
          toast.error(`Trip ${i + 1}: enter a custom reason`);
          return false;
        }
      }
    }
    return true;
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const patch = buildDutyPatch(editBaseline, form);
        if (!patch || Object.keys(patch).length === 0) {
          toast.info("No changes to save");
          return;
        }
        if (patch.trips != null && !validateTrips()) return;
        await API.put(Endpoints.operations.duties.update(editing), patch);
        toast.success("Duty updated");
      } else {
        if (!form.driver_license?.trim() || !form.conductor_id?.trim() || !form.bus_id?.trim() || !String(form.route_id || "").trim() || !form.date?.trim()) {
          toast.error("Please fill driver, conductor, bus, route, and date");
          return;
        }
        if (!validateTrips()) return;
        const payload = {
          ...form,
          route_id: String(form.route_id),
          trips: renumberTrips(form.trips),
        };
        await API.post(Endpoints.operations.duties.create(), payload);
        toast.success("Duty assigned");
      }
      setOpen(false); setEditing(null); resetForm(); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Remove this duty assignment?")) return;
    try { await API.delete(Endpoints.operations.duties.remove(id)); toast.success("Removed"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const sendSms = async (id) => {
    try {
      const { data } = await API.post(Endpoints.operations.duties.sendSms(id));
      toast.success(`SMS sent to ${data.phone}`);
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const sendAllSms = async () => {
    if (!filterDate) { toast.error("Select a date"); return; }
    try {
      const { data } = await API.post(Endpoints.operations.duties.sendAllSms(filterDate));
      toast.success(data.message);
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const resolveDriverLicense = (stored) => {
    const s = String(stored ?? "").trim();
    if (!s) return "";
    const exact = drivers.find((dr) => String(dr.license_number) === s);
    if (exact) return String(exact.license_number);
    const byTrim = drivers.find((dr) => String(dr.license_number ?? "").trim() === s);
    if (byTrim) return String(byTrim.license_number);
    return s;
  };

  const resolveConductorId = (stored) => {
    const s = String(stored ?? "").trim();
    if (!s) return "";
    const exact = conductors.find((c) => String(c.conductor_id) === s);
    if (exact) return String(exact.conductor_id);
    const byTrim = conductors.find((c) => String(c.conductor_id ?? "").trim() === s);
    if (byTrim) return String(byTrim.conductor_id);
    return s;
  };

  const openEdit = (d) => {
    const raw = normalizeTripsFromApi(d.trips);
    const trips = raw.length ? renumberTrips(raw) : defaultTripsForNewDuty();
    let rid = String(d.route_id ?? "").trim();
    if (!rid && (d.route_name || "").trim()) {
      const byName = routes.find((r) => (r.name || "").trim() === (d.route_name || "").trim());
      if (byName) rid = String(byName.route_id ?? "").trim();
    }
    if (rid) {
      const canon = routes.find((r) => String(r.route_id ?? "").trim() === rid);
      if (canon) rid = String(canon.route_id ?? "").trim();
      else {
        const byIdCi = routes.find((r) => String(r.route_id ?? "").trim().toLowerCase() === rid.toLowerCase());
        if (byIdCi) rid = String(byIdCi.route_id ?? "").trim();
      }
    }
    const routeIdSet = new Set(routes.map((r) => String(r.route_id ?? "").trim()));
    if (rid && !routeIdSet.has(rid)) {
      setRouteSelectExtra([
        {
          route_id: rid,
          name: (d.route_name || "").trim() || rid,
          origin: d.start_point || "",
          destination: d.end_point || "",
        },
      ]);
    } else {
      setRouteSelectExtra([]);
    }
    const nextTrips = deriveTripTerminals(trips, d.start_point || "", d.end_point || "");
    const next = {
      driver_license: resolveDriverLicense(d.driver_license),
      conductor_id: resolveConductorId(d.conductor_id),
      bus_id: String(d.bus_id ?? "").trim(),
      route_id: rid,
      route_name: d.route_name,
      start_point: d.start_point,
      end_point: d.end_point,
      punctuality_scheduled_departure: d.punctuality_scheduled_departure || "",
      punctuality_scheduled_arrival: d.punctuality_scheduled_arrival || "",
      punctuality_actual_departure: d.punctuality_actual_departure || "",
      punctuality_actual_arrival: d.punctuality_actual_arrival || "",
      date: d.date,
      trips: nextTrips,
    };
    setForm(next);
    setEditBaseline(JSON.parse(JSON.stringify(next)));
    setEditing(d.id);
    setOpen(true);
  };

  const updateTrip = (idx, field, value) => {
    const newTrips = [...form.trips];
    let next = { ...newTrips[idx], [field]: value };
    if (field === "trip_status" && !tripStatusNeedsReason(value)) {
      next = { ...next, cancel_reason_code: "none", cancel_reason_custom: "" };
    }
    newTrips[idx] = next;
    setForm({ ...form, trips: newTrips });
  };

  const selectRoute = (routeId) => {
    const rid = routeId != null && routeId !== "" ? String(routeId) : "";
    const r = routes.find((x) => String(x.route_id ?? "") === rid);
    setForm((prev) => {
      const routeStart = r?.origin || "";
      const routeEnd = r?.destination || "";
      const nextTrips = deriveTripTerminals(prev.trips, routeStart, routeEnd);
      return ({
      ...prev,
      route_id: rid,
      route_name: r?.name || "",
      start_point: routeStart,
      end_point: routeEnd,
      trips: nextTrips,
      punctuality_scheduled_departure: prev.punctuality_scheduled_departure || (nextTrips[0]?.start_time || ""),
      punctuality_scheduled_arrival: prev.punctuality_scheduled_arrival || (nextTrips[nextTrips.length - 1]?.end_time || ""),
      punctuality_actual_departure: prev.punctuality_actual_departure || (nextTrips[0]?.actual_start_time || ""),
      punctuality_actual_arrival: prev.punctuality_actual_arrival || (nextTrips[nextTrips.length - 1]?.actual_end_time || ""),
      });
    });
  };

  const deriveTripTerminals = (trips, routeStart, routeEnd) =>
    (trips || []).map((t, i) => {
      const dir = (t.direction || (i % 2 === 0 ? "outward" : "return")).toLowerCase();
      const sp = dir === "return" ? routeEnd : routeStart;
      const ep = dir === "return" ? routeStart : routeEnd;
      return { ...t, direction: dir, start_point: t.start_point || sp || "", end_point: t.end_point || ep || "" };
    });

  const addTrip = () => {
    const i = form.trips.length;
    const nextTrips = [...form.trips, emptyTripRow(i)];
    setForm({ ...form, trips: deriveTripTerminals(nextTrips, form.start_point, form.end_point) });
  };

  const removeTrip = (idx) => {
    if (form.trips.length <= 1) {
      toast.error("A duty must have at least one trip");
      return;
    }
    const next = form.trips.filter((_, j) => j !== idx);
    setForm({ ...form, trips: deriveTripTerminals(renumberTrips(next), form.start_point, form.end_point) });
  };

  return (
    <div className="w-full max-w-none" data-testid="duty-page">
      <div className="page-header flex-wrap">
        <div>
          <h1 className="page-title">Duty Assignments</h1>
          <p className="page-desc max-w-3xl">
            Create and manage duty assignments by date. Expand <strong>Route trips</strong> to view the timetable; use <strong>Edit</strong> to update trips.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="rounded-lg border-gray-300" onClick={() => navigate(`/duties/summary?${summaryQuery()}`)} data-testid="duty-summary-nav">
            <LayoutList size={14} className="mr-1.5" /> View duty summary
          </Button>
          <Button onClick={sendAllSms} variant="outline" className="text-[#C8102E] border-[#C8102E] hover:bg-red-50" data-testid="send-all-sms-btn">
            <Send size={14} className="mr-1.5" /> Send All SMS
          </Button>
          <Button onClick={() => { resetForm(); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-duty-btn">
            <Plus size={16} className="mr-1.5" /> Assign Duty
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-end w-full">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Date</label>
          <Input type="date" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setPage(1); }} className="w-44 rounded-lg" data-testid="duty-date-filter" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setFilterBusId(""); setPage(1); }}>
            <SelectTrigger className="w-44 rounded-lg"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {[...new Set(buses.map((x) => x.depot).filter(Boolean))].sort().map((dep) => (
                <SelectItem key={dep} value={dep}>{dep}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={filterBusId || "all"} onValueChange={(v) => { setFilterBusId(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-36 rounded-lg"><SelectValue placeholder="All Buses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buses</SelectItem>
              {(filterDepot ? buses.filter((x) => x.depot === filterDepot) : buses).map((x) => (
                <SelectItem key={x.bus_id} value={x.bus_id}>{x.bus_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[200px] max-w-md">
          <label className="text-xs font-medium uppercase text-gray-500">Search</label>
          <Input
            placeholder="Driver, route, bus, trip ID…"
            value={filterSearchQ}
            onChange={(e) => { setFilterSearchQ(e.target.value); setPage(1); }}
            className="rounded-lg"
            data-testid="duty-search-filter"
          />
        </div>
        <Button onClick={load} variant="outline" className="rounded-lg" data-testid="duty-filter-btn">Refresh</Button>
      </div>

      <div className="space-y-3 w-full">
        {fetchError ? <AsyncPanel error={fetchError} onRetry={load} minHeight="min-h-[160px]" /> : null}
        {!fetchError && loading && duties.length === 0 ? <AsyncPanel loading minHeight="min-h-[200px]" /> : null}
        {!fetchError && duties.map((d) => {
          const tripCount = (d.trips || []).length;
          const tripsOpen = !!tripsOpenByDutyId[d.id];
          return (
            <Card key={d.id} className={`w-full border-gray-200 shadow-sm ${loading ? "opacity-70" : ""}`} data-testid={`duty-card-${d.id}`}>
              <CardContent className="p-0">
                <div className="flex flex-col gap-0 sm:flex-row sm:items-stretch sm:justify-between border-b border-gray-100 bg-[#FAFAFA] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                    <span className="font-mono text-xs text-gray-500 shrink-0">{d.id}</span>
                    <span className="text-xs text-gray-500">{formatDateIN(d.date)}</span>
                    <Badge className={d.status === "assigned" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-green-100 text-green-700 hover:bg-green-100"}>{d.status}</Badge>
                    {d.sms_sent ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100"><MessageSquare size={10} className="mr-1" />SMS</Badge> : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-2 sm:mt-0">
                    {!d.sms_sent && (
                      <Button variant="outline" size="sm" onClick={() => sendSms(d.id)} className="text-[#C8102E] border-[#C8102E] h-8" data-testid={`sms-duty-${d.id}`}>
                        <Send size={12} className="mr-1" /> SMS
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(d)} data-testid={`edit-duty-${d.id}`}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(d.id)} data-testid={`delete-duty-${d.id}`}><Trash2 size={14} className="text-red-500" /></Button>
                  </div>
                </div>

                <div className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-4 w-full">
                  <div className="lg:col-span-4 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Driver</p>
                      <p className="font-medium text-sm leading-snug">{d.driver_name || "—"}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={10} className="shrink-0" />{d.driver_phone || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Conductor</p>
                      <p className="font-medium text-sm leading-snug">{d.conductor_name || "—"}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={10} className="shrink-0" />{d.conductor_phone || "—"}</p>
                    </div>
                  </div>
                  <div className="lg:col-span-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Bus</p>
                    <p className="font-mono font-semibold text-sm">{d.bus_id}</p>
                  </div>
                  <div className="lg:col-span-6 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Route</p>
                    <p className="font-medium text-sm">{d.route_name}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{d.start_point} → {d.end_point}</p>
                  </div>
                </div>

                <Collapsible open={tripsOpen} onOpenChange={(o) => setDutyTripsOpen(d.id, o)} className="border-t border-gray-100">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium text-gray-800 bg-white hover:bg-gray-50 transition-colors">
                    <span>
                      Route trips
                      <span className="ml-2 font-normal text-gray-500">({tripCount} {tripCount === 1 ? "trip" : "trips"}) — tap to {tripsOpen ? "collapse" : "expand"}</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 ${tripsOpen ? "rotate-180" : ""}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-1 bg-gray-50/80">
                      <p className="text-xs text-gray-600 mb-2">
                        Punctuality (duty): Sch {d.punctuality_scheduled_departure || "—"} - {d.punctuality_scheduled_arrival || "—"} | Act {d.punctuality_actual_departure || "—"} - {d.punctuality_actual_arrival || "—"}
                      </p>
                      <DutyTripsReadOnlyTable trips={d.trips} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          );
        })}
        {!fetchError && !loading && duties.length === 0 ? (
          <Card className="w-full border-gray-200"><CardContent className="p-6 text-center text-sm text-gray-400">No duties for these filters</CardContent></Card>
        ) : null}
        <TablePaginationBar 
          page={page} 
          pages={listMeta.pages} 
          total={listMeta.total} 
          limit={listMeta.limit} 
          onPageChange={setPage} 
          onLimitChange={(l) => setListMeta(prev => ({ ...prev, limit: l }))}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,72rem)] max-h-[92vh] overflow-y-auto" data-testid="duty-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit duty" : "Assign duty"}</DialogTitle>
            <p className="text-xs text-gray-500 font-normal pt-1">
              Set route and endpoints first, then add as many trips as needed (outward / return and times). Use <strong>Add trip</strong> for extra legs.
              Trip IDs are created by the server when you save (not editable here).
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Driver</Label>
                <Select
                  value={form.driver_license ? String(form.driver_license) : undefined}
                  onValueChange={(v) => setForm({ ...form, driver_license: v })}
                >
                  <SelectTrigger data-testid="duty-driver-select"><SelectValue placeholder="Select driver" /></SelectTrigger>
                  <SelectContent>{drivers.map((dr) => <SelectItem key={dr.license_number} value={String(dr.license_number)}>{dr.name} ({dr.license_number})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Conductor</Label>
                <Select
                  value={form.conductor_id ? String(form.conductor_id) : undefined}
                  onValueChange={(v) => setForm({ ...form, conductor_id: v })}
                >
                  <SelectTrigger data-testid="duty-conductor-select"><SelectValue placeholder="Select conductor" /></SelectTrigger>
                  <SelectContent>{conductors.map((c) => <SelectItem key={c.conductor_id} value={String(c.conductor_id)}>{c.name} ({c.conductor_id})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Bus</Label>
                <Select value={form.bus_id ? String(form.bus_id) : undefined} onValueChange={(v) => setForm({ ...form, bus_id: v })}>
                  <SelectTrigger data-testid="duty-bus-select"><SelectValue placeholder="Select bus" /></SelectTrigger>
                  <SelectContent>{buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id} ({b.depot})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="duty-date" /></div>
            </div>
            <div className="space-y-2">
              <Label>Route</Label>
                <Select value={form.route_id ? String(form.route_id).trim() : undefined} onValueChange={(v) => selectRoute(v)}>
                <SelectTrigger data-testid="duty-route-select"><SelectValue placeholder="Select route" /></SelectTrigger>
                <SelectContent>
                  {routesForSelect.map((r) => (
                    <SelectItem key={String(r.route_id)} value={String(r.route_id).trim()}>
                      {r.route_id} — {r.name}{r.origin || r.destination ? ` (${r.origin || "—"} → ${r.destination || "—"})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Starting point</Label><Input value={form.start_point} readOnly disabled placeholder="Auto-filled from route" data-testid="duty-start-point" /></div>
              <div className="space-y-2"><Label>Ending point</Label><Input value={form.end_point} readOnly disabled placeholder="Auto-filled from route" data-testid="duty-end-point" /></div>
            </div>
            <div className="border rounded-md p-3 bg-gray-50 space-y-3">
              <Label className="text-sm font-semibold">Punctuality</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600">Scheduled departure</Label><Input type="time" value={form.punctuality_scheduled_departure || ""} onChange={(e) => setForm({ ...form, punctuality_scheduled_departure: e.target.value })} data-testid="duty-punctuality-sched-dep" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600">Scheduled arrival</Label><Input type="time" value={form.punctuality_scheduled_arrival || ""} onChange={(e) => setForm({ ...form, punctuality_scheduled_arrival: e.target.value })} data-testid="duty-punctuality-sched-arr" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600">Actual departure</Label><Input type="time" value={form.punctuality_actual_departure || ""} onChange={(e) => setForm({ ...form, punctuality_actual_departure: e.target.value })} data-testid="duty-punctuality-actual-dep" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600">Actual arrival</Label><Input type="time" value={form.punctuality_actual_arrival || ""} onChange={(e) => setForm({ ...form, punctuality_actual_arrival: e.target.value })} data-testid="duty-punctuality-actual-arr" /></div>
              </div>
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-semibold">Trips on this duty</Label>
                <Button type="button" variant="outline" size="sm" onClick={addTrip} className="h-8" data-testid="duty-add-trip">
                  <Plus size={14} className="mr-1" /> Add trip
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <Table>
                  <TableHeader>
                    <TableRow className="table-header">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">Trip ID</TableHead>
                      <TableHead className="whitespace-nowrap">Start point</TableHead>
                      <TableHead className="whitespace-nowrap">End point</TableHead>
                      <TableHead className="whitespace-nowrap">Start time</TableHead>
                      <TableHead className="whitespace-nowrap">End time</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">Status</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">Cancellation reason</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.trips.map((t, idx) => (
                      <Fragment key={`trip-block-${idx}`}>
                        <TableRow className="align-top">
                          <TableCell className="font-mono text-xs pt-3">{idx + 1}</TableCell>
                          <TableCell className="p-1 pt-2.5 align-top min-w-0">
                            <span
                              className={`block text-xs font-mono px-1 break-all whitespace-normal ${t.trip_id ? "text-gray-800" : "text-gray-400"}`}
                              title={t.trip_id || ""}
                              data-testid={`trip-${idx}-id-readonly`}
                            >
                              {t.trip_id && String(t.trip_id).trim() ? t.trip_id : "-"}
                            </span>
                          </TableCell>
                          <TableCell className="p-1">
                            <Input className="h-8 text-xs w-[150px]" value={t.start_point || ""} readOnly />
                          </TableCell>
                          <TableCell className="p-1">
                            <Input className="h-8 text-xs w-[150px]" value={t.end_point || ""} readOnly />
                          </TableCell>
                          <TableCell className="p-1">
                            <Input type="time" className="h-8 text-xs w-[108px]" value={t.start_time || ""} onChange={(e) => updateTrip(idx, "start_time", e.target.value)} data-testid={`trip-${idx}-sched-start`} />
                          </TableCell>
                          <TableCell className="p-1">
                            <Input type="time" className="h-8 text-xs w-[108px]" value={t.end_time || ""} onChange={(e) => updateTrip(idx, "end_time", e.target.value)} data-testid={`trip-${idx}-sched-end`} />
                          </TableCell>
                          <TableCell className="p-1">
                            <Select value={t.trip_status || "scheduled"} onValueChange={(v) => updateTrip(idx, "trip_status", v)}>
                              <SelectTrigger className="h-8 text-xs min-w-[100px]" data-testid={`trip-${idx}-status`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TRIP_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="p-1">
                            <Select
                              value={t.cancel_reason_code || "none"}
                              onValueChange={(v) => updateTrip(idx, "cancel_reason_code", v)}
                              disabled={!tripStatusNeedsReason(t.trip_status)}
                            >
                              <SelectTrigger className="h-8 text-xs min-w-[120px]" data-testid={`trip-${idx}-reason`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {CANCEL_REASON_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="p-1 pt-2">
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => removeTrip(idx)} disabled={form.trips.length <= 1} data-testid={`trip-${idx}-remove`}>
                              <Trash2 size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {t.cancel_reason_code === "other" && tripStatusNeedsReason(t.trip_status) ? (
                          <TableRow key={`${idx}-custom`}>
                            <TableCell colSpan={9} className="bg-gray-50 py-2">
                              <Label className="text-xs text-gray-500">Custom reason (trip {idx + 1})</Label>
                              <Input className="mt-1 h-8 text-sm" value={t.cancel_reason_custom || ""} onChange={(e) => updateTrip(idx, "cancel_reason_custom", e.target.value)} placeholder="Required when reason is Other" data-testid={`trip-${idx}-reason-custom`} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="duty-save-btn">{editing ? "Update duty" : "Assign duty"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
