import { useState, useEffect, useCallback, useMemo } from "react";
import { useSettings, useSettingMutations } from "../features/settings/api/useSettings";
import { messageFromAxiosError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [page, setPage] = useState(1);
  const [editValues, setEditValues] = useState({});

  const { data: settingsData, isLoading: loading, error: fetchError, refetch: load } = useSettings({
    page,
    limit: 20,
  });

  const settings = useMemo(() => settingsData?.items || [], [settingsData]);
  const meta = {
    total: settingsData?.total || 0,
    pages: settingsData?.pages || 1,
    limit: settingsData?.limit || 20,
  };

  const { saveSetting, isSaving } = useSettingMutations();

  // Sync editValues when settings load
  useEffect(() => {
    if (settings.length > 0) {
      const vals = {};
      settings.forEach((s) => {
        vals[s.key] = s.value;
      });
      setEditValues((prev) => ({ ...prev, ...vals }));
    }
  }, [settings]);

  const handleSave = async (key) => {
    if (key.startsWith("_")) {
      toast.error("System settings cannot be modified");
      return;
    }
    try {
      await saveSetting({ key, value: editValues[key] });
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleSaveAll = async () => {
    try {
      const promises = Object.entries(editValues)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, value]) => saveSetting({ key, value }));

      await Promise.all(promises);
      toast.success("All settings saved");
    } catch (err) {
      // Error handled in hook
    }
  };

  const labelMap = {
    tariff_rate: "Electricity Tariff Rate (Rs/kWh)",
    "12m_ac_kwh_per_km": "12m AC - Standard kWh/km",
    "9m_ac_kwh_per_km": "9m AC - Standard kWh/km",
    "12m_non_ac_kwh_per_km": "12m Non-AC - Standard kWh/km",
    max_deduction_cap_pct: "Max Deduction Cap (%)",
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings size={14} /> System Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fetchError ? <AsyncPanel error={fetchError} onRetry={load} minHeight="min-h-[120px]" /> : null}
          {!fetchError && loading && settings.length === 0 ? <AsyncPanel loading minHeight="min-h-[200px]" /> : null}
          <div className="space-y-4">
            {!fetchError &&
              settings
                .filter((s) => !s.key.startsWith("_"))
                .map((s) => (
                  <div key={s.key} className="flex items-center gap-4 p-3 bg-gray-50 rounded-md" data-testid={`setting-${s.key}`}>
                    <div className="flex-1">
                      <Label className="text-sm font-medium">{labelMap[s.key] || s.key}</Label>
                      <p className="text-xs text-gray-400 mt-0.5">Key: {s.key}</p>
                    </div>
                    <Input value={editValues[s.key] || ""} onChange={(e) => setEditValues({ ...editValues, [s.key]: e.target.value })} className="w-40" data-testid={`setting-input-${s.key}`} />
                    <Button variant="outline" size="sm" onClick={() => handleSave(s.key)} data-testid={`save-setting-${s.key}`}>
                      <Save size={14} />
                    </Button>
                  </div>
                ))}
            {!fetchError && !loading && settings.length === 0 ? <p className="text-center text-gray-500 py-8 text-sm">No settings on this page.</p> : null}
          </div>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Card className="mt-6 border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle>Add New Setting</CardTitle>
        </CardHeader>
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

  const { saveSetting } = useSettingMutations();

  const handleAdd = async () => {
    if (!key) {
      toast.error("Key is required");
      return;
    }
    try {
      await saveSetting({ key, value });
      setKey("");
      setValue("");
      onSave();
    } catch (err) {
      // Error handled in hook
    }
  };

  return (
    <div className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label>Key</Label>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="setting_key" data-testid="new-setting-key" />
      </div>
      <div className="flex-1 space-y-1.5">
        <Label>Value</Label>
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" data-testid="new-setting-value" />
      </div>
      <Button onClick={handleAdd} className="bg-[#C8102E] hover:bg-[#A50E25] text-white" data-testid="add-setting-btn">
        Add
      </Button>
    </div>
  );
}
