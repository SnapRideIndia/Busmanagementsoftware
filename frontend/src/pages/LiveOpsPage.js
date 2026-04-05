import { useState, useEffect, useCallback, useMemo } from "react";
import API, { buildQuery, unwrapListResponse, formatApiError, fetchAllPaginated } from "../lib/api";
import AsyncPanel from "../components/AsyncPanel";
import TablePaginationBar from "../components/TablePaginationBar";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { MapPin, RefreshCw, AlertTriangle, Video } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const LIVE_TABLE_LIMIT = 25;

// Fix leaflet default icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const busIcon = (status) => L.divIcon({
  className: "custom-marker",
  html: `<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;background:${
    status === "on_route" ? "#16A34A" : status === "at_stop" ? "#F59E0B" : "#2563EB"
  };border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">B</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
});

const ALERT_FILTER_CODES = [
  { code: "panic", label: "Panic" },
  { code: "overspeed_user", label: "Overspeed" },
  { code: "gps_breakage", label: "GPS breakage" },
  { code: "idle", label: "Idle" },
  { code: "route_deviation", label: "Route deviation" },
  { code: "bunching_user", label: "Bunching" },
  { code: "harness_removal", label: "Harness removal" },
];

export default function LiveOpsPage() {
  const [liveData, setLiveData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [allBuses, setAllBuses] = useState([]);
  const [depot, setDepot] = useState("");
  const [busId, setBusId] = useState("");
  const [vehStatus, setVehStatus] = useState("");
  const [alertCode, setAlertCode] = useState("");
  const [alertSeverity, setAlertSeverity] = useState("");
  const [alertResolved, setAlertResolved] = useState("");
  const [fetchError, setFetchError] = useState(null);
  const [tablePage, setTablePage] = useState(1);
  const [cameraBusId, setCameraBusId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const items = await fetchAllPaginated("/buses", {});
        setAllBuses(items);
      } catch { setAllBuses([]); }
    })();
  }, []);

  const depotsList = [...new Set(allBuses.map((b) => b.depot).filter(Boolean))].sort();
  const busesForSelect = depot ? allBuses.filter((b) => b.depot === depot) : allBuses;

  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const liveParams = buildQuery({ depot, bus_id: busId, status: vehStatus });
      const alertParams = buildQuery({
        depot,
        bus_id: busId,
        alert_code: alertCode,
        severity: alertSeverity,
        resolved: alertResolved,
      });
      const [ld, al] = await Promise.all([
        API.get("/live-operations", { params: liveParams }),
        API.get("/live-operations/alerts", { params: alertParams }),
      ]);
      setLiveData(ld.data);
      setAlerts(al.data);
      setTablePage(1);
    } catch (err) {
      setFetchError(formatApiError(err.response?.data?.detail) || err.message || "Failed to refresh live data");
    } finally {
      setLoading(false);
    }
  }, [depot, busId, vehStatus, alertCode, alertSeverity, alertResolved]);

  const liveTablePages = Math.max(1, Math.ceil(liveData.length / LIVE_TABLE_LIMIT));
  const liveTableRows = useMemo(() => {
    const start = (tablePage - 1) * LIVE_TABLE_LIMIT;
    return liveData.slice(start, start + LIVE_TABLE_LIMIT);
  }, [liveData, tablePage]);

  useEffect(() => {
    if (tablePage > liveTablePages) setTablePage(liveTablePages);
  }, [tablePage, liveTablePages]);

  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv); }, [refresh]);

  return (
    <div data-testid="live-ops-page">
      <div className="page-header">
        <h1 className="page-title">Live Operations</h1>
        <Button onClick={refresh} variant="outline" size="sm" data-testid="live-refresh-btn">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-end" data-testid="live-ops-filters">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={depot || "all"} onValueChange={(v) => { setDepot(v === "all" ? "" : v); setBusId(""); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {depotsList.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={busId || "all"} onValueChange={(v) => setBusId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Buses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buses</SelectItem>
              {busesForSelect.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Map status</label>
          <Select value={vehStatus || "all"} onValueChange={(v) => setVehStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="on_route">On route</SelectItem>
              <SelectItem value="at_stop">At stop</SelectItem>
              <SelectItem value="charging">Charging</SelectItem>
              <SelectItem value="panic">Panic</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Alert type</label>
          <Select value={alertCode || "all"} onValueChange={(v) => setAlertCode(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ALERT_FILTER_CODES.map((a) => <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Severity</label>
          <Select value={alertSeverity || "all"} onValueChange={(v) => setAlertSeverity(v === "all" ? "" : v)}>
            <SelectTrigger className="w-32"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Resolved</label>
          <Select value={alertResolved || "all"} onValueChange={(v) => setAlertResolved(v === "all" ? "" : v)}>
            <SelectTrigger className="w-32"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="false">Active</SelectItem>
              <SelectItem value="true">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {fetchError && !loading ? (
        <div className="mb-6">
          <AsyncPanel error={fetchError} onRetry={refresh} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <Card className="lg:col-span-2 border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><MapPin size={16} /> Track Buses</CardTitle></CardHeader>
          <CardContent>
            <div className="relative z-0 isolate h-[500px] rounded-md overflow-hidden" data-testid="live-map">
              <MapContainer center={[17.385, 78.486]} zoom={12} style={{ height: "100%", width: "100%" }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OSM" />
                {liveData.map((bus) => (
                  <Marker key={bus.bus_id} position={[bus.lat, bus.lng]} icon={busIcon(bus.status)}>
                    <Popup>
                      <div className="text-sm space-y-2 min-w-[160px]">
                        <p className="font-bold">{bus.bus_id}</p>
                        <p>Status: {bus.status}</p>
                        <p>Speed: {bus.speed} km/h</p>
                        <p>Type: {bus.bus_type}</p>
                        {bus.status === "panic" ? (
                          <button
                            type="button"
                            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-red-600 text-white text-xs font-medium py-1.5 px-2 hover:bg-red-700"
                            onClick={() => setCameraBusId(bus.bus_id)}
                          >
                            <Video size={14} aria-hidden />
                            Live camera
                          </button>
                        ) : null}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#16A34A]" />On Route ({liveData.filter(b => b.status === "on_route").length})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#F59E0B]" />At Stop ({liveData.filter(b => b.status === "at_stop").length})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#2563EB]" />Charging ({liveData.filter(b => b.status === "charging").length})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#DC2626]" />Panic ({liveData.filter(b => b.status === "panic").length})</span>
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><AlertTriangle size={16} /> Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[520px] overflow-y-auto" data-testid="alerts-list">
              {alerts.map((a) => (
                <div key={a.id} className={`p-3 rounded-md border text-sm ${a.severity === "high" ? "border-red-200 bg-red-50" : a.severity === "medium" ? "border-yellow-200 bg-yellow-50" : "border-gray-200 bg-gray-50"}`} data-testid={`alert-${a.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{a.alert_type}</span>
                    <Badge variant={a.resolved ? "secondary" : "destructive"} className={a.resolved ? "bg-green-100 text-green-700" : ""}>{a.resolved ? "Resolved" : "Active"}</Badge>
                  </div>
                  <p className="text-gray-600">Bus: {a.bus_id}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {a.timestamp
                      ? new Date(a.timestamp).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </p>
                </div>
              ))}
              {alerts.length === 0 && <p className="text-gray-400 text-center py-8">No alerts</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bus Status Table */}
      <Card className="mt-6 border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Bus Status</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
              <TableHead>Speed</TableHead><TableHead>Depot</TableHead><TableHead>Position</TableHead>
              <TableHead className="w-[108px] text-center align-middle">
                <span className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 whitespace-nowrap">
                  <Video className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                  Camera
                </span>
              </TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {liveTableRows.map((b) => (
                <TableRow key={b.bus_id} className="hover:bg-gray-50">
                  <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                  <TableCell>{b.bus_type}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        b.status === "panic"
                          ? "bg-red-100 text-red-800 hover:bg-red-100 border-red-200"
                          : b.status === "on_route"
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : b.status === "at_stop"
                              ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"
                              : "bg-blue-100 text-blue-700 hover:bg-blue-100"
                      }
                    >
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{b.speed} km/h</TableCell>
                  <TableCell>{b.depot}</TableCell>
                  <TableCell className="font-mono text-xs">{b.lat}, {b.lng}</TableCell>
                  <TableCell className="text-center p-1 align-middle">
                    {b.status === "panic" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2 text-red-700 border-red-200 bg-red-50/80 hover:bg-red-100 hover:text-red-800"
                        title="View live camera (concessionaire)"
                        aria-label={`Live camera for bus ${b.bus_id}`}
                        onClick={() => setCameraBusId(b.bus_id)}
                        data-testid={`live-camera-${b.bus_id}`}
                      >
                        <Video size={15} strokeWidth={2} className="shrink-0" />
                        <span className="text-[11px] font-medium">View</span>
                      </Button>
                    ) : (
                      <span
                        className="inline-flex items-center justify-center gap-1 text-gray-400"
                        title="Live camera is available when bus status is Panic"
                      >
                        <Video size={16} strokeWidth={1.5} className="opacity-35" aria-hidden />
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {liveData.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-400 py-10">
                    No vehicles match filters
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {liveData.length > LIVE_TABLE_LIMIT ? (
            <TablePaginationBar
              page={tablePage}
              pages={liveTablePages}
              total={liveData.length}
              limit={LIVE_TABLE_LIMIT}
              onPageChange={setTablePage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={!!cameraBusId} onOpenChange={(open) => { if (!open) setCameraBusId(null); }}>
        <DialogContent className="max-w-3xl" data-testid="live-camera-dialog">
          <DialogHeader>
            <DialogTitle>Live camera — {cameraBusId}</DialogTitle>
            <DialogDescription>
              Video stream from the concessionaire operations system. Playback is not wired yet; this panel reserves the integration point.
            </DialogDescription>
          </DialogHeader>
          <div
            className="relative aspect-video w-full rounded-md border border-gray-200 bg-gradient-to-br from-gray-900 to-gray-800 flex flex-col items-center justify-center gap-3 text-center px-6"
            role="img"
            aria-label="Placeholder for live camera stream"
          >
            <Video className="h-14 w-14 text-white/25" strokeWidth={1} aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium text-white/90">Awaiting concessionaire stream</p>
              <p className="text-xs text-white/50 max-w-md">
                HLS / WebRTC or embedded player URL from the concessionaire would render here (bus {cameraBusId}).
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
