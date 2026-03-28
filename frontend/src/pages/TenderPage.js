import { useState, useEffect } from "react";
import API, { formatApiError } from "../lib/api";
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

const empty = { tender_id: "", pk_rate: "", energy_rate: "", subsidy_rate: "0", subsidy_type: "per_km", description: "", status: "active" };

export default function TenderPage() {
  const [tenders, setTenders] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    try { const { data } = await API.get("/tenders"); setTenders(data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    try {
      const payload = { ...form, pk_rate: Number(form.pk_rate), energy_rate: Number(form.energy_rate), subsidy_rate: Number(form.subsidy_rate) };
      if (editing) {
        await API.put(`/tenders/${editing}`, payload);
        toast.success("Tender updated");
      } else {
        await API.post("/tenders", payload);
        toast.success("Tender added");
      }
      setOpen(false); setEditing(null); setForm(empty); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this tender?")) return;
    try { await API.delete(`/tenders/${id}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const openEdit = (t) => {
    setForm({ tender_id: t.tender_id, pk_rate: t.pk_rate, energy_rate: t.energy_rate, subsidy_rate: t.subsidy_rate || 0, subsidy_type: t.subsidy_type || "per_km", description: t.description || "", status: t.status });
    setEditing(t.tender_id); setOpen(true);
  };

  return (
    <div data-testid="tender-page">
      <div className="page-header">
        <h1 className="page-title">Tender Management</h1>
        <Button onClick={() => { setForm(empty); setEditing(null); setOpen(true); }} className="bg-[#134219] hover:bg-[#0E3213]" data-testid="add-tender-btn">
          <Plus size={16} className="mr-1.5" /> Add Tender
        </Button>
      </div>
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>Tender ID</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">PK Rate (Rs/km)</TableHead>
                <TableHead className="text-right">Energy Rate</TableHead>
                <TableHead className="text-right">Subsidy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenders.map((t) => (
                <TableRow key={t.tender_id} className="hover:bg-gray-50" data-testid={`tender-row-${t.tender_id}`}>
                  <TableCell className="font-mono text-sm font-medium">{t.tender_id}</TableCell>
                  <TableCell className="text-sm">{t.description}</TableCell>
                  <TableCell className="text-right font-mono">{t.pk_rate}</TableCell>
                  <TableCell className="text-right font-mono">{t.energy_rate}</TableCell>
                  <TableCell className="text-right font-mono">{t.subsidy_rate} ({t.subsidy_type})</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "active" ? "default" : "secondary"} className={t.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(t)} data-testid={`edit-tender-${t.tender_id}`}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(t.tender_id)} data-testid={`delete-tender-${t.tender_id}`}><Trash2 size={14} className="text-red-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {tenders.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No tenders found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="tender-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Tender" : "Add Tender"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tender ID</Label>
              <Input value={form.tender_id} onChange={(e) => setForm({ ...form, tender_id: e.target.value })} disabled={!!editing} data-testid="tender-id-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>PK Rate (Rs/km)</Label><Input type="number" value={form.pk_rate} onChange={(e) => setForm({ ...form, pk_rate: e.target.value })} data-testid="tender-pk-rate" /></div>
              <div className="space-y-2"><Label>Energy Rate (Rs/kWh)</Label><Input type="number" value={form.energy_rate} onChange={(e) => setForm({ ...form, energy_rate: e.target.value })} data-testid="tender-energy-rate" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Subsidy Rate</Label><Input type="number" value={form.subsidy_rate} onChange={(e) => setForm({ ...form, subsidy_rate: e.target.value })} data-testid="tender-subsidy-rate" /></div>
              <div className="space-y-2">
                <Label>Subsidy Type</Label>
                <Select value={form.subsidy_type} onValueChange={(v) => setForm({ ...form, subsidy_type: v })}>
                  <SelectTrigger data-testid="tender-subsidy-type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="per_km">Per KM</SelectItem><SelectItem value="per_bus">Per Bus</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="tender-description" /></div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="tender-status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#134219] hover:bg-[#0E3213]" data-testid="tender-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
