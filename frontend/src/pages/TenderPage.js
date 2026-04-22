import { useState, useEffect, useCallback } from "react";
import { useTenders, useTenderMutations } from "../features/tenders/api/useTenders";
import API, { formatApiError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
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

const empty = { tender_id: "", concessionaire: "", pk_rate: "", energy_rate: "", description: "", status: "active", annual_assured_bus_km: "" };

export default function TenderPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const { data, isLoading: loading, error: fetchError, refetch: load } = useTenders({
    page,
    limit: 30,
    search,
    status: filterStatus,
  });
  const tenders = data?.items || [];
  const meta = { total: data?.total || 0, pages: data?.pages || 1, limit: data?.limit || 30 };

  const { createTender, updateTender, deleteTender, isSaving } = useTenderMutations();

  useEffect(() => {
    setPage(1);
  }, [search, filterStatus]);

  const handleSave = async () => {
    try {
      const payload = {
        ...form,
        pk_rate: Number(form.pk_rate),
        energy_rate: Number(form.energy_rate),
        annual_assured_bus_km: form.annual_assured_bus_km === "" || form.annual_assured_bus_km == null ? 0 : Number(form.annual_assured_bus_km),
      };
      if (editing) {
        await updateTender({ id: editing, payload });
      } else {
        await createTender(payload);
      }
      setOpen(false);
      setEditing(null);
      setForm(empty);
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this tender?")) return;
    try {
      await deleteTender(id);
    } catch (err) {
      // Error handled in hook
    }
  };

  const openEdit = (t) => {
    setForm({
      tender_id: t.tender_id,
      concessionaire: t.concessionaire || "",
      pk_rate: t.pk_rate,
      energy_rate: t.energy_rate,
      description: t.description || "",
      status: t.status,
      annual_assured_bus_km: t.annual_assured_bus_km != null && t.annual_assured_bus_km !== "" ? String(t.annual_assured_bus_km) : "",
    });
    setEditing(t.tender_id);
    setOpen(true);
  };

  return (
    <div data-testid="tender-page">
      <div className="page-header">
        <h1 className="page-title">Tender Management</h1>
        <Button
          onClick={() => {
            setForm(empty);
            setEditing(null);
            setOpen(true);
          }}
          className="bg-[#C8102E] hover:bg-[#A50E25]"
          data-testid="add-tender-btn"
        >
          <Plus size={16} className="mr-1.5" /> Add Tender
        </Button>
      </div>
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <div className="border-b bg-gray-50/60 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500 uppercase">Search</Label>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tender ID / Description / Concessionaire" className="w-[300px] h-9" data-testid="tender-filter-search" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500 uppercase">Status</Label>
                <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-[140px] h-9" data-testid="tender-filter-status">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="ghost"
                className="h-9"
                onClick={() => {
                  setSearch("");
                  setFilterStatus("");
                }}
              >
                Clear
              </Button>
            </div>
          </div>
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>Tender ID</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Concessionaire</TableHead>
                <TableHead className="text-right">Assured km / bus / yr</TableHead>
                <TableHead className="text-right">PK Rate (Rs/km)</TableHead>
                <TableHead className="text-right">Energy Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows colSpan={8} loading={loading} error={fetchError} onRetry={load} isEmpty={tenders.length === 0} emptyMessage="No tenders found">
                {tenders.map((t) => (
                  <TableRow key={t.tender_id} className="hover:bg-gray-50" data-testid={`tender-row-${t.tender_id}`}>
                    <TableCell className="font-mono text-[12px] font-medium">{t.tender_id}</TableCell>
                    <TableCell className="text-[12px]">{t.description}</TableCell>
                    <TableCell className="text-[12px]">{t.concessionaire || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(t.annual_assured_bus_km || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{t.pk_rate}</TableCell>
                    <TableCell className="text-right font-mono">{t.energy_rate}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === "active" ? "default" : "secondary"} className={t.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(t)} data-testid={`edit-tender-${t.tender_id}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(t.tender_id)} data-testid={`delete-tender-${t.tender_id}`}>
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
        <DialogContent data-testid="tender-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Tender" : "Add Tender"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tender ID</Label>
              <Input value={form.tender_id} onChange={(e) => setForm({ ...form, tender_id: e.target.value })} disabled={!!editing} data-testid="tender-id-input" />
            </div>
            <div className="space-y-2">
              <Label>Concessionaire</Label>
              <Input value={form.concessionaire} onChange={(e) => setForm({ ...form, concessionaire: e.target.value })} data-testid="tender-concessionaire" />
            </div>
            <div className="space-y-2">
              <Label>Annual assured bus km (per bus / year)</Label>
              <Input
                type="number"
                min={0}
                value={form.annual_assured_bus_km}
                onChange={(e) => setForm({ ...form, annual_assured_bus_km: e.target.value })}
                placeholder="e.g. 72000 (Art. 22.3.1)"
                data-testid="tender-annual-assured-km"
              />
              <p className="text-[11px] text-gray-500">Minimum average scheduled km per bus per contract year for this lot (concession).</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>PK Rate (Rs/km)</Label>
                <Input type="number" value={form.pk_rate} onChange={(e) => setForm({ ...form, pk_rate: e.target.value })} data-testid="tender-pk-rate" />
              </div>
              <div className="space-y-2">
                <Label>Energy Rate (Rs/kWh)</Label>
                <Input type="number" value={form.energy_rate} onChange={(e) => setForm({ ...form, energy_rate: e.target.value })} data-testid="tender-energy-rate" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="tender-description" />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="tender-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} disabled={isSaving} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="tender-save-btn">
              {isSaving ? "Saving..." : (editing ? "Update" : "Save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
