import { useState, useEffect, useCallback, Fragment } from "react";
import { Link } from "react-router-dom";
import { useRoutes, useRouteGeofences, useRouteMutations } from "../features/routes/api/useRoutes";
import { useAllDepotNames } from "../features/depots/api/useDepots";
import { useAllStops } from "../features/stops/api/useStops";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { toast } from "sonner";

/** Page size for the expanded route → stops preview table */
const ROUTE_STOPS_PAGE_SIZE = 25;

const CHARGING_STATUS_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "available", label: "Available" },
  { value: "occupied", label: "Occupied" },
  { value: "maintenance", label: "Maintenance" },
  { value: "offline", label: "Offline" },
];

const emptyForm = {
  route_id: "",
  name: "",
  origin: "",
  destination: "",
  distance_km: "",
  depot: "",
  active: true,
  stop_sequence: [],
  alternate_charging_stop_id: "",
  charging_point_status: "unknown",
};

function sortResolvedStops(s) {
  return [...(s || [])].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

function sortSequenceRows(rows) {
  return [...(rows || [])].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

function stopSequenceForApi(rows) {
  return sortSequenceRows(rows || [])
    .map((x, i) => ({
      seq: Number(x.seq) > 0 ? Number(x.seq) : i + 1,
      stop_id: (x.stop_id || "").trim(),
    }))
    .filter((x) => x.stop_id.length > 0);
}

/** Stop IDs currently on the route form (for alternate charging dropdown). */
function stopIdsFromFormSequence(stopSequence) {
  const seen = new Set();
  const out = [];
  for (const x of stopSequence || []) {
    const id = (x.stop_id || "").trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Build editable rows from API route (prefers `stop_sequence`, else hydrated `stops`, with name→master fallback). */
function stopRowsFromRoute(r, nameToStopId) {
  if (Array.isArray(r.stop_sequence) && r.stop_sequence.length > 0) {
    return sortSequenceRows(
      r.stop_sequence.map((x) => ({
        seq: String(x.seq != null ? x.seq : ""),
        stop_id: x.stop_id || "",
      }))
    );
  }
  const stops = sortResolvedStops(r.stops || []);
  if (!stops.length) return [{ seq: "1", stop_id: "" }];
  return stops.map((s, i) => {
    let sid = (s.stop_id || "").trim();
    if (!sid && s.name) {
      const k = String(s.name).trim().toLowerCase();
      sid = nameToStopId.get(k) || "";
    }
    return {
      seq: String(s.seq != null ? s.seq : i + 1),
      stop_id: sid,
    };
  });
}

export default function RoutesPage() {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterDepot, setFilterDepot] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [metaLimit, setMetaLimit] = useState(30);
  const [expandedRouteId, setExpandedRouteId] = useState(null);
  const [expandedStopsPage, setExpandedStopsPage] = useState(1);

  const { data: depotNames = [] } = useAllDepotNames();
  const { data: masterStops = [] } = useAllStops();
  const { data: routeFenceMap = {} } = useRouteGeofences();
  const { data: routesData, isLoading: loading, error: fetchError, refetch: load } = useRoutes({
    depot: filterDepot,
    active: filterActive,
    search,
    page,
    limit: metaLimit,
  });

  const rows = routesData?.items || [];
  const meta = {
    total: routesData?.total || 0,
    pages: routesData?.pages || 1,
    limit: routesData?.limit || metaLimit,
  };

  const { createRoute, updateRoute, deleteRoute, isSaving } = useRouteMutations();


  useEffect(() => {
    setPage(1);
  }, [search, filterDepot, filterActive]);

  const handleSave = async () => {
    const name = (form.name || "").trim();
    const routeId = (form.route_id || "").trim();
    if (!name) {
      toast.error("Route name is required");
      return;
    }
    if (!editingId && !routeId) {
      toast.error("Route ID is required");
      return;
    }
    const seq = stopSequenceForApi(form.stop_sequence);
    const alt = (form.alternate_charging_stop_id || "").trim();
    if (alt && !seq.some((s) => s.stop_id === alt)) {
      toast.error("Alternate charging point must be one of the stops on this route");
      return;
    }
    const payload = {
      name,
      origin: (form.origin || "").trim(),
      destination: (form.destination || "").trim(),
      distance_km: form.distance_km === "" ? 0 : Number(form.distance_km),
      depot: (form.depot || "").trim(),
      active: !!form.active,
      stop_sequence: seq,
      alternate_charging_stop_id: alt,
      charging_point_status: form.charging_point_status || "unknown",
    };
    try {
      if (editingId) {
        await updateRoute({ id: editingId, payload });
      } else {
        await createRoute({ ...payload, route_id: routeId });
      }
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleDelete = async (routeId) => {
    if (!window.confirm(`Delete route "${routeId}"?`)) return;
    try {
      await deleteRoute(routeId);
    } catch (err) {
      // Error handled in hook
    }
  };

  const openEdit = (r) => {
    const nameToStopId = new Map();
    masterStops.forEach((s) => {
      const k = String(s.name || "").trim().toLowerCase();
      if (k && !nameToStopId.has(k)) nameToStopId.set(k, s.stop_id);
    });
    const rows = stopRowsFromRoute(r, nameToStopId);
    setForm({
      route_id: r.route_id || "",
      name: r.name || "",
      origin: r.origin || "",
      destination: r.destination || "",
      distance_km: r.distance_km != null ? String(r.distance_km) : "",
      depot: r.depot || "",
      active: r.active !== false,
      stop_sequence: rows.length ? rows : [{ seq: "1", stop_id: "" }],
      alternate_charging_stop_id: r.alternate_charging_stop_id || "",
      charging_point_status: r.charging_point_status || "unknown",
    });
    setEditingId(r.route_id);
    setOpen(true);
  };

  const openCreate = () => {
    setForm({
      ...emptyForm,
      stop_sequence: [{ seq: "1", stop_id: "" }],
    });
    setEditingId(null);
    setOpen(true);
  };

  const addStopRow = () => {
    const cur = form.stop_sequence || [];
    const maxSeq = cur.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0);
    const next = maxSeq > 0 ? maxSeq + 1 : cur.length + 1;
    setForm({
      ...form,
      stop_sequence: [...cur, { seq: String(next), stop_id: "" }],
    });
  };

  const removeStopRow = (index) => {
    const rows = [...(form.stop_sequence || [])];
    rows.splice(index, 1);
    const nextSeq = rows.length ? rows : [{ seq: "1", stop_id: "" }];
    const ids = new Set(stopIdsFromFormSequence(nextSeq));
    const alt = (form.alternate_charging_stop_id || "").trim();
    setForm({
      ...form,
      stop_sequence: nextSeq,
      ...(alt && !ids.has(alt) ? { alternate_charging_stop_id: "" } : {}),
    });
  };

  const updateStopRow = (index, field, value) => {
    const rows = [...(form.stop_sequence || [])];
    rows[index] = { ...rows[index], [field]: value };
    const ids = new Set(stopIdsFromFormSequence(rows));
    const alt = (form.alternate_charging_stop_id || "").trim();
    setForm({
      ...form,
      stop_sequence: rows,
      ...(field === "stop_id" && alt && !ids.has(alt) ? { alternate_charging_stop_id: "" } : {}),
    });
  };

  /** 12px typography and controls (matches duty form; portals need the same on DialogContent). */
  const routePageText =
    "text-[12px] leading-normal [&_label]:!text-[12px] [&_input]:!text-[12px] md:[&_input]:!text-[12px] [&_[role=combobox]]:!text-[12px] [&_button]:!text-[12px] [&_.text-sm]:!text-[12px] [&_.page-title]:!text-[12px] md:[&_.page-title]:!text-[12px] [&_.page-lead]:!text-[12px] md:[&_.page-lead]:!text-[12px] [&_.table-header]:!text-[12px] sm:[&_.table-header]:!text-[12px]";
  const selectContent12 = "[&_[role=option]]:!text-[12px] [&_[role=group]]:!text-[12px]";

  return (
    <div data-testid="routes-page" className={routePageText}>
      <div className="page-header">
        <h1 className="page-title">Routes</h1>
        <Button onClick={openCreate} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-route-btn">
          <Plus size={16} className="mr-1.5" /> Add Route
        </Button>
      </div>

      <p className="page-lead max-w-3xl text-gray-500">
        Route <span className="font-mono">name</span> is used by ticket and revenue analytics, reports, and passenger views.
        Renaming a route updates dependent ticketing rows to the new name.{" "}
        <span className="text-gray-700">
          <strong>Stops</strong> come from the shared{" "}
          <Link to="/bus-stops" className="text-[#C8102E] font-medium hover:underline">
            Stops
          </Link>{" "}
          master (same stop can appear on several routes). Demo data: RT-101–RT-505.
        </span>
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-[12px] font-medium uppercase text-gray-500">Search</label>
          <Input
            placeholder="ID, name, origin…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-56"
            data-testid="routes-search"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] font-medium uppercase text-gray-500">Depot</label>
          <Select
            value={filterDepot || "all"}
            onValueChange={(v) => {
              setFilterDepot(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48 h-8" data-testid="routes-filter-depot">
              <SelectValue placeholder="All depots" />
            </SelectTrigger>
            <SelectContent className={selectContent12}>
              <SelectItem value="all">All depots</SelectItem>
              {depotNames.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[12px] font-medium uppercase text-gray-500">Status</label>
          <Select
            value={filterActive || "all"}
            onValueChange={(v) => {
              setFilterActive(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40 h-8" data-testid="routes-filter-active">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent className={selectContent12}>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0 text-[12px]">
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow className="table-header">
                <TableHead className="w-10" />
                <TableHead>Route ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead className="text-center">Stops</TableHead>
                <TableHead>Alternate charging</TableHead>
                <TableHead>Route fence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={12}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={rows.length === 0}
                emptyMessage="No routes found"
              >
                {rows.map((r) => (
                  <Fragment key={r.route_id}>
                    <TableRow className="hover:bg-gray-50" data-testid={`route-row-${r.route_id}`}>
                      <TableCell className="p-1 w-10">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={expandedRouteId === r.route_id ? "Collapse stops" : "Expand stops"}
                          onClick={() => setExpandedRouteId(expandedRouteId === r.route_id ? null : r.route_id)}
                        >
                          {expandedRouteId === r.route_id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-[12px] font-medium">{r.route_id}</TableCell>
                    <TableCell className="text-[12px] py-3 leading-relaxed" title={r.name}>
                      {r.name}
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-600">{r.origin || "—"}</TableCell>
                    <TableCell className="text-[12px] text-gray-600">{r.destination || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-[12px]">
                      {r.distance_km != null ? Number(r.distance_km).toLocaleString("en-IN") : "—"}
                    </TableCell>
                    <TableCell className="text-[12px]">{r.depot || "—"}</TableCell>
                    <TableCell className="text-center font-mono text-[12px]">{r.stop_count ?? (Array.isArray(r.stops) ? r.stops.length : 0)}</TableCell>
                    <TableCell className="text-[12px] max-w-[200px]">
                      {(() => {
                        const hasAlt = !!(r.alternate_charging_stop_id || "").trim();
                        if (!hasAlt) return <span className="text-gray-400">—</span>;
                        const st = (r.charging_point_status || "unknown").toLowerCase();
                        return (
                          <>
                            <div
                              className="leading-snug text-gray-800"
                              title={r.alternate_charging_display || r.alternate_charging_stop_id || ""}
                            >
                              {r.alternate_charging_display || r.alternate_charging_stop_id}
                            </div>
                            {st !== "unknown" ? (
                              <Badge
                                variant="outline"
                                className={
                                  st === "available"
                                    ? "mt-1 text-[12px] border-green-300 text-green-800 bg-green-50"
                                    : st === "occupied"
                                      ? "mt-1 text-[12px] border-amber-300 text-amber-900 bg-amber-50"
                                      : st === "maintenance"
                                        ? "mt-1 text-[12px] border-blue-300 text-blue-800 bg-blue-50"
                                        : st === "offline"
                                          ? "mt-1 text-[12px] border-gray-300 text-gray-700 bg-gray-50"
                                          : "mt-1 text-[12px] border-slate-200 text-slate-600 bg-slate-50"
                                }
                              >
                                {st}
                              </Badge>
                            ) : null}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {routeFenceMap[r.route_id] ? (
                        <Badge className="text-[12px]" variant={routeFenceMap[r.route_id].active ? "default" : "outline"}>
                          {routeFenceMap[r.route_id].buffer_m ? `${routeFenceMap[r.route_id].buffer_m}m` : "linked"}
                        </Badge>
                      ) : (
                        <Badge className="text-[12px]" variant="outline">
                          missing
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          r.active !== false
                            ? "text-[12px] bg-green-100 text-green-700 hover:bg-green-100"
                            : "text-[12px] bg-gray-100 text-gray-600 hover:bg-gray-100"
                        }
                      >
                        {r.active !== false ? "active" : "inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(r)} data-testid={`edit-route-${r.route_id}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(r.route_id)}
                          data-testid={`delete-route-${r.route_id}`}
                        >
                          <Trash2 size={14} className="text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                    {expandedRouteId === r.route_id ? (
                      <TableRow key={`${r.route_id}-stops`} className="bg-amber-50/50">
                        <TableCell colSpan={12} className="p-4">
                          <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-800 mb-2">
                            <MapPin size={16} className="text-[#C8102E]" />
                            Stops — {r.name} ({r.origin} → {r.destination})
                          </div>
                          {sortResolvedStops(r.stops).length === 0 ? (
                            <p className="text-[12px] text-gray-500">No stops defined. Edit the route to add boarding points from stop master.</p>
                          ) : (
                            (() => {
                              const allStops = sortResolvedStops(r.stops);
                              const totalStops = allStops.length;
                              const stopPages = Math.max(1, Math.ceil(totalStops / ROUTE_STOPS_PAGE_SIZE));
                              const safePage = Math.min(expandedStopsPage, stopPages);
                              const pagedStops = allStops.slice(
                                (safePage - 1) * ROUTE_STOPS_PAGE_SIZE,
                                safePage * ROUTE_STOPS_PAGE_SIZE
                              );
                              return (
                                <div className="space-y-0">
                                  <div className="rounded-md border border-amber-200/80 bg-white overflow-hidden">
                                    <Table className="text-[12px]">
                                      <TableHeader>
                                        <TableRow className="bg-amber-100/60">
                                          <TableHead className="w-14 text-[12px]">Seq</TableHead>
                                          <TableHead className="min-w-[100px] text-[12px]">Stop ID</TableHead>
                                          <TableHead className="text-[12px]">Stop name</TableHead>
                                          <TableHead className="text-[12px]">Locality</TableHead>
                                          <TableHead className="text-[12px]">Landmark</TableHead>
                                          <TableHead className="text-right text-[12px]">Lat</TableHead>
                                          <TableHead className="text-right text-[12px]">Lng</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {pagedStops.map((s) => (
                                          <TableRow key={`${r.route_id}-s-${s.seq}-${s.stop_id || s.name}`}>
                                            <TableCell className="font-mono text-[12px]">{s.seq}</TableCell>
                                            <TableCell className="font-mono text-[12px] text-gray-700">{s.stop_id || "—"}</TableCell>
                                            <TableCell className="text-[12px] font-medium">{s.name}</TableCell>
                                            <TableCell className="text-[12px] text-gray-600">{s.locality || "—"}</TableCell>
                                            <TableCell className="text-[12px] text-gray-500">{s.landmark || "—"}</TableCell>
                                            <TableCell className="text-right font-mono text-[12px] text-gray-600">
                                              {s.lat != null ? Number(s.lat).toFixed(4) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[12px] text-gray-600">
                                              {s.lng != null ? Number(s.lng).toFixed(4) : "—"}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                  {totalStops > ROUTE_STOPS_PAGE_SIZE ? (
                                    <TablePaginationBar
                                      page={safePage}
                                      pages={stopPages}
                                      total={totalStops}
                                      limit={ROUTE_STOPS_PAGE_SIZE}
                                      onPageChange={setExpandedStopsPage}
                                      className="rounded-b-md border border-t-0 border-amber-200/80 bg-amber-50/50"
                                    />
                                  ) : null}
                                </div>
                              );
                            })()
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar 
            page={page} 
            pages={meta.pages} 
            total={meta.total} 
            limit={meta.limit} 
            onPageChange={setPage} 
            onLimitChange={(l) => {
              setPage(1);
              setMetaLimit(l);
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="route-dialog"
          className={`max-w-lg max-h-[90vh] overflow-y-auto ${routePageText}`}
        >
          <DialogHeader>
            <DialogTitle className="!text-[12px]">{editingId ? "Edit route" : "Add route"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Route ID</Label>
              <Input
                value={form.route_id}
                onChange={(e) => setForm({ ...form, route_id: e.target.value })}
                disabled={!!editingId}
                placeholder="e.g. RT-701"
                data-testid="route-id-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Name (exact label on TIM / revenue)</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Route-701 Hitech-Gachibowli"
                data-testid="route-name-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Origin</Label>
                <Input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} data-testid="route-origin" />
              </div>
              <div className="space-y-2">
                <Label>Destination</Label>
                <Input
                  value={form.destination}
                  onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  data-testid="route-destination"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Distance (km)</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                value={form.distance_km}
                onChange={(e) => setForm({ ...form, distance_km: e.target.value })}
                data-testid="route-distance"
              />
            </div>
            <div className="space-y-2">
              <Label>Operating depot</Label>
              <Select value={form.depot || "none"} onValueChange={(v) => setForm({ ...form, depot: v === "none" ? "" : v })}>
                <SelectTrigger className="h-8" data-testid="route-depot">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent className={selectContent12}>
                  <SelectItem value="none">None</SelectItem>
                  {depotNames.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="!text-[12px]">Stops (from master)</Label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/bus-stops">Manage stops</Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addStopRow}>
                    <Plus size={14} className="mr-1" /> Add row
                  </Button>
                </div>
              </div>
              <p className="text-[12px] text-gray-500">
                Pick a <span className="font-mono">stop_id</span> for each sequence. Rows with no stop are ignored on save. Names and coordinates live on the Stops page. Use{" "}
                <strong>Add row</strong> / trash to change the list — same pattern as linking stops on{" "}
                <Link to="/bus-terminals" className="text-[#C8102E] font-medium hover:underline">
                  Terminals
                </Link>
                . Any route that includes a stop will show under that terminal&apos;s <strong>Served routes</strong> after save.
              </p>
              {masterStops.length === 0 ? (
                <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                  No active stops loaded. Open <Link to="/bus-stops" className="underline font-medium">Stops</Link> and add stops, or check the API connection.
                </p>
              ) : null}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(form.stop_sequence || []).map((s, idx) => (
                  <div key={`stop-${idx}`} className="grid grid-cols-12 gap-2 items-end border border-gray-100 rounded-md p-2 bg-gray-50/80">
                    <div className="col-span-2 space-y-1">
                      <span className="text-[12px] uppercase text-gray-500">Seq</span>
                      <Input
                        className="h-8 text-[12px]"
                        value={s.seq}
                        onChange={(e) => updateStopRow(idx, "seq", e.target.value)}
                        data-testid={`route-stop-seq-${idx}`}
                      />
                    </div>
                    <div className="col-span-9 space-y-1">
                      <span className="text-[12px] uppercase text-gray-500">Stop</span>
                      <Select
                        value={s.stop_id || "__none__"}
                        onValueChange={(v) => updateStopRow(idx, "stop_id", v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger className="h-8 text-[12px]" data-testid={`route-stop-select-${idx}`}>
                          <SelectValue placeholder="Choose stop…" />
                        </SelectTrigger>
                        <SelectContent className={`max-h-64 ${selectContent12}`}>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {masterStops.map((ms) => (
                            <SelectItem key={ms.stop_id} value={ms.stop_id}>
                              <span className="font-mono text-[12px]">{ms.stop_id}</span>
                              <span className="text-gray-600 text-[12px]">
                                {" "}
                                — {ms.name}
                                {ms.active === false ? " (inactive)" : ""}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 flex justify-end pb-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeStopRow(idx)} aria-label="Remove stop">
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <Label>Alternate charging point</Label>
              <p className="text-[12px] text-gray-500">Choose a stop from this route&apos;s sequence (add stops above first).</p>
              <Select
                value={form.alternate_charging_stop_id || "none"}
                onValueChange={(v) => setForm({ ...form, alternate_charging_stop_id: v === "none" ? "" : v })}
              >
                <SelectTrigger className="h-8" data-testid="route-alternate-charging">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent className={selectContent12}>
                  <SelectItem value="none">— None —</SelectItem>
                  {stopIdsFromFormSequence(form.stop_sequence).map((sid) => {
                    const ms = masterStops.find((m) => m.stop_id === sid);
                    return (
                      <SelectItem key={sid} value={sid}>
                        <span className="font-mono text-[12px]">{sid}</span>
                        {ms ? <span className="text-gray-600 text-[12px]"> — {ms.name}</span> : null}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Charging status</Label>
              <Select
                value={form.charging_point_status || "unknown"}
                onValueChange={(v) => setForm({ ...form, charging_point_status: v })}
              >
                <SelectTrigger className="h-8" data-testid="route-charging-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={selectContent12}>
                  {CHARGING_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="route-active"
                checked={!!form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="route-active" className="font-normal cursor-pointer">
                Active
              </Label>
            </div>
            <Button onClick={handleSave} disabled={isSaving} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="route-save-btn">
              {isSaving ? "Saving..." : (editingId ? "Update" : "Save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
