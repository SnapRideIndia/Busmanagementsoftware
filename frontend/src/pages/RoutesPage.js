import { useState, useEffect, useCallback, Fragment } from "react";
import { Link } from "react-router-dom";
import API, { buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
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

const emptyForm = {
  route_id: "",
  name: "",
  origin: "",
  destination: "",
  distance_km: "",
  depot: "",
  active: true,
  stop_sequence: [],
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
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterDepot, setFilterDepot] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [depotNames, setDepotNames] = useState([]);
  const [masterStops, setMasterStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [expandedRouteId, setExpandedRouteId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const depots = await fetchAllPaginated("/depots", {});
        setDepotNames(depots.map((d) => d.name).filter(Boolean).sort());
      } catch {
        setDepotNames([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stops = await fetchAllPaginated("/stop-master", {});
        setMasterStops([...stops].sort((a, b) => String(a.name).localeCompare(String(b.name))));
      } catch {
        setMasterStops([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await API.get("/route-master", {
        params: buildQuery({ depot: filterDepot, active: filterActive, search, page, limit: 20 }),
      });
      const u = unwrapListResponse(data);
      setRows(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load routes"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterDepot, filterActive, search, page]);

  useEffect(() => {
    load();
  }, [load]);

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
    const payload = {
      name,
      origin: (form.origin || "").trim(),
      destination: (form.destination || "").trim(),
      distance_km: form.distance_km === "" ? 0 : Number(form.distance_km),
      depot: (form.depot || "").trim(),
      active: !!form.active,
      stop_sequence: stopSequenceForApi(form.stop_sequence),
    };
    try {
      if (editingId) {
        await API.put(`/bus-routes/${encodeURIComponent(editingId)}`, payload);
        toast.success("Route updated");
      } else {
        await API.post("/bus-routes", { ...payload, route_id: routeId });
        toast.success("Route created");
      }
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(messageFromAxiosError(err, "Could not save route"));
    }
  };

  const handleDelete = async (routeId) => {
    if (!window.confirm(`Delete route "${routeId}"?`)) return;
    try {
      await API.delete(`/bus-routes/${encodeURIComponent(routeId)}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(messageFromAxiosError(err, "Could not delete route"));
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
    setForm({
      ...form,
      stop_sequence: rows.length ? rows : [{ seq: "1", stop_id: "" }],
    });
  };

  const updateStopRow = (index, field, value) => {
    const rows = [...(form.stop_sequence || [])];
    rows[index] = { ...rows[index], [field]: value };
    setForm({ ...form, stop_sequence: rows });
  };

  return (
    <div data-testid="routes-page">
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
          master (same stop can appear on several routes). Demo data: RT-101–RT-606.
        </span>
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Search</label>
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
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select
            value={filterDepot || "all"}
            onValueChange={(v) => {
              setFilterDepot(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48" data-testid="routes-filter-depot">
              <SelectValue placeholder="All depots" />
            </SelectTrigger>
            <SelectContent>
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
          <label className="text-xs font-medium uppercase text-gray-500">Status</label>
          <Select
            value={filterActive || "all"}
            onValueChange={(v) => {
              setFilterActive(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40" data-testid="routes-filter-active">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
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
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={10}
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
                      <TableCell className="font-mono text-sm font-medium">{r.route_id}</TableCell>
                    <TableCell className="text-sm max-w-[220px] truncate" title={r.name}>
                      {r.name}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{r.origin || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600">{r.destination || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.distance_km != null ? Number(r.distance_km).toLocaleString("en-IN") : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{r.depot || "—"}</TableCell>
                    <TableCell className="text-center font-mono text-sm">{r.stop_count ?? (Array.isArray(r.stops) ? r.stops.length : 0)}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          r.active !== false
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-100"
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
                        <TableCell colSpan={10} className="p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
                            <MapPin size={16} className="text-[#C8102E]" />
                            Stops — {r.name} ({r.origin} → {r.destination})
                          </div>
                          {sortResolvedStops(r.stops).length === 0 ? (
                            <p className="text-sm text-gray-500">No stops defined. Edit the route to add boarding points from stop master.</p>
                          ) : (
                            <div className="rounded-md border border-amber-200/80 bg-white overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-amber-100/60">
                                    <TableHead className="w-14">Seq</TableHead>
                                    <TableHead className="min-w-[100px]">Stop ID</TableHead>
                                    <TableHead>Stop name</TableHead>
                                    <TableHead>Locality</TableHead>
                                    <TableHead>Landmark</TableHead>
                                    <TableHead className="text-right">Lat</TableHead>
                                    <TableHead className="text-right">Lng</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {sortResolvedStops(r.stops).map((s) => (
                                    <TableRow key={`${r.route_id}-s-${s.seq}-${s.stop_id || s.name}`}>
                                      <TableCell className="font-mono text-sm">{s.seq}</TableCell>
                                      <TableCell className="font-mono text-xs text-gray-700">{s.stop_id || "—"}</TableCell>
                                      <TableCell className="text-sm font-medium">{s.name}</TableCell>
                                      <TableCell className="text-sm text-gray-600">{s.locality || "—"}</TableCell>
                                      <TableCell className="text-sm text-gray-500">{s.landmark || "—"}</TableCell>
                                      <TableCell className="text-right font-mono text-xs text-gray-600">
                                        {s.lat != null ? Number(s.lat).toFixed(4) : "—"}
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-xs text-gray-600">
                                        {s.lng != null ? Number(s.lng).toFixed(4) : "—"}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="route-dialog" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit route" : "Add route"}</DialogTitle>
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
                <SelectTrigger data-testid="route-depot">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
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
                <Label className="text-base">Stops (from master)</Label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/bus-stops">Manage stops</Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addStopRow}>
                    <Plus size={14} className="mr-1" /> Add row
                  </Button>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Pick a <span className="font-mono">stop_id</span> for each sequence. Rows with no stop are ignored on save. Names and coordinates live on the Stops page.
              </p>
              {masterStops.length === 0 ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                  No active stops loaded. Open <Link to="/bus-stops" className="underline font-medium">Stops</Link> and add stops, or check the API connection.
                </p>
              ) : null}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(form.stop_sequence || []).map((s, idx) => (
                  <div key={`stop-${idx}`} className="grid grid-cols-12 gap-2 items-end border border-gray-100 rounded-md p-2 bg-gray-50/80">
                    <div className="col-span-2 space-y-1">
                      <span className="text-[10px] uppercase text-gray-500">Seq</span>
                      <Input
                        className="h-8 text-sm"
                        value={s.seq}
                        onChange={(e) => updateStopRow(idx, "seq", e.target.value)}
                        data-testid={`route-stop-seq-${idx}`}
                      />
                    </div>
                    <div className="col-span-9 space-y-1">
                      <span className="text-[10px] uppercase text-gray-500">Stop</span>
                      <Select
                        value={s.stop_id || "__none__"}
                        onValueChange={(v) => updateStopRow(idx, "stop_id", v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid={`route-stop-select-${idx}`}>
                          <SelectValue placeholder="Choose stop…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          <SelectItem value="__none__">— None —</SelectItem>
                          {masterStops.map((ms) => (
                            <SelectItem key={ms.stop_id} value={ms.stop_id}>
                              <span className="font-mono text-xs">{ms.stop_id}</span>
                              <span className="text-gray-600">
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
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="route-save-btn">
              {editingId ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
