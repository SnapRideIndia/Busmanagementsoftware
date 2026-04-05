"""
Punctuality vs planned (deployment) times — concessionaire-supplied trip rows.

Aligns with typical GCC / operator contract logic (e.g. start relaxation in minutes,
arrival relaxation as % of scheduled trip time with a cap). Business rules keys:
  - punctuality_start_relax_min (default 5)
  - punctuality_arrival_relax_pct (default 10)
  - punctuality_arrival_relax_max_min (default 15)

Trip documents may provide either pre-computed flags or times for EBMS to evaluate.

Optional fields on each trip (``trip_data``):
  - punctuality_start_on_time: bool
  - punctuality_arrival_on_time: bool
  OR
  - plan_start_time, actual_start_time: "HH:MM" (service day, same calendar date as ``date``)
  - planned_trip_duration_min: int (minutes) — scheduled trip time for arrival window
  - plan_end_time: "HH:MM" optional; if set without duration, duration = plan_end - plan_start
  - actual_end_time: "HH:MM" — actual arrival at last stop

If no trip has punctuality data, callers should fall back to a synthetic estimate.
"""

from __future__ import annotations

from typing import Any


def parse_hhmm_to_minutes(value: str | None) -> int | None:
    """Parse 'HH:MM' or 'H:MM' to minutes from midnight; same service day only."""
    if value is None or not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    parts = s.split(":")
    if len(parts) != 2:
        return None
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if h < 0 or h > 30 or m < 0 or m > 59:
        return None
    return h * 60 + m


def _arrival_slack_min(planned_duration_min: int, rules: dict[str, str]) -> int:
    pct = float(rules.get("punctuality_arrival_relax_pct", "10"))
    cap = float(rules.get("punctuality_arrival_relax_max_min", "15"))
    return int(min(cap, (pct / 100.0) * max(0, planned_duration_min)))


def evaluate_trip_punctuality(trip: dict[str, Any], rules: dict[str, str]) -> tuple[bool | None, bool | None]:
    """
    Returns (start_on_time, arrival_on_time). None means missing data for that leg.
    """
    fs = trip.get("punctuality_start_on_time")
    fa = trip.get("punctuality_arrival_on_time")
    if isinstance(fs, bool) and isinstance(fa, bool):
        return fs, fa

    plan_start = parse_hhmm_to_minutes(trip.get("plan_start_time"))
    actual_start = parse_hhmm_to_minutes(trip.get("actual_start_time"))
    start_ok: bool | None = None
    if plan_start is not None and actual_start is not None:
        relax_s = int(float(rules.get("punctuality_start_relax_min", "5")))
        start_ok = actual_start <= plan_start + relax_s

    duration: int | None = None
    raw_dur = trip.get("planned_trip_duration_min")
    if raw_dur is not None:
        try:
            duration = int(raw_dur)
        except (TypeError, ValueError):
            duration = None
    if duration is None and plan_start is not None:
        plan_end = parse_hhmm_to_minutes(trip.get("plan_end_time"))
        if plan_end is not None and plan_end >= plan_start:
            duration = plan_end - plan_start

    actual_end = parse_hhmm_to_minutes(trip.get("actual_end_time"))
    arrival_ok: bool | None = None
    if plan_start is not None and duration is not None and duration > 0 and actual_end is not None:
        scheduled_arrival = plan_start + duration
        if scheduled_arrival < 24 * 60 and actual_end < 24 * 60 * 2:
            slack = _arrival_slack_min(duration, rules)
            arrival_ok = actual_end <= scheduled_arrival + slack

    return start_ok, arrival_ok


def punctuality_percentages_from_trips(
    trips: list[dict[str, Any]],
    rules: dict[str, str],
) -> tuple[float | None, float | None, dict[str, Any]]:
    """
    Aggregate start % and arrival % over trips with usable data.
    Returns (start_pct, arrival_pct, meta). Percentages are None if no trips contributed.
    """
    start_hits = 0
    start_n = 0
    arr_hits = 0
    arr_n = 0
    for t in trips:
        s_ok, a_ok = evaluate_trip_punctuality(t, rules)
        if s_ok is not None:
            start_n += 1
            if s_ok:
                start_hits += 1
        if a_ok is not None:
            arr_n += 1
            if a_ok:
                arr_hits += 1

    meta: dict[str, Any] = {
        "source": "concessionaire",
        "trips_start_measured": start_n,
        "trips_arrival_measured": arr_n,
    }
    if start_n == 0 and arr_n == 0:
        return None, None, {**meta, "source": "none"}

    start_pct = (start_hits / start_n * 100) if start_n else None
    arr_pct = (arr_hits / arr_n * 100) if arr_n else None
    return start_pct, arr_pct, meta
