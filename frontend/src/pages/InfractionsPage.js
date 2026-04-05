import { useState, useEffect, useCallback } from "react";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Plus, Pencil, Trash2, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "../lib/api";

const catColors = {
  A: "bg-gray-100 text-gray-700", B: "bg-blue-100 text-blue-700",
  C: "bg-yellow-100 text-yellow-700", D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700", F: "bg-red-200 text-red-800",
  G: "bg-red-300 text-red-900"
};
const catAmounts = { A: 100, B: 500, C: 1000, D: 1500, E: 3000, F: 10000, G: 200000 };
const emptyForm = { code: "", category: "A", description: "", amount: 100, safety_flag: false, repeat_escalation: true, active: true };

export default function InfractionsPage() {
  const [catalogue, setCatalogue] = useState([]);
  const [logged, setLogged] = useState([]);
  const [tab, setTab] = useState("catalogue");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({ bus_id: "", driver_id: "", infraction_code: "", date: "", remarks: "" });
  const [buses, setBuses] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([API.get("/infractions/catalogue"), API.get("/buses")]);
      setCatalogue(c.data); setBuses(b.data);
    } catch {}
  }, []);

  const loadLogged = useCallback(async () => {
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await API.get("/infractions/logged", { params });
      setLogged(data);
    } catch {}
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "logged") loadLogged(); }, [tab, loadLogged]);

  const handleSave = async () => {
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (editing) { await API.put(`/infractions/catalogue/${editing}`, payload); toast.success("Updated"); }
      else { await API.post("/infractions/catalogue", payload); toast.success("Added"); }
      setOpen(false); setEditing(null); setForm(emptyForm); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete?")) return;
    try { await API.delete(`/infractions/catalogue/${id}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleLog = async () => {
    try {
      const params = new URLSearchParams(logForm);
      await API.post(`/infractions/log?${params}`);
      toast.success("Infraction logged"); setLogOpen(false);
      setLogForm({ bus_id: "", driver_id: "", infraction_code: "", date: "", remarks: "" });
      loadLogged();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div data-testid="infractions-page">
      <div className="page-header">
        <h1 className="page-title">Schedule-S Infractions</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLogOpen(true)} data-testid="log-infraction-btn">
            <FileText size={14} className="mr-1.5" /> Log Infraction
          </Button>
          <Button onClick={() => { setForm(emptyForm); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-infraction-btn">
            <Plus size={16} className="mr-1.5" /> Add to Catalogue
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <Button variant={tab === "catalogue" ? "default" : "outline"} onClick={() => setTab("catalogue")} className={tab === "catalogue" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>Catalogue ({catalogue.length})</Button>
        <Button variant={tab === "logged" ? "default" : "outline"} onClick={() => setTab("logged")} className={tab === "logged" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>Logged ({logged.length})</Button>
      </div>

      {tab === "catalogue" && (
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header">
                <TableHead>Code</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead>
                <TableHead className="text-right">Amount (Rs)</TableHead><TableHead>Safety</TableHead><TableHead>Repeat Esc.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {catalogue.map((c) => (
                  <TableRow key={c.id} className="hover:bg-[#FAFAFA]" data-testid={`cat-row-${c.code}`}>
                    <TableCell className="font-mono font-medium">{c.code}</TableCell>
                    <TableCell><Badge className={`${catColors[c.category]} hover:${catColors[c.category]}`}>{c.category}</Badge></TableCell>
                    <TableCell className="text-sm">{c.description}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-[#DC2626]">Rs.{c.amount?.toLocaleString()}</TableCell>
                    <TableCell>{c.safety_flag ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Safety</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                    <TableCell>{c.repeat_escalation ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setForm(c); setEditing(c.id); setOpen(true); }}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}><Trash2 size={14} className="text-red-500" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "logged" && (
        <>
          <div className="flex gap-3 mb-4">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            <Button onClick={loadLogged} variant="outline">Filter</Button>
          </div>
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>ID</TableHead><TableHead>Code</TableHead><TableHead>Cat</TableHead><TableHead>Bus</TableHead>
                  <TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Date</TableHead><TableHead>By</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logged.map((l) => (
                    <TableRow key={l.id} className="hover:bg-[#FAFAFA]">
                      <TableCell className="font-mono text-xs">{l.id}</TableCell>
                      <TableCell className="font-mono">{l.infraction_code}</TableCell>
                      <TableCell><Badge className={`${catColors[l.category]} hover:${catColors[l.category]}`}>{l.category}</Badge></TableCell>
                      <TableCell className="font-mono">{l.bus_id}</TableCell>
                      <TableCell className="text-sm">{l.description}</TableCell>
                      <TableCell className="text-right font-mono text-[#DC2626]">Rs.{l.amount?.toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{l.date}</TableCell>
                      <TableCell className="text-sm">{l.logged_by}</TableCell>
                    </TableRow>
                  ))}
                  {logged.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-8">No infractions logged</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Add/Edit Catalogue Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="infraction-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Infraction" : "Add Infraction to Catalogue"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. A01" data-testid="inf-code" /></div>
              <div className="space-y-2"><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v, amount: catAmounts[v] || form.amount })}>
                  <SelectTrigger data-testid="inf-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{["A","B","C","D","E","F","G"].map(c => <SelectItem key={c} value={c}>Cat {c} (Rs.{catAmounts[c]?.toLocaleString()})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="inf-description" /></div>
            <div className="space-y-2"><Label>Amount (Rs)</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="inf-amount" /></div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2"><Switch checked={form.safety_flag} onCheckedChange={(v) => setForm({ ...form, safety_flag: v })} data-testid="inf-safety" /><Label>Safety Flag</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.repeat_escalation} onCheckedChange={(v) => setForm({ ...form, repeat_escalation: v })} /><Label>Repeat Escalation</Label></div>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="inf-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Infraction Dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent data-testid="log-infraction-dialog">
          <DialogHeader><DialogTitle>Log Infraction</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Infraction Code</Label>
              <Select value={logForm.infraction_code} onValueChange={(v) => setLogForm({ ...logForm, infraction_code: v })}>
                <SelectTrigger data-testid="log-inf-code"><SelectValue placeholder="Select code" /></SelectTrigger>
                <SelectContent>{catalogue.map(c => <SelectItem key={c.code} value={c.code}>{c.code} - {c.description} (Rs.{c.amount})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Bus</Label>
                <Select value={logForm.bus_id} onValueChange={(v) => setLogForm({ ...logForm, bus_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select bus" /></SelectTrigger>
                  <SelectContent>{buses.map(b => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Remarks</Label><Input value={logForm.remarks} onChange={(e) => setLogForm({ ...logForm, remarks: e.target.value })} /></div>
            <Button onClick={handleLog} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="log-inf-submit-btn">Log Infraction</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
