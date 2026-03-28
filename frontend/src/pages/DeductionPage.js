import { useState, useEffect } from "react";
import API, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Plus, Pencil, Trash2, Play, Calculator } from "lucide-react";
import { toast } from "sonner";

const emptyRule = { name: "", rule_type: "performance", penalty_percent: "", is_capped: false, cap_limit: "0", description: "", active: true };

export default function DeductionPage() {
  const [rules, setRules] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyRule);
  const [result, setResult] = useState(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const load = async () => {
    try { const { data } = await API.get("/deductions/rules"); setRules(data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    try {
      const payload = { ...form, penalty_percent: Number(form.penalty_percent), cap_limit: Number(form.cap_limit) };
      if (editing) { await API.put(`/deductions/rules/${editing}`, payload); toast.success("Rule updated"); }
      else { await API.post("/deductions/rules", payload); toast.success("Rule added"); }
      setOpen(false); setEditing(null); setForm(emptyRule); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this rule?")) return;
    try { await API.delete(`/deductions/rules/${id}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const applyDeductions = async () => {
    if (!periodStart || !periodEnd) { toast.error("Select period"); return; }
    try {
      const { data } = await API.post(`/deductions/apply?period_start=${periodStart}&period_end=${periodEnd}`);
      setResult(data); toast.success("Deductions calculated");
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div data-testid="deduction-page">
      <div className="page-header">
        <h1 className="page-title">Deduction Engine</h1>
        <Button onClick={() => { setForm(emptyRule); setEditing(null); setOpen(true); }} className="bg-[#134219] hover:bg-[#0E3213]" data-testid="add-rule-btn">
          <Plus size={16} className="mr-1.5" /> Configure Rule
        </Button>
      </div>

      {/* Rules Table */}
      <Card className="border-gray-200 shadow-sm mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Rule</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Penalty %</TableHead>
              <TableHead>Capped</TableHead><TableHead className="text-right">Cap Limit</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} className="hover:bg-gray-50" data-testid={`rule-row-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{r.rule_type}</Badge></TableCell>
                  <TableCell className="text-right font-mono font-medium text-red-600">{r.penalty_percent}%</TableCell>
                  <TableCell>{r.is_capped ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Capped</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                  <TableCell className="text-right font-mono">{r.is_capped ? `Rs.${r.cap_limit?.toLocaleString()}` : "-"}</TableCell>
                  <TableCell><Badge className={r.active ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>{r.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setForm({ ...r, penalty_percent: r.penalty_percent, cap_limit: r.cap_limit }); setEditing(r.id); setOpen(true); }}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 size={14} className="text-red-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Apply Deductions */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator size={16} /> Apply Deductions</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" data-testid="deduction-period-start" />
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" data-testid="deduction-period-end" />
            <Button onClick={applyDeductions} className="bg-[#BA9149] hover:bg-[#A67F3B] text-white" data-testid="apply-deductions-btn">
              <Play size={14} className="mr-1.5" /> Apply
            </Button>
          </div>

          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Base Payment</p><p className="text-xl font-mono font-semibold">Rs.{result.base_payment?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Missed KM</p><p className="text-xl font-mono font-semibold text-red-600">{result.missed_km?.toLocaleString()} km</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Total Deduction</p><p className="text-xl font-mono font-semibold text-red-600">Rs.{result.total_deduction?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Deduction %</p><p className="text-xl font-mono font-semibold">{result.base_payment ? ((result.total_deduction / result.base_payment) * 100).toFixed(1) : 0}%</p></div>
              </div>
              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>Rule</TableHead><TableHead>Type</TableHead><TableHead className="text-right">%</TableHead><TableHead className="text-right">Amount (Rs)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableRow className="bg-yellow-50"><TableCell className="font-medium">Availability Deduction</TableCell><TableCell>availability</TableCell><TableCell className="text-right">-</TableCell><TableCell className="text-right font-mono font-medium text-red-600">{result.availability_deduction?.toLocaleString()}</TableCell></TableRow>
                  {result.breakdown?.map((b, i) => (
                    <TableRow key={i} className="hover:bg-gray-50">
                      <TableCell>{b.rule}</TableCell><TableCell>{b.type}</TableCell><TableCell className="text-right font-mono">{b.percent}%</TableCell><TableCell className="text-right font-mono text-red-600">{b.amount?.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rule Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="rule-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Rule" : "Add Deduction Rule"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="rule-name" /></div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.rule_type} onValueChange={(v) => setForm({ ...form, rule_type: v })}>
                <SelectTrigger data-testid="rule-type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="performance">Performance</SelectItem><SelectItem value="system">System</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Penalty %</Label><Input type="number" value={form.penalty_percent} onChange={(e) => setForm({ ...form, penalty_percent: e.target.value })} data-testid="rule-percent" /></div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_capped} onCheckedChange={(v) => setForm({ ...form, is_capped: v })} data-testid="rule-capped" />
              <Label>Capped</Label>
            </div>
            {form.is_capped && <div className="space-y-2"><Label>Cap Limit (Rs)</Label><Input type="number" value={form.cap_limit} onChange={(e) => setForm({ ...form, cap_limit: e.target.value })} data-testid="rule-cap-limit" /></div>}
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="rule-description" /></div>
            <Button onClick={handleSave} className="w-full bg-[#134219] hover:bg-[#0E3213]" data-testid="rule-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
