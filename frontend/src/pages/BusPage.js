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
import { Plus, Pencil, Trash2, Eye, Link } from "lucide-react";
import { toast } from "sonner";

const emptyBus = { bus_id: "", bus_type: "12m_ac", capacity: "40", tender_id: "", depot: "", status: "active" };

export default function BusPage() {
  const [buses, setBuses] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyBus);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBus, setAssignBus] = useState("");
  const [assignTender, setAssignTender] = useState("");

  const load = async () => {
    try {
      const [b, t] = await Promise.all([API.get("/buses"), API.get("/tenders")]);
      setBuses(b.data); setTenders(t.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    try {
      const payload = { ...form, capacity: Number(form.capacity) };
      if (editing) { await API.put(`/buses/${editing}`, payload); toast.success("Bus updated"); }
      else { await API.post("/buses", payload); toast.success("Bus added"); }
      setOpen(false); setEditing(null); setForm(emptyBus); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this bus?")) return;
    try { await API.delete(`/buses/${id}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const viewDetail = async (id) => {
    try { const { data } = await API.get(`/buses/${id}`); setDetail(data); setDetailOpen(true); }
    catch {}
  };

  const handleAssign = async () => {
    try {
      await API.put(`/buses/${assignBus}/assign-tender?tender_id=${assignTender}`);
      toast.success("Tender assigned"); setAssignOpen(false); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const busTypeLabel = (t) => ({ "12m_ac": "12m AC", "9m_ac": "9m AC", "12m_non_ac": "12m Non-AC", "9m_non_ac": "9m Non-AC" }[t] || t);

  return (
    <div data-testid="bus-page">
      <div className="page-header">
        <h1 className="page-title">Bus Master</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)} data-testid="assign-tender-btn">
            <Link size={14} className="mr-1.5" /> Assign Tender
          </Button>
          <Button onClick={() => { setForm(emptyBus); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-bus-btn">
            <Plus size={16} className="mr-1.5" /> Add Bus
          </Button>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Type</TableHead><TableHead>Capacity</TableHead>
              <TableHead>Tender</TableHead><TableHead>Depot</TableHead><TableHead>kWh/km</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {buses.map((b) => (
                <TableRow key={b.bus_id} className="hover:bg-gray-50" data-testid={`bus-row-${b.bus_id}`}>
                  <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                  <TableCell>{busTypeLabel(b.bus_type)}</TableCell>
                  <TableCell className="font-mono">{b.capacity}</TableCell>
                  <TableCell className="font-mono text-sm">{b.tender_id || "-"}</TableCell>
                  <TableCell>{b.depot || "-"}</TableCell>
                  <TableCell className="font-mono">{b.kwh_per_km}</TableCell>
                  <TableCell>
                    <Badge className={b.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : b.status === "maintenance" ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => viewDetail(b.bus_id)} data-testid={`view-bus-${b.bus_id}`}><Eye size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { setForm(b); setEditing(b.bus_id); setOpen(true); }} data-testid={`edit-bus-${b.bus_id}`}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(b.bus_id)} data-testid={`delete-bus-${b.bus_id}`}><Trash2 size={14} className="text-red-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {buses.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-8">No buses found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="bus-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Bus" : "Add Bus"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Bus ID</Label><Input value={form.bus_id} onChange={(e) => setForm({ ...form, bus_id: e.target.value })} disabled={!!editing} data-testid="bus-id-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.bus_type} onValueChange={(v) => setForm({ ...form, bus_type: v })}>
                  <SelectTrigger data-testid="bus-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12m_ac">12m AC</SelectItem><SelectItem value="9m_ac">9m AC</SelectItem>
                    <SelectItem value="12m_non_ac">12m Non-AC</SelectItem><SelectItem value="9m_non_ac">9m Non-AC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} data-testid="bus-capacity" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Depot</Label><Input value={form.depot} onChange={(e) => setForm({ ...form, depot: e.target.value })} data-testid="bus-depot" /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="bus-status"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="bus-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg" data-testid="bus-detail-dialog">
          <DialogHeader><DialogTitle>Bus Details - {detail?.bus_id}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Type:</span> {busTypeLabel(detail.bus_type)}</div>
                <div><span className="text-gray-500">Capacity:</span> {detail.capacity}</div>
                <div><span className="text-gray-500">Tender:</span> {detail.tender_id || "None"}</div>
                <div><span className="text-gray-500">Depot:</span> {detail.depot || "None"}</div>
                <div><span className="text-gray-500">kWh/km:</span> {detail.kwh_per_km}</div>
                <div><span className="text-gray-500">Status:</span> {detail.status}</div>
              </div>
              <p className="text-gray-500 font-medium mt-3">Recent Trips: {detail.trips?.length || 0}</p>
              <p className="text-gray-500 font-medium">Energy Records: {detail.energy?.length || 0}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Tender Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent data-testid="assign-dialog">
          <DialogHeader><DialogTitle>Assign Tender to Bus</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bus</Label>
              <Select value={assignBus} onValueChange={setAssignBus}>
                <SelectTrigger data-testid="assign-bus-select"><SelectValue placeholder="Select bus" /></SelectTrigger>
                <SelectContent>{buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tender</Label>
              <Select value={assignTender} onValueChange={setAssignTender}>
                <SelectTrigger data-testid="assign-tender-select"><SelectValue placeholder="Select tender" /></SelectTrigger>
                <SelectContent>{tenders.map((t) => <SelectItem key={t.tender_id} value={t.tender_id}>{t.tender_id} - {t.description}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleAssign} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="assign-save-btn">Assign</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
