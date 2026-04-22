import { useEffect, useMemo, useCallback, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import API, { buildQuery, formatApiError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import AsyncPanel from "../components/AsyncPanel";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import TablePaginationBar from "../components/TablePaginationBar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";
import { VALID_KPI_SLUGS, kpiDetailLabels, relatedKpis } from "../lib/kpiDetailDefinitions";
import { ChevronLeft } from "lucide-react";

const inNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));
const fmtPct = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Math.round(Number(n) * 10) / 10;
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
};

const INCIDENT_PAGE_SIZE = 15;

function CategoryNumbers({ slug, cat, loading }) {
  if (loading || !cat) return <p className="text-sm text-muted-foreground">Loading…</p>;
  switch (slug) {
    case "reliability":
      return (
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">BF</p>
            <p className="text-lg font-mono font-semibold">{cat.bf != null ? Number(cat.bf).toFixed(4) : "—"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-lg font-mono font-semibold">{cat.target != null ? Number(cat.target).toFixed(4) : "—"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Breakdowns</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.breakdowns)}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Bus-km</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.bus_km)}</p>
          </div>
        </div>
      );
    case "availability":
      return (
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Availability %</p>
            <p className="text-lg font-mono font-semibold">{fmtPct(cat.pct)}%</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Target %</p>
            <p className="text-lg font-mono font-semibold">{fmtPct(cat.target)}%</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Expected turnouts</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.shift_turnouts_expected)}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Available turnouts</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.shift_turnouts_available)}</p>
          </div>
        </div>
      );
    case "punctuality":
      return (
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Start on time</p>
            <p className="text-lg font-mono font-semibold">{fmtPct(cat.start_pct)}%</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Arrival on time</p>
            <p className="text-lg font-mono font-semibold">{fmtPct(cat.arrival_pct)}%</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Trips (start)</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.trips_start_measured)}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Trips (arrival)</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.trips_arrival_measured)}</p>
          </div>
        </div>
      );
    case "frequency":
      return (
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Trip frequency %</p>
            <p className="text-lg font-mono font-semibold">{fmtPct(cat.trip_freq_pct)}%</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Bus-km frequency %</p>
            <p className="text-lg font-mono font-semibold">{fmtPct(cat.bus_km_freq_pct)}%</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Completed / scheduled trips</p>
            <p className="text-lg font-mono font-semibold">
              {inNum(cat.completed_trips)} / {inNum(cat.scheduled_trips)}
            </p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Actual / scheduled km</p>
            <p className="text-lg font-mono font-semibold">
              {inNum(cat.actual_km)} / {inNum(cat.scheduled_km)}
            </p>
          </div>
        </div>
      );
    case "trip_speed":
      return (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Average speed</p>
            <p className="text-lg font-mono font-semibold">{cat.avg_kmh != null ? `${fmtPct(cat.avg_kmh)} km/h` : "—"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-lg font-mono font-semibold">{cat.target_kmh != null ? `${fmtPct(cat.target_kmh)} km/h` : "—"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Trips measured</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.measured_trips)}</p>
          </div>
        </div>
      );
    case "safety":
      return (
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">MAF</p>
            <p className="text-lg font-mono font-semibold">{cat.maf != null ? Number(cat.maf).toFixed(4) : "—"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">MAF target</p>
            <p className="text-lg font-mono font-semibold">{cat.maf_target != null ? Number(cat.maf_target).toFixed(4) : "0.0100"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Minor accidents</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.minor_accidents)}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Major accidents</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.major_accidents)}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Fire-affected buses (3 months)</p>
            <p className="text-lg font-mono font-semibold">{inNum(cat.lot_fire_bus_count_3m)}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Fire lot % (3 months)</p>
            <p className="text-lg font-mono font-semibold">{cat.lot_fire_bus_pct_3m != null ? `${fmtPct(cat.lot_fire_bus_pct_3m)}%` : "—"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Fire threshold</p>
            <p className="text-lg font-mono font-semibold">{cat.lot_fire_threshold_pct != null ? `${fmtPct(cat.lot_fire_threshold_pct)}%` : "4%"}</p>
          </div>
          <div className="rounded-lg border bg-white/80 p-3">
            <p className="text-xs text-muted-foreground">Lot shutdown trigger</p>
            <p className="text-lg font-mono font-semibold">{cat.lot_shutdown_triggered ? "Yes" : "No"}</p>
          </div>
        </div>
      );
    default:
      return null;
  }
}

export default function KpiDetailPage() {
  const { kpiSlug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const slug = String(kpiSlug || "").toLowerCase();
  const [incidentPage, setIncidentPage] = useState(1);

  const queryParams = useMemo(() => {
    const o = {};
    ["period_start", "period_end", "depot", "concessionaire", "bus_id"].forEach((k) => {
      const v = searchParams.get(k);
      if (v) o[k] = v;
    });
    return o;
  }, [searchParams]);

  const [state, setState] = useState({ kpi: null, loading: true, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const params = buildQuery(queryParams);
      const { data } = await API.get(Endpoints.kpi.gccEngine(), { params });
      setState({ kpi: data, loading: false, error: null });
    } catch (err) {
      setState({ kpi: null, loading: false, error: formatApiError(err.response?.data?.detail) || err.message || "Failed to load" });
    }
  }, [queryParams]);

  useEffect(() => {
    if (!VALID_KPI_SLUGS.includes(slug)) {
      navigate("/kpi", { replace: true });
      return;
    }
    load();
  }, [slug, load, navigate]);

  useEffect(() => {
    setIncidentPage(1);
  }, [slug, state.kpi?.incident_visibility]);

  const cat = state.kpi?.categories?.[slug];
  const vis = state.kpi?.incident_visibility?.[slug];
  const qs = searchParams.toString();
  const linkSuffix = qs ? `?${qs}` : "";

  const incidentRows = vis?.sample || [];
  const incidentTotal = incidentRows.length;
  const incidentPages = Math.max(1, Math.ceil(incidentTotal / INCIDENT_PAGE_SIZE));
  const safeIncidentPage = Math.min(incidentPage, incidentPages);
  const incidentStart = (safeIncidentPage - 1) * INCIDENT_PAGE_SIZE;
  const incidentSlice = incidentRows.slice(incidentStart, incidentStart + INCIDENT_PAGE_SIZE);

  return (
    <div className="space-y-6 pb-10" data-testid={`kpi-detail-${slug}`}>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/dashboard">Home</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/kpi${linkSuffix}`}>KPI</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{kpiDetailLabels[slug] || slug}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground" asChild>
          <Link to={`/kpi${linkSuffix}`}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Link>
        </Button>
        <h1 className="page-title">{kpiDetailLabels[slug]}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {state.kpi?.period?.start || "—"} → {state.kpi?.period?.end || "—"}
          {" · "}
          {state.kpi?.bus_count ?? "—"} buses
        </p>
      </div>

      {state.loading && !state.kpi ? (
        <AsyncPanel loading />
      ) : state.error ? (
        <AsyncPanel error={state.error} onRetry={load} />
      ) : state.kpi ? (
        <>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CategoryNumbers slug={slug} cat={cat} loading={state.loading} />
              <div className="flex flex-wrap gap-6 pt-2 border-t text-sm">
                <span>
                  <span className="text-muted-foreground">Damages </span>
                  <span className="text-red-600 font-mono font-semibold">Rs.{inNum(cat?.damages)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Incentive </span>
                  <span className="text-green-700 font-mono font-semibold">Rs.{inNum(cat?.incentive)}</span>
                </span>
                <span className="text-muted-foreground">
                  Fee base <span className="font-mono text-foreground">Rs.{inNum(state.kpi.monthly_fee_base)}</span>
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Related incidents</CardTitle>
            </CardHeader>
            <CardContent>
              {vis?.incident_count != null && vis.incident_count > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground mb-3">
                    Total: <span className="font-medium text-foreground">{vis.incident_count}</span>
                    {incidentTotal < vis.incident_count ? (
                      <span className="text-xs"> (showing {incidentTotal} in this response)</span>
                    ) : null}
                  </p>
                  {vis.by_incident_code && Object.keys(vis.by_incident_code).length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {Object.entries(vis.by_incident_code).map(([code, n]) => (
                        <Badge key={code} variant="outline" className="font-mono text-xs">
                          {code}: {n}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {incidentSlice.length > 0 ? (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow className="table-header">
                            <TableHead>ID</TableHead>
                            <TableHead>Bus</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Occurred</TableHead>
                            <TableHead>Severity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {incidentSlice.map((row, idx) => (
                            <TableRow key={`${row.id}-${idx}`}>
                              <TableCell className="font-mono text-xs">{row.id || "—"}</TableCell>
                              <TableCell className="font-mono text-xs">{row.bus_id || "—"}</TableCell>
                              <TableCell className="text-xs">{row.incident_type}</TableCell>
                              <TableCell className="text-xs">{row.occurred_at || "—"}</TableCell>
                              <TableCell className="text-xs">{row.severity || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {incidentTotal > INCIDENT_PAGE_SIZE ? (
                        <TablePaginationBar
                          page={safeIncidentPage}
                          pages={incidentPages}
                          total={incidentTotal}
                          limit={INCIDENT_PAGE_SIZE}
                          onPageChange={setIncidentPage}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No related incidents for this filter.</p>
              )}
              <Button variant="outline" size="sm" className="mt-4" asChild>
                <Link to="/incidents">Incidents</Link>
              </Button>
            </CardContent>
          </Card>

          {(relatedKpis[slug] || []).length > 0 ? (
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Other KPIs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {(relatedKpis[slug] || []).map((r) => (
                  <Button key={r} variant="secondary" size="sm" asChild>
                    <Link to={`/kpi/detail/${r}${linkSuffix}`}>{kpiDetailLabels[r]}</Link>
                  </Button>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <AsyncPanel empty emptyMessage="No data." />
      )}
    </div>
  );
}
