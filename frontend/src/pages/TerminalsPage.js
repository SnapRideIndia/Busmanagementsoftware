import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTerminals, useTerminalMutations } from "../features/terminals/api/useTerminals";
import { useAllStops } from "../features/stops/api/useStops";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Plus, Pencil, Trash2, Building2, X } from "lucide-react";
import { toast } from "sonner";

const empty = {
  terminal_id: "",
  name: "",
  locality: "",
  landmark: "",
  region: "Hyderabad",
  linked_stop_ids: [],
  lat: "",
  lng: "",
  notes: "",
  active: true,
};

export default function TerminalsPage() {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(empty);
  const [filterActive, setFilterActive] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [metaLimit, setMetaLimit] = useState(30);

  const { data: masterStops = [] } = useAllStops();
  const { data: terminalsData, isLoading: loading, error: fetchError, refetch: load } = useTerminals({
    active: filterActive,
    search,
    page,
    limit: metaLimit,
  });

  const rows = terminalsData?.items || [];
  const meta = {
    total: terminalsData?.total || 0,
    pages: terminalsData?.pages || 1,
    limit: terminalsData?.limit || metaLimit,
  };

  const { createTerminal, updateTerminal, deleteTerminal, isSaving } = useTerminalMutations();

  useEffect(() => {
    setPage(1);
  }, [search, filterActive]);

  const stopsToAdd = useMemo(() => {
    const sel = new Set(form.linked_stop_ids || []);
    return (masterStops || []).filter((s) => s.stop_id && !sel.has(s.stop_id));
  }, [masterStops, form.linked_stop_ids]);

  const addLinkedStop = (stopId) => {
    if (!stopId || stopId === "__none__") return;
    setForm((f) => ({
      ...f,
      linked_stop_ids: [...(f.linked_stop_ids || []), stopId],
    }));
  };

  const removeLinkedStop = (stopId) => {
    setForm((f) => ({
      ...f,
      linked_stop_ids: (f.linked_stop_ids || []).filter((x) => x !== stopId),
    }));
  };

  const handleSave = async () => {
    const tid = (form.terminal_id || "").trim();
    const nm = (form.name || "").trim();
    if (!nm) {
      toast.error("Name is required");
      return;
    }
    if (!editingId && !tid) {
      toast.error("Terminal ID is required");
      return;
    }
    if (!(form.linked_stop_ids || []).length) {
      toast.error("Link at least one stop from the master");
      return;
    }
    const payload = {
      name: nm,
      locality: (form.locality || "").trim(),
      landmark: (form.landmark || "").trim(),
      region: (form.region || "Hyderabad").trim() || "Hyderabad",
      linked_stop_ids: form.linked_stop_ids,
      active: !!form.active,
      notes: (form.notes || "").trim(),
      lat: form.lat === "" ? null : Number(form.lat),
      lng: form.lng === "" ? null : Number(form.lng),
    };
    try {
      if (editingId) {
        await updateTerminal({ id: editingId, payload });
      } else {
        await createTerminal({ ...payload, terminal_id: tid });
      }
      setOpen(false);
      setEditingId(null);
      setForm(empty);
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleDelete = async (terminalId) => {
    if (!window.confirm(`Delete terminal "${terminalId}"?`)) return;
    try {
      await deleteTerminal(terminalId);
    } catch (err) {
      // Error handled in hook
    }
  };

  const openEdit = (t) => {
    setForm({
      terminal_id: t.terminal_id || "",
      name: t.name || "",
      locality: t.locality || "",
      landmark: t.landmark || "",
      region: t.region || "Hyderabad",
      linked_stop_ids: Array.isArray(t.linked_stop_ids) ? [...t.linked_stop_ids] : [],
      lat: t.lat != null ? String(t.lat) : "",
      lng: t.lng != null ? String(t.lng) : "",
      notes: t.notes || "",
      active: t.active !== false,
    });
    setEditingId(t.terminal_id);
    setOpen(true);
  };

  const fmtCoord = (v) => (v != null && v !== "" ? Number(v).toFixed(5) : "—");

  return (
    <div data-testid="terminals-page">
      <div className="page-header">
        <h1 className="page-title">Terminals</h1>
        <Button
          onClick={() => {
            setForm(empty);
            setEditingId(null);
            setOpen(true);
          }}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="add-terminal-btn"
        >
          <Plus size={16} className="mr-1.5" /> Add terminal
        </Button>
      </div>

      <p className="page-lead max-w-3xl text-gray-500">
        <Building2 className="inline w-4 h-4 mr-1 text-[#C8102E] align-text-bottom" />
        Major <strong>bus stands / terminals</strong> — each row links to one or more stops in{" "}
        <Link to="/bus-stops" className="text-[#C8102E] font-medium hover:underline">
          Stops
        </Link>
        . <strong>Served routes</strong> come from{" "}
        <Link to="/bus-routes" className="text-[#C8102E] font-medium hover:underline">
          Routes
        </Link>{" "}
        whose stop list includes any linked stop. Change routes there — this table updates on refresh. Optional latitude /
        longitude here refine the stand when it differs from the stop master.
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
            data-testid="terminals-search"
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
            <SelectTrigger className="w-40" data-testid="terminals-filter-active">
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
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>Terminal ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Linked stops</TableHead>
                <TableHead className="text-right">Latitude</TableHead>
                <TableHead className="text-right">Longitude</TableHead>
                <TableHead>Served routes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={8}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={rows.length === 0}
                emptyMessage="No terminals found"
              >
                {rows.map((t) => (
                  <TableRow key={t.terminal_id} className="hover:bg-gray-50" data-testid={`terminal-row-${t.terminal_id}`}>
                    <TableCell className="font-mono text-[12px] font-medium">{t.terminal_id}</TableCell>
                    <TableCell className="text-[12px]">{t.name}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="flex flex-wrap gap-1">
                        {(t.linked_stops || []).map((s) => (
                          <Badge key={s.stop_id} variant="outline" className="font-mono text-[11px]">
                            {s.stop_id}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-700 text-right font-mono text-[11px]">{fmtCoord(t.display_lat)}</TableCell>
                    <TableCell className="text-[12px] text-gray-700 text-right font-mono text-[11px]">{fmtCoord(t.display_lng)}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex flex-wrap gap-1">
                        {(t.served_routes || []).map((r) => (
                          <span key={r.route_id} className="text-[11px] text-gray-700" title={r.name}>
                            <span className="font-mono">{r.route_id}</span>
                          </span>
                        ))}
                        {!(t.served_routes || []).length ? <span className="text-gray-400">—</span> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          t.active !== false
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-100"
                        }
                      >
                        {t.active !== false ? "active" : "inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(t)} data-testid={`edit-terminal-${t.terminal_id}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(t.terminal_id)}
                          data-testid={`delete-terminal-${t.terminal_id}`}
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
        <DialogContent data-testid="terminal-dialog" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit terminal" : "Add terminal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-[12px]">
            <div className="space-y-2">
              <Label>Terminal ID</Label>
              <Input
                value={form.terminal_id}
                onChange={(e) => setForm({ ...form, terminal_id: e.target.value })}
                disabled={!!editingId}
                placeholder="e.g. TRM-HYD-MGBS"
                data-testid="terminal-id-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bus stand name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Locality</Label>
                <Input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Landmark</Label>
              <Input value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
            </div>
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <Label>Linked stops (from master)</Label>
              <div className="flex flex-wrap gap-1 min-h-[32px]">
                {(form.linked_stop_ids || []).map((sid) => (
                  <Badge key={sid} variant="secondary" className="gap-1 font-mono text-[11px]">
                    {sid}
                    <button type="button" className="ml-0.5 rounded hover:bg-gray-300 p-0.5" onClick={() => removeLinkedStop(sid)} aria-label="Remove">
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
              </div>
              <Select
                key={(form.linked_stop_ids || []).join(",")}
                value="__none__"
                onValueChange={(v) => addLinkedStop(v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Add stop…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Choose stop to link…</SelectItem>
                  {stopsToAdd.map((s) => (
                    <SelectItem key={s.stop_id} value={s.stop_id}>
                      <span className="font-mono text-[12px]">{s.stop_id}</span>
                      <span className="text-gray-600"> — {s.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Lat (optional)</Label>
                <Input
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  placeholder="Leave empty to use stop"
                />
              </div>
              <div className="space-y-2">
                <Label>Lng (optional)</Label>
                <Input
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  placeholder="Leave empty to use stop"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="resize-y" />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="terminal-active"
                checked={!!form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="terminal-active" className="font-normal cursor-pointer">
                Active
              </Label>
            </div>
            <Button onClick={handleSave} disabled={isSaving} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="terminal-save-btn">
              {isSaving ? "Saving..." : (editingId ? "Update" : "Save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
