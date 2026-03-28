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
import { Plus, AlertTriangle, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function IncidentPage() {
  const [incidents, setIncidents] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ incident_type: "", description: "", bus_id: "", driver_id: "", severity: "medium" });
  const [buses, setBuses] = useState([]);

  const load = async () => {
    try {
      const [i, b] = await Promise.all([API.get("/incidents"), API.get("/buses")]);
      setIncidents(i.data); setBuses(b.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      await API.post("/incidents", form);
      toast.success("Incident reported"); setOpen(false);
      setForm({ incident_type: "", description: "", bus_id: "", driver_id: "", severity: "medium" }); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const updateStatus = async (id, status) => {
    try { await API.put(`/incidents/${id}?status=${status}`); toast.success("Updated"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const severityColor = (s) => ({ high: "bg-red-100 text-red-700 hover:bg-red-100", medium: "bg-yellow-100 text-yellow-700 hover:bg-yellow-100", low: "bg-blue-100 text-blue-700 hover:bg-blue-100" }[s] || "");
  const statusColor = (s) => ({ open: "bg-red-100 text-red-700 hover:bg-red-100", investigating: "bg-yellow-100 text-yellow-700 hover:bg-yellow-100", resolved: "bg-green-100 text-green-700 hover:bg-green-100" }[s] || "");

  return (
    <div data-testid="incident-page">
      <div className="page-header">
        <h1 className="page-title">Incident Management</h1>
        <Button onClick={() => setOpen(true)} className="bg-[#134219] hover:bg-[#0E3213]" data-testid="report-incident-btn">
          <Plus size={16} className="mr-1.5" /> Report Incident
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>ID</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead>
              <TableHead>Bus</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead>
              <TableHead>Reported</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {incidents.map((inc) => (
                <TableRow key={inc.id} className="hover:bg-gray-50" data-testid={`incident-row-${inc.id}`}>
                  <TableCell className="font-mono text-sm">{inc.id}</TableCell>
                  <TableCell className="font-medium">{inc.incident_type}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate">{inc.description}</TableCell>
                  <TableCell className="font-mono">{inc.bus_id || "-"}</TableCell>
                  <TableCell><Badge className={severityColor(inc.severity)}>{inc.severity}</Badge></TableCell>
                  <TableCell><Badge className={statusColor(inc.status)}>{inc.status}</Badge></TableCell>
                  <TableCell className="text-sm text-gray-500">{inc.created_at?.slice(0, 10)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {inc.status !== "investigating" && (
                        <Button variant="ghost" size="sm" onClick={() => updateStatus(inc.id, "investigating")} data-testid={`investigate-${inc.id}`}>
                          <AlertTriangle size={14} className="text-yellow-600" />
                        </Button>
                      )}
                      {inc.status !== "resolved" && (
                        <Button variant="ghost" size="sm" onClick={() => updateStatus(inc.id, "resolved")} data-testid={`resolve-${inc.id}`}>
                          <CheckCircle size={14} className="text-green-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {incidents.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-8">No incidents</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="incident-dialog">
          <DialogHeader><DialogTitle>Report Incident</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.incident_type} onValueChange={(v) => setForm({ ...form, incident_type: v })}>
                <SelectTrigger data-testid="incident-type-select"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accident">Accident</SelectItem><SelectItem value="Breakdown">Breakdown</SelectItem>
                  <SelectItem value="Route Deviation">Route Deviation</SelectItem><SelectItem value="Passenger Complaint">Passenger Complaint</SelectItem>
                  <SelectItem value="Driver Issue">Driver Issue</SelectItem><SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="incident-description" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Bus (optional)</Label>
                <Select value={form.bus_id} onValueChange={(v) => setForm({ ...form, bus_id: v })}>
                  <SelectTrigger data-testid="incident-bus"><SelectValue placeholder="Select bus" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{buses.map(b => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger data-testid="incident-severity"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleAdd} className="w-full bg-[#134219] hover:bg-[#0E3213]" data-testid="incident-save-btn">Report</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
