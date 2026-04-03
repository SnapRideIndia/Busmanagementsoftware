import { useState, useEffect } from "react";
import API, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [editValues, setEditValues] = useState({});

  const load = async () => {
    try {
      const { data } = await API.get("/settings");
      setSettings(data);
      const vals = {};
      data.forEach((s) => { vals[s.key] = s.value; });
      setEditValues(vals);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (key) => {
    try {
      await API.post("/settings", { key, value: editValues[key] });
      toast.success(`${key} updated`); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleSaveAll = async () => {
    try {
      for (const [key, value] of Object.entries(editValues)) {
        await API.post("/settings", { key, value });
      }
      toast.success("All settings saved"); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const labelMap = {
    tariff_rate: "Electricity Tariff Rate (Rs/kWh)",
    "12m_ac_kwh_per_km": "12m AC - Standard kWh/km",
    "9m_ac_kwh_per_km": "9m AC - Standard kWh/km",
    "12m_non_ac_kwh_per_km": "12m Non-AC - Standard kWh/km",
    max_deduction_cap_pct: "Max Deduction Cap (%)",
    default_subsidy_rate: "Default Subsidy Rate (Rs/km)",
  };

  return (
    <div data-testid="settings-page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <Button onClick={handleSaveAll} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="save-all-settings-btn">
          <Save size={16} className="mr-1.5" /> Save All Settings
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings size={16} /> System Configuration</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {settings.map((s) => (
              <div key={s.key} className="flex items-center gap-4 p-3 bg-gray-50 rounded-md" data-testid={`setting-${s.key}`}>
                <div className="flex-1">
                  <Label className="text-sm font-medium">{labelMap[s.key] || s.key}</Label>
                  <p className="text-xs text-gray-400 mt-0.5">Key: {s.key}</p>
                </div>
                <Input
                  value={editValues[s.key] || ""}
                  onChange={(e) => setEditValues({ ...editValues, [s.key]: e.target.value })}
                  className="w-40"
                  data-testid={`setting-input-${s.key}`}
                />
                <Button variant="outline" size="sm" onClick={() => handleSave(s.key)} data-testid={`save-setting-${s.key}`}>
                  <Save size={14} />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6 border-gray-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">Add New Setting</CardTitle></CardHeader>
        <CardContent>
          <NewSettingForm onSave={() => load()} />
        </CardContent>
      </Card>
    </div>
  );
}

function NewSettingForm({ onSave }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const handleAdd = async () => {
    if (!key) { toast.error("Key is required"); return; }
    try {
      await API.post("/settings", { key, value });
      toast.success("Setting added"); setKey(""); setValue(""); onSave();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5"><Label>Key</Label><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="setting_key" data-testid="new-setting-key" /></div>
      <div className="flex-1 space-y-1.5"><Label>Value</Label><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" data-testid="new-setting-value" /></div>
      <Button onClick={handleAdd} className="bg-[#C8102E] hover:bg-[#A50E25] text-white" data-testid="add-setting-btn">Add</Button>
    </div>
  );
}
