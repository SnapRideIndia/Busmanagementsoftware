import { useState, useEffect } from "react";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { BarChart3, TrendingUp, Shield, Clock, Gauge, AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function GccKpiPage() {
  const [kpi, setKpi] = useState(null);
  const [feePk, setFeePk] = useState(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("kpi");

  const loadKpi = async () => {
    setLoading(true);
    try {
      const params = {};
      if (periodStart) params.period_start = periodStart;
      if (periodEnd) params.period_end = periodEnd;
      const { data } = await API.get("/kpi/gcc-engine", { params });
      setKpi(data);
    } catch {} finally { setLoading(false); }
  };

  const loadFeePk = async () => {
    try {
      const params = {};
      if (periodStart) params.period_start = periodStart;
      if (periodEnd) params.period_end = periodEnd;
      const { data } = await API.get("/fee-pk/compute", { params });
      setFeePk(data);
    } catch {}
  };

  useEffect(() => { loadKpi(); loadFeePk(); }, []); // eslint-disable-line

  const cats = kpi?.categories || {};
  const kpiCards = [
    { key: "reliability", label: "Reliability (BF)", value: cats.reliability?.bf, target: cats.reliability?.target, dam: cats.reliability?.damages, inc: cats.reliability?.incentive, icon: Shield, color: "#2563EB" },
    { key: "availability", label: "Availability", value: `${cats.availability?.pct}%`, target: `${cats.availability?.target}%`, dam: cats.availability?.damages, inc: 0, icon: Gauge, color: "#16A34A" },
    { key: "punctuality", label: "Punctuality", value: `S:${cats.punctuality?.start_pct}% A:${cats.punctuality?.arrival_pct}%`, target: "S:90% A:80%", dam: cats.punctuality?.damages, inc: cats.punctuality?.incentive, icon: Clock, color: "#F59E0B" },
    { key: "frequency", label: "Frequency", value: `${cats.frequency?.trip_freq_pct}%`, target: `${cats.frequency?.target}%`, dam: cats.frequency?.damages, inc: cats.frequency?.incentive, icon: TrendingUp, color: "#8B5CF6" },
    { key: "safety", label: "Safety (MAF)", value: cats.safety?.maf, target: cats.safety?.maf !== undefined ? "0.01" : "-", dam: cats.safety?.damages, inc: cats.safety?.incentive, icon: AlertTriangle, color: "#DC2626" },
  ];

  const chartData = kpiCards.map(k => ({
    name: k.key, damages: k.dam || 0, incentive: k.inc || 0
  }));

  return (
    <div data-testid="gcc-kpi-page">
      <div className="page-header">
        <h1 className="page-title">GCC KPI Engine (§18)</h1>
        <Button onClick={() => { loadKpi(); loadFeePk(); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="compute-kpi-btn">
          <BarChart3 size={14} className="mr-1.5" /> Compute
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" data-testid="kpi-period-start" />
        <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" data-testid="kpi-period-end" />
        <Button onClick={() => { loadKpi(); loadFeePk(); }} variant="outline">Apply</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <Button variant={tab === "kpi" ? "default" : "outline"} onClick={() => setTab("kpi")} className={tab === "kpi" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>KPI Damages / Incentives</Button>
        <Button variant={tab === "feepk" ? "default" : "outline"} onClick={() => setTab("feepk")} className={tab === "feepk" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>Fee/PK Engine (§20)</Button>
      </div>

      {tab === "kpi" && kpi && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Monthly Fee Base</p>
              <p className="text-xl font-semibold" style={{ fontFamily: 'Inter' }}>Rs.{kpi.monthly_fee_base?.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{kpi.bus_km?.toLocaleString()} bus-km</p>
            </CardContent></Card>
            <Card className="kpi-card border-red-200"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1 flex items-center gap-1"><ArrowDown size={10} className="text-red-500" />Total Damages (Capped)</p>
              <p className="text-xl font-semibold text-[#DC2626]" style={{ fontFamily: 'Inter' }}>Rs.{kpi.total_damages_capped?.toLocaleString()}</p>
              <p className="text-xs text-gray-400">Raw: Rs.{kpi.total_damages_raw?.toLocaleString()} | Cap: Rs.{kpi.kpi_cap?.toLocaleString()}</p>
            </CardContent></Card>
            <Card className="kpi-card border-green-200"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1 flex items-center gap-1"><ArrowUp size={10} className="text-green-500" />Total Incentives (Capped)</p>
              <p className="text-xl font-semibold text-[#16A34A]" style={{ fontFamily: 'Inter' }}>Rs.{kpi.total_incentive_capped?.toLocaleString()}</p>
              <p className="text-xs text-gray-400">Raw: Rs.{kpi.total_incentive_raw?.toLocaleString()} | Cap: Rs.{kpi.incentive_cap?.toLocaleString()}</p>
            </CardContent></Card>
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Net Impact</p>
              <p className={`text-xl font-semibold ${(kpi.total_incentive_capped - kpi.total_damages_capped) >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`} style={{ fontFamily: 'Inter' }}>
                Rs.{Math.abs(kpi.total_incentive_capped - kpi.total_damages_capped).toLocaleString()}
                {(kpi.total_incentive_capped - kpi.total_damages_capped) >= 0 ? " (credit)" : " (debit)"}
              </p>
            </CardContent></Card>
          </div>

          {/* KPI Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {kpiCards.map(k => (
              <Card key={k.key} className="border-gray-200 shadow-sm" data-testid={`kpi-cat-${k.key}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <k.icon size={18} style={{ color: k.color }} />
                    <Badge variant="outline" className="text-xs">{k.label}</Badge>
                  </div>
                  <p className="text-lg font-semibold" style={{ fontFamily: 'Inter' }}>{loading ? "..." : k.value}</p>
                  <p className="text-xs text-gray-400">Target: {k.target}</p>
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-[#DC2626]">-Rs.{(k.dam || 0).toLocaleString()}</span>
                    <span className="text-[#16A34A]">+Rs.{(k.inc || 0).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Chart */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-base">Damages vs Incentives by Category</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => `Rs.${v.toLocaleString()}`} />
                    <Bar dataKey="damages" fill="#DC2626" radius={[4, 4, 0, 0]} name="Damages" />
                    <Bar dataKey="incentive" fill="#16A34A" radius={[4, 4, 0, 0]} name="Incentives" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "feepk" && feePk && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Total Fee (PK)</p>
              <p className="text-2xl font-semibold text-[#C8102E]" style={{ fontFamily: 'Inter' }}>Rs.{feePk.total_fee?.toLocaleString()}</p>
            </CardContent></Card>
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Buses</p>
              <p className="text-2xl font-semibold" style={{ fontFamily: 'Inter' }}>{feePk.bus_count}</p>
            </CardContent></Card>
            <Card className="kpi-card"><CardContent className="p-5">
              <p className="text-xs text-gray-500 uppercase mb-1">Formula (§20)</p>
              <p className="text-xs text-gray-600 leading-relaxed">actual≥assured: PK×assured + PK×0.5×(act-ass)<br/>actual&lt;assured: PK×actual + PK×0.75×(ass-act)</p>
            </CardContent></Card>
          </div>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-base">Bus-wise Fee/PK Calculation</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>Bus</TableHead><TableHead>Depot</TableHead><TableHead className="text-right">PK Rate</TableHead>
                  <TableHead className="text-right">Actual KM</TableHead><TableHead className="text-right">Assured KM</TableHead>
                  <TableHead>Band</TableHead><TableHead className="text-right">Fee (Rs)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {feePk.bus_results?.map(b => (
                    <TableRow key={b.bus_id} className="hover:bg-[#FAFAFA]" data-testid={`feepk-bus-${b.bus_id}`}>
                      <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                      <TableCell>{b.depot}</TableCell>
                      <TableCell className="text-right font-mono">Rs.{b.pk_rate}</TableCell>
                      <TableCell className="text-right font-mono">{b.actual_km?.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{b.assured_km?.toLocaleString()}</TableCell>
                      <TableCell><Badge className={b.band === "actual>=assured" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"}>{b.band === "actual>=assured" ? "Excess" : "Shortfall"}</Badge></TableCell>
                      <TableCell className="text-right font-mono font-semibold">Rs.{b.fee?.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
