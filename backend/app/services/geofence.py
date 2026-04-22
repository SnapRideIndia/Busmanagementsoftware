"""Geofence helpers and lightweight runtime evaluator."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import asin, atan2, cos, radians, sin, sqrt
from typing import Any


EARTH_RADIUS_M = 6371000.0


@dataclass
class GeofenceHit:
    geofence_id: str
    event_type: str
    distance_m: float | None = None
    threshold_m: float | None = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two WGS84 coordinates in meters."""
    p1 = radians(lat1)
    p2 = radians(lat2)
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(p1) * cos(p2) * sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(max(0.0, min(1.0, a))))


def _to_local_xy_m(lat: float, lng: float, ref_lat: float, ref_lng: float) -> tuple[float, float]:
    """Approximate local tangent plane coordinates in meters near `ref`."""
    lat_m = 111320.0
    lng_m = 111320.0 * cos(radians(ref_lat))
    return (lng - ref_lng) * lng_m, (lat - ref_lat) * lat_m


def point_in_polygon(lat: float, lng: float, polygon_points: list[dict[str, float]]) -> bool:
    """Ray casting algorithm; polygon points format: [{lat, lng}, ...]."""
    if len(polygon_points) < 3:
        return False
    inside = False
    j = len(polygon_points) - 1
    for i, p in enumerate(polygon_points):
        pi_lat = float(p.get("lat", 0.0))
        pi_lng = float(p.get("lng", 0.0))
        pj_lat = float(polygon_points[j].get("lat", 0.0))
        pj_lng = float(polygon_points[j].get("lng", 0.0))
        intersects = ((pi_lat > lat) != (pj_lat > lat)) and (
            lng < (pj_lng - pi_lng) * (lat - pi_lat) / ((pj_lat - pi_lat) or 1e-12) + pi_lng
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_to_polyline_distance_m(lat: float, lng: float, path_points: list[dict[str, float]]) -> float | None:
    """Shortest distance from point to polyline (meters), using local projection."""
    if len(path_points) < 2:
        return None
    ref_lat, ref_lng = lat, lng
    px, py = _to_local_xy_m(lat, lng, ref_lat, ref_lng)
    best = None
    for i in range(len(path_points) - 1):
        a = path_points[i]
        b = path_points[i + 1]
        ax, ay = _to_local_xy_m(float(a.get("lat", 0.0)), float(a.get("lng", 0.0)), ref_lat, ref_lng)
        bx, by = _to_local_xy_m(float(b.get("lat", 0.0)), float(b.get("lng", 0.0)), ref_lat, ref_lng)
        vx, vy = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        vv = vx * vx + vy * vy
        if vv <= 1e-9:
            d = sqrt((px - ax) ** 2 + (py - ay) ** 2)
        else:
            t = max(0.0, min(1.0, (wx * vx + wy * vy) / vv))
            proj_x = ax + t * vx
            proj_y = ay + t * vy
            d = sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)
        if best is None or d < best:
            best = d
    return best


def evaluate_point_inside(
    gf: dict[str, Any],
    lat: float,
    lng: float,
    *,
    fallback_radius_m: float = 0.0,
) -> tuple[bool, float | None]:
    """Return (inside, distance_m_or_none). For route fences: inside means within buffer."""
    geom = str(gf.get("geometry_type") or "circle").strip().lower()
    if geom == "circle":
        c_lat = gf.get("center_lat")
        c_lng = gf.get("center_lng")
        if c_lat is None or c_lng is None:
            return False, None
        d = haversine_m(float(lat), float(lng), float(c_lat), float(c_lng))
        r = float(gf.get("radius_m") or fallback_radius_m or 0.0)
        return d <= r if r > 0 else False, d
    if geom == "polygon":
        points = gf.get("path_points") or []
        return point_in_polygon(float(lat), float(lng), points), None
    if geom == "polyline_buffer":
        points = gf.get("path_points") or []
        dist = point_to_polyline_distance_m(float(lat), float(lng), points)
        buf = float(gf.get("buffer_m") or fallback_radius_m or 0.0)
        return (dist is not None and dist <= buf), dist
    return False, None


def bearing_degrees(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing from point 1 to point 2."""
    p1 = radians(lat1)
    p2 = radians(lat2)
    dlng = radians(lng2 - lng1)
    y = sin(dlng) * cos(p2)
    x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dlng)
    brg = atan2(y, x)
    deg = (brg * 180.0 / 3.141592653589793) % 360.0
    return deg
