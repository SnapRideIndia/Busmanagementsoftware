import { useState, useEffect, useCallback, useMemo } from "react";
import API, { buildQuery, formatApiError, fetchAllPaginated } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import AsyncPanel from "../components/AsyncPanel";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import {
  MapPin,
  RefreshCw,
  AlertTriangle,
  Video,
  Search,
  Bus,
  LayoutGrid,
  ListFilter,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { GoogleMap, InfoWindowF, MarkerF, useJsApiLoader } from "@react-google-maps/api";

const SPEED_GAUGE_MAX = 80;

const ALERT_FILTER_CODES = [
  { code: "panic", label: "Panic" },
  { code: "overspeed_user", label: "Overspeed" },
  { code: "gps_breakage", label: "GPS loss" },
  { code: "idle", label: "Idle" },
  { code: "route_deviation", label: "Route deviation" },
  { code: "bunching_user", label: "Bunching" },
  { code: "harness_removal", label: "Harness" },
];

const TELEM_STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "in_service", label: "In service" },
  { id: "at_depot", label: "At depot" },
  { id: "charging", label: "Charging" },
  { id: "idle", label: "Idle" },
  { id: "breakdown", label: "Breakdown" },
  { id: "panic", label: "Panic" },
];

const GOOGLE_MAPS_API_KEY = "AIzaSyCtC_0HfLwBvG3KRI2ZAcAyQqRrkJSeKSE";

function telemMarkerColor(status) {
  switch (status) {
    case "in_service":
      return "#16A34A";
    case "at_depot":
      return "#2563EB";
    case "charging":
      return "#7C3AED";
    case "idle":
      return "#D97706";
    case "breakdown":
      return "#EA580C";
    case "panic":
      return "#DC2626";
    default:
      return "#64748B";
  }
}


function SpeedGauge({ speed, max = SPEED_GAUGE_MAX, size = 48 }) {
  const pct = Math.min(1, Math.max(0, speed / max));
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const arcLen = Math.PI * r;
  const dashFill = pct * arcLen;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const gid = `spdGrad-${size}-${max}`;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size / 2 + 6 }}
      title={`${speed} km/h`}
      aria-label={`Speed ${speed} kilometers per hour`}
    >
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} className="overflow-visible">
        <path d={arc} fill="none" stroke="#E5E7EB" strokeWidth="4" strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dashFill} ${arcLen}`}
        />
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22C55E" />
            <stop offset="70%" stopColor="#EAB308" />
            <stop offset="100%" stopColor="#EF4444" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute left-1/2 bottom-0 -translate-x-1/2 text-[10px] font-mono font-bold text-gray-600 tabular-nums">
        {speed}
      </span>
    </div>
  );
}

function statusBadgeClass(status) {
  if (status === "panic") return "bg-red-100 text-red-800 border-red-200";
  if (status === "in_service") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "charging") return "bg-violet-50 text-violet-800 border-violet-200";
  if (status === "at_depot") return "bg-blue-50 text-blue-800 border-blue-200";
  if (status === "idle") return "bg-amber-50 text-amber-900 border-amber-200";
  if (status === "breakdown") return "bg-orange-50 text-orange-900 border-orange-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function worstActiveSeverity(alertsList) {
  const rank = { high: 3, medium: 2, low: 1 };
  return alertsList.reduce((best, a) => (rank[a.severity] > rank[best] ? a.severity : best), alertsList[0].severity);
}

function activeAlertLeftBorder(sev) {
  if (sev === "high") return "border-l-4 border-l-red-500";
  if (sev === "medium") return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-slate-400";
}

function alertPriorityScore(busAlerts) {
  const active = (busAlerts || []).filter((a) => !a.resolved);
  if (active.length === 0) return 0;
  if (active.some((a) => a.severity === "high")) return 4;
  if (active.some((a) => a.severity === "medium")) return 3;
  return 2;
}

function FleetVehicleCard({ row, busAlerts, selected, onSelect, onCamera }) {
  const active = (busAlerts || []).filter((a) => !a.resolved);
  const resolved = (busAlerts || []).filter((a) => a.resolved);
  const topActive = active.slice(0, 3);
  const moreActive = active.length - topActive.length;
  const worstSev = active.length ? worstActiveSeverity(active) : null;

  return (
    <button
      type="button"
      data-testid={`fleet-card-${row.bus_id}`}
      onClick={() => onSelect(row.bus_id === selected ? null : row.bus_id)}
      className={`w-full text-left rounded-xl border border-gray-200 bg-white transition-all duration-150 ${
        selected === row.bus_id
          ? "ring-2 ring-[#C8102E]/30 border-[#C8102E] shadow-md"
          : "hover:border-gray-300 hover:shadow-sm"
      } ${worstSev && selected !== row.bus_id ? activeAlertLeftBorder(worstSev) : ""}`}
    >
      <div className="p-3">
        <div className="flex gap-3">
          <div
            className="w-1 self-stretch rounded-full shrink-0 mt-0.5 mb-0.5"
            style={{ background: telemMarkerColor(row.status) }}
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-sm font-bold text-gray-900 tracking-tight">{row.bus_id}</p>
                <p className="text-[11px] text-gray-500 truncate">{row.registration_no}</p>
              </div>
              <Badge className={`text-[10px] shrink-0 border ${statusBadgeClass(row.status)}`}>
                {row.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="flex items-center justify-between mt-2 gap-2">
              <div className="flex items-center gap-2">
                <SpeedGauge speed={row.speed} size={44} />
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">km/h</p>
                  <p className="text-xs text-gray-700">
                    SOC <span className="font-mono font-semibold">{row.soc}%</span>
                    <span className="text-gray-300 mx-1">·</span>
                    <span className="text-gray-500">SOH {row.soh}%</span>
                  </p>
                </div>
              </div>
              <div className="text-right text-[11px] text-gray-600 truncate max-w-[130px]" title={row.route}>
                {row.route}
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 truncate">
              {row.driver}
              {row.depot ? <span className="text-gray-300"> · </span> : null}
              {row.depot}
            </p>
          </div>
        </div>

        {(topActive.length > 0 || resolved.length > 0) && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <AlertTriangle className="w-3 h-3" />
              Alerts
            </div>
            {topActive.length > 0 ? (
              <ul className="space-y-1.5" data-testid={`fleet-alerts-${row.bus_id}`}>
                {topActive.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white border border-gray-100 px-2 py-1.5 text-[11px]"
                    data-testid={`alert-${a.id}`}
                  >
                    <span className="text-gray-800 font-medium truncate">{a.alert_type}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          a.severity === "high" ? "bg-red-500" : a.severity === "medium" ? "bg-amber-500" : "bg-slate-400"
                        }`}
                      />
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-5 border-red-200 text-red-700 bg-red-50/80">
                        Active
                      </Badge>
                    </span>
                  </li>
                ))}
                {moreActive > 0 ? (
                  <li className="text-[10px] text-gray-500 pl-1">+{moreActive} more active</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-[11px] text-gray-400">No active alerts</p>
            )}
            {resolved.length > 0 && active.length === 0 ? (
              <p className="text-[10px] text-gray-400">{resolved.length} resolved in this session</p>
            ) : null}
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onCamera(row.bus_id);
            }}
            data-testid={`live-camera-${row.bus_id}`}
          >
            <Video className="w-3.5 h-3.5" />
            Live camera
          </Button>
        </div>
      </div>
    </button>
  );
}

export default function LiveTrackingPage() {
  const { isLoaded: mapsLoaded, loadError: mapsLoadError } = useJsApiLoader({
    id: "google-maps-live-tracking",
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });
  const [mapRef, setMapRef] = useState(null);
  const [mapPopupBusId, setMapPopupBusId] = useState(null);
  const [positions, setPositions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [allBuses, setAllBuses] = useState([]);
  const [depot, setDepot] = useState("");
  const [telemStatus, setTelemStatus] = useState("");
  const [alertCode, setAlertCode] = useState("");
  const [alertSeverity, setAlertSeverity] = useState("");
  const [alertResolved, setAlertResolved] = useState("");
  const [fleetSearch, setFleetSearch] = useState("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [cameraBusId, setCameraBusId] = useState(null);
  const [selectedBusId, setSelectedBusId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const items = await fetchAllPaginated(Endpoints.masters.buses.list(), {});
        setAllBuses(items);
      } catch {
        setAllBuses([]);
      }
    })();
  }, []);

  const depotsList = [...new Set(allBuses.map((b) => b.depot).filter(Boolean))].sort();

  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const telemParams = buildQuery({ depot, status: telemStatus });
      const alertParams = buildQuery({
        depot,
        alert_code: alertCode,
        severity: alertSeverity,
        resolved: alertResolved,
      });
      const [tp, al] = await Promise.all([
        API.get(Endpoints.operations.live.telemetryPositions(), { params: telemParams }),
        API.get(Endpoints.operations.live.alerts(), { params: alertParams }),
      ]);
      setPositions(Array.isArray(tp.data) ? tp.data : []);
      setAlerts(Array.isArray(al.data) ? al.data : []);
    } catch (err) {
      setFetchError(formatApiError(err.response?.data?.detail) || err.message || "Failed to refresh");
    } finally {
      setLoading(false);
    }
  }, [depot, telemStatus, alertCode, alertSeverity, alertResolved]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, [refresh]);

  const alertsByBus = useMemo(() => {
    const m = new Map();
    for (const a of alerts) {
      const bid = a.bus_id;
      if (!m.has(bid)) m.set(bid, []);
      m.get(bid).push(a);
    }
    return m;
  }, [alerts]);

  const filteredFleet = useMemo(() => {
    let rows = positions;
    const q = fleetSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) =>
        [p.bus_id, p.registration_no, p.route, p.driver, p.depot]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      );
    }
    if (alertsOnly) {
      rows = rows.filter((p) => {
        const list = alertsByBus.get(p.bus_id) || [];
        return list.some((a) => !a.resolved);
      });
    }
    return [...rows].sort(
      (a, b) =>
        alertPriorityScore(alertsByBus.get(b.bus_id)) - alertPriorityScore(alertsByBus.get(a.bus_id)) ||
        a.bus_id.localeCompare(b.bus_id),
    );
  }, [positions, fleetSearch, alertsOnly, alertsByBus]);

  useEffect(() => {
    if (selectedBusId && !filteredFleet.some((p) => p.bus_id === selectedBusId)) {
      setSelectedBusId(null);
    }
  }, [selectedBusId, filteredFleet]);

  useEffect(() => {
    if (mapPopupBusId && !filteredFleet.some((p) => p.bus_id === mapPopupBusId)) {
      setMapPopupBusId(null);
    }
  }, [mapPopupBusId, filteredFleet]);

  const counts = useMemo(() => {
    const running = positions.filter((p) => p.status === "in_service").length;
    const breakdown = positions.filter((p) => p.status === "breakdown").length;
    const charging = positions.filter((p) => p.status === "charging").length;
    const withActive = positions.filter((p) => (alertsByBus.get(p.bus_id) || []).some((a) => !a.resolved)).length;
    return { running, breakdown, charging, withActive };
  }, [positions, alertsByBus]);

  const mapCenter = useMemo(() => {
    if (selectedBusId) {
      const b = filteredFleet.find((p) => p.bus_id === selectedBusId) || positions.find((p) => p.bus_id === selectedBusId);
      if (b) return { lat: Number(b.lat), lng: Number(b.lng) };
    }
    const src = filteredFleet.length ? filteredFleet : positions;
    if (src.length) {
      const lat = src.reduce((s, p) => s + p.lat, 0) / src.length;
      const lng = src.reduce((s, p) => s + p.lng, 0) / src.length;
      return { lat: Number(lat), lng: Number(lng) };
    }
    return { lat: 17.385, lng: 78.4867 };
  }, [positions, filteredFleet, selectedBusId]);

  const mapMarkers = filteredFleet;

  useEffect(() => {
    if (!mapRef || !mapsLoaded) return;
    mapRef.panTo(mapCenter);
  }, [mapCenter, mapRef, mapsLoaded]);

  const busMarkerIcon = useCallback(
    (status) => ({
      path: window.google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: telemMarkerColor(status),
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
    }),
    [],
  );

  /** Fixed-height map pane: no vertical scroll; only map pan/zoom inside. */
  const renderMapBlock = (heightClassName) => (
    <div
      className={`relative z-0 isolate rounded-xl overflow-hidden border border-gray-200 shadow-sm ${heightClassName}`}
      data-testid="live-map"
    >
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap gap-2 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap gap-2 rounded-lg bg-white/95 border border-gray-200 shadow-sm px-3 py-2 text-[11px] font-medium text-gray-700">
          <span className="text-emerald-700">Running {counts.running}</span>
          <span className="text-gray-300">|</span>
          <span className="text-orange-700">Breakdown {counts.breakdown}</span>
          <span className="text-gray-300">|</span>
          <span className="text-violet-700">Charging {counts.charging}</span>
          <span className="text-gray-300">|</span>
          <span className="text-red-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Alert buses {counts.withActive}
          </span>
        </div>
      </div>
      {!mapsLoaded ? (
        <div className="h-full w-full grid place-items-center text-sm text-gray-500 bg-gray-50">Loading Google Maps…</div>
      ) : mapsLoadError ? (
        <div className="h-full w-full grid place-items-center text-sm text-red-600 bg-red-50">
          Failed to load Google Maps.
        </div>
      ) : (
        <GoogleMap
          center={mapCenter}
          zoom={12}
          mapContainerStyle={{ height: "100%", width: "100%" }}
          onLoad={(m) => setMapRef(m)}
          options={{
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
          }}
        >
          {mapMarkers.map((bus) => (
            <MarkerF
              key={bus.bus_id}
              position={{ lat: Number(bus.lat), lng: Number(bus.lng) }}
              icon={busMarkerIcon(bus.status)}
              onClick={() => setMapPopupBusId(bus.bus_id)}
            />
          ))}
          {mapPopupBusId ? (() => {
            const bus = mapMarkers.find((b) => b.bus_id === mapPopupBusId);
            if (!bus) return null;
            const activeAlerts = (alertsByBus.get(bus.bus_id) || []).filter((a) => !a.resolved);
            return (
              <InfoWindowF
                position={{ lat: Number(bus.lat), lng: Number(bus.lng) }}
                onCloseClick={() => setMapPopupBusId(null)}
              >
                <div className="text-sm space-y-2 min-w-[200px]">
                  <p className="font-bold font-mono">{bus.bus_id}</p>
                  <p className="text-xs text-gray-500">{bus.registration_no}</p>
                  <p className="text-xs">
                    {bus.status.replace(/_/g, " ")} · {bus.speed} km/h · SOC {bus.soc}%
                  </p>
                  <p className="text-xs text-gray-600">{bus.route}</p>
                  <p className="text-xs">{bus.driver}</p>
                  {activeAlerts.length > 0 ? (
                    <div className="pt-2 border-t border-gray-100 space-y-1">
                      <p className="text-[10px] font-bold uppercase text-gray-400">Active alerts</p>
                      {activeAlerts.slice(0, 4).map((a) => (
                        <p key={a.id} className="text-xs text-red-800 bg-red-50 rounded px-2 py-1">
                          {a.alert_type}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => setCameraBusId(bus.bus_id)}
                  >
                    <Video className="w-3.5 h-3.5 mr-1" />
                    Live camera
                  </Button>
                </div>
              </InfoWindowF>
            );
          })() : null}
        </GoogleMap>
      )}
    </div>
  );

  const fleetPanel = (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-gray-200 bg-gray-50/80 overflow-hidden shadow-sm">
      <div className="p-3 border-b border-gray-200 bg-white space-y-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search bus, reg., route, driver, depot…"
            value={fleetSearch}
            onChange={(e) => setFleetSearch(e.target.value)}
            className="pl-9 h-10 rounded-lg border-gray-200 bg-gray-50/50 focus:bg-white"
            data-testid="fleet-search"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-gray-500">
            <span className="font-semibold text-gray-800">{filteredFleet.length}</span>
            {filteredFleet.length !== positions.length ? (
              <span>
                {" "}
                of {positions.length} shown
              </span>
            ) : (
              <span> vehicles</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Switch id="alerts-only" checked={alertsOnly} onCheckedChange={setAlertsOnly} data-testid="fleet-alerts-only" />
            <Label htmlFor="alerts-only" className="text-xs font-medium text-gray-600 cursor-pointer">
              Active alerts only
            </Label>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0 min-h-[200px]">
        <div className="p-3 space-y-2.5" data-testid="live-tracking-side-list">
          {filteredFleet.map((p) => (
            <FleetVehicleCard
              key={p.bus_id}
              row={p}
              busAlerts={alertsByBus.get(p.bus_id) || []}
              selected={selectedBusId}
              onSelect={setSelectedBusId}
              onCamera={setCameraBusId}
            />
          ))}
          {filteredFleet.length === 0 && !loading ? (
            <div className="py-16 text-center text-sm text-gray-400 px-4">
              {positions.length === 0 ? "No vehicles match filters." : "No vehicles match search or alert filter."}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div data-testid="live-tracking-page" className="space-y-4 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">Live tracking</h1>
            <Badge variant="outline" className="text-xs font-mono border-gray-300 text-gray-700 bg-gray-50">
              {positions.length} on map
            </Badge>
          </div>
          <p className="page-desc max-w-2xl">
            Fleet positions with telemetry. Alerts are shown on each vehicle card; use search to find buses in large fleets.
          </p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm" data-testid="live-refresh-btn" className="shrink-0 rounded-lg border-gray-200">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm overflow-hidden">
        <CardContent className="p-4 space-y-4" data-testid="live-tracking-filters">
          <div className="flex flex-col xl:flex-row gap-4 xl:items-end">
            <div className="flex flex-wrap gap-3 flex-1">
              <div className="space-y-1 min-w-[160px]">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                  <Bus className="w-3 h-3" />
                  Depot
                </Label>
                <Select
                  value={depot || "all"}
                  onValueChange={(v) => {
                    setDepot(v === "all" ? "" : v);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-44 h-9 rounded-lg">
                    <SelectValue placeholder="All depots" />
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
              <div className="space-y-1 min-w-[140px]">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                  <ListFilter className="w-3 h-3" />
                  Alert type
                </Label>
                <Select value={alertCode || "all"} onValueChange={(v) => setAlertCode(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-full sm:w-40 h-9 rounded-lg">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {ALERT_FILTER_CODES.map((a) => (
                      <SelectItem key={a.code} value={a.code}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[120px]">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Severity</Label>
                <Select value={alertSeverity || "all"} onValueChange={(v) => setAlertSeverity(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-full sm:w-32 h-9 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[120px]">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</Label>
                <Select value={alertResolved || "all"} onValueChange={(v) => setAlertResolved(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-full sm:w-32 h-9 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="false">Active</SelectItem>
                    <SelectItem value="true">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 block">Vehicle status</Label>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {TELEM_STATUS_FILTERS.map((f) => (
                <button
                  key={f.id || "all"}
                  type="button"
                  onClick={() => setTelemStatus(f.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    telemStatus === f.id
                      ? "border-[#C8102E] bg-[#C8102E] text-white shadow-sm"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {fetchError && !loading ? (
        <AsyncPanel error={fetchError} onRetry={refresh} />
      ) : null}

      {/* Desktop: map left (fixed height, sticky — no page scroll in map), fleet right (scrolls inside list) */}
      <div className="hidden lg:flex lg:flex-row lg:gap-4 lg:items-start">
        <div className="flex-1 min-w-0 lg:sticky lg:top-20 lg:z-[1] self-start h-[calc(100vh-9rem)] max-h-[880px]">
          {renderMapBlock("h-full")}
        </div>
        <div className="w-full max-w-[420px] shrink-0 flex flex-col min-h-0 h-[calc(100vh-9rem)] max-h-[880px]">
          {fleetPanel}
        </div>
      </div>

      {/* Mobile / tablet: Map first, Fleet second */}
      <div className="lg:hidden">
        <Tabs defaultValue="map" className="w-full">
          <TabsList className="w-full grid grid-cols-2 h-11 rounded-lg bg-gray-100 p-1">
            <TabsTrigger value="map" className="rounded-md gap-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <MapPin className="w-4 h-4" />
              Map
            </TabsTrigger>
            <TabsTrigger value="fleet" className="rounded-md gap-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <LayoutGrid className="w-4 h-4" />
              Fleet
            </TabsTrigger>
          </TabsList>
          <TabsContent value="map" className="mt-3 focus-visible:outline-none">
            {renderMapBlock("h-[min(52vh,440px)]")}
          </TabsContent>
          <TabsContent value="fleet" className="mt-3 focus-visible:outline-none">
            <div className="h-[min(72vh,620px)] flex flex-col min-h-0">{fleetPanel}</div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!cameraBusId} onOpenChange={(open) => { if (!open) setCameraBusId(null); }}>
        <DialogContent className="max-w-3xl" data-testid="live-camera-dialog">
          <DialogHeader>
            <DialogTitle>Live camera — {cameraBusId}</DialogTitle>
            <DialogDescription>
              Video stream from the concessionaire operations system. Playback is not wired yet; this panel reserves the integration point.
            </DialogDescription>
          </DialogHeader>
          <div
            className="relative aspect-video w-full rounded-lg border border-gray-200 bg-gradient-to-br from-gray-900 to-gray-800 flex flex-col items-center justify-center gap-3 text-center px-6"
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
