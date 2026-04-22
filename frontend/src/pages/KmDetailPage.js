import { useState, useEffect, useMemo } from "react";
import { useKmDetails, useKmMutations } from "../features/km/api/useKm";
import API, { messageFromAxiosError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { useAuth } from "../contexts/AuthContext";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import { formatChartAxisDate, formatDateIN, rechartsDateLabelFormatter } from "../lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { MapPin, ArrowLeft, TrendingUp, Bus, Gauge, Pencil } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import TripKmApprovalPanel from "../components/TripKmApprovalPanel";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";

const TRIP_KM_EDIT_MAX = 2000;
const BUS_SUMMARY_PAGE_SIZE = 12;

function tripKeyForRow(r) {
  const tid = r.trip_id;
  if (tid != null && String(tid).trim()) return String(tid).trim();
  return `${r.bus_id}|${r.date}`;
}


export default function KmDetailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [depot, setDepot] = useState(searchParams.get("depot") || "");
  const [busId, setBusId] = useState(searchParams.get("bus") || "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("to") || "");
  const [period, setPeriod] = useState("daily");
  const [page, setPage] = useState(1);
  const [busSummaryPage, setBusSummaryPage] = useState(1);

  const filters = {
    period,
    depot,
    bus_id: busId,
    date_from: dateFrom,
    date_to: dateTo,
    page,
    limit: 20,
  };

  const { data, isLoading: loading, error: fetchError, refetch: load } = useKmDetails(filters);
  const { updateTripKm, isSubmitting: editSaving } = useKmMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editScheduled, setEditScheduled] = useState("");
  const [editActual, setEditActual] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editAddInfractions, setEditAddInfractions] = useState(false);
  const [editError, setEditError] = useState(null);

  const canEditTripKm = (user?.permissions || []).includes("operations.trip_km.traffic_approve");

  const kmTab = useMemo(() => (searchParams.get("tab") === "approval" ? "approval" : "analytics"), [searchParams]);

  const setKmTab = (v) => {
    const p = new URLSearchParams(searchParams);
    if (v === "approval") p.set("tab", "approval");
    else p.delete("tab");
    setSearchParams(p, { replace: true });
  };

  const inNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));

  useEffect(() => { setPage(1); }, [depot, busId, dateFrom, dateTo, period]);

  useEffect(() => { setBusSummaryPage(1); }, [depot, busId, dateFrom, dateTo, period, data?.row_total, data?.page]);

  const openKmEdit = (r) => {
    setEditRow(r);
    setEditScheduled(String(r.scheduled_km ?? ""));
    setEditActual(String(r.actual_km ?? ""));
    setEditReason(String(r.km_tracking_edit_reason ?? ""));
    setEditAddInfractions(Boolean(r.km_tracking_add_to_infractions));
    setEditError(null);
    setEditOpen(true);
  };

  const saveKmEdit = async () => {
    if (!editRow) return;
    const sk = parseFloat(editScheduled, 10);
    const ak = parseFloat(editActual, 10);
    if (Number.isNaN(sk) || Number.isNaN(ak)) {
      setEditError("Enter valid numbers for scheduled and actual KM.");
      return;
    }
    if (sk < 0 || ak < 0 || sk > TRIP_KM_EDIT_MAX || ak > TRIP_KM_EDIT_MAX) {
      setEditError(`KM must be between 0 and ${TRIP_KM_EDIT_MAX}.`);
      return;
    }
    try {
      await updateTripKm({
        trip_key: tripKeyForRow(editRow),
        scheduled_km: sk,
        actual_km: ak,
        reason: editReason.trim(),
        add_to_infractions: editAddInfractions,
      });
      setEditOpen(false);
      setEditRow(null);
    } catch (err) {
      setEditError(messageFromAxiosError(err, "Update failed"));
    }
  };

  const editPreviewMissed = useMemo(() => {
    const sk = parseFloat(editScheduled, 10);
    const ak = parseFloat(editActual, 10);
    if (Number.isNaN(sk) || Number.isNaN(ak)) return null;
    return Math.max(0, sk - ak);
  }, [editScheduled, editActual]);

  const editHasKmVariance = useMemo(() => {
    const sk = parseFloat(editScheduled, 10);
    const ak = parseFloat(editActual, 10);
    if (Number.isNaN(sk) || Number.isNaN(ak)) return false;
    return sk !== ak;
  }, [editScheduled, editActual]);

  const editInfractionCodeHint = useMemo(() => {
    const sk = parseFloat(editScheduled, 10);
    const ak = parseFloat(editActual, 10);
    if (Number.isNaN(sk) || Number.isNaN(ak) || sk === ak) return "";
    if (ak < sk) return "O12 (lost / doubtful kilometres)";
    return "C08 (trip not forming part of schedule)";
  }, [editScheduled, editActual]);

  useEffect(() => {
    if (editOpen && !editHasKmVariance) setEditAddInfractions(false);
  }, [editOpen, editHasKmVariance]);

  // Aggregate for charts
  const chartData = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      const key = period === "daily" ? r.date : r.period;
      if (!agg[key]) agg[key] = { period: key, actual_km: 0, scheduled_km: 0 };
      agg[key].actual_km += r.actual_km || 0;
      agg[key].scheduled_km += r.scheduled_km || 0;
    });
    return Object.values(agg).sort((a, b) => a.period.localeCompare(b.period));
  })() : [];

  // Top buses by KM
  const topBuses = data?.data ? (() => {
    const agg = {};
    data.data.forEach((r) => {
      if (!agg[r.bus_id]) agg[r.bus_id] = { bus_id: r.bus_id, depot: r.depot, actual_km: 0, scheduled_km: 0, days: 0 };
      agg[r.bus_id].actual_km += r.actual_km || 0;
      agg[r.bus_id].scheduled_km += r.scheduled_km || 0;
      agg[r.bus_id].days += (period === "daily" ? 1 : r.days || 1);
    });
    return Object.values(agg).sort((a, b) => b.actual_km - a.actual_km);
  })() : [];

  const busSummaryTotal = topBuses.length;
  const busSummaryPages = Math.max(1, Math.ceil(busSummaryTotal / BUS_SUMMARY_PAGE_SIZE));
  const safeBusSummaryPage = Math.min(busSummaryPage, busSummaryPages);
  const busSummaryStart = (safeBusSummaryPage - 1) * BUS_SUMMARY_PAGE_SIZE;
  const topBusesPage = topBuses.slice(busSummaryStart, busSummaryStart + BUS_SUMMARY_PAGE_SIZE);

  const totalScheduled = chartData.reduce((s, d) => s + (d.scheduled_km || 0), 0);
  const availPct = totalScheduled > 0 ? ((data?.total_km || 0) / totalScheduled * 100).toFixed(1) : 0;

  return (
    <div data-testid="km-detail-page">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} data-testid="km-back-btn">
            <ArrowLeft size={18} />
          </Button>
          <h1 className="page-title">Kilometre Tracking</h1>
        </div>
      </div>

      <Tabs value={kmTab} onValueChange={setKmTab} className="w-full">
        <TabsList className="mb-4 h-auto flex-wrap justify-start gap-1 bg-gray-100/80 p-1">
          <TabsTrigger value="analytics" className="text-xs sm:text-sm" data-testid="km-tab-analytics">
            Analytics
          </TabsTrigger>
          <TabsTrigger value="approval" className="text-xs sm:text-sm" data-testid="km-tab-approval">
            Trip kilometre verification
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="mt-0 flex flex-col gap-6 focus-visible:ring-0">
      {/* Filters */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Period</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-36" data-testid="km-period-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
              <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
                <SelectTrigger className="w-48" data-testid="km-depot-filter"><SelectValue placeholder="All Depots" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Depots</SelectItem>
                  {data?.depots?.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
              <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36" data-testid="km-bus-filter"><SelectValue placeholder="All Buses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buses</SelectItem>
                  {data?.bus_ids?.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="km-date-from" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="km-date-to" />
            </div>
            <Button onClick={load} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="km-apply-btn">Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {fetchError && !loading ? (
        <AsyncPanel error={messageFromAxiosError(fetchError, "Failed to load KM details")} onRetry={load} />
      ) : null}
      {loading && !data ? (
        <AsyncPanel loading minHeight="min-h-[200px]" />
      ) : null}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Total KM</p>
            <p className="text-lg font-bold text-[#16A34A]" style={{ fontFamily: 'Inter' }}>{inNum(data?.total_km ?? 0)} km</p></div>
            <MapPin size={18} className="text-[#16A34A]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Scheduled KM</p>
            <p className="text-lg font-bold text-gray-600" style={{ fontFamily: 'Inter' }}>{inNum(totalScheduled)} km</p></div>
            <Gauge size={18} className="text-gray-400" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Availability %</p>
            <p className={`text-lg font-bold ${Number(availPct) >= 90 ? "text-[#16A34A]" : "text-[#F59E0B]"}`} style={{ fontFamily: 'Inter' }}>{availPct}%</p></div>
            <TrendingUp size={18} className="text-[#16A34A]" />
          </div>
        </CardContent></Card>
        <Card className="kpi-card"><CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div><p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Top Bus</p>
            <p className="text-lg font-bold text-[#2563EB]" style={{ fontFamily: 'Inter' }}>{topBuses[0]?.bus_id || "-"}</p>
            <p className="text-xs text-gray-400 mt-0.5">{inNum(topBuses[0]?.actual_km ?? 0)} km</p></div>
            <Bus size={18} className="text-[#2563EB]" />
          </div>
        </CardContent></Card>
      </div>

      {/* Chart */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="font-medium">KM Trend ({period})</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            {!loading && chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                No data for the selected filters. Adjust period, depot, bus, or date range.
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              {period === "daily" ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={(v) => (period === "daily" ? formatChartAxisDate(v) : v)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inNum(v)} labelFormatter={(l) => (period === "daily" ? rechartsDateLabelFormatter(l) : l)} />
                  <Line type="monotone" dataKey="actual_km" stroke="#16A34A" strokeWidth={2} dot={false} name="Actual KM" />
                  <Line type="monotone" dataKey="scheduled_km" stroke="#9CA3AF" strokeWidth={2} dot={false} name="Scheduled KM" strokeDasharray="5 5" />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => inNum(v)} />
                  <Bar dataKey="actual_km" fill="#16A34A" radius={[4, 4, 0, 0]} name="Actual KM" />
                  <Bar dataKey="scheduled_km" fill="#E5E7EB" radius={[4, 4, 0, 0]} name="Scheduled KM" />
                </BarChart>
              )}
            </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bus-wise KM Table */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="font-medium">Bus-wise KM Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Depot</TableHead>
              <TableHead className="text-right">Scheduled KM</TableHead>
              <TableHead className="text-right">Actual KM</TableHead>
              <TableHead className="text-right">Missed KM</TableHead>
              <TableHead className="text-right">Availability %</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {topBusesPage.map((b) => {
                const missed = Math.max(0, b.scheduled_km - b.actual_km);
                const avail = b.scheduled_km > 0 ? (b.actual_km / b.scheduled_km * 100).toFixed(1) : 0;
                return (
                  <TableRow key={b.bus_id} className="hover:bg-gray-50" data-testid={`km-bus-${b.bus_id}`}>
                    <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                    <TableCell>{b.depot}</TableCell>
                    <TableCell className="text-right font-mono">{inNum(b.scheduled_km)}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-[#16A34A]">{inNum(b.actual_km)}</TableCell>
                    <TableCell className="text-right font-mono text-[#DC2626]">{inNum(missed)}</TableCell>
                    <TableCell className="text-right"><Badge className={Number(avail) >= 90 ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"}>{avail}%</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {busSummaryTotal > BUS_SUMMARY_PAGE_SIZE ? (
            <TablePaginationBar
              page={safeBusSummaryPage}
              pages={busSummaryPages}
              total={busSummaryTotal}
              limit={BUS_SUMMARY_PAGE_SIZE}
              onPageChange={setBusSummaryPage}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="font-medium">Detailed {period === "daily" ? "Day-wise" : period === "monthly" ? "Month-wise" : "Quarter-wise"} Data</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow className="table-header sticky top-0">
                <TableHead>Bus ID</TableHead><TableHead>Depot</TableHead>
                <TableHead>{period === "daily" ? "Date" : "Period"}</TableHead>
                {period === "daily" && <TableHead>Driver</TableHead>}
                <TableHead className="text-right">Scheduled KM</TableHead>
                <TableHead className="text-right">Actual KM</TableHead>
                <TableHead className="text-right">Missed KM</TableHead>
                {period !== "daily" && <TableHead className="text-right">Days</TableHead>}
                {period === "daily" && canEditTripKm && <TableHead className="text-right w-[88px]">Actions</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {(data?.data || []).map((r, i) => {
                  const sk = Number(r.scheduled_km ?? 0);
                  const ak = Number(r.actual_km ?? 0);
                  const missed = r.missed_km != null && r.missed_km !== undefined
                    ? Number(r.missed_km)
                    : Math.max(0, sk - ak);
                  return (
                  <TableRow key={`${tripKeyForRow(r)}-${i}`} className="hover:bg-[#FAFAFA]">
                    <TableCell className="font-mono text-sm">{r.bus_id}</TableCell>
                    <TableCell className="text-sm">{r.depot}</TableCell>
                    <TableCell className="text-sm">{formatDateIN(r.date || r.period)}</TableCell>
                    {period === "daily" && <TableCell className="text-sm text-gray-500">{r.driver_id || "-"}</TableCell>}
                    <TableCell className="text-right font-mono">{inNum(r.scheduled_km)}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{inNum(r.actual_km)}</TableCell>
                    <TableCell className="text-right font-mono text-[#DC2626]">{inNum(missed)}</TableCell>
                    {period !== "daily" && <TableCell className="text-right font-mono">{r.days}</TableCell>}
                    {period === "daily" && canEditTripKm && (
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => openKmEdit(r)} data-testid={`km-edit-${tripKeyForRow(r)}`}>
                          <Pencil size={14} className="mr-1" /> Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePaginationBar
            page={data?.page ?? page}
            pages={data?.pages ?? 1}
            total={data?.row_total ?? 0}
            limit={data?.limit ?? 20}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) { setEditOpen(false); setEditRow(null); setEditError(null); } }}>
        <DialogContent className="sm:max-w-md" data-testid="km-edit-dialog">
          <DialogHeader>
            <DialogTitle>Edit KM</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground font-mono text-xs">
                {editRow.bus_id} · {formatDateIN(editRow.date)}
                {editRow.trip_id ? ` · ${editRow.trip_id}` : ""}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Scheduled</label>
                  <Input
                    type="number"
                    min={0}
                    max={TRIP_KM_EDIT_MAX}
                    step="0.01"
                    value={editScheduled}
                    onChange={(e) => setEditScheduled(e.target.value)}
                    data-testid="km-edit-scheduled"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Actual</label>
                  <Input
                    type="number"
                    min={0}
                    max={TRIP_KM_EDIT_MAX}
                    step="0.01"
                    value={editActual}
                    onChange={(e) => setEditActual(e.target.value)}
                    data-testid="km-edit-actual"
                  />
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2">
                <span className="text-xs text-muted-foreground">Missed </span>
                <span className="font-mono font-semibold text-[#DC2626]">
                  {editPreviewMissed == null ? "—" : `${inNum(editPreviewMissed)} km`}
                </span>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Note</label>
                <Textarea
                  rows={2}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Optional"
                  data-testid="km-edit-reason"
                />
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs text-gray-700">Add to incidents</Label>
                  <Switch
                    checked={editAddInfractions}
                    disabled={!editHasKmVariance}
                    onCheckedChange={(checked) => setEditAddInfractions(Boolean(checked))}
                    data-testid="km-edit-add-incidents"
                  />
                </div>
                {!editHasKmVariance ? (
                  <p className="text-xs text-muted-foreground">Available when scheduled and actual KM differ.</p>
                ) : editInfractionCodeHint ? (
                  <p className="text-xs text-amber-900">
                    Suggested infraction: <span className="font-mono font-medium">{editInfractionCodeHint}</span>
                  </p>
                ) : null}
              </div>
              {editError ? <p className="text-sm text-red-600">{editError}</p> : null}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => { setEditOpen(false); setEditRow(null); }} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="button" className="bg-[#C8102E] hover:bg-[#A50E25]" onClick={saveKmEdit} disabled={editSaving} data-testid="km-edit-save">
              {editSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        <TabsContent value="approval" className="mt-0 focus-visible:ring-0">
          <TripKmApprovalPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
