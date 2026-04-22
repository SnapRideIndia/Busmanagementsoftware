import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../../lib/api";
import { Endpoints } from "../../lib/endpoints";
import { useDuties, useDutyMutations } from "@/features/duty/api/useDuties";
import { useAllDrivers } from "@/features/drivers/api/useDrivers";
import { useAllBuses } from "@/features/buses/api/useBuses";
import TablePaginationBar from "../../components/TablePaginationBar";
import AsyncPanel from "../../components/AsyncPanel";
import { formatDateIN } from "../../lib/dates";
import { isDutyTripLeg, dutyListStatusLabel, dutyListStatusBadgeClass } from "@/features/duty/lib/dutyTrips";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Plus, Send, Trash2, Pencil, MessageSquare, Phone, LayoutList } from "lucide-react";
import { toast } from "sonner";

const today = new Date().toISOString().slice(0, 10);

/** @param {string} raw */
function normalizeDutyLoad(raw) {
  const v = String(raw || "all").toLowerCase();
  if (v === "single" || v === "double") return v;
  return "all";
}

export default function DutyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);

  const [filterDepot, setFilterDepot] = useState("");
  const [filterBusId, setFilterBusId] = useState("");
  const [filterDriverLicense, setFilterDriverLicense] = useState("");
  const [filterDutyLoad, setFilterDutyLoad] = useState("all");
  const [filterSearchQ, setFilterSearchQ] = useState("");

  // TanStack Queries
  const { data: driverOptions = [] } = useAllDrivers();
  const { data: busOptions = [] } = useAllBuses();
  
  const dutyFilters = useMemo(() => ({
    depot: filterDepot,
    bus_id: filterBusId,
    driver_license: filterDriverLicense,
    q: filterSearchQ.trim(),
    page,
    limit,
    ...(filterDutyLoad !== "all" ? { duty_load: filterDutyLoad } : {}),
  }), [filterDepot, filterBusId, filterDriverLicense, filterSearchQ, page, limit, filterDutyLoad]);

  const { data: dutyData, isLoading: loadingDuties, error: fetchError, refetch: refetchDuties } = useDuties(dutyFilters);

  const duties = dutyData?.items || [];
  const listMeta = useMemo(() => ({
    total: dutyData?.total || 0,
    pages: dutyData?.pages || 1,
    limit: dutyData?.limit || limit,
  }), [dutyData, limit]);

  // Mutations
  const { deleteDuty, sendSms, sendAllSms } = useDutyMutations();

  useEffect(() => {
    if (!searchParams.toString()) return;
    const dep = searchParams.get("depot");
    const bus = searchParams.get("bus_id");
    const qq = searchParams.get("q");
    const dl = searchParams.get("driver_license");
    if (dep !== null) setFilterDepot(dep);
    if (bus !== null) setFilterBusId(bus);
    if (qq !== null) setFilterSearchQ(qq);
    if (dl !== null) setFilterDriverLicense(dl);
    const dutyLoad = searchParams.get("duty_load");
    if (dutyLoad) setFilterDutyLoad(normalizeDutyLoad(dutyLoad));
  }, [searchParams]);

  const summaryQuery = () => {
    const q = new URLSearchParams();
    if (filterDepot) q.set("depot", filterDepot);
    if (filterBusId) q.set("bus_id", filterBusId);
    if (filterDriverLicense) q.set("driver_license", filterDriverLicense);
    if (filterDutyLoad && filterDutyLoad !== "all") q.set("duty_load", filterDutyLoad);
    if (filterSearchQ.trim()) q.set("q", filterSearchQ.trim());
    return q.toString();
  };

  const handleDelete = (id) => {
    if (!window.confirm("Remove this duty assignment?")) return;
    deleteDuty.mutate(id);
  };

  const handleSendSms = (id) => {
    sendSms.mutate(id);
  };

  const handleSendAllSms = () => {
    const filterDate = today; // From your original code, it seems today was fixed for sendAllSms or used as a fallback
    sendAllSms.mutate(filterDate);
  };

  return (
    <div className="w-full max-w-none" data-testid="duty-page">
      <div className="page-header flex-wrap">
        <div>
          <h1 className="page-title">Duty Assignments</h1>
          <p className="page-desc max-w-3xl">
            Create and manage standalone duty assignments. Each card shows today's operational summary.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="rounded-lg border-gray-300" onClick={() => navigate(`/duties/summary?${summaryQuery()}`)} data-testid="duty-summary-nav">
            <LayoutList size={14} className="mr-1.5" /> View duty summary
          </Button>
          <Button onClick={sendAllSms} variant="outline" className="text-[#C8102E] border-[#C8102E] hover:bg-red-50" data-testid="send-all-sms-btn">
            <Send size={14} className="mr-1.5" /> Send All SMS
          </Button>
          <Button
            onClick={() => navigate("/duties/new")}
            className="bg-[#C8102E] hover:bg-[#A50E25]"
            data-testid="add-duty-btn"
          >
            <Plus size={16} className="mr-1.5" /> Assign Duty
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-end w-full">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setFilterBusId(""); setPage(1); }}>
            <SelectTrigger className="w-44 rounded-lg"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {[...new Set(busOptions.map((x) => x.depot).filter(Boolean))].sort().map((dep) => (
                <SelectItem key={dep} value={dep}>{dep}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={filterBusId || "all"} onValueChange={(v) => { setFilterBusId(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-36 rounded-lg"><SelectValue placeholder="All Buses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buses</SelectItem>
              {(filterDepot ? busOptions.filter((x) => x.depot === filterDepot) : busOptions).map((x) => (
                <SelectItem key={x.bus_id} value={x.bus_id}>{x.bus_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 min-w-[200px] max-w-[260px]">
          <label className="text-xs font-medium uppercase text-gray-500">Driver</label>
          <Select value={filterDriverLicense || "all"} onValueChange={(v) => { setFilterDriverLicense(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-full rounded-lg"><SelectValue placeholder="All drivers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All drivers</SelectItem>
              {driverOptions
                .filter((dr) => dr.license_number)
                .map((dr) => (
                  <SelectItem key={dr.license_number} value={dr.license_number}>
                    {(dr.name || dr.license_number) + (dr.license_number ? ` · ${dr.license_number}` : "")}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 w-44">
          <label className="text-xs font-medium uppercase text-gray-500">Duty load</label>
          <Select value={filterDutyLoad} onValueChange={(v) => { setFilterDutyLoad(normalizeDutyLoad(v)); setPage(1); }}>
            <SelectTrigger className="rounded-lg" data-testid="duty-filter-duty-load">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="single">Single duty</SelectItem>
              <SelectItem value="double">Double duty</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[200px] max-w-md">
          <label className="text-xs font-medium uppercase text-gray-500">Search</label>
          <Input
            placeholder="Driver, route, bus, trip ID…"
            value={filterSearchQ}
            onChange={(e) => { setFilterSearchQ(e.target.value); setPage(1); }}
            className="rounded-lg"
            data-testid="duty-search-filter"
          />
        </div>
        <Button onClick={() => refetchDuties()} variant="outline" className="rounded-lg" data-testid="duty-filter-btn">Refresh</Button>
      </div>

      <div className="space-y-3 w-full">
        {fetchError ? <AsyncPanel error={fetchError} onRetry={() => refetchDuties()} minHeight="min-h-[160px]" /> : null}
        {!fetchError && loadingDuties && duties.length === 0 ? <AsyncPanel loading minHeight="min-h-[200px]" /> : null}
        {!fetchError && duties.map((d) => {
          const todaySummary = d.today_summary || {};
          const tripCount = Number(todaySummary.trip_count || (d.trips || []).filter(isDutyTripLeg).length || 0);
          return (
            <Card key={d.id} className={`w-full border-gray-200 shadow-sm ${loadingDuties ? "opacity-70" : ""}`} data-testid={`duty-card-${d.id}`}>
              <CardContent className="p-0">
                <div className="flex flex-col gap-0 sm:flex-row sm:items-stretch sm:justify-between border-b border-gray-100 bg-[#FAFAFA] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                    <span className="font-mono text-xs text-gray-500 shrink-0">{d.id}</span>
                    <span className="text-xs text-gray-500">Today: {formatDateIN(todaySummary.date || today)}</span>
                    <Badge className={dutyListStatusBadgeClass(d)}>{dutyListStatusLabel(d)}</Badge>
                    {d.sms_sent ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100"><MessageSquare size={10} className="mr-1" />SMS</Badge> : null}
                    <Badge variant="outline" className="border-slate-300 text-slate-800 bg-white">
                      Round trip {todaySummary.round_trip_completion_pct != null ? `${todaySummary.round_trip_completion_pct}%` : "—"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-2 sm:mt-0">
                    {!d.sms_sent && (
                      <Button variant="outline" size="sm" onClick={() => handleSendSms(d.id)} className="text-[#C8102E] border-[#C8102E] h-8" data-testid={`sms-duty-${d.id}`}>
                        <Send size={12} className="mr-1" /> SMS
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/duties/${encodeURIComponent(d.id)}/edit`)} data-testid={`edit-duty-${d.id}`}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(d.id)} data-testid={`delete-duty-${d.id}`}><Trash2 size={14} className="text-red-500" /></Button>
                  </div>
                </div>

                <div className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-4 w-full">
                  <div className="lg:col-span-4 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Driver</p>
                      <p className="font-medium text-sm leading-snug">{d.driver_name || "—"}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={10} className="shrink-0" />{d.driver_phone || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Conductor</p>
                      <p className="font-medium text-sm leading-snug">{d.conductor_name || "—"}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={10} className="shrink-0" />{d.conductor_phone || "—"}</p>
                    </div>
                  </div>
                  <div className="lg:col-span-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Bus</p>
                    <p className="font-mono font-semibold text-sm">{d.bus_id}</p>
                  </div>
                  <div className="lg:col-span-6 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Route</p>
                    <p className="font-medium text-sm">{d.route_name}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{d.start_point} → {d.end_point}</p>
                  </div>
                </div>

                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/80">
                  <p className="text-xs text-gray-600">
                    Today's trips: {tripCount} · Completed: {todaySummary.completed_trip_count ?? "—"} · Sch {todaySummary.punctuality_scheduled_departure || "—"} - {todaySummary.punctuality_scheduled_arrival || "—"} · Act {todaySummary.punctuality_actual_departure || "—"} - {todaySummary.punctuality_actual_arrival || "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!fetchError && !loadingDuties && duties.length === 0 ? (
          <Card className="w-full border-gray-200"><CardContent className="p-6 text-center text-sm text-gray-400">No duties for these filters</CardContent></Card>
        ) : null}
        <TablePaginationBar
          page={page}
          pages={listMeta.pages}
          total={listMeta.total}
          limit={listMeta.limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      </div>
    </div>
  );
}
