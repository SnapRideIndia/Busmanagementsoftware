/** Default map focus (Hyderabad) — aligned with backend seed helpers. */
export const DEFAULT_MAP_CENTER = { lat: 17.385, lng: 78.4867 };

/** Deterministic IDs matching POST /geofences/bootstrap in the API. */
export function geofenceIdFor(type, entityRef) {
  const r = String(entityRef || "").trim();
  if (!r) return "";
  switch (type) {
    case "stop":
      return `STOP-${r}`;
    case "terminal":
      return `TERM-${r}`;
    case "depot":
      return `DEPOT-${r}`;
    case "route":
      return `ROUTE-${r}`;
    default:
      return "";
  }
}

function sortSeq(a, b) {
  return (Number(a.seq) || 0) - (Number(b.seq) || 0);
}

/**
 * Build path_points for route geofence from route master + stop_master lookup (same logic as backend bootstrap).
 * @param {object} route - row from /bus-routes or /route-master
 * @param {Map<string, object>} stopById - stop_id -> { lat, lng }
 * @returns {Array<{lat: number, lng: number}>}
 */
export function pathPointsFromRouteAndStops(route, stopById) {
  const seq = Array.isArray(route?.stop_sequence) ? [...route.stop_sequence].sort(sortSeq) : [];
  const points = [];
  for (const item of seq) {
    const sid = String(item?.stop_id || "").trim();
    if (!sid) continue;
    const s = stopById.get(sid);
    if (s && s.lat != null && s.lng != null) {
      points.push({ lat: Number(s.lat), lng: Number(s.lng) });
    }
  }
  if (points.length >= 2) return points;
  const stops = Array.isArray(route?.stops) ? [...route.stops].sort(sortSeq) : [];
  for (const s of stops) {
    const sid = String(s?.stop_id || "").trim();
    const row = sid ? stopById.get(sid) : null;
    const lat = row?.lat ?? s?.lat;
    const lng = row?.lng ?? s?.lng;
    if (lat != null && lng != null) {
      points.push({ lat: Number(lat), lng: Number(lng) });
    }
  }
  return points;
}

/**
 * Terminal center: optional lat/lng on terminal, else first linked stop with coordinates.
 */
export function terminalCenterFromMaster(terminal, stopById) {
  const lat = terminal?.lat;
  const lng = terminal?.lng;
  if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return { lat: Number(lat), lng: Number(lng) };
  }
  for (const sid of terminal?.linked_stop_ids || []) {
    const s = stopById.get(String(sid).trim());
    if (s && s.lat != null && s.lng != null) {
      return { lat: Number(s.lat), lng: Number(s.lng) };
    }
  }
  return null;
}

export function parseRuleFloat(rulesMap, key, fallback) {
  const raw = rulesMap?.[key];
  if (raw === undefined || raw === null) return fallback;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : fallback;
}
