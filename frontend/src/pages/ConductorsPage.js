import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const emptyConductor = {
  name: "",
  badge_no: "",
  phone: "",
  depot: "",
  status: "active",
  rating: 4.5,
  total_trips: 0,
};

export default function ConductorsPage() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyConductor);
  const [filterDepot, setFilterDepot] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [depotNames, setDepotNames] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const depots = await fetchAllPaginated("/depots", {});
        setDepotNames(depots.map((x) => x.name).filter(Boolean).sort());
      } catch {
        setDepotNames([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await API.get(
        "/conductors",
        { params: buildQuery({ depot: filterDepot, status: filterStatus, page, limit: 20 }) }
      );
      const u = unwrapListResponse(res.data);
      setRows(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load conductors"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterDepot, filterStatus, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    try {
      const payload = {
        ...form,
        rating: Math.min(5, Math.max(0, Number(form.rating) || 0)),
        total_trips: Number(form.total_trips) || 0,
      };
      if (editing) {
        await API.put(`/conductors/${editing}`, payload);
        toast.success("Conductor updated");
      } else {
        await API.post("/conductors", payload);
        toast.success("Conductor added");
      }
      setOpen(false);
      setEditing(null);
      setForm(emptyConductor);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message || "Save failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this conductor?")) return;
    try {
      await API.delete(`/conductors/${id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message || "Delete failed");
    }
  };

  return (
    <div data-testid="conductors-page">
      <div className="page-header">
        <h1 className="page-title">Conductors</h1>
        <Button
          onClick={() => {
            setForm(emptyConductor);
            setEditing(null);
            setOpen(true);
          }}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="add-conductor-btn"
        >
          <Plus size={16} className="mr-1.5" /> Add conductor
        </Button>
      </div>
      <p className="page-desc mb-3 max-w-3xl">Field staff linked to depots; badge numbers must be unique.</p>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select
            value={filterDepot || "all"}
            onValueChange={(v) => {
              setFilterDepot(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44" data-testid="conductor-filter-depot">
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
            value={filterStatus || "all"}
            onValueChange={(v) => {
              setFilterStatus(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36" data-testid="conductor-filter-status">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Badge</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Trips</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={9}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={rows.length === 0}
                emptyMessage="No conductors found"
              >
                {rows.map((c) => (
                  <TableRow key={c.conductor_id} className="hover:bg-gray-50" data-testid={`conductor-row-${c.conductor_id}`}>
                    <TableCell className="font-mono text-xs">{c.conductor_id}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="font-mono text-sm">{c.badge_no}</TableCell>
                    <TableCell>{c.phone || "—"}</TableCell>
                    <TableCell>{c.depot || "—"}</TableCell>
                    <TableCell className="font-mono">
                      {Number(c.rating).toFixed(1)}
                      <span className="text-gray-400 text-xs ml-0.5">/ 5</span>
                    </TableCell>
                    <TableCell className="font-mono">{c.total_trips ?? 0}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          c.status === "active"
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-100"
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setForm({
                              name: c.name,
                              badge_no: c.badge_no,
                              phone: c.phone || "",
                              depot: c.depot || "",
                              status: c.status || "active",
                              rating: c.rating ?? 4.5,
                              total_trips: c.total_trips ?? 0,
                            });
                            setEditing(c.conductor_id);
                            setOpen(true);
                          }}
                          data-testid={`edit-conductor-${c.conductor_id}`}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(c.conductor_id)}
                          data-testid={`delete-conductor-${c.conductor_id}`}
                        >
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
        <DialogContent data-testid="conductor-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit conductor" : "Add conductor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="conductor-name" />
            </div>
            <div className="space-y-2">
              <Label>Badge number</Label>
              <Input
                value={form.badge_no}
                onChange={(e) => setForm({ ...form, badge_no: e.target.value })}
                disabled={!!editing}
                data-testid="conductor-badge"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="conductor-phone" />
            </div>
            <div className="space-y-2">
              <Label>Depot</Label>
              <Select value={form.depot || "__none"} onValueChange={(v) => setForm({ ...form, depot: v === "__none" ? "" : v })}>
                <SelectTrigger data-testid="conductor-depot">
                  <SelectValue placeholder="Select depot" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {depotNames.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="conductor-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Rating (0–5)</Label>
                <Input
                  type="number"
                  min={0}
                  max={5}
                  step="0.1"
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: e.target.value })}
                  data-testid="conductor-rating"
                />
              </div>
              <div className="space-y-2">
                <Label>Total trips</Label>
                <Input
                  type="number"
                  value={form.total_trips}
                  onChange={(e) => setForm({ ...form, total_trips: e.target.value })}
                  data-testid="conductor-trips"
                />
              </div>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="conductor-save-btn">
              {editing ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
