import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import API, { buildQuery, formatApiError, fetchAllPaginated, getBackendOrigin } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import RingLoader from "../components/RingLoader";
import { BarChart3, TrendingUp, Shield, Clock, Gauge, ArrowDown, ArrowUp, Download, FilterX } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";

const FEE_PK_LIMIT = 20;

const inNum = (n) => (n == null ? "" : Number(n).toLocaleString("en-IN"));

/** Percent for KPI cards: whole numbers without “.0”, else one decimal. */
const fmtPctKpi = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const r = Math.round(v * 10) / 10;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(1);
};

const fmtNum2 = (n) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(2));

export default function KpiPage() {
  const [kpi, setKpi] = useState(null);
  const [kpiError, setKpiError] = useState(null);
  const [feePk, setFeePk] = useState(null);
  const [feePkError, setFeePkError] = useState(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [depot, setDepot] = useState("");
  const [concessionaire, setConcessionaire] = useState("");
  const [busId, setBusId] = useState("");
  const [buses, setBuses] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [fleetDepots, setFleetDepots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feePkLoading, setFeePkLoading] = useState(false);
  const [tab, setTab] = useState("kpi");

  useEffect(() => {
    (async () => {
      try {
        const [items, tenderRows] = await Promise.all([fetchAllPaginated(Endpoints.masters.buses.list(), {}), fetchAllPaginated(Endpoints.masters.tenders.list(), {})]);
        setBuses(items);
        setTenders(Array.isArray(tenderRows) ? tenderRows : []);
        setFleetDepots([...new Set(items.map((b) => b.depot).filter(Boolean))].sort());
      } catch {
        setBuses([]);
        setTenders([]);
        setFleetDepots([]);
      }
    })();
  }, []);

  const tenderById = useMemo(() => {
    const m = {};
    (tenders || []).forEach((t) => {
      if (t?.tender_id) m[String(t.tender_id).trim()] = t;
    });
    return m;
  }, [tenders]);

  const concessionaireOptions = useMemo(() => {
    const names = new Set((tenders || []).map((t) => String(t?.concessionaire || "").trim()).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [tenders]);

  const busOptions = useMemo(() => {
    let list = buses;
    if (depot) list = list.filter((b) => String(b.depot || "").trim() === String(depot).trim());
    if (concessionaire) {
      list = list.filter((b) => {
        const t = tenderById[String(b.tender_id || "").trim()];
        return t && String(t.concessionaire || "").trim() === concessionaire;
      });
    }
    return [...list].sort((a, b) => String(a.bus_id).localeCompare(String(b.bus_id)));
  }, [buses, depot, concessionaire, tenderById]);

  useEffect(() => {
    if (!busId) return;
    if (!busOptions.some((b) => b.bus_id === busId)) setBusId("");
  }, [busOptions, busId]);

  const loadKpi = useCallback(async () => {
    setLoading(true);
    setKpiError(null);
    try {
      const params = buildQuery({
        period_start: periodStart,
        period_end: periodEnd,
        depot,
        concessionaire,
        bus_id: busId,
      });
      const { data } = await API.get(Endpoints.kpi.gccEngine(), { params });
      setKpi(data);
    } catch (err) {
      setKpiError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load KPI");
      setKpi(null);
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd, depot, concessionaire, busId]);

  const loadFeePk = useCallback(
    async (pageNum) => {
      setFeePkLoading(true);
      setFeePkError(null);
      try {
        const params = buildQuery({
          period_start: periodStart,
          period_end: periodEnd,
          depot,
          concessionaire,
          bus_id: busId,
          page: pageNum,
          limit: FEE_PK_LIMIT,
        });
        const { data } = await API.get(Endpoints.kpi.feePkCompute(), { params });
        setFeePk(data);
      } catch (err) {
        const msg = formatApiError(err.response?.data?.detail) || err.message || "Failed to load Fee/PK";
        setFeePkError(msg);
        if (pageNum === 1) setFeePk(null);
      } finally {
        setFeePkLoading(false);
      }
    },
    [periodStart, periodEnd, depot, concessionaire, busId],
  );

  const refreshAll = useCallback(() => {
    loadKpi();
    loadFeePk(1);
  }, [loadKpi, loadFeePk]);

  const clearFilters = useCallback(() => {
    setPeriodStart("");
    setPeriodEnd("");
    setDepot("");
    setConcessionaire("");
    setBusId("");
  }, []);

  const downloadKpiReport = useCallback(
    (fmt) => {
      const q = new URLSearchParams(
        buildQuery({
          period_start: periodStart,
          period_end: periodEnd,
          depot,
          concessionaire,
          bus_id: busId,
          fmt,
        }),
      );
      const origin = getBackendOrigin();
      window.open(`${origin || ""}/api/kpi/gcc-engine/download?${q}`, "_blank");
    },
    [periodStart, periodEnd, depot, concessionaire, busId],
  );

  useEffect(() => {
    loadKpi();
    loadFeePk(1);
  }, [loadKpi, loadFeePk]);

  const cats = kpi?.categories || {};
  const punctualityMeta = cats.punctuality?.meta;
  const st = cats.punctuality?.start_target_pct ?? 90;
  const at = cats.punctuality?.arrival_target_pct ?? 80;
  const sp = cats.punctuality?.start_pct;
  const ap = cats.punctuality?.arrival_pct;

  const kpiTargetBadge = (pct, target) => {
    if (pct == null || target == null) return null;
    if (pct < target) return { label: "Below target", className: "bg-red-50 text-red-800 border-red-200" };
    if (pct > target) return { label: "Above target", className: "bg-green-50 text-green-800 border-green-200" };
    return { label: "At target", className: "bg-gray-50 text-gray-800 border-gray-200" };
  };

  const startPunctualityBadge = kpi && !loading && sp != null ? kpiTargetBadge(sp, st) : null;
  const arrivalPunctualityBadge = kpi && !loading && ap != null ? kpiTargetBadge(ap, at) : null;

  const kpiCards = [
    {
      key: "reliability",
      label: "Reliability (BF)",
      value: cats.reliability?.bf == null ? "—" : Number(cats.reliability.bf).toFixed(4),
      target: cats.reliability?.target == null ? "—" : Number(cats.reliability.target).toFixed(4),
      dam: cats.reliability?.damages,
      inc: cats.reliability?.incentive,
      icon: Shield,
      color: "#2563EB",
    },
    {
      key: "availability",
      label: "Availability",
      value: cats.availability?.pct == null ? "—" : `${fmtPctKpi(cats.availability.pct)}%`,
      target: cats.availability?.target == null ? "—" : `≥ ${fmtPctKpi(cats.availability.target)}%`,
      dam: cats.availability?.damages,
      inc: 0,
      icon: Gauge,
      color: "#16A34A",
    },
    {
      key: "punctuality",
      label: "Punctuality",
      value: loading ? "…" : `Start ${fmtPctKpi(sp)}% · Arrival ${fmtPctKpi(ap)}%`,
      target: `Start ≥ ${fmtPctKpi(st)}% · Arrival ≥ ${fmtPctKpi(at)}%`,
      dam: cats.punctuality?.damages,
      inc: cats.punctuality?.incentive,
      icon: Clock,
      color: "#F59E0B",
    },
    {
      key: "frequency",
      label: "Frequency",
      value:
        cats.frequency?.trip_freq_pct == null || cats.frequency?.bus_km_freq_pct == null
          ? "—"
          : `${fmtPctKpi(cats.frequency.trip_freq_pct)}% / ${fmtPctKpi(cats.frequency.bus_km_freq_pct)}%`,
      target:
        cats.frequency?.trip_target == null || cats.frequency?.bus_km_target == null
          ? "—"
          : `Trip ≥ ${fmtPctKpi(cats.frequency.trip_target)}% · KM ≥ ${fmtPctKpi(cats.frequency.bus_km_target)}%`,
      dam: cats.frequency?.damages,
      inc: cats.frequency?.incentive,
      icon: TrendingUp,
      color: "#8B5CF6",
    },
    {
      key: "safety",
      label: "Safety (MAF)",
      value: cats.safety?.maf == null ? "—" : Number(cats.safety.maf).toFixed(4),
      target: `≤ ${fmtNum2(cats.safety?.maf_target ?? cats.safety?.target ?? 0.01)}`,
      dam: cats.safety?.damages,
      inc: cats.safety?.incentive,
      icon: Shield,
      color: "#DC2626",
    },
  ];

  const chartData = kpiCards.map((k) => ({
    name: k.key,
    damages: k.dam || 0,
    incentive: k.inc || 0,
  }));

  const kpiDetailQuery = useMemo(() => {
    const q = buildQuery({
      period_start: periodStart,
      period_end: periodEnd,
      depot,
      concessionaire,
      bus_id: busId,
    });
    return new URLSearchParams(q).toString();
  }, [periodStart, periodEnd, depot, concessionaire, busId]);

  return (
    <div data-testid="kpi-dashboard-page">
      <div className="page-header">
        <h1 className="page-title">KPI</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadKpiReport("excel")} variant="outline" data-testid="kpi-download-excel-btn" title="Uses current period, depot, concessionaire, and bus filters">
            <Download size={14} className="mr-1.5 text-green-600" /> KPI Excel
          </Button>
          <Button onClick={() => downloadKpiReport("pdf")} variant="outline" data-testid="kpi-download-pdf-btn" title="Uses current period, depot, concessionaire, and bus filters">
            <Download size={14} className="mr-1.5 text-red-500" /> KPI PDF
          </Button>
          <Button onClick={refreshAll} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="compute-kpi-btn">
            <BarChart3 size={14} className="mr-1.5" /> Compute
          </Button>
        </div>
      </div>

      <p className="page-lead">
        Month-close style damages and incentives. Results are <strong>point-in-time</strong> and refresh when you change dates or filters (trips and incidents in range). Related data:{" "}
        <Link to="/incidents" className="text-[#C8102E] font-medium hover:underline">
          Incidents
        </Link>
        ,{" "}
        <Link to="/infractions" className="text-[#C8102E] font-medium hover:underline">
          Infractions
        </Link>
        .{/* <Link to="/deductions">Deductions</Link> hidden while deduction UI is off */}
      </p>

      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" data-testid="kpi-period-start" />
        <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" data-testid="kpi-period-end" />
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select
            value={depot || "all"}
            onValueChange={(v) => {
              setDepot(v === "all" ? "" : v);
              setBusId("");
            }}
          >
            <SelectTrigger className="w-44" data-testid="kpi-filter-depot">
              <SelectValue placeholder="All Depots" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {fleetDepots.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Concessionaire</label>
          <Select
            value={concessionaire || "all"}
            onValueChange={(v) => {
              setConcessionaire(v === "all" ? "" : v);
              setBusId("");
            }}
          >
            <SelectTrigger className="w-52" data-testid="kpi-filter-concessionaire">
              <SelectValue placeholder="All concessionaires" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All concessionaires</SelectItem>
              {concessionaireOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-52" data-testid="kpi-filter-bus">
              <SelectValue placeholder="All buses" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All buses</SelectItem>
              {busOptions.map((b) => (
                <SelectItem key={b.bus_id} value={b.bus_id}>
                  <span className="font-mono text-xs">{b.bus_id}</span>
                  {b.depot ? <span className="text-gray-500"> — {b.depot}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" onClick={clearFilters} variant="outline" data-testid="kpi-clear-filters-btn">
          <FilterX size={14} className="mr-1.5" /> Clear filters
        </Button>
      </div>

      <p className="text-xs text-gray-500 mb-4 max-w-3xl">
        KPI and Fee/PK include only <strong>active buses</strong> that match your filters. When a concessionaire is selected, the server scopes buses by matching that name on the tender (same rule as
        the bus list below). Excel and PDF downloads use the same filters as the screen.
        {kpi?.filters?.concessionaire ? (
          <span className="block mt-1 text-gray-600">
            Current API scope — concessionaire: <span className="font-medium">{kpi.filters.concessionaire}</span>
          </span>
        ) : null}
      </p>

      <div className="flex gap-2 mb-6">
        <Button variant={tab === "kpi" ? "default" : "outline"} onClick={() => setTab("kpi")} className={tab === "kpi" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>
          KPI Damages / Incentives
        </Button>
        <Button variant={tab === "feepk" ? "default" : "outline"} onClick={() => setTab("feepk")} className={tab === "feepk" ? "bg-[#C8102E] hover:bg-[#A50E25]" : ""}>
          Fee / PK
        </Button>
      </div>

      {tab === "kpi" && (
        <>
          {loading && !kpi ? (
            <AsyncPanel loading />
          ) : kpiError ? (
            <AsyncPanel error={kpiError} onRetry={loadKpi} />
          ) : kpi ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="kpi-card">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1">Monthly Fee Base</p>
                    <p className="text-lg font-bold" style={{ fontFamily: "Inter" }}>
                      Rs.{inNum(kpi.monthly_fee_base)}
                    </p>
                    <p className="text-xs text-gray-400">{inNum(kpi.bus_km)} bus-km</p>
                  </CardContent>
                </Card>
                <Card className="kpi-card border-red-200">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1 flex items-center gap-1">
                      <ArrowDown size={10} className="text-red-500" />
                      Total Damages (Capped)
                    </p>
                    <p className="text-lg font-bold text-[#DC2626]" style={{ fontFamily: "Inter" }}>
                      Rs.{inNum(kpi.total_damages_capped)}
                    </p>
                    <p className="text-xs text-gray-400">
                      Raw: Rs.{inNum(kpi.total_damages_raw)} | Cap: Rs.{inNum(kpi.kpi_cap)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="kpi-card border-green-200">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1 flex items-center gap-1">
                      <ArrowUp size={10} className="text-green-500" />
                      Total Incentives (Capped)
                    </p>
                    <p className="text-lg font-bold text-[#16A34A]" style={{ fontFamily: "Inter" }}>
                      Rs.{inNum(kpi.total_incentive_capped)}
                    </p>
                    <p className="text-xs text-gray-400">
                      Raw: Rs.{inNum(kpi.total_incentive_raw)} | Cap: Rs.{inNum(kpi.incentive_cap)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="kpi-card">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1">Net Impact</p>
                    <p className={`text-lg font-bold ${kpi.total_incentive_capped - kpi.total_damages_capped >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`} style={{ fontFamily: "Inter" }}>
                      Rs.{inNum(Math.abs(kpi.total_incentive_capped - kpi.total_damages_capped))}
                      {kpi.total_incentive_capped - kpi.total_damages_capped >= 0 ? " (credit)" : " (debit)"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-gray-200 shadow-sm" data-testid="kpi-punctuality-detail-card">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <Link
                      to={kpiDetailQuery ? `/kpi/detail/punctuality?${kpiDetailQuery}` : "/kpi/detail/punctuality"}
                      className="flex items-center gap-2 min-w-0 group"
                    >
                      <Clock size={18} className="text-amber-600 shrink-0" />
                      <h2 className="text-sm font-semibold text-gray-900 group-hover:text-[#C8102E]">Punctuality</h2>
                      <span className="text-[10px] text-[#C8102E] opacity-0 group-hover:opacity-100 transition-opacity">View detail →</span>
                    </Link>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/80 px-3 py-2">
                      <span className="text-xs text-gray-600">Start on time</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-base font-semibold tabular-nums" style={{ fontFamily: "Inter" }}>
                          {loading ? "…" : `${sp ?? "—"}%`}
                        </span>
                        <span className="text-[10px] text-gray-400">≥{st}%</span>
                        {startPunctualityBadge ? (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 border ${startPunctualityBadge.className}`}>
                            {startPunctualityBadge.label}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/80 px-3 py-2">
                      <span className="text-xs text-gray-600">Arrival on time</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-base font-semibold tabular-nums" style={{ fontFamily: "Inter" }}>
                          {loading ? "…" : `${ap ?? "—"}%`}
                        </span>
                        <span className="text-[10px] text-gray-400">≥{at}%</span>
                        {arrivalPunctualityBadge ? (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 border ${arrivalPunctualityBadge.className}`}>
                            {arrivalPunctualityBadge.label}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs border-t border-gray-100 pt-3">
                    <span>
                      <span className="text-gray-500">Damages </span>
                      <span className="text-[#DC2626] font-medium tabular-nums">Rs.{inNum(cats.punctuality?.damages || 0)}</span>
                    </span>
                    <span>
                      <span className="text-gray-500">Incentive </span>
                      <span className="text-[#16A34A] font-medium tabular-nums">Rs.{inNum(cats.punctuality?.incentive || 0)}</span>
                    </span>
                    {punctualityMeta?.data_source === "concessionaire" ? (
                      <span className="text-gray-500">
                        Data: {punctualityMeta.trips_start_measured ?? 0} starts / {punctualityMeta.trips_arrival_measured ?? 0} arrivals
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {kpiCards.map((k) => (
                  <Link
                    key={k.key}
                    to={kpiDetailQuery ? `/kpi/detail/${k.key}?${kpiDetailQuery}` : `/kpi/detail/${k.key}`}
                    className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C8102E]/35"
                    data-testid={`kpi-cat-link-${k.key}`}
                  >
                    <Card className="border-gray-200 shadow-sm h-full hover:border-[#C8102E]/35 hover:shadow-md transition-all cursor-pointer" data-testid={`kpi-cat-${k.key}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <k.icon size={18} style={{ color: k.color }} />
                          <Badge variant="outline" className="text-xs">
                            {k.label}
                          </Badge>
                        </div>
                        <p className="text-lg font-bold tabular-nums leading-snug" style={{ fontFamily: "Inter" }}>
                          {loading ? "…" : k.value}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{loading ? "" : `Target: ${k.target}`}</p>
                        {k.key === "frequency" && !loading && cats.frequency?.scheduled_trips != null ? (
                          <p
                            className="text-[10px] text-gray-500 mt-1 leading-snug"
                            title="Trip % = (completed trips ÷ scheduled trips) × 100. A trip counts as completed if trip_status is completed or actual_km reaches the business-rule threshold of scheduled_km (default 100%)."
                          >
                            Trips: {cats.frequency.completed_trips ?? 0} completed / {cats.frequency.scheduled_trips} scheduled
                          </p>
                        ) : null}
                        <p className="text-[10px] text-[#C8102E] mt-2 font-medium">Open detail →</p>
                        <div className="flex justify-between gap-3 mt-3 pt-2 border-t border-gray-100 text-xs">
                          <div className="min-w-0">
                            <span className="text-gray-500 block mb-0.5">Damages</span>
                            <span className="text-[#DC2626] font-bold tabular-nums">Rs.{inNum(k.dam ?? 0)}</span>
                          </div>
                          <div className="min-w-0 text-right">
                            <span className="text-gray-500 block mb-0.5">Incentive</span>
                            <span className="text-[#16A34A] font-bold tabular-nums">Rs.{inNum(k.inc ?? 0)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle>Damages vs Incentives by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-2">
                      <RingLoader />
                    </div>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <RechartsTooltip formatter={(v) => `Rs.${inNum(v)}`} />
                          <Bar dataKey="damages" fill="#DC2626" radius={[4, 4, 0, 0]} name="Damages" />
                          <Bar dataKey="incentive" fill="#16A34A" radius={[4, 4, 0, 0]} name="Incentives" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <AsyncPanel empty emptyMessage="No KPI data. Adjust filters and click Compute." />
          )}
        </>
      )}

      {tab === "feepk" && (
        <>
          {feePkLoading && !feePk ? (
            <AsyncPanel loading />
          ) : feePkError && !feePk ? (
            <AsyncPanel error={feePkError} onRetry={() => loadFeePk(1)} />
          ) : feePk ? (
            <div className="space-y-6">
              {feePkError ? (
                <div className="rounded-lg border border-red-100 bg-red-50/90 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <p className="text-sm text-red-800">{feePkError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => loadFeePk(feePk.page ?? 1)}>
                    Retry
                  </Button>
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="kpi-card">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1">Total Fee (PK)</p>
                    <p className="text-lg font-bold text-[#C8102E]" style={{ fontFamily: "Inter" }}>
                      Rs.{inNum(feePk.total_fee)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="kpi-card">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1">Buses</p>
                    <p className="text-lg font-bold" style={{ fontFamily: "Inter" }}>
                      {inNum(feePk.bus_count)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="kpi-card">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase mb-1">Fee/PK formula</p>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      actual≥assured: PK×assured + PK×0.5×(act-ass)
                      <br />
                      actual&lt;assured: PK×actual + PK×0.75×(ass-act)
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle>Bus-wise Fee/PK Calculation</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {feePkLoading ? (
                    <div className="py-16 flex flex-col items-center justify-center gap-2">
                      <RingLoader />
                      <p className="text-xs text-gray-500">Loading…</p>
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow className="table-header">
                            <TableHead>Bus</TableHead>
                            <TableHead>Depot</TableHead>
                            <TableHead className="text-right">PK Rate</TableHead>
                            <TableHead className="text-right">Actual KM</TableHead>
                            <TableHead className="text-right">Assured KM</TableHead>
                            <TableHead>Band</TableHead>
                            <TableHead className="text-right">Fee (Rs)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {feePk.bus_results?.map((b) => (
                            <TableRow key={b.bus_id} className="hover:bg-[#FAFAFA]" data-testid={`feepk-bus-${b.bus_id}`}>
                              <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                              <TableCell>{b.depot}</TableCell>
                              <TableCell className="text-right font-mono">Rs.{inNum(b.pk_rate)}</TableCell>
                              <TableCell className="text-right font-mono">{inNum(b.actual_km)}</TableCell>
                              <TableCell className="text-right font-mono">{inNum(b.assured_km)}</TableCell>
                              <TableCell>
                                <Badge className={b.band === "actual>=assured" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"}>
                                  {b.band === "actual>=assured" ? "Excess" : "Shortfall"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">Rs.{inNum(b.fee)}</TableCell>
                            </TableRow>
                          ))}
                          {(!feePk.bus_results || feePk.bus_results.length === 0) && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-gray-400 py-10">
                                No bus rows for this period
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                      <TablePaginationBar
                        page={feePk.page ?? 1}
                        pages={feePk.pages ?? 1}
                        total={feePk.row_total ?? feePk.bus_count ?? 0}
                        limit={feePk.limit ?? FEE_PK_LIMIT}
                        onPageChange={(p) => loadFeePk(p)}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <AsyncPanel empty emptyMessage="No Fee/PK data. Adjust filters and click Compute." />
          )}
        </>
      )}
    </div>
  );
}
