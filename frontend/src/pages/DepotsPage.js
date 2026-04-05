import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse } from "../lib/api";
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

const empty = { name: "", code: "", address: "", active: true };

export default function DepotsPage() {
  const [depots, setDepots] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingOriginalName, setEditingOriginalName] = useState(null);
  const [form, setForm] = useState(empty);
  const [filterActive, setFilterActive] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await API.get("/depots", { params: buildQuery({ active: filterActive, page, limit: 20 }) });
      const u = unwrapListResponse(data);
      setDepots(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
    } catch (err) {
      setFetchError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load depots");
      setDepots([]);
    } finally {
      setLoading(false);
    }
  }, [filterActive, page]);
  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name.trim(),
        code: (form.code || "").trim(),
        address: (form.address || "").trim(),
        active: !!form.active,
      };
      if (editingOriginalName) {
        await API.put(`/depots/${encodeURIComponent(editingOriginalName)}`, payload);
        toast.success("Depot updated");
      } else {
        await API.post("/depots", payload);
        toast.success("Depot added");
      }
      setOpen(false);
      setEditingOriginalName(null);
      setForm(empty);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete depot "${name}"?`)) return;
    try {
      await API.delete(`/depots/${encodeURIComponent(name)}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const openEdit = (d) => {
    setForm({
      name: d.name || "",
      code: d.code || "",
      address: d.address || "",
      active: d.active !== false,
    });
    setEditingOriginalName(d.name);
    setOpen(true);
  };

  return (
    <div data-testid="depots-page">
      <div className="page-header">
        <h1 className="page-title">Depots</h1>
        <Button
          onClick={() => {
            setForm(empty);
            setEditingOriginalName(null);
            setOpen(true);
          }}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="add-depot-btn"
        >
          <Plus size={16} className="mr-1.5" /> Add Depot
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Status</label>
          <Select value={filterActive || "all"} onValueChange={(v) => { setFilterActive(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40" data-testid="depot-filter-active">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Active only</SelectItem>
              <SelectItem value="false">Inactive only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Buses</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={6}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={depots.length === 0}
                emptyMessage="No depots found"
              >
                {depots.map((d) => (
                  <TableRow key={d.name} className="hover:bg-gray-50" data-testid={`depot-row-${d.name}`}>
                    <TableCell className="font-medium text-sm">{d.name}</TableCell>
                    <TableCell className="text-sm text-gray-600">{d.code || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600 max-w-[240px] truncate" title={d.address}>
                      {d.address || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{d.bus_count ?? 0}</TableCell>
                    <TableCell>
                      <Badge
                        variant={d.active !== false ? "default" : "secondary"}
                        className={d.active !== false ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}
                      >
                        {d.active !== false ? "active" : "inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(d)} data-testid={`edit-depot-${d.name}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(d.name)}
                          data-testid={`delete-depot-${d.name}`}
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
        <DialogContent data-testid="depot-dialog">
          <DialogHeader>
            <DialogTitle>{editingOriginalName ? "Edit Depot" : "Add Depot"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Miyapur Depot"
                data-testid="depot-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Code (optional)</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                data-testid="depot-code-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                data-testid="depot-address-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.active ? "active" : "inactive"}
                onValueChange={(v) => setForm({ ...form, active: v === "active" })}
              >
                <SelectTrigger data-testid="depot-active-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="depot-save-btn">
              {editingOriginalName ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
