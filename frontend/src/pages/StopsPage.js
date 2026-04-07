import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../lib/api";
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
import { Plus, Pencil, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";

const empty = {
  stop_id: "",
  name: "",
  locality: "",
  landmark: "",
  region: "Hyderabad",
  lat: "",
  lng: "",
  active: true,
};

export default function StopsPage() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(empty);
  const [filterRegion, setFilterRegion] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await API.get("/stop-master", {
        params: buildQuery({ region: filterRegion, active: filterActive, search, page, limit: 20 }),
      });
      const u = unwrapListResponse(data);
      setRows(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load stops"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterRegion, filterActive, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    const sid = (form.stop_id || "").trim();
    const nm = (form.name || "").trim();
    if (!nm) {
      toast.error("Name is required");
      return;
    }
    if (!editingId && !sid) {
      toast.error("Stop ID is required");
      return;
    }
    const payload = {
      name: nm,
      locality: (form.locality || "").trim(),
      landmark: (form.landmark || "").trim(),
      region: (form.region || "Hyderabad").trim() || "Hyderabad",
      active: !!form.active,
      lat: form.lat === "" ? null : Number(form.lat),
      lng: form.lng === "" ? null : Number(form.lng),
    };
    try {
      if (editingId) {
        await API.put(`/stop-master/${encodeURIComponent(editingId)}`, payload);
        toast.success("Stop updated");
      } else {
        await API.post("/stop-master", { ...payload, stop_id: sid });
        toast.success("Stop created");
      }
      setOpen(false);
      setEditingId(null);
      setForm(empty);
      load();
    } catch (err) {
      toast.error(messageFromAxiosError(err, "Could not save stop"));
    }
  };

  const handleDelete = (stopId) => {
    if (!window.confirm(`Delete stop "${stopId}"? It must not be used on any route.`)) return;
    (async () => {
      try {
        await API.delete(`/stop-master/${encodeURIComponent(stopId)}`);
        toast.success("Deleted");
        load();
      } catch (err) {
        toast.error(messageFromAxiosError(err, "Could not delete"));
      }
    })();
  };

  const openEdit = (s) => {
    setForm({
      stop_id: s.stop_id || "",
      name: s.name || "",
      locality: s.locality || "",
      landmark: s.landmark || "",
      region: s.region || "Hyderabad",
      lat: s.lat != null ? String(s.lat) : "",
      lng: s.lng != null ? String(s.lng) : "",
      active: s.active !== false,
    });
    setEditingId(s.stop_id);
    setOpen(true);
  };

  return (
    <div data-testid="stops-page">
      <div className="page-header">
        <h1 className="page-title">Stops</h1>
        <Button
          onClick={() => {
            setForm(empty);
            setEditingId(null);
            setOpen(true);
          }}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="add-stop-btn"
        >
          <Plus size={16} className="mr-1.5" /> Add stop
        </Button>
      </div>

      <p className="page-lead max-w-3xl text-gray-500">
        <MapPin className="inline w-4 h-4 mr-1 text-[#C8102E] align-text-bottom" />
        Shared <strong>stop master</strong> — the same stop (e.g. Tarnaka) can appear on multiple routes. Assign ordered stops on the{" "}
        <Link to="/bus-routes" className="text-[#C8102E] font-medium hover:underline">
          Routes
        </Link>{" "}
        page. Demo data covers Hyderabad / Telangana (ST-HYD-*).
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Search</label>
          <Input
            placeholder="ID, name, locality…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-56"
            data-testid="stops-search"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Region</label>
          <Input
            placeholder="e.g. Hyderabad"
            value={filterRegion}
            onChange={(e) => {
              setFilterRegion(e.target.value);
              setPage(1);
            }}
            className="w-44"
            data-testid="stops-filter-region"
          />
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
            <SelectTrigger className="w-40" data-testid="stops-filter-active">
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
                <TableHead>Stop ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Locality</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="text-right">Routes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={7}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={rows.length === 0}
                emptyMessage="No stops found"
              >
                {rows.map((s) => (
                  <TableRow key={s.stop_id} className="hover:bg-gray-50" data-testid={`stop-row-${s.stop_id}`}>
                    <TableCell className="font-mono text-sm font-medium">{s.stop_id}</TableCell>
                    <TableCell className="text-sm">{s.name}</TableCell>
                    <TableCell className="text-sm text-gray-600">{s.locality || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600">{s.region || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{s.route_count ?? 0}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          s.active !== false
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-100"
                        }
                      >
                        {s.active !== false ? "active" : "inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)} data-testid={`edit-stop-${s.stop_id}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(s.stop_id)} data-testid={`delete-stop-${s.stop_id}`}>
                          <Trash2 size={14} className="text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="stop-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit stop" : "Add stop"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Stop ID</Label>
              <Input
                value={form.stop_id}
                onChange={(e) => setForm({ ...form, stop_id: e.target.value })}
                disabled={!!editingId}
                placeholder="e.g. ST-HYD-TAR"
                data-testid="stop-id-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="stop-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Locality</Label>
                <Input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} data-testid="stop-locality" />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} data-testid="stop-region" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Landmark</Label>
              <Input value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} data-testid="stop-landmark" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="font-mono" placeholder="17.xxx" />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className="font-mono" placeholder="78.xxx" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="stop-active"
                checked={!!form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="stop-active" className="font-normal cursor-pointer">
                Active
              </Label>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="stop-save-btn">
              {editingId ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
