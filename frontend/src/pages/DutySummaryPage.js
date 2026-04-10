import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import API, { buildQuery, buildDutiesSummaryExportUrl, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import AsyncPanel from "../components/AsyncPanel";
import DutyTripsReadOnlyTable from "../components/DutyTripsReadOnlyTable";
import TablePaginationBar from "../components/TablePaginationBar";
import ReportDownloads from "../components/ReportDownloads";
import { formatDateIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, Bus, CalendarDays, Hourglass, MessageSquare, Phone, Route, User } from "lucide-react";

const today = new Date().toISOString().slice(0, 10);
const PAGE_LIMIT = 20;

function StatTile({ label, value, icon: Icon, hint }) {
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardContent className="p-4 flex items-start gap-3">
        {Icon ? (
          <div className="rounded-lg bg-gray-100 p-2 text-gray-600 shrink-0">
            <Icon size={18} strokeWidth={2} />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-[#1A1A1A] tabular-nums leading-tight mt-0.5">{value}</p>
          {hint ? <p className="text-xs text-gray-600 mt-1 leading-snug">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DutySummaryPage() {
  const [searchParams] = useSearchParams();
  const [filterDate, setFilterDate] = useState(searchParams.get("date") || today);
  const [filterDepot, setFilterDepot] = useState(searchParams.get("depot") || "");
  const [filterBusId, setFilterBusId] = useState(searchParams.get("bus_id") || "");
  const [filterSearchQ, setFilterSearchQ] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(1);
  const [buses, setBuses] = useState([]);
  const [duties, setDuties] = useState([]);
  const [listMeta, setListMeta] = useState({ total: 0, pages: 1, limit: PAGE_LIMIT });
  const [metrics, setMetrics] = useState({
    duty_count: 0,
    trip_legs: 0,
    sms_sent: 0,
    sms_pending: 0,
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const exportFilters = useMemo(
    () => ({
      date: filterDate,
      depot: filterDepot,
      bus_id: filterBusId,
      q: filterSearchQ.trim(),
    }),
    [filterDate, filterDepot, filterBusId, filterSearchQ]
  );

  const pdfHref = useMemo(() => buildDutiesSummaryExportUrl("pdf", exportFilters), [exportFilters]);
  const excelHref = useMemo(() => buildDutiesSummaryExportUrl("excel", exportFilters), [exportFilters]);

  const listQueryString = () => {
    const q = new URLSearchParams();
    q.set("date", filterDate || today);
    if (filterDepot) q.set("depot", filterDepot);
    if (filterBusId) q.set("bus_id", filterBusId);
    if (filterSearchQ.trim()) q.set("q", filterSearchQ.trim());
    return q.toString();
  };

  useEffect(() => {
    setPage(1);
  }, [filterDate, filterDepot, filterBusId, filterSearchQ]);

  const loadMetrics = useCallback(async () => {
    try {
      const { data } = await API.get(Endpoints.operations.duties.summaryMetrics(), {
        params: buildQuery({
          date: filterDate,
          depot: filterDepot,
          bus_id: filterBusId,
          q: filterSearchQ.trim(),
        }),
      });
      setMetrics({
        duty_count: Number(data?.duty_count) || 0,
        trip_legs: Number(data?.trip_legs) || 0,
        sms_sent: Number(data?.sms_sent) || 0,
        sms_pending: Number(data?.sms_pending) || 0,
      });
    } catch {
      setMetrics({ duty_count: 0, trip_legs: 0, sms_sent: 0, sms_pending: 0 });
    }
  }, [filterDate, filterDepot, filterBusId, filterSearchQ]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = buildQuery({
        date: filterDate,
        depot: filterDepot,
        bus_id: filterBusId,
        q: filterSearchQ.trim(),
        page,
        limit: PAGE_LIMIT,
      });
      const [dRes, busItems] = await Promise.all([
        API.get(Endpoints.operations.duties.list(), { params }),
        fetchAllPaginated(Endpoints.masters.buses.list(), {}),
      ]);
      const du = unwrapListResponse(dRes.data);
      setDuties(du.items);
      setListMeta({ total: du.total, pages: du.pages, limit: du.limit });
      setBuses(busItems);
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load duties"));
      setDuties([]);
      setListMeta({ total: 0, pages: 1, limit: PAGE_LIMIT });
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterDepot, filterBusId, filterSearchQ, page]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const refreshAll = () => {
    loadMetrics();
    loadList();
  };

  const exportDisabled = !!fetchError || loading;

  return (
    <div className="w-full max-w-none" data-testid="duty-summary-page">
      <div className="page-header flex-wrap gap-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 min-w-0 flex-1">
          <Button variant="outline" size="sm" asChild className="rounded-lg shrink-0 w-fit">
            <Link to={`/duties?${listQueryString()}`}>
              <ArrowLeft size={14} className="mr-1.5" /> Back to duty list
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="page-title">Duty summary</h1>
            <p className="page-desc max-w-3xl">
              Filtered snapshot of duty assignments. Tiles reflect totals for all matching duties; exports include all matching rows (up to the export limit).
            </p>
          </div>
        </div>
        <ReportDownloads pdfHref={pdfHref} excelHref={excelHref} disabled={exportDisabled} />
      </div>

      <Card className="border-gray-200 shadow-sm mb-5">
        <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
          <CardTitle className="text-sm font-semibold text-gray-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-5 pb-4 pt-0">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Date</label>
              <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-44 rounded-lg" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
              <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setFilterBusId(""); }}>
                <SelectTrigger className="w-44 rounded-lg"><SelectValue placeholder="All Depots" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Depots</SelectItem>
                  {[...new Set(buses.map((x) => x.depot).filter(Boolean))].sort().map((dep) => (
                    <SelectItem key={dep} value={dep}>{dep}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
              <Select value={filterBusId || "all"} onValueChange={(v) => setFilterBusId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36 rounded-lg"><SelectValue placeholder="All Buses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buses</SelectItem>
                  {(filterDepot ? buses.filter((x) => x.depot === filterDepot) : buses).map((x) => (
                    <SelectItem key={x.bus_id} value={x.bus_id}>{x.bus_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px] max-w-md">
              <label className="text-xs font-medium uppercase text-gray-500">Search</label>
              <Input placeholder="Driver, route, bus, trip ID…" value={filterSearchQ} onChange={(e) => setFilterSearchQ(e.target.value)} className="rounded-lg" />
            </div>
            <Button type="button" onClick={refreshAll} variant="outline" className="rounded-lg">
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {fetchError ? (
        <div className="mb-5">
          <AsyncPanel error={fetchError} onRetry={refreshAll} minHeight="min-h-[160px]" />
        </div>
      ) : null}

      {!fetchError && loading ? (
        <div className="mb-5">
          <AsyncPanel loading minHeight="min-h-[200px]" />
        </div>
      ) : null}

      {!fetchError && !loading && listMeta.total > 0 ? (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                {formatDateIN(filterDate)}
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">
                This page: {duties.length} of {listMeta.total} duties
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatTile label="Duties" value={metrics.duty_count} icon={CalendarDays} hint="Same filters; counts every page" />
            <StatTile label="Trip legs" value={metrics.trip_legs} icon={Route} hint="All trips on those duties" />
            <StatTile label="SMS sent" value={metrics.sms_sent} icon={MessageSquare} hint="Duty SMS already sent" />
            <StatTile label="SMS pending" value={metrics.sms_pending} icon={Hourglass} hint="Duty SMS not sent" />
          </div>

          <div className="space-y-4">
            {duties.map((d) => {
              const tripCount = d.trips?.length || 0;
              return (
                <Card
                  key={d.id}
                  className="w-full border-gray-200 shadow-sm overflow-hidden break-inside-avoid"
                  data-testid={`duty-summary-card-${d.id}`}
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-gray-100 bg-[#FAFAFA] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                        <span className="font-mono text-xs text-gray-500">{d.id}</span>
                        <span className="text-xs text-gray-600">{formatDateIN(d.date)}</span>
                        <Badge className={d.status === "assigned" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-green-100 text-green-700 hover:bg-green-100"}>
                          {d.status}
                        </Badge>
                        {d.sms_sent ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            <MessageSquare size={10} className="mr-1" />
                            SMS sent
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-gray-600">SMS pending</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 sm:text-right">
                        {tripCount} {tripCount === 1 ? "trip" : "trips"}
                      </div>
                    </div>

                    <div className="px-4 py-4 grid grid-cols-1 md:grid-cols-12 gap-6 border-b border-gray-50">
                      <div className="md:col-span-4 min-w-0 flex gap-3">
                        <div className="rounded-lg bg-gray-100 p-2 h-fit text-gray-500 shrink-0">
                          <User size={16} />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Driver</p>
                          <p className="font-medium text-sm text-[#1A1A1A] mt-0.5">{d.driver_name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                            <Phone size={12} className="shrink-0" />
                            {d.driver_phone || "—"}
                          </p>
                          {d.conductor_name ? <p className="text-xs text-gray-500 mt-1">Conductor: {d.conductor_name}</p> : null}
                        </div>
                      </div>

                      <div className="md:col-span-2 min-w-0 flex gap-3">
                        <div className="rounded-lg bg-gray-100 p-2 h-fit text-gray-500 shrink-0">
                          <Bus size={16} />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Bus</p>
                          <p className="font-mono font-semibold text-sm text-[#1A1A1A] mt-0.5">{d.bus_id}</p>
                        </div>
                      </div>

                      <div className="md:col-span-6 min-w-0 flex gap-3">
                        <div className="rounded-lg bg-gray-100 p-2 h-fit text-gray-500 shrink-0">
                          <Route size={16} />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Route</p>
                          <p className="font-medium text-sm text-[#1A1A1A] mt-0.5">{d.route_name}</p>
                          <p className="text-sm text-gray-600 mt-0.5">{d.start_point} → {d.end_point}</p>
                        </div>
                      </div>
                    </div>

                    <div className="px-4 py-4 bg-gray-50/90">
                      <p className="text-xs text-gray-600 mb-2">
                        Punctuality (duty): Sch {d.punctuality_scheduled_departure || "—"} - {d.punctuality_scheduled_arrival || "—"} | Act {d.punctuality_actual_departure || "—"} - {d.punctuality_actual_arrival || "—"}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Trip timetable</p>
                      <DutyTripsReadOnlyTable trips={d.trips} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div>
            <TablePaginationBar
              page={page}
              pages={listMeta.pages}
              total={listMeta.total}
              limit={listMeta.limit}
              onPageChange={setPage}
            />
          </div>
        </>
      ) : null}

      {!fetchError && !loading && listMeta.total === 0 ? (
        <Card className="border-gray-200 border-dashed">
          <CardContent className="p-10 text-center">
            <p className="text-sm font-medium text-gray-700">No duties for these filters</p>
            <p className="text-xs text-gray-500 mt-2 max-w-md mx-auto">
              Change the date or filters, or open the roster to add assignments.
            </p>
            <Button variant="outline" className="mt-4 rounded-lg" asChild>
              <Link to={`/duties?${listQueryString()}`}>Open duty roster</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
