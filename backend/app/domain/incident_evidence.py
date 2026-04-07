"""PM / Schedule evidence helpers for IRMS incidents (occurrence time normalization)."""

from __future__ import annotations

from datetime import datetime, timezone


def normalize_occurred_at_iso(raw: str) -> str:
    """
    Parse user/frontend ISO or date-only string; return UTC ISO 8601 for storage.
    Date-only YYYY-MM-DD is interpreted as start of that day in UTC.
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("occurred_at is required")
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        s = f"{s}T00:00:00+00:00"
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError as e:
        raise ValueError("occurred_at must be a valid ISO 8601 date or datetime") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def occurred_at_range_mongo_filter(occurred_from: str, occurred_to: str) -> dict | None:
    """
    Build Mongo filter on occurred_at (only rows with a stored occurrence time).
    occurred_from / occurred_to are date (YYYY-MM-DD) or full ISO strings.
    """
    raw_from = (occurred_from or "").strip()
    raw_to = (occurred_to or "").strip()
    if not raw_from and not raw_to:
        return None
    flt: dict = {"$exists": True, "$nin": [None, ""]}
    if raw_from:
        flt["$gte"] = normalize_occurred_at_iso(raw_from[:10] if len(raw_from) == 10 else raw_from)
    if raw_to:
        d = datetime.strptime(raw_to[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        d = d.replace(hour=23, minute=59, second=59, microsecond=999999)
        flt["$lte"] = d.isoformat()
    return flt
