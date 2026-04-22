import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleF, GoogleMap, MarkerF, PolygonF, PolylineF, useJsApiLoader } from "@react-google-maps/api";
import API, { fetchAllPaginated, formatApiError, unwrapListResponse } from "../../lib/api";
import { Endpoints } from "../../lib/endpoints";
import { getGoogleMapsApiKey } from "../../lib/googleMapsConfig";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Switch } from "../../components/ui/switch";
import { toast } from "sonner";
import {
  Building2,
  Bus,
  Circle,
  Crosshair,
  Hexagon,
  MapPin,
  Minus,
  MousePointer2,
  RotateCcw,
  Square,
  Spline,
} from "lucide-react";
import {
  DEFAULT_MAP_CENTER,
  geofenceIdFor,
  parseRuleFloat,
  pathPointsFromRouteAndStops,
  terminalCenterFromMaster,
} from "./geofenceConsoleModel";

const RULE_STOP = "geofence_stoppage_radius_m";
const RULE_TERM = "geofence_terminal_radius_m";
const RULE_DEPOT = "geofence_depot_radius_m";
const RULE_ROUTE_BUF = "route_fence_buffer_m";

const DEFAULTS = {
  [RULE_STOP]: 50,
  [RULE_TERM]: 100,
  [RULE_DEPOT]: 150,
  [RULE_ROUTE_BUF]: 500,
};

/** Display labels for filters, summaries, and identity (no abbreviations). */
const ASSET_TYPE_LABEL = {
  stop: "Bus stop",
  terminal: "Terminal",
  depot: "Depot",
  route: "Route",
};

const RADIUS_MIN = 1;
const RADIUS_MAX = 10000;
const BUFFER_MIN = 1;
const BUFFER_MAX = 10000;

function clamp(n, lo, hi) {
  const x = Number(n);
  if (Number.isNaN(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function rectFromDiagonal(a, b) {
  const minLat = Math.min(a.lat, b.lat);
  const maxLat = Math.max(a.lat, b.lat);
  const minLng = Math.min(a.lng, b.lng);
  const maxLng = Math.max(a.lng, b.lng);
  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng },
  ];
}

async function loadOperationsRulesMap() {
  const map = {};
  let page = 1;
  let pages = 1;
  do {
    const { data } = await API.get(Endpoints.masters.businessRules.root(), {
      params: { category: "operations", page, limit: 100 },
    });
    const u = unwrapListResponse(data);
    (u.items || []).forEach((r) => {
      if (r?.rule_key) map[r.rule_key] = r.rule_value;
    });
    pages = Math.max(1, u.pages);
    page += 1;
  } while (page <= pages);
  return map;
}

/** @typedef {'select'|'circle'|'polygon'|'polyline'|'rect'} DrawTool */

/**
 * Three-pane geofence console (reference layout): asset list | map + tools | identity & geometry.
 */
export default function GeofenceMapConsole({ onSaved, summaryStats: summaryStatsProp }) {
  const { isLoaded: mapsLoaded, loadError: mapsLoadError } = useJsApiLoader({
    id: "google-maps-geofence-console",
    googleMapsApiKey: getGoogleMapsApiKey(),
  });

  const [mapRef, setMapRef] = useState(null);
  const [assetType, setAssetType] = useState("stop");
  const [rulesMap, setRulesMap] = useState({});
  const [stops, setStops] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [depots, setDepots] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [mastersLoading, setMastersLoading] = useState(true);
  const [pickSearch, setPickSearch] = useState("");
  const [selectedRef, setSelectedRef] = useState("");
  const [summaryStats, setSummaryStats] = useState(null);

  const [center, setCenter] = useState(DEFAULT_MAP_CENTER);
  const [radiusM, setRadiusM] = useState(50);
  const [bufferM, setBufferM] = useState(500);
  const [pathPoints, setPathPoints] = useState([]);
  /** Polygon for stop/terminal/depot (area) */
  const [polygonFence, setPolygonFence] = useState([]);
  /** 'circle' | 'polygon' for point assets */
  const [geometryShape, setGeometryShape] = useState("circle");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [geofenceSynced, setGeofenceSynced] = useState(false);

  const [drawTool, setDrawTool] = useState(/** @type {DrawTool} */ ("select"));
  const [rectStep, setRectStep] = useState(0);
  const [rectA, setRectA] = useState(null);

  const [routeClickAdd, setRouteClickAdd] = useState(false);

  const setRadiusSafe = useCallback((v) => setRadiusM(clamp(v, RADIUS_MIN, RADIUS_MAX)), []);
  const setBufferSafe = useCallback((v) => setBufferM(clamp(v, BUFFER_MIN, BUFFER_MAX)), []);

  useEffect(() => {
    if (summaryStatsProp != null) {
      setSummaryStats(summaryStatsProp);
      return;
    }
    let cancelled = false;
    API.get(Endpoints.masters.geofences.stats())
      .then(({ data }) => {
        if (!cancelled) setSummaryStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [summaryStatsProp]);

  const stopById = useMemo(() => {
    const m = new Map();
    (stops || []).forEach((s) => {
      if (s?.stop_id) m.set(String(s.stop_id).trim(), s);
    });
    return m;
  }, [stops]);

  const rulesReady = useMemo(
    () => ({
      stop: parseRuleFloat(rulesMap, RULE_STOP, DEFAULTS[RULE_STOP]),
      terminal: parseRuleFloat(rulesMap, RULE_TERM, DEFAULTS[RULE_TERM]),
      depot: parseRuleFloat(rulesMap, RULE_DEPOT, DEFAULTS[RULE_DEPOT]),
      routeBuf: parseRuleFloat(rulesMap, RULE_ROUTE_BUF, DEFAULTS[RULE_ROUTE_BUF]),
    }),
    [rulesMap],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMastersLoading(true);
      try {
        const [rules, stopList, termList, depotList, routeList] = await Promise.all([
          loadOperationsRulesMap(),
          fetchAllPaginated(Endpoints.masters.stops.list(), {}),
          fetchAllPaginated(Endpoints.masters.terminals.list(), {}),
          fetchAllPaginated(Endpoints.masters.depots.list(), {}),
          fetchAllPaginated(Endpoints.masters.routes.list(), {}),
        ]);
        if (cancelled) return;
        setRulesMap(rules);
        setStops(stopList || []);
        setTerminals(termList || []);
        setDepots(depotList || []);
        setRoutes(routeList || []);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e.response?.data?.detail) || e.message || "Could not load reference data.");
      } finally {
        if (!cancelled) setMastersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRoute = useMemo(
    () => (routes || []).find((r) => String(r.route_id || "").trim() === selectedRef) || null,
    [routes, selectedRef],
  );

  const selectedLabel = useMemo(() => {
    if (!selectedRef) return { name: "—", code: "—" };
    if (assetType === "stop") {
      const s = stopById.get(selectedRef);
      return { name: s?.name || "—", code: s?.stop_id || selectedRef };
    }
    if (assetType === "terminal") {
      const t = terminals.find((x) => String(x.terminal_id).trim() === selectedRef);
      return { name: t?.name || "—", code: t?.terminal_id || selectedRef };
    }
    if (assetType === "depot") {
      const d = depots.find((x) => String(x.name).trim() === selectedRef);
      return { name: d?.name || selectedRef, code: d?.code || "—" };
    }
    const r = selectedRoute;
    return { name: r?.name || "—", code: r?.route_id || selectedRef };
  }, [assetType, depots, selectedRef, selectedRoute, stopById, terminals]);

  const applyDefaultsForType = useCallback(
    (type) => {
      if (type === "stop") setRadiusSafe(rulesReady.stop);
      if (type === "terminal") setRadiusSafe(rulesReady.terminal);
      if (type === "depot") setRadiusSafe(rulesReady.depot);
      if (type === "route") setBufferSafe(rulesReady.routeBuf);
    },
    [rulesReady, setBufferSafe, setRadiusSafe],
  );

  const hydrateFromExisting = useCallback(
    (doc) => {
      if (!doc) return;
      setActive(doc.active !== false);
      setNotes(String(doc.notes || ""));
      setGeofenceSynced(true);
      const gt = String(doc.geometry_type || "circle");
      if (gt === "circle") {
        setGeometryShape("circle");
        setPolygonFence([]);
        setPathPoints([]);
        if (doc.center_lat != null && doc.center_lng != null) {
          setCenter({ lat: Number(doc.center_lat), lng: Number(doc.center_lng) });
        }
        if (doc.radius_m != null) setRadiusSafe(Number(doc.radius_m));
      } else if (gt === "polygon") {
        setGeometryShape("polygon");
        setPathPoints([]);
        if (Array.isArray(doc.path_points) && doc.path_points.length >= 3) {
          setPolygonFence(doc.path_points.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })));
        }
      } else if (gt === "polyline_buffer") {
        setPolygonFence([]);
        if (doc.buffer_m != null) setBufferSafe(Number(doc.buffer_m));
        if (Array.isArray(doc.path_points) && doc.path_points.length >= 2) {
          setPathPoints(doc.path_points.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })));
        }
      }
    },
    [setBufferSafe, setRadiusSafe],
  );

  const loadExistingOrSeed = useCallback(
    async (type, entityRef) => {
      const gid = geofenceIdFor(type, entityRef);
      if (!gid) return;
      setLoadingDoc(true);
      setGeofenceSynced(false);
      try {
        const { data } = await API.get(Endpoints.masters.geofences.get(gid));
        hydrateFromExisting(data);
        setDrawTool("select");
        setRouteClickAdd(false);
        setRectStep(0);
        setRectA(null);
      } catch (err) {
        if (err.response?.status !== 404) {
          toast.error(formatApiError(err.response?.data?.detail) || "Could not load existing boundary.");
          return;
        }
        setGeofenceSynced(false);
        setGeometryShape("circle");
        setPolygonFence([]);
        if (type === "stop") {
          const s = stopById.get(entityRef);
          if (s?.lat != null && s?.lng != null) {
            setCenter({ lat: Number(s.lat), lng: Number(s.lng) });
          } else {
            setCenter(DEFAULT_MAP_CENTER);
            toast.info("No master coordinates — use map tools to mark the boundary.");
          }
          setRadiusSafe(rulesReady.stop);
          setPathPoints([]);
        }
        if (type === "terminal") {
          const t = (terminals || []).find((x) => String(x.terminal_id || "").trim() === entityRef);
          const c = t ? terminalCenterFromMaster(t, stopById) : null;
          if (c) setCenter(c);
          else {
            setCenter(DEFAULT_MAP_CENTER);
            toast.info("Click the map to place the boundary (circle or polygon tools).");
          }
          setRadiusSafe(rulesReady.terminal);
          setPathPoints([]);
        }
        if (type === "depot") {
          const d = (depots || []).find((x) => String(x.name || "").trim() === entityRef);
          if (d?.lat != null && d?.lng != null) {
            setCenter({ lat: Number(d.lat), lng: Number(d.lng) });
          } else {
            setCenter(DEFAULT_MAP_CENTER);
            toast.info("Click the map to place the depot boundary.");
          }
          setRadiusSafe(rulesReady.depot);
          setPathPoints([]);
        }
        if (type === "route") {
          const r = (routes || []).find((x) => String(x.route_id || "").trim() === entityRef);
          const pts = r ? pathPointsFromRouteAndStops(r, stopById) : [];
          setPathPoints(pts);
          setBufferSafe(rulesReady.routeBuf);
          if (pts.length) {
            const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
            const lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
            setCenter({ lat, lng });
          } else {
            setCenter(DEFAULT_MAP_CENTER);
            toast.info("Use Polyline tool and click the map to draw the corridor.");
          }
        }
      } finally {
        setLoadingDoc(false);
      }
    },
    [depots, hydrateFromExisting, routes, rulesReady, setBufferSafe, setRadiusSafe, stopById, terminals],
  );

  useEffect(() => {
    if (!selectedRef) return;
    loadExistingOrSeed(assetType, selectedRef);
  }, [assetType, selectedRef, loadExistingOrSeed]);

  useEffect(() => {
    applyDefaultsForType(assetType);
  }, [assetType, applyDefaultsForType]);

  useEffect(() => {
    if (!mapRef || !window.google?.maps) return;
    if (assetType === "route" && pathPoints.length >= 2) {
      const b = new window.google.maps.LatLngBounds();
      pathPoints.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
      mapRef.fitBounds(b, 32);
      return;
    }
    if (assetType !== "route" && geometryShape === "polygon" && polygonFence.length >= 2) {
      const b = new window.google.maps.LatLngBounds();
      polygonFence.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
      mapRef.fitBounds(b, 40);
      return;
    }
    if (assetType !== "route" && center?.lat != null && center?.lng != null) {
      mapRef.panTo(center);
      const z = mapRef.getZoom();
      if (!z || z < 13) mapRef.setZoom(15);
    }
  }, [mapRef, assetType, pathPoints, center, geometryShape, polygonFence]);

  const filteredStops = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    let list = [...stops];
    if (q) {
      list = list.filter(
        (s) =>
          String(s.stop_id || "")
            .toLowerCase()
            .includes(q) || String(s.name || "")
            .toLowerCase()
            .includes(q),
      );
    }
    return list.slice(0, 120);
  }, [stops, pickSearch]);

  const filteredTerminals = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    let list = [...terminals];
    if (q) {
      list = list.filter(
        (t) =>
          String(t.terminal_id || "")
            .toLowerCase()
            .includes(q) || String(t.name || "")
            .toLowerCase()
            .includes(q),
      );
    }
    return list.slice(0, 80);
  }, [terminals, pickSearch]);

  const filteredDepots = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    let list = [...depots];
    if (q) {
      list = list.filter((d) => String(d.name || "").toLowerCase().includes(q));
    }
    return list.slice(0, 80);
  }, [depots, pickSearch]);

  const filteredRoutes = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    let list = [...routes];
    if (q) {
      list = list.filter(
        (r) =>
          String(r.route_id || "")
            .toLowerCase()
            .includes(q) || String(r.name || "")
            .toLowerCase()
            .includes(q),
      );
    }
    return list.slice(0, 80);
  }, [routes, pickSearch]);

  const instructionBanner = useMemo(() => {
    if (assetType === "route") {
      if (routeClickAdd || drawTool === "polyline") return "Drawing corridor — click the map to add points. Drag handles to adjust.";
      return "Select Polyline tool, then click to add corridor points. Rebuild from route master in the panel.";
    }
    if (drawTool === "select") return "Select an asset on the left, then choose a drawing tool.";
    if (drawTool === "circle") return "Drawing circle — click the map to set centre; drag pin or use the panel for radius.";
    if (drawTool === "polygon") return "Drawing polygon — click the map to add corners. Undo last or Close when done.";
    if (drawTool === "rect") return rectStep === 0 ? "Rectangle — click first corner." : "Rectangle — click opposite corner to finish.";
    return "";
  }, [assetType, drawTool, rectStep, routeClickAdd]);

  const handleMapClick = useCallback(
    (e) => {
      const ll = e.latLng;
      if (!ll) return;
      const la = ll.lat();
      const ln = ll.lng();

      if (assetType === "route") {
        if (drawTool === "polyline" || routeClickAdd) {
          setPathPoints((prev) => [...prev, { lat: la, lng: ln }]);
        }
        return;
      }

      if (drawTool === "select") return;

      if (drawTool === "circle") {
        setGeometryShape("circle");
        setPolygonFence([]);
        setCenter({ lat: la, lng: ln });
        return;
      }

      if (drawTool === "polygon") {
        setGeometryShape("polygon");
        setPolygonFence((prev) => [...prev, { lat: la, lng: ln }]);
        return;
      }

      if (drawTool === "rect") {
        if (rectStep === 0) {
          setRectA({ lat: la, lng: ln });
          setRectStep(1);
        } else {
          const b = { lat: la, lng: ln };
          const corners = rectFromDiagonal(rectA, b);
          setPolygonFence(corners);
          setGeometryShape("polygon");
          setRectStep(0);
          setRectA(null);
          setDrawTool("select");
          const cx = corners.reduce((s, p) => s + p.lat, 0) / corners.length;
          const cy = corners.reduce((s, p) => s + p.lng, 0) / corners.length;
          setCenter({ lat: cx, lng: cy });
          toast.success("Rectangle added. Save when ready.");
        }
      }
    },
    [assetType, drawTool, rectA, rectStep, routeClickAdd],
  );

  const undoLastPathPoint = () => {
    setPathPoints((p) => (p.length ? p.slice(0, -1) : p));
  };

  const undoLastPolygonVertex = () => {
    setPolygonFence((p) => (p.length ? p.slice(0, -1) : p));
  };

  const clearRoutePath = () => {
    if (!pathPoints.length) return;
    if (!window.confirm("Clear all corridor points?")) return;
    setPathPoints([]);
  };

  const closePolygonDraft = () => {
    if (polygonFence.length < 3) {
      toast.error("Need at least 3 corners.");
      return;
    }
    setDrawTool("select");
    toast.success("Polygon ready — save to apply.");
  };

  const handleSave = async () => {
    const ref = String(selectedRef || "").trim();
    if (!ref) {
      toast.error("Choose a record from the list.");
      return;
    }
    const gid = geofenceIdFor(assetType, ref);
    if (!gid) {
      toast.error("Missing reference.");
      return;
    }

    if (assetType === "route") {
      if (!pathPoints || pathPoints.length < 2) {
        toast.error("Route corridor needs at least two points.");
        return;
      }
      if (!bufferM || bufferM < 1) {
        toast.error("Corridor width (m) is required.");
        return;
      }
    } else if (geometryShape === "polygon") {
      if (!polygonFence || polygonFence.length < 3) {
        toast.error("Polygon needs at least three corners.");
        return;
      }
    } else {
      if (center?.lat == null || center?.lng == null) {
        toast.error("Set a position on the map.");
        return;
      }
      if (!radiusM || radiusM < 1) {
        toast.error("Radius (m) is required.");
        return;
      }
    }

    setSaving(true);
    try {
      const base = {
        geofence_id: gid,
        type: assetType,
        entity_ref: ref,
        active,
        notes: notes.trim(),
        source: "map_console",
        version: 1,
      };

      if (assetType === "route") {
        await API.post(Endpoints.masters.geofences.create(), {
          ...base,
          geometry_type: "polyline_buffer",
          center_lat: null,
          center_lng: null,
          radius_m: null,
          buffer_m: Number(bufferM),
          path_points: pathPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
        });
      } else if (geometryShape === "polygon") {
        await API.post(Endpoints.masters.geofences.create(), {
          ...base,
          geometry_type: "polygon",
          center_lat: null,
          center_lng: null,
          radius_m: null,
          buffer_m: null,
          path_points: polygonFence.map((p) => ({ lat: p.lat, lng: p.lng })),
        });
      } else {
        await API.post(Endpoints.masters.geofences.create(), {
          ...base,
          geometry_type: "circle",
          center_lat: Number(center.lat),
          center_lng: Number(center.lng),
          radius_m: Number(radiusM),
          buffer_m: null,
          path_points: [],
        });
      }

      if (assetType === "depot" && geometryShape === "circle") {
        const d = (depots || []).find((x) => String(x.name || "").trim() === ref);
        try {
          await API.put(Endpoints.masters.depots.update(ref), {
            name: ref,
            code: (d?.code || "").trim(),
            address: (d?.address || "").trim(),
            active: d?.active !== false,
            lat: Number(center.lat),
            lng: Number(center.lng),
          });
        } catch (e) {
          toast.info("Boundary saved. Depot master location could not be updated.");
        }
      }

      toast.success("Boundary saved");
      setGeofenceSynced(true);
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const rebuildRoutePath = () => {
    if (!selectedRoute) return;
    const pts = pathPointsFromRouteAndStops(selectedRoute, stopById);
    setPathPoints(pts);
    if (pts.length) {
      const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
      const lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
      setCenter({ lat, lng });
    }
    if (pts.length < 2) toast.info("Not enough stops with coordinates on this route.");
    else toast.success("Path rebuilt from the route master");
  };

  const onAssetFilterChange = (v) => {
    setAssetType(v);
    setSelectedRef("");
    setPickSearch("");
    setPathPoints([]);
    setPolygonFence([]);
    setCenter(DEFAULT_MAP_CENTER);
    setGeometryShape("circle");
    setRouteClickAdd(false);
    setDrawTool("select");
    setRectStep(0);
    setRectA(null);
  };

  const mapCursorClass =
    assetType === "route" && (routeClickAdd || drawTool === "polyline")
      ? "cursor-crosshair"
      : assetType !== "route" && drawTool !== "select"
        ? "cursor-crosshair"
        : "";

  const by = summaryStats?.by_type || {};
  const typeChips = [
    { id: "stop", label: "Bus stops" },
    { id: "terminal", label: "Terminals" },
    { id: "depot", label: "Depots" },
    { id: "route", label: "Routes" },
  ];

  const pickerList = () => {
    const rowCls = (sel) =>
      `w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-colors ${
        sel ? "bg-[#C8102E]/10 border-[#C8102E]/30 shadow-sm" : "border-transparent hover:bg-gray-100"
      }`;

    if (assetType === "stop") {
      return filteredStops.map((s) => {
        const hasGps = s.lat != null && s.lng != null;
        const sel = selectedRef === s.stop_id;
        return (
          <button key={s.stop_id} type="button" className={rowCls(sel)} onClick={() => setSelectedRef(String(s.stop_id))}>
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-[#C8102E] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">{s.name || s.stop_id}</div>
                <div className="font-mono text-[10px] text-gray-500">{s.stop_id}</div>
                {sel ? (
                  <Badge variant={geofenceSynced ? "default" : "secondary"} className="mt-1 text-[9px] h-5 px-1.5">
                    {geofenceSynced ? "Synced" : "Pending"}
                  </Badge>
                ) : null}
                {!hasGps ? <span className="text-amber-700 text-[10px] block mt-0.5">No master GPS</span> : null}
              </div>
            </div>
          </button>
        );
      });
    }
    if (assetType === "terminal") {
      return filteredTerminals.map((t) => {
        const sel = selectedRef === t.terminal_id;
        return (
          <button key={t.terminal_id} type="button" className={rowCls(sel)} onClick={() => setSelectedRef(String(t.terminal_id))}>
            <div className="flex items-start gap-2">
              <Building2 className="w-3.5 h-3.5 text-[#C8102E] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">{t.name}</div>
                <div className="font-mono text-[10px] text-gray-500">{t.terminal_id}</div>
                {sel ? (
                  <Badge variant={geofenceSynced ? "default" : "secondary"} className="mt-1 text-[9px] h-5 px-1.5">
                    {geofenceSynced ? "Synced" : "Pending"}
                  </Badge>
                ) : null}
              </div>
            </div>
          </button>
        );
      });
    }
    if (assetType === "depot") {
      return filteredDepots.map((d) => {
        const sel = selectedRef === d.name;
        return (
          <button key={d.name} type="button" className={rowCls(sel)} onClick={() => setSelectedRef(String(d.name))}>
            <div className="flex items-start gap-2">
              <Building2 className="w-3.5 h-3.5 text-gray-700 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">{d.name}</div>
                {sel ? (
                  <Badge variant={geofenceSynced ? "default" : "secondary"} className="mt-1 text-[9px] h-5 px-1.5">
                    {geofenceSynced ? "Synced" : "Pending"}
                  </Badge>
                ) : null}
              </div>
            </div>
          </button>
        );
      });
    }
    return filteredRoutes.map((r) => {
      const sel = selectedRef === r.route_id;
      return (
        <button key={r.route_id} type="button" className={rowCls(sel)} onClick={() => setSelectedRef(String(r.route_id))}>
          <div className="flex items-start gap-2">
            <Bus className="w-3.5 h-3.5 text-[#C8102E] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900 truncate">{r.name}</div>
              <div className="font-mono text-[10px] text-gray-500">{r.route_id}</div>
              {sel ? (
                <Badge variant={geofenceSynced ? "default" : "secondary"} className="mt-1 text-[9px] h-5 px-1.5">
                  {geofenceSynced ? "Synced" : "Pending"}
                </Badge>
              ) : null}
            </div>
          </div>
        </button>
      );
    });
  };

  const toolBtn = (id, icon, title, active) => (
    <button
      type="button"
      title={title}
      onClick={() => {
        setDrawTool(id);
        if (id !== "rect") {
          setRectStep(0);
          setRectA(null);
        }
        if (assetType === "route") {
          if (id === "polyline") setRouteClickAdd(true);
          if (id === "select") setRouteClickAdd(false);
        }
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-md border text-gray-700 transition-colors ${
        active ? "border-[#C8102E] bg-[#C8102E] text-white shadow-sm" : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
    >
      {icon}
    </button>
  );

  const polygonPathClosed = useMemo(() => {
    if (polygonFence.length < 3) return [];
    return [...polygonFence, polygonFence[0]];
  }, [polygonFence]);

  return (
    <Card className="border-gray-200 shadow-md overflow-hidden" data-testid="geofence-map-console">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(260px,320px)] min-h-[min(640px,calc(100vh-220px))]">
          {/* LEFT — inventory */}
          <aside className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r border-gray-200 bg-slate-50/90">
            <div className="p-3 border-b border-gray-200/80 bg-white/80">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assets</h2>
              <Input
                className="h-9 mt-2 text-[12px]"
                value={pickSearch}
                onChange={(e) => setPickSearch(e.target.value)}
                placeholder="Search code or name…"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {typeChips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onAssetFilterChange(c.id)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors ${
                      assetType === c.id ? "bg-[#C8102E] text-white border-[#C8102E]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-600">
                <span>
                  Bus stops: <strong className="text-gray-900">{by.stop ?? "—"}</strong>
                </span>
                <span>
                  Terminals: <strong className="text-gray-900">{by.terminal ?? "—"}</strong>
                </span>
                <span>
                  Depots: <strong className="text-gray-900">{by.depot ?? "—"}</strong>
                </span>
                <span>
                  Routes: <strong className="text-gray-900">{by.route ?? "—"}</strong>
                </span>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 max-h-[min(420px,calc(100vh-300px))] border-t border-gray-200/80 bg-white/50"
              aria-label="Asset list"
            >
              {mastersLoading ? <p className="text-[11px] text-gray-500 p-2">Loading…</p> : pickerList()}
            </div>
          </aside>

          {/* CENTER — map */}
          <div className={`relative bg-gray-100 min-h-[360px] ${mapCursorClass}`}>
            {/* Vertical drawing toolbar */}
            <div className="absolute left-3 top-1/2 z-[5] -translate-y-1/2 flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg pointer-events-auto">
              {assetType === "route" ? (
                <>
                  {toolBtn("select", <MousePointer2 className="w-4 h-4" />, "Select / pan", drawTool === "select" && !routeClickAdd)}
                  {toolBtn("polyline", <Spline className="w-4 h-4" />, "Polyline corridor", drawTool === "polyline" || routeClickAdd)}
                </>
              ) : (
                <>
                  {toolBtn("select", <MousePointer2 className="w-4 h-4" />, "Select", drawTool === "select")}
                  {toolBtn("circle", <Circle className="w-4 h-4" />, "Circle", drawTool === "circle")}
                  {toolBtn("polygon", <Hexagon className="w-4 h-4" />, "Polygon", drawTool === "polygon")}
                  {toolBtn("rect", <Square className="w-4 h-4" />, "Rectangle", drawTool === "rect")}
                </>
              )}
            </div>

            {/* Instruction banner */}
            {instructionBanner ? (
              <div className="absolute top-3 left-1/2 z-[4] -translate-x-1/2 max-w-[90%] pointer-events-none">
                <div className="rounded-full border border-gray-200 bg-white/95 px-4 py-1.5 text-center text-[11px] text-gray-800 shadow-sm">
                  {instructionBanner}
                </div>
              </div>
            ) : null}

            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-[4] rounded-md border border-gray-200 bg-white/95 px-2 py-1.5 text-[9px] text-gray-600 shadow-sm max-w-[200px] pointer-events-none">
              <div className="font-semibold text-gray-700 mb-0.5">Legend</div>
              <div>● Bus stop / depot — circle or polygon</div>
              <div>● Route — red corridor polyline</div>
            </div>

            {/* Route quick actions */}
            {assetType === "route" ? (
              <div className="absolute top-14 right-3 z-[4] flex flex-wrap gap-1 justify-end">
                <Button type="button" variant={routeClickAdd ? "default" : "outline"} size="sm" className="h-8 text-[10px]" onClick={() => setRouteClickAdd((v) => !v)}>
                  <Crosshair className="w-3.5 h-3.5 mr-1" />
                  Add points
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" onClick={undoLastPathPoint} disabled={!pathPoints.length}>
                  <Minus className="w-3.5 h-3.5 mr-1" />
                  Undo
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" onClick={rebuildRoutePath} disabled={!selectedRoute}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Rebuild
                </Button>
              </div>
            ) : geometryShape === "polygon" && drawTool === "polygon" ? (
              <div className="absolute top-14 right-3 z-[4] flex gap-1">
                <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" onClick={undoLastPolygonVertex} disabled={!polygonFence.length}>
                  Undo corner
                </Button>
                <Button type="button" size="sm" className="h-8 text-[10px] bg-[#C8102E] hover:bg-[#A50E25]" onClick={closePolygonDraft} disabled={polygonFence.length < 3}>
                  Close shape
                </Button>
              </div>
            ) : null}

            {!mapsLoaded ? (
              <div className="h-full min-h-[360px] w-full grid place-items-center text-sm text-gray-500">Loading map…</div>
            ) : mapsLoadError ? (
              <div className="h-full min-h-[360px] w-full grid place-items-center text-sm text-red-600 px-4 text-center">Map could not be loaded. Set REACT_APP_GOOGLE_MAPS_API_KEY.</div>
            ) : (
              <GoogleMap
                mapContainerStyle={{ height: "100%", minHeight: 420, width: "100%" }}
                center={center}
                zoom={13}
                onLoad={(m) => setMapRef(m)}
                onClick={handleMapClick}
                options={{
                  streetViewControl: false,
                  mapTypeControl: false,
                  fullscreenControl: true,
                  clickableIcons: false,
                }}
              >
                {assetType !== "route" && geometryShape === "circle" ? (
                  <>
                    <MarkerF
                      position={center}
                      draggable={drawTool !== "select"}
                      onDragEnd={(ev) => {
                        const ll = ev.latLng;
                        if (!ll) return;
                        setCenter({ lat: ll.lat(), lng: ll.lng() });
                      }}
                    />
                    <CircleF
                      center={center}
                      radius={radiusM}
                      options={{
                        strokeColor: "#C8102E",
                        strokeOpacity: 0.95,
                        strokeWeight: 2,
                        fillColor: "#C8102E",
                        fillOpacity: 0.14,
                      }}
                    />
                  </>
                ) : null}

                {assetType !== "route" && geometryShape === "polygon" && polygonPathClosed.length >= 4 ? (
                  <PolygonF
                    paths={polygonPathClosed}
                    options={{
                      strokeColor: "#C8102E",
                      strokeOpacity: 0.95,
                      strokeWeight: 2,
                      fillColor: "#C8102E",
                      fillOpacity: 0.12,
                    }}
                  />
                ) : null}

                {assetType !== "route" &&
                  geometryShape === "polygon" &&
                  polygonFence.map((p, i) => (
                    <MarkerF
                      key={`poly-v-${i}`}
                      position={p}
                      draggable
                      label={{ text: String(i + 1), color: "#fff", fontSize: "10px" }}
                      onDragEnd={(ev) => {
                        const ll = ev.latLng;
                        if (!ll) return;
                        setPolygonFence((prev) => {
                          const n = [...prev];
                          n[i] = { lat: ll.lat(), lng: ll.lng() };
                          return n;
                        });
                      }}
                    />
                  ))}

                {assetType === "route" && pathPoints.length >= 2 ? (
                  <PolylineF
                    path={pathPoints}
                    options={{
                      strokeColor: "#C8102E",
                      strokeOpacity: 0.95,
                      strokeWeight: 4,
                    }}
                  />
                ) : null}

                {assetType === "route" &&
                  pathPoints.map((p, i) => (
                    <MarkerF
                      key={`path-${selectedRef}-${i}`}
                      position={p}
                      draggable
                      label={{ text: String(i + 1), color: "#ffffff", fontSize: "11px", fontWeight: "600" }}
                      onDragEnd={(ev) => {
                        const ll = ev.latLng;
                        if (!ll) return;
                        setPathPoints((prev) => {
                          const n = [...prev];
                          n[i] = { lat: ll.lat(), lng: ll.lng() };
                          return n;
                        });
                      }}
                      options={{ zIndex: 900 + i }}
                    />
                  ))}
              </GoogleMap>
            )}
          </div>

          {/* RIGHT — identity & geometry */}
          <aside className="border-t lg:border-t-0 lg:border-l border-gray-200 bg-white flex flex-col overflow-y-auto">
            <div className="p-4 space-y-4 flex-1">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Identity</h3>
                <div className="mt-2 space-y-2">
                  <div>
                    <Label className="text-[10px] text-gray-500">Name</Label>
                    <Input className="h-8 mt-0.5 bg-gray-50" readOnly value={selectedLabel.name} />
                  </div>
                  <div>
                    <Label className="text-[10px] text-gray-500">Code</Label>
                    <Input className="h-8 mt-0.5 font-mono text-[11px] bg-gray-50" readOnly value={selectedLabel.code} />
                  </div>
                  <div>
                    <Label className="text-[10px] text-gray-500">Asset type</Label>
                    <Input className="h-8 mt-0.5 bg-gray-50" readOnly value={ASSET_TYPE_LABEL[assetType] || assetType} />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Geometry</h3>
                {assetType === "route" ? (
                  <div className="mt-2 space-y-3">
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>Corridor width (m)</span>
                        <span className="font-mono text-gray-800">{bufferM}</span>
                      </div>
                      <input
                        type="range"
                        min={BUFFER_MIN}
                        max={BUFFER_MAX}
                        value={clamp(bufferM, BUFFER_MIN, BUFFER_MAX)}
                        onChange={(e) => setBufferSafe(Number(e.target.value))}
                        className="w-full mt-1 accent-[#C8102E]"
                      />
                      <Input type="number" className="h-8 mt-1" min={BUFFER_MIN} max={BUFFER_MAX} value={bufferM} onChange={(e) => setBufferSafe(e.target.value)} />
                    </div>
                    <p className="text-[10px] text-gray-500">Draw the path on the map with the polyline tool, or Rebuild from the route master.</p>
                  </div>
                ) : geometryShape === "polygon" ? (
                  <p className="mt-2 text-[11px] text-gray-600">Area polygon — {polygonFence.length} corners. Use map tools to edit vertices.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] text-gray-500">Latitude</Label>
                        <Input
                          className="h-8 mt-0.5 font-mono text-[11px]"
                          value={center.lat != null ? String(Number(center.lat).toFixed(6)) : ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) setCenter((c) => ({ ...c, lat: v }));
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-gray-500">Longitude</Label>
                        <Input
                          className="h-8 mt-0.5 font-mono text-[11px]"
                          value={center.lng != null ? String(Number(center.lng).toFixed(6)) : ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) setCenter((c) => ({ ...c, lng: v }));
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>Radius (m)</span>
                        <span className="font-mono text-gray-800">{radiusM}</span>
                      </div>
                      <input
                        type="range"
                        min={RADIUS_MIN}
                        max={RADIUS_MAX}
                        value={clamp(radiusM, RADIUS_MIN, RADIUS_MAX)}
                        onChange={(e) => setRadiusSafe(Number(e.target.value))}
                        className="w-full mt-1 accent-[#C8102E]"
                      />
                      <Input type="number" className="h-8 mt-1" min={RADIUS_MIN} max={RADIUS_MAX} value={radiusM} onChange={(e) => setRadiusSafe(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Buffer &amp; status</h3>
                <p className="text-[10px] text-gray-500 mt-1">Speed and approach behaviour use values in Business rules for this boundary type.</p>
                <div className="flex items-center gap-2 mt-3">
                  <Switch checked={active} onCheckedChange={setActive} id="gf-active" />
                  <Label htmlFor="gf-active" className="text-[11px] cursor-pointer">
                    Active
                  </Label>
                </div>
                <div className="mt-2">
                  <Label className="text-[10px] text-gray-500">Notes</Label>
                  <Input className="h-8 mt-0.5" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>
              </div>
            </div>

            <div className="p-4 pt-0 border-t border-gray-100 mt-auto">
              <Button
                type="button"
                className="w-full bg-[#C8102E] hover:bg-[#A50E25]"
                disabled={saving || !selectedRef || loadingDoc || mastersLoading}
                onClick={handleSave}
                data-testid="geofence-console-save"
              >
                {loadingDoc ? "Loading…" : saving ? "Saving…" : "Save boundary"}
              </Button>
            </div>
          </aside>
        </div>
      </CardContent>
    </Card>
  );
}
