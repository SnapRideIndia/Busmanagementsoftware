import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
import TablePaginationBar from "./TablePaginationBar";
import AsyncPanel from "./AsyncPanel";
import { formatDateIN } from "../lib/dates";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { CheckCircle2, CircleDashed, ShieldCheck, ClipboardCheck, AlertTriangle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

function dayISO(d) {
  return d.toISOString().slice(0, 10);
}

/** API queue values unchanged; labels avoid depot “traffic” jargon. */
const queues = [
  { value: "all", label: "All rows" },
  { value: "traffic_pending", label: "Awaiting first verification" },
  { value: "maintenance_pending", label: "Awaiting final verification" },
  { value: "complete", label: "Fully closed" },
];

/**
 * Daily trip-row kilometre verification (two steps), embedded under kilometre tracking.
 */
export default function TripKmApprovalPanel() {
  const { user } = useAuth();
  const perms = user?.permissions || [];
  const canRead = perms.includes("operations.trip_km.read");
  const canFirstSignOff = perms.includes("operations.trip_km.traffic_approve");
  const canFinalClose = perms.includes("operations.trip_km.maintenance_finalize");

  const [dateFrom, setDateFrom] = useState(() => dayISO(new Date(Date.now() - 13 * 86400000)));
  const [dateTo, setDateTo] = useState(() => dayISO(new Date()));
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [queue, setQueue] = useState("traffic_pending");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [buses, setBuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [acting, setActing] = useState(false);

  const depotsList = useMemo(
    () => [...new Set(buses.map((b) => b.depot).filter(Boolean))].sort(),
    [buses],
  );
  const busesForSelect = depot ? buses.filter((b) => b.depot === depot) : buses;

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const params = buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        depot,
        bus_id: busId,
        queue,
        page,
        limit: 20,
      });
      const [res, busItems] = await Promise.all([
        API.get("/trip-km-approvals", { params }),
        fetchAllPaginated("/buses", {}),
      ]);
      const u = unwrapListResponse(res.data);
      setRows(u.items);
      setMeta({ total: u.total, pages: u.pages, limit: u.limit });
      setBuses(busItems);
      setSelected(new Set());
    } catch (err) {
      setError(messageFromAxiosError(err, "Failed to load trip kilometre verification queue"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [canRead, dateFrom, dateTo, depot, busId, queue, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, depot, busId, queue]);

  const toggleOne = (key, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectableKeys = useMemo(() => {
    return rows
      .filter((r) => {
        if (queue === "traffic_pending" || (queue === "all" && !r.traffic_km_approved)) {
          return canFirstSignOff && !r.traffic_km_approved;
        }
        if (queue === "maintenance_pending" || (queue === "all" && r.traffic_km_approved && !r.maintenance_km_finalized)) {
          return canFinalClose && r.traffic_km_approved && !r.maintenance_km_finalized;
        }
        return false;
      })
      .map((r) => r.trip_key);
  }, [rows, queue, canFirstSignOff, canFinalClose]);

  const allSelectableChecked =
    selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));

  const toggleSelectAll = (checked) => {
    if (checked) setSelected(new Set(selectableKeys));
    else setSelected(new Set());
  };

  const postBatch = async (path, keys) => {
    if (!keys.length) return;
    setActing(true);
    try {
      const { data } = await API.post(path, { trip_keys: keys });
      const { updated, failed } = data;
      if (updated) toast.success(`${updated} row(s) updated`);
      if (failed?.length) {
        toast.error(`${failed.length} skipped`, { description: failed.map((f) => f.detail).slice(0, 3).join(" · ") });
      }
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message || "Request failed");
    } finally {
      setActing(false);
    }
  };

  const signOffFirstBulk = () => {
    const keys = [...selected].filter((k) => {
      const r = rows.find((x) => x.trip_key === k);
      return r && !r.traffic_km_approved;
    });
    if (!keys.length) {
      toast.info("Select at least one row still awaiting first verification.");
      return;
    }
    postBatch("/trip-km-approvals/traffic", keys);
  };

  const finalizeBulk = () => {
    const keys = [...selected].filter((k) => {
      const r = rows.find((x) => x.trip_key === k);
      return r && r.traffic_km_approved && !r.maintenance_km_finalized;
    });
    if (!keys.length) {
      toast.info("Select rows with first verification complete and final verification still open.");
      return;
    }
    postBatch("/trip-km-approvals/maintenance", keys);
  };

  const recordExceptionAction = async (row, action) => {
    const note = window.prompt(
      action === "approved_with_exception"
        ? "Enter exception approval note (required):"
        : "Enter rejection or review note (required):",
      "",
    );
    if (!note || note.trim().length < 3) {
      toast.info("Please provide a clear note with at least three characters.");
      return;
    }
    const linkedIncidentId = window.prompt(
      "Optional incident identifier for traceability:",
      row.linked_incident_id || "",
    ) || "";
    setActing(true);
    try {
      await API.post("/trip-km-approvals/exception-action", {
        trip_key: row.trip_key,
        action,
        note: note.trim(),
        linked_incident_id: linkedIncidentId.trim(),
      });
      toast.success("Exception action recorded.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message || "Could not save exception action");
    } finally {
      setActing(false);
    }
  };

  const rowActionFirst = (r) => {
    if (!canFirstSignOff || r.traffic_km_approved) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-xs border-amber-200 text-amber-900 hover:bg-amber-50"
        disabled={acting}
        onClick={() => postBatch("/trip-km-approvals/traffic", [r.trip_key])}
      >
        Mark first verification complete
      </Button>
    );
  };

  const rowActionFinal = (r) => {
    if (!canFinalClose || !r.traffic_km_approved || r.maintenance_km_finalized) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-xs border-slate-300 text-slate-800 hover:bg-slate-50"
        disabled={acting}
        onClick={() => postBatch("/trip-km-approvals/maintenance", [r.trip_key])}
      >
        Mark final verification complete
      </Button>
    );
  };

  const renderRowActionsMenu = (r) => {
    const canApproveWithException =
      r.needs_exception_action &&
      r.exception_action_status !== "approved_with_exception" &&
      !r.traffic_km_approved;
    const canRejectForReview =
      r.needs_exception_action &&
      r.exception_action_status !== "rejected_for_review" &&
      !r.traffic_km_approved;
    const canFirstVerify = canFirstSignOff && !r.traffic_km_approved;
    const canFinalize = canFinalClose && r.traffic_km_approved && !r.maintenance_km_finalized;

    if (!canApproveWithException && !canRejectForReview && !canFirstVerify && !canFinalize) {
      return <span className="text-xs text-gray-400">No actions</span>;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Open actions for ${r.trip_key}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canApproveWithException ? (
            <DropdownMenuItem onClick={() => recordExceptionAction(r, "approved_with_exception")}>
              Approve with exception
            </DropdownMenuItem>
          ) : null}
          {canRejectForReview ? (
            <DropdownMenuItem onClick={() => recordExceptionAction(r, "rejected_for_review")}>
              Reject for review
            </DropdownMenuItem>
          ) : null}
          {canFirstVerify ? (
            <DropdownMenuItem onClick={() => postBatch("/trip-km-approvals/traffic", [r.trip_key])}>
              Mark first verification complete
            </DropdownMenuItem>
          ) : null}
          {canFinalize ? (
            <DropdownMenuItem onClick={() => postBatch("/trip-km-approvals/maintenance", [r.trip_key])}>
              Mark final verification complete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  if (!canRead) {
    return (
      <Card className="border-gray-200" data-testid="trip-km-panel">
        <CardContent className="p-6 text-sm text-gray-600">You do not have permission to view this queue.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="trip-km-panel">
      <p className="page-desc page-lead max-w-2xl text-gray-600 text-sm">
        Use this screen to formally verify each bus-day trip kilometre total after checks, before billing and reports rely on it.
      </p>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50/80 p-1">
            {queues.map((q) => (
              <button
                key={q.value}
                type="button"
                onClick={() => setQueue(q.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  queue === q.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Depot</label>
              <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All depots</SelectItem>
                  {depotsList.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Bus</label>
              <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All buses</SelectItem>
                  {busesForSelect.map((b) => (
                    <SelectItem key={b.bus_id} value={b.bus_id}>
                      {b.bus_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && !loading ? <AsyncPanel error={error} onRetry={load} /> : null}

      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2 border-b border-gray-100 flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold text-gray-900">Daily trip kilometre rows</CardTitle>
          {selectableKeys.length > 0 && (canFirstSignOff || canFinalClose) ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">{selected.size} selected</span>
              {canFirstSignOff && (queue === "traffic_pending" || queue === "all") ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={acting || selected.size === 0}
                  onClick={signOffFirstBulk}
                >
                  <ClipboardCheck size={14} className="mr-1" />
                  Mark first verification complete
                </Button>
              ) : null}
              {canFinalClose && (queue === "maintenance_pending" || queue === "all") ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-slate-700 hover:bg-slate-800 text-white"
                  disabled={acting || selected.size === 0}
                  onClick={finalizeBulk}
                >
                  <ShieldCheck size={14} className="mr-1" />
                  Mark final verification complete
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="table-header">
                  <TableHead className="w-10">
                    {selectableKeys.length > 0 ? (
                      <Checkbox
                        checked={allSelectableChecked}
                        onCheckedChange={(v) => toggleSelectAll(!!v)}
                        aria-label="Select all actionable rows"
                      />
                    ) : null}
                  </TableHead>
                  <TableHead>Bus</TableHead>
                  <TableHead>Depot</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Scheduled kilometres</TableHead>
                  <TableHead className="text-right">Actual kilometres</TableHead>
                  <TableHead>Start and end time</TableHead>
                  <TableHead className="text-right">Variance percent</TableHead>
                  <TableHead>Exception action</TableHead>
                  <TableHead>First verification</TableHead>
                  <TableHead>Final verification</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-gray-400 py-12">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-gray-400 py-12">
                      No rows for this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const canSelFirst = canFirstSignOff && !r.traffic_km_approved;
                    const canSelFinal = canFinalClose && r.traffic_km_approved && !r.maintenance_km_finalized;
                    const showBox =
                      (queue === "traffic_pending" && canSelFirst) ||
                      (queue === "maintenance_pending" && canSelFinal) ||
                      (queue === "all" && (canSelFirst || canSelFinal));
                    return (
                      <TableRow key={r.trip_key} className="hover:bg-gray-50/80">
                        <TableCell>
                          {showBox ? (
                            <Checkbox
                              checked={selected.has(r.trip_key)}
                              onCheckedChange={(v) => toggleOne(r.trip_key, !!v)}
                              aria-label={`Select ${r.trip_key}`}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">{r.bus_id}</TableCell>
                        <TableCell className="text-sm text-gray-600">{r.depot || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDateIN(r.date)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Number(r.scheduled_km || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Number(r.actual_km || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-xs text-gray-600 whitespace-nowrap">
                          <span className="font-mono">{r.start_time || "—"}</span>
                          <span className="mx-0.5 text-gray-400">→</span>
                          <span className="font-mono">{r.end_time || "—"}</span>
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${Math.abs(Number(r.km_variance_pct || 0)) > 5 ? "text-amber-700" : "text-gray-700"}`}>
                          {Number(r.km_variance_pct || 0).toFixed(2)}%
                        </TableCell>
                        <TableCell>
                          {r.needs_exception_action ? (
                            r.exception_action_status === "approved_with_exception" ? (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal">Approved with exception</Badge>
                            ) : r.exception_action_status === "rejected_for_review" ? (
                              <Badge className="bg-red-100 text-red-700 hover:bg-red-100 font-normal">Rejected for review</Badge>
                            ) : (
                              <Badge variant="secondary" className="font-normal gap-1 text-amber-900 bg-amber-50">
                                <AlertTriangle size={12} />
                                Action required
                              </Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="font-normal text-gray-600">Not required</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.traffic_km_approved ? (
                            <Badge className="bg-emerald-50 text-emerald-800 hover:bg-emerald-50 font-normal gap-1">
                              <CheckCircle2 size={12} />
                              Verified
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="font-normal gap-1 text-amber-900 bg-amber-50">
                              <CircleDashed size={12} />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.maintenance_km_finalized ? (
                            <Badge className="bg-slate-100 text-slate-800 hover:bg-slate-100 font-normal gap-1">
                              <ShieldCheck size={12} />
                              Finalized
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal text-gray-600">
                              Open
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {renderRowActionsMenu(r)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
