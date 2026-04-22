"""Static route geometry: {lat,lng}[] per route_id from app/core/data/route_path_points.json."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_DATA = Path(__file__).resolve().parent / "data" / "route_path_points.json"


@lru_cache(maxsize=1)
def load_route_path_points() -> dict[str, list[dict[str, float]]]:
    if not _DATA.is_file():
        return {}
    try:
        raw = json.loads(_DATA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("route_path_points: could not read %s: %s", _DATA, e)
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[dict[str, float]]] = {}
    for k, v in raw.items():
        rid = str(k or "").strip()
        if not rid.startswith("RT-"):
            continue
        if not isinstance(v, list):
            continue
        pts: list[dict[str, float]] = []
        for p in v:
            if not isinstance(p, dict):
                continue
            try:
                la = float(p.get("lat"))
                ln = float(p.get("lng"))
            except (TypeError, ValueError):
                continue
            pts.append({"lat": la, "lng": ln})
        out[rid] = pts
    return out


def reload_route_path_points() -> dict[str, list[dict[str, float]]]:
    load_route_path_points.cache_clear()
    return load_route_path_points()
