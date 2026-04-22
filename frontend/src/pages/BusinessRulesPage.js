import { useState, useEffect, useCallback, useMemo } from "react";
import { useBusinessRules, useBusinessRuleMutations } from "../features/business-rules/api/useBusinessRules";
import TablePaginationBar from "../components/TablePaginationBar";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Switch } from "../components/ui/switch";
import { Plus, Trash2, Save, Sliders, Shield, Zap, Receipt, Database } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "../lib/api";
import AsyncPanel from "../components/AsyncPanel";

const categoryIcons = { kpi: Shield, operations: Sliders, infraction: Zap, billing: Receipt, data: Database };
const categoryColors = { kpi: "text-blue-600", operations: "text-green-600", infraction: "text-red-600", billing: "text-purple-600", data: "text-orange-600" };

export default function BusinessRulesPage() {
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [editValues, setEditValues] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ rule_key: "", rule_value: "", category: "general", description: "" });

  const { data: rulesData, isLoading: loading, error: fetchError, refetch: load } = useBusinessRules({
    category,
    page,
    limit: 20,
  });

  const rules = useMemo(() => rulesData?.items || [], [rulesData]);
  const listMeta = {
    total: rulesData?.total || 0,
    pages: rulesData?.pages || 1,
    limit: rulesData?.limit || 20,
  };

  const { saveRule, deleteRule, isSaving } = useBusinessRuleMutations();

  // Sync editValues when rules load
  useEffect(() => {
    if (rules.length > 0) {
      const vals = {};
      rules.forEach((r) => {
        vals[r.rule_key] = r.rule_value;
      });
      setEditValues((prev) => ({ ...prev, ...vals }));
    }
  }, [rules]);


  const handleSave = async (rule) => {
    try {
      await saveRule({
        rule_key: rule.rule_key,
        rule_value: editValues[rule.rule_key],
        category: rule.category,
        description: rule.description,
      });
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleSaveAll = async () => {
    try {
      const promises = rules.map((rule) =>
        saveRule({
          rule_key: rule.rule_key,
          rule_value: editValues[rule.rule_key],
          category: rule.category,
          description: rule.description,
        })
      );
      await Promise.all(promises);
      toast.success("All rules saved");
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleAdd = async () => {
    try {
      await saveRule(addForm);
      setAddOpen(false);
      setAddForm({ rule_key: "", rule_value: "", category: "general", description: "" });
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleDelete = async (key) => {
    if (!window.confirm(`Delete rule "${key}"?`)) return;
    try {
      await deleteRule(key);
    } catch (err) {
      // Error handled in hook
    }
  };

  const categories = [...new Set(rules.map((r) => r.category))];
  const grouped = {};
  rules.forEach((r) => {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  });

  return (
    <div data-testid="business-rules-page">
      <div className="page-header">
        <h1 className="page-title">Business rules</h1>
        <div className="flex gap-2">
          <Button onClick={() => setAddOpen(true)} variant="outline" data-testid="add-rule-btn">
            <Plus size={14} className="mr-1.5" /> Add Rule
          </Button>
          <Button onClick={handleSaveAll} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="save-all-rules-btn">
            <Save size={14} className="mr-1.5" /> Save All
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <Button variant={!category ? "default" : "outline"} onClick={() => setCategory("")} className={!category ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""} size="sm">
          All ({listMeta.total})
        </Button>
        {categories.map((c) => (
          <Button
            key={c}
            variant={category === c ? "default" : "outline"}
            onClick={() => setCategory(c)}
            className={category === c ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}
            size="sm"
            data-testid={`filter-cat-${c}`}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </Button>
        ))}
      </div>

      {fetchError ? <AsyncPanel error={fetchError} onRetry={load} minHeight="min-h-[160px]" /> : null}
      {!fetchError && loading && rules.length === 0 ? <AsyncPanel loading minHeight="min-h-[200px]" /> : null}

      {!fetchError &&
        Object.entries(grouped)
          .filter(([cat]) => !category || cat === category)
          .map(([cat, catRules]) => {
            const Icon = categoryIcons[cat] || Sliders;
            const color = categoryColors[cat] || "text-gray-600";
            return (
              <Card key={cat} className="border-gray-200 shadow-sm mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="font-medium flex items-center gap-2">
                    <Icon size={16} className={color} />
                    {cat === "operations" ? "Operations Rules (includes Geofence & Route Fence)" : `${cat.charAt(0).toUpperCase() + cat.slice(1)} Rules`}
                  </CardTitle>
                  {cat === "operations" ? (
                    <p className="text-xs text-gray-500">
                      Geofence thresholds use meters (`m`) and speed rules use kilometers per hour (`km/h`).
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {catRules.map((r) => (
                      <div key={r.rule_key} className="flex items-center gap-3 p-3 bg-[#FAFAFA] rounded-lg" data-testid={`rule-${r.rule_key}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[#1A1A1A] leading-relaxed">{r.description || r.rule_key}</p>
                          <p className="text-[12px] text-gray-400 font-mono">{r.rule_key}</p>
                        </div>
                        <Input
                          value={editValues[r.rule_key] || ""}
                          onChange={(e) => setEditValues({ ...editValues, [r.rule_key]: e.target.value })}
                          className="w-32 text-right font-mono"
                          data-testid={`rule-input-${r.rule_key}`}
                        />
                        <Button variant="outline" size="sm" onClick={() => handleSave(r)} data-testid={`save-rule-${r.rule_key}`}>
                          <Save size={12} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(r.rule_key)}>
                          <Trash2 size={12} className="text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

      {!fetchError && !loading && rules.length === 0 ? <p className="text-center text-gray-500 py-10 text-sm">No business rules match this filter.</p> : null}

      <TablePaginationBar page={page} pages={listMeta.pages} total={listMeta.total} limit={listMeta.limit} onPageChange={setPage} />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="add-rule-dialog">
          <DialogHeader>
            <DialogTitle>Add Business Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Key</Label>
              <Input value={addForm.rule_key} onChange={(e) => setAddForm({ ...addForm, rule_key: e.target.value })} placeholder="e.g. overspeed_limit" data-testid="new-rule-key" />
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input value={addForm.rule_value} onChange={(e) => setAddForm({ ...addForm, rule_value: e.target.value })} data-testid="new-rule-value" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={addForm.category} onValueChange={(v) => setAddForm({ ...addForm, category: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kpi">KPI</SelectItem>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="infraction">Infraction</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="data">Data</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} data-testid="new-rule-desc" />
            </div>
            <Button onClick={handleAdd} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-rule-submit-btn">
              Add Rule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
