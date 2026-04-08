import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Play, Calculator } from "lucide-react";
import { toast } from "sonner";

export default function DeductionPage() {
  const [rules, setRules] = useState([]);
  const [buses, setBuses] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [result, setResult] = useState(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const [filterBusId, setFilterBusId] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [rulesRes, busesRes] = await Promise.all([
        API.get(Endpoints.deductions.rules(), { params: buildQuery({ page, limit: 20 }) }),
        fetchAllPaginated(Endpoints.masters.buses.list(), {}),
      ]);
      const u = unwrapListResponse(rulesRes.data);
      setRules(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
      setBuses(busesRes);
    } catch (err) {
      setFetchError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load deduction compliance data");
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const applyDeductions = async () => {
    if (!periodStart || !periodEnd) {
      toast.error("Select period");
      return;
    }
    try {
      const { data } = await API.post(
        Endpoints.deductions.apply(),
        null,
        {
          params: buildQuery({
            period_start: periodStart,
            period_end: periodEnd,
            depot: filterDepot,
            bus_id: filterBusId,
          }),
        }
      );
      setResult(data);
      toast.success("Deductions calculated");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const depots = [...new Set(buses.map((b) => b.depot).filter(Boolean))].sort();
  const busesForFilter = (filterDepot ? buses.filter((b) => b.depot === filterDepot) : buses).sort((a, b) => String(a.bus_id).localeCompare(String(b.bus_id)));
  const ir = result?.infractions_breakdown || {};

  return (
    <div data-testid="deduction-page">
      <div className="page-header">
        <h1 className="page-title">Deductions Compliance</h1>
      </div>

      <p className="page-lead">
        Contract-facing deduction view for SLA/infraction evidence. Line-level actions are in{" "}
        <Link to="/infractions" className="text-[#C8102E] font-medium hover:underline">Infractions</Link>{" "}
        and KPI damages are in{" "}
        <Link to="/gcc-kpi" className="text-[#C8102E] font-medium hover:underline">GCC KPI</Link>.
      </p>

      <Card className="border-gray-200 shadow-sm mb-6">
        <CardHeader>
          <CardTitle className="text-base">Configured deduction heads (read-only)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Rule</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Penalty %</TableHead>
              <TableHead>Capped</TableHead><TableHead className="text-right">Cap Limit</TableHead><TableHead>Active</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={6}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={rules.length === 0}
                emptyMessage="No deduction rules configured"
              >
                {rules.map((r) => (
                  <TableRow key={r.id} className="hover:bg-gray-50" data-testid={`rule-row-${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{r.rule_type}</Badge></TableCell>
                    <TableCell className="text-right font-mono font-medium text-red-600">{r.penalty_percent}%</TableCell>
                    <TableCell>{r.is_capped ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Capped</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                    <TableCell className="text-right font-mono">{r.is_capped ? `Rs.${r.cap_limit?.toLocaleString()}` : "-"}</TableCell>
                    <TableCell><Badge className={r.active ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>{r.active ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator size={16} /> Compute deduction evidence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" data-testid="deduction-period-start" />
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" data-testid="deduction-period-end" />
            <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setFilterBusId(""); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All Depots" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Depots</SelectItem>
                {depots.map((dep) => <SelectItem key={dep} value={dep}>{dep}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterBusId || "all"} onValueChange={(v) => setFilterBusId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All Buses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Buses</SelectItem>
                {busesForFilter.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={applyDeductions} className="bg-[#C8102E] hover:bg-[#A50E25] text-white" data-testid="apply-deductions-btn">
              <Play size={14} className="mr-1.5" /> Apply
            </Button>
          </div>

          {result && (
            <div className="space-y-4">
              <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Period: <span className="font-medium">{result.period?.start || periodStart}</span> to{" "}
                <span className="font-medium">{result.period?.end || periodEnd}</span>
                {result.scope?.depot ? (
                  <>
                    {" "}
                    | Depot: <span className="font-medium">{result.scope.depot}</span>
                  </>
                ) : null}
                {result.scope?.bus_id ? (
                  <>
                    {" "}
                    | Bus: <span className="font-mono font-medium">{result.scope.bus_id}</span>
                  </>
                ) : null}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Base Payment</p><p className="text-lg font-mono font-bold">Rs.{result.base_payment?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Missed KM</p><p className="text-lg font-mono font-bold text-red-600">{result.missed_km?.toLocaleString()} km</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Infractions (Applied)</p><p className="text-lg font-mono font-bold text-red-600">Rs.{result.infractions_deduction?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Total Deduction</p><p className="text-lg font-mono font-bold text-red-600">Rs.{result.total_deduction?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Deduction %</p><p className="text-lg font-mono font-bold">{result.base_payment ? ((result.total_deduction / result.base_payment) * 100).toFixed(1) : 0}%</p></div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Infraction Capped Raw</p><p className="text-lg font-mono">Rs.{ir.capped_raw?.toLocaleString?.() ?? 0}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Cap Limit (5%)</p><p className="text-lg font-mono">Rs.{ir.capped_cap_limit?.toLocaleString?.() ?? 0}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Capped Applied</p><p className="text-lg font-mono">Rs.{ir.capped_applied?.toLocaleString?.() ?? 0}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Uncapped Applied</p><p className="text-lg font-mono">Rs.{ir.uncapped_applied?.toLocaleString?.() ?? 0}</p></div>
              </div>

              <Table>
                <TableHeader><TableRow className="table-header">
                  <TableHead>Head</TableHead><TableHead>Type</TableHead><TableHead className="text-right">%</TableHead><TableHead className="text-right">Amount (Rs)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableRow className="bg-gray-50/80"><TableCell className="font-medium">Availability deduction</TableCell><TableCell>availability</TableCell><TableCell className="text-right">-</TableCell><TableCell className="text-right font-mono font-medium text-red-600">{result.availability_deduction?.toLocaleString()}</TableCell></TableRow>
                  {result.breakdown?.map((b, i) => (
                    <TableRow key={i} className="hover:bg-gray-50">
                      <TableCell>{b.rule}</TableCell><TableCell>{b.type}</TableCell><TableCell className="text-right font-mono">{b.percent}%</TableCell><TableCell className="text-right font-mono text-red-600">{b.amount?.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="border rounded-md overflow-hidden">
                <div className="p-3 bg-gray-50 border-b"><p className="font-semibold text-sm">Infraction deduction evidence</p></div>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">ID</th>
                        <th className="p-2 text-left">Code</th>
                        <th className="p-2 text-left">Detected Date</th>
                        <th className="p-2 text-left">Logged At</th>
                        <th className="p-2 text-left">Category</th>
                        <th className="p-2 text-left">Status</th>
                        <th className="p-2 text-left">Safety</th>
                        <th className="p-2 text-left">Capped (A-D)</th>
                        <th className="p-2 text-right">Amount Applied</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ir.rows || []).map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2 font-mono">{r.id}</td>
                          <td className="p-2">{r.code}</td>
                          <td className="p-2">{r.date || "—"}</td>
                          <td className="p-2">{r.created_at ? String(r.created_at).replace("T", " ").slice(0, 19) : "—"}</td>
                          <td className="p-2">{r.category}</td>
                          <td className="p-2">{r.status}</td>
                          <td className="p-2">{r.safety_flag ? "Yes" : "No"}</td>
                          <td className="p-2">{r.is_capped_non_safety ? "Yes" : "No"}</td>
                          <td className="p-2 text-right font-mono">{r.amount_applied?.toLocaleString?.() ?? 0}</td>
                        </tr>
                      ))}
                      {(ir.rows || []).length === 0 ? (
                        <tr className="border-t"><td colSpan={9} className="p-3 text-center text-gray-500">No infractions in selected period/scope</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
