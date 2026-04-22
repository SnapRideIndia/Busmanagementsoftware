"""Decode Google-encoded polylines for live map / telemetry (tolerates truncated tails)."""

from __future__ import annotations


def decode_google_polyline(encoded: str) -> list[dict[str, float]]:
    """Return lat/lng dicts, or empty. Truncated trailing chunks are dropped."""
    s = (encoded or "").strip()
    if s.startswith("{"):
        s = s[1:]
    if s.endswith("}"):
        s = s[:-1]
    s = s.strip()
    if not s:
        return []
    for drop in range(0, min(32, len(s) + 1)):
        try:
            return _decode_exact(s[: len(s) - drop])
        except IndexError:
            continue
    return []


def _decode_exact(s: str) -> list[dict[str, float]]:
    idx = 0
    lat_i = 0
    lng_i = 0
    out: list[dict[str, float]] = []
    while idx < len(s):
        shift = 0
        result = 0
        while True:
            b = ord(s[idx]) - 63
            idx += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat_i += dlat
        shift = 0
        result = 0
        while True:
            b = ord(s[idx]) - 63
            idx += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng_i += dlng
        out.append({"lat": lat_i * 1e-5, "lng": lng_i * 1e-5})
    return out


def polyline_plausible_telangana(pts: list[dict[str, float]], sample: int = 24) -> bool:
    """Rough bounds for Telangana demo data (reject clearly broken decodes)."""
    if len(pts) < 2:
        return False
    chunk = pts[:sample]
    for p in chunk:
        la = float(p.get("lat") or 0.0)
        ln = float(p.get("lng") or 0.0)
        if not (15.0 <= la <= 20.5 and 77.0 <= ln <= 81.5):
            return False
    return True
