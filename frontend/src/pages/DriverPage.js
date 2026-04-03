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
import { Plus, Pencil, Trash2, BarChart3, Link } from "lucide-react";
import { toast } from "sonner";

const emptyDriver = { name: "", license_number: "", phone: "", bus_id: "", status: "active" };

export default function DriverPage() {
  const [drivers, setDrivers] = useState([]);
  const [buses, setBuses] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyDriver);
  const [perfOpen, setPerfOpen] = useState(false);
  const [perf, setPerf] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDriver, setAssignDriver] = useState("");
  const [assignBus, setAssignBus] = useState("");

  const load = async () => {
    try {
      const [d, b] = await Promise.all([API.get("/drivers"), API.get("/buses")]);
      setDrivers(d.data); setBuses(b.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    try {
      if (editing) { await API.put(`/drivers/${editing}`, form); toast.success("Driver updated"); }
      else { await API.post("/drivers", form); toast.success("Driver added"); }
      setOpen(false); setEditing(null); setForm(emptyDriver); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (lic) => {
    if (!window.confirm("Delete this driver?")) return;
    try { await API.delete(`/drivers/${lic}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const viewPerf = async (lic) => {
    try { const { data } = await API.get(`/drivers/${lic}/performance`); setPerf(data); setPerfOpen(true); }
    catch {}
  };

  const handleAssign = async () => {
    try {
      await API.put(`/drivers/${assignDriver}/assign-bus?bus_id=${assignBus}`);
      toast.success("Bus assigned"); setAssignOpen(false); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div data-testid="driver-page">
      <div className="page-header">
        <h1 className="page-title">Driver Management</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)} data-testid="assign-driver-btn"><Link size={14} className="mr-1.5" /> Assign Bus</Button>
          <Button onClick={() => { setForm(emptyDriver); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-driver-btn">
            <Plus size={16} className="mr-1.5" /> Add Driver
          </Button>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Name</TableHead><TableHead>License</TableHead><TableHead>Phone</TableHead>
              <TableHead>Bus</TableHead><TableHead>Score</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {drivers.map((d) => (
                <TableRow key={d.license_number} className="hover:bg-gray-50" data-testid={`driver-row-${d.license_number}`}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="font-mono text-sm">{d.license_number}</TableCell>
                  <TableCell>{d.phone || "-"}</TableCell>
                  <TableCell className="font-mono">{d.bus_id || "-"}</TableCell>
                  <TableCell>
                    <span className={`font-mono font-medium ${d.performance_score >= 90 ? "text-green-600" : d.performance_score >= 70 ? "text-yellow-600" : "text-red-600"}`}>
                      {d.performance_score?.toFixed(1)}
                    </span>
                  </TableCell>
                  <TableCell><Badge className={d.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>{d.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => viewPerf(d.license_number)} data-testid={`perf-driver-${d.license_number}`}><BarChart3 size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { setForm(d); setEditing(d.license_number); setOpen(true); }} data-testid={`edit-driver-${d.license_number}`}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(d.license_number)} data-testid={`delete-driver-${d.license_number}`}><Trash2 size={14} className="text-red-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {drivers.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No drivers found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="driver-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Driver" : "Add Driver"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="driver-name" /></div>
            <div className="space-y-2"><Label>License Number</Label><Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} disabled={!!editing} data-testid="driver-license" /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="driver-phone" /></div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="driver-status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="driver-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Performance */}
      <Dialog open={perfOpen} onOpenChange={setPerfOpen}>
        <DialogContent data-testid="driver-perf-dialog">
          <DialogHeader><DialogTitle>Driver Performance</DialogTitle></DialogHeader>
          {perf && (
            <div className="space-y-3">
              <p className="font-medium text-lg">{perf.driver?.name}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Score</p><p className="text-2xl font-mono font-semibold">{perf.performance_score?.toFixed(1)}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Total KM</p><p className="text-2xl font-mono font-semibold">{perf.total_km?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Total Trips</p><p className="text-2xl font-mono font-semibold">{perf.total_trips}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Incidents</p><p className="text-2xl font-mono font-semibold">{perf.incidents}</p></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Bus */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent data-testid="assign-bus-dialog">
          <DialogHeader><DialogTitle>Assign Bus to Driver</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Driver</Label>
              <Select value={assignDriver} onValueChange={setAssignDriver}>
                <SelectTrigger data-testid="assign-driver-select"><SelectValue placeholder="Select driver" /></SelectTrigger>
                <SelectContent>{drivers.map((d) => <SelectItem key={d.license_number} value={d.license_number}>{d.name} ({d.license_number})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Bus</Label>
              <Select value={assignBus} onValueChange={setAssignBus}>
                <SelectTrigger data-testid="assign-bus-select-driver"><SelectValue placeholder="Select bus" /></SelectTrigger>
                <SelectContent>{buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleAssign} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="assign-driver-save-btn">Assign</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
