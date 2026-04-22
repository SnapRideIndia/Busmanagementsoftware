import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGeofences, useGeofenceEvents, useGeofenceStats, useGeofenceMutations } from "../features/geofences/api/useGeofences";
import { messageFromAxiosError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import GeofenceMapConsole from "../features/geofences/GeofenceMapConsole";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TYPE_LABEL = { stop: "Bus stop", terminal: "Terminal", depot: "Depot", route: "Route" };

const SHAPE_LABEL = {
  circle: "Circle",
  polygon: "Area",
  polyline_buffer: "Route corridor",
};

export default function GeofencesPage() {
  const [page, setPage] = useState(1);
  const [metaLimit, setMetaLimit] = useState(30);
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [search, setSearch] = useState("");

  const filters = {
    type: typeFilter,
    active: activeFilter,
    search,
    page,
    limit: metaLimit,
  };

  const { data: geofencesData, isLoading: listLoading, error: listError, refetch: refetchList } = useGeofences(filters);
  const { data: events = [], isLoading: eventsLoading } = useGeofenceEvents({ limit: 20 });
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useGeofenceStats();
  const { deleteGeofence } = useGeofenceMutations();

  const rows = geofencesData?.items || [];
  const meta = {
    total: geofencesData?.total || 0,
    pages: geofencesData?.pages || 1,
    limit: geofencesData?.limit || metaLimit,
  };
  const loading = listLoading || eventsLoading || statsLoading;
  const error = listError ? messageFromAxiosError(listError, "Could not load geofences") : null;

  const load = () => {
    refetchList();
    refetchStats();
  };


  const handleDelete = async (id) => {
    if (!window.confirm("Remove this geofence?")) return;
    try {
      await deleteGeofence(id);
    } catch (err) {
      // Error handled in hook
    }
  };

  const by = stats?.by_type || {};

  return (
    <div data-testid="geofences-page" className="space-y-5 text-[12px]">
      <div className="page-header">
        <div>
          <h1 className="page-title">Geofences</h1>
          <p className="page-desc max-w-3xl text-gray-600">
            Draw and adjust boundaries on the map: pick a master record, place the shape, set radius or corridor width, then save. Defaults follow{" "}
            <Link to="/business-rules" className="text-[#C8102E] font-medium hover:underline">
              Business rules
            </Link>
            . Update stops, terminals, routes, and depots under{" "}
            <Link to="/bus-stops" className="text-[#C8102E] font-medium hover:underline">
              Stops
            </Link>
            ,{" "}
            <Link to="/bus-terminals" className="text-[#C8102E] font-medium hover:underline">
              Terminals
            </Link>
            ,{" "}
            <Link to="/bus-routes" className="text-[#C8102E] font-medium hover:underline">
              Routes
            </Link>
            ,{" "}
            <Link to="/depots" className="text-[#C8102E] font-medium hover:underline">
              Depots
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} data-testid="geofence-refresh-btn" size="sm" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <GeofenceMapConsole onSaved={load} summaryStats={stats} />

      <section aria-labelledby="gf-overview">
        <h2 id="gf-overview" className="sr-only">
          Summary
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { k: "stop", label: "Bus stops", v: by.stop },
            { k: "terminal", label: "Terminals", v: by.terminal },
            { k: "depot", label: "Depots", v: by.depot },
            { k: "route", label: "Routes", v: by.route },
            { k: "active", label: "Active", v: stats?.active },
          ].map((x) => (
            <Card key={x.k} className="border-gray-200 shadow-sm">
              <CardContent className="p-3">
                <p className="text-[10px] uppercase font-semibold text-gray-500">{x.label}</p>
                <p className="text-xl font-semibold text-[#1A1A1A]">{loading && stats == null ? "—" : x.v ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {!error && !stats && !loading ? (
          <p className="text-[11px] text-gray-500 mt-2">Summary counts were not available; the register below is still shown.</p>
        ) : null}
      </section>

      <section aria-labelledby="gf-list">
        <h2 id="gf-list" className="text-sm font-semibold text-[#1A1A1A] mb-2">
          Register
        </h2>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <span className="text-[10px] uppercase text-gray-500">Search</span>
                <Input
                  className="w-full sm:w-72 h-8"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-40 h-8">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="stop">Bus stop</SelectItem>
                  <SelectItem value="terminal">Terminal</SelectItem>
                  <SelectItem value="depot">Depot</SelectItem>
                  <SelectItem value="route">Route</SelectItem>
                </SelectContent>
              </Select>
              <Select value={activeFilter || "all"} onValueChange={(v) => setActiveFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8" onClick={() => { setPage(1); load(); }}>
                Apply
              </Button>
            </div>
            {error ? <AsyncPanel error={error} onRetry={load} minHeight="min-h-[140px]" /> : null}
            {!error ? (
              <div className="rounded-md border border-gray-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="table-header">
                      <TableHead>Reference</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Linked record</TableHead>
                      <TableHead>Shape</TableHead>
                      <TableHead>Size (m)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.geofence_id}>
                        <TableCell className="font-mono text-[11px]">{r.geofence_id}</TableCell>
                        <TableCell>{TYPE_LABEL[r.type] || r.type}</TableCell>
                        <TableCell className="font-mono text-[11px]">{r.entity_ref || "—"}</TableCell>
                        <TableCell>{SHAPE_LABEL[r.geometry_type] || r.geometry_type}</TableCell>
                        <TableCell>{r.radius_m ?? r.buffer_m ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={r.active ? "default" : "outline"} className="text-[11px]">
                            {r.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(r.geofence_id)} aria-label="Remove">
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            <TablePaginationBar
              page={page}
              pages={meta.pages}
              total={meta.total}
              limit={meta.limit}
              onPageChange={setPage}
              onLimitChange={(l) => {
                setPage(1);
                setMetaLimit(l);
              }}
            />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="gf-events">
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="py-3">
            <CardTitle id="gf-events" className="text-sm font-semibold">
              Zone activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {events.length === 0 ? (
              <p className="text-[11px] text-gray-500">No historical entries in this view. Current vehicle position on the map reflects live data separately.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Distance (m)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.event_id}>
                      <TableCell>{String(e.event_ts || "").replace("T", " ").slice(0, 19)}</TableCell>
                      <TableCell>{e.bus_id}</TableCell>
                      <TableCell className="font-mono text-[11px]">{e.geofence_id}</TableCell>
                      <TableCell>{e.event_type}</TableCell>
                      <TableCell>{e.distance_m ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
