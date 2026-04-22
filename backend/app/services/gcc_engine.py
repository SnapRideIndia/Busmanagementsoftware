"""GCC-style KPI damage / incentive calculator (Article 20 aligned)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.domain.incident_types import is_breakdown_for_reliability, safety_kpi_counts
from app.services.punctuality import parse_hhmm_to_minutes, punctuality_percentages_from_trips


def _as_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _parse_ymd(s: str | None) -> date | None:
    raw = str(s or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _first_30_day_active(rules: dict[str, str], *, period_start: str = "", period_end: str = "") -> bool:
    # Explicit toggle wins when provided.
    force = str(rules.get("first_30_day_active", "")).strip().lower()
    if force in {"1", "true", "yes", "on"}:
        return True
    if force in {"0", "false", "no", "off"}:
        return False

    lot_cod = _parse_ymd(rules.get("lot_cod_date", ""))
    if lot_cod is None:
        return False
    p_start = _parse_ymd(period_start)
    p_end = _parse_ymd(period_end)
    if p_start is None and p_end is None:
        return False
    window_end = lot_cod + timedelta(days=29)
    check_start = p_start or p_end
    check_end = p_end or p_start
    return bool(check_start and check_end and check_start <= window_end and check_end >= lot_cod)


def _apply_relax_to_target(target: float, relax_pct: float, *, lower_is_better: bool) -> float:
    if relax_pct <= 0:
        return target
    factor = relax_pct / 100.0
    if lower_is_better:
        return target * (1.0 + factor)
    return target * (1.0 - factor)


def _trip_speed_kmh(trip: dict[str, Any]) -> float | None:
    direct = _as_float(trip.get("avg_speed"), -1.0)
    if direct > 0:
        return direct
    km = _as_float(trip.get("actual_km"), 0.0)
    st = parse_hhmm_to_minutes(trip.get("actual_start_time"))
    et = parse_hhmm_to_minutes(trip.get("actual_end_time"))
    if km <= 0 or st is None or et is None:
        return None
    duration_min = et - st
    if duration_min <= 0:
        duration_min += 24 * 60
    if duration_min <= 0:
        return None
    return km / (duration_min / 60.0)


def _is_fire_serious_incident(incident: dict[str, Any]) -> bool:
    it = str(incident.get("incident_type", "") or "").strip().upper()
    if it == "FIRE_ON_BUS":
        return True
    if any(str(i.get("infraction_code", "")).strip().upper() == "F01" for i in (incident.get("infractions") or [])):
        return True
    d = str(incident.get("description", "") or "").lower()
    return "fire" in d or "thermal" in d


def compute_kpi_damages(
    monthly_fee: float,
    trips: list[dict[str, Any]],
    buses: list[dict[str, Any]],
    incidents_list: list[dict[str, Any]],
    bus_km: float,
    rules: dict[str, str],
    duty_assignments: list[dict[str, Any]] | None = None,
    *,
    period_start: str = "",
    period_end: str = "",
) -> dict[str, Any]:
    """Return KPI category breakdown, raw/capped damages and incentives."""
    results: dict[str, Any] = {}

    relax_pct = _as_float(rules.get("first_30_day_kpi_relaxation_pct", "0"), 0.0)
    first30 = _first_30_day_active(rules, period_start=period_start, period_end=period_end)

    # 1) Reliability
    breakdowns = sum(1 for i in incidents_list if is_breakdown_for_reliability(i))
    bf = (breakdowns * 10000) / bus_km if bus_km > 0 else 0.0
    bf_target_base = _as_float(rules.get("reliability_target", "0.5"), 0.5)
    bf_target = _apply_relax_to_target(bf_target_base, relax_pct, lower_is_better=True) if first30 else bf_target_base
    rel_dam = 0.0
    rel_inc = 0.0
    if bf > bf_target:
        steps = max(0, int((bf - bf_target) / 0.1))
        rel_dam = steps * 0.001 * monthly_fee
    elif bf < bf_target:
        steps = max(0, int((bf_target - bf) / 0.1))
        rel_inc = steps * 0.0005 * monthly_fee
    results["reliability"] = {
        "bf": round(bf, 4),
        "target": round(bf_target, 4),
        "target_base": round(bf_target_base, 4),
        "breakdowns": breakdowns,
        "bus_km": round(bus_km, 2),
        "damages": round(rel_dam, 2),
        "incentive": round(rel_inc, 2),
    }

    # 2) Availability (shift-turnout semantics proxy)
    total_buses_in_scope = len(buses)
    by_duty_date = {
        (str(t.get("duty_id", "") or ""), str(t.get("date", "") or "")): t
        for t in trips
        if (t.get("duty_id") or t.get("date"))
    }
    duties = duty_assignments or []
    expected_shift_turnouts = 0
    available_shift_turnouts = 0
    excluded_shift_turnouts = 0
    for drow in duties:
        ddate = str(drow.get("date", "") or "")
        duty_id = str(drow.get("duty_id", "") or "")
        bid = str(drow.get("bus_id", "") or "")
        if not ddate:
            continue
        if bid and buses and bid not in {str(b.get("bus_id", "")) for b in buses}:
            continue
        expected_shift_turnouts += 1
        attribution = str(drow.get("attribution_context", "") or "").lower()
        # 17.12-like non-attributable exclusions (treated available).
        if attribution in {"external", "force_majeure", "authority", "riot", "natural_disaster", "vandalism", "traffic_jam"}:
            available_shift_turnouts += 1
            excluded_shift_turnouts += 1
            continue
        trip = by_duty_date.get((duty_id, ddate))
        if trip and _as_float(trip.get("actual_km", 0), 0.0) > 0:
            available_shift_turnouts += 1
            continue
        # Fallback: if duty status is completed/assigned with real start timestamp, treat as available.
        if str(drow.get("status", "") or "").lower() in {"completed", "assigned"} and str(drow.get("punctuality_actual_departure", "") or "").strip():
            available_shift_turnouts += 1
            continue

    if expected_shift_turnouts == 0:
        # Last resort if no duty data: bus-day proxy from trip_data.
        all_dates = sorted(set(str(t.get("date", "")) for t in trips if t.get("date")))
        expected_shift_turnouts = total_buses_in_scope * max(len(all_dates), 1)
        available_shift_turnouts = sum(
            len({str(t.get("bus_id", "")) for t in trips if str(t.get("date", "")) == d and _as_float(t.get("actual_km", 0), 0.0) > 0})
            for d in all_dates
        )
    avail_pct = (available_shift_turnouts / expected_shift_turnouts * 100) if expected_shift_turnouts > 0 else 100.0
    avail_target_base = _as_float(rules.get("availability_target", "95"), 95.0)
    avail_target = _apply_relax_to_target(avail_target_base, relax_pct, lower_is_better=False) if first30 else avail_target_base
    if str(rules.get("availability_refurbishment_relax_active", "0")).strip().lower() in {"1", "true", "yes", "on"}:
        refurb_relax = _as_float(rules.get("availability_refurbishment_relax_pct", "5"), 5.0)
        avail_target = _apply_relax_to_target(avail_target, refurb_relax, lower_is_better=False)
    pk_rate = _as_float(rules.get("avg_pk_rate", "85"), 85.0)
    avail_dam = 0.0
    if avail_pct < avail_target:
        missed_bus_days = max(0, expected_shift_turnouts - available_shift_turnouts)
        if avail_pct >= 90:
            avail_dam = missed_bus_days * 50 * pk_rate
        elif avail_pct >= 85:
            avail_dam = missed_bus_days * 60 * pk_rate
        else:
            avail_dam = missed_bus_days * 70 * pk_rate
    results["availability"] = {
        "pct": round(avail_pct, 1),
        "target": round(avail_target, 2),
        "target_base": round(avail_target_base, 2),
        "shift_turnouts_expected": expected_shift_turnouts,
        "shift_turnouts_available": available_shift_turnouts,
        "shift_turnouts_excluded_1712": excluded_shift_turnouts,
        "method": "shift_turnout_proxy",
        "damages": round(avail_dam, 2),
        "incentive": 0.0,
    }

    # 3) Punctuality
    sp_data, ap_data, p_meta = punctuality_percentages_from_trips(trips, rules)
    start_pct = sp_data if sp_data is not None else 100.0
    arrival_pct = ap_data if ap_data is not None else 100.0
    start_target_base = _as_float(rules.get("punctuality_start_target", "90"), 90.0)
    arrival_target_base = _as_float(rules.get("punctuality_arrival_target", "80"), 80.0)
    start_target = _apply_relax_to_target(start_target_base, relax_pct, lower_is_better=False) if first30 else start_target_base
    arrival_target = _apply_relax_to_target(arrival_target_base, relax_pct, lower_is_better=False) if first30 else arrival_target_base

    start_shortfall = max(0.0, start_target - start_pct)
    arrival_shortfall = max(0.0, arrival_target - arrival_pct)
    punct_dam = (start_shortfall * 0.01 * monthly_fee) + (max(0.0, arrival_shortfall - start_shortfall) * 0.01 * monthly_fee)

    # Incentive: compute independently for each KPI above target (0.05% per +1%).
    start_excess = max(0.0, start_pct - start_target)
    arrival_excess = max(0.0, arrival_pct - arrival_target)
    punct_inc = ((start_excess + arrival_excess) * 0.0005 * monthly_fee)

    results["punctuality"] = {
        "start_pct": round(start_pct, 1),
        "arrival_pct": round(arrival_pct, 1),
        "start_target_pct": round(start_target, 1),
        "arrival_target_pct": round(arrival_target, 1),
        "start_target_pct_base": round(start_target_base, 1),
        "arrival_target_pct_base": round(arrival_target_base, 1),
        "trips_start_measured": int(p_meta.get("trips_start_measured", 0)),
        "trips_arrival_measured": int(p_meta.get("trips_arrival_measured", 0)),
        "total_trips": len(trips),
        "damages": round(punct_dam, 2),
        "incentive": round(punct_inc, 2),
        "meta": p_meta,
        "data_source": p_meta.get("source", "none"),
    }

    # 4) Frequency (Trip Frequency + Bus-km Frequency)
    scheduled_trips = 0
    completed_trips = 0
    scheduled_km_total = 0.0
    actual_km_total = 0.0
    completed_trip_threshold_pct = _as_float(rules.get("frequency_completed_trip_threshold_pct", "100"), 100.0)
    completed_trip_threshold_pct = max(0.0, min(100.0, completed_trip_threshold_pct))
    completed_trip_factor = completed_trip_threshold_pct / 100.0
    for t in trips:
        sched = _as_float(t.get("scheduled_km", 0), 0.0)
        actual = _as_float(t.get("actual_km", 0), 0.0)
        explicit_completed = str(t.get("trip_status", "") or "").strip().lower() == "completed"
        if sched > 0:
            scheduled_trips += 1
            scheduled_km_total += sched
            actual_km_total += max(0.0, actual)
            # Default strict completion is 100% scheduled km unless business rule overrides.
            if explicit_completed or actual >= sched * completed_trip_factor:
                completed_trips += 1
        elif actual > 0:
            scheduled_trips += 1
            completed_trips += 1
            actual_km_total += actual

    trip_freq = (completed_trips / scheduled_trips * 100.0) if scheduled_trips > 0 else 100.0
    bus_km_freq = (actual_km_total / scheduled_km_total * 100.0) if scheduled_km_total > 0 else 100.0

    trip_freq_target_base = _as_float(rules.get("frequency_trip_target", rules.get("frequency_target", "94")), 94.0)
    bus_km_freq_target_base = _as_float(rules.get("frequency_bus_km_target", rules.get("frequency_target", "94")), 94.0)
    trip_freq_target = _apply_relax_to_target(trip_freq_target_base, relax_pct, lower_is_better=False) if first30 else trip_freq_target_base
    bus_km_freq_target = _apply_relax_to_target(bus_km_freq_target_base, relax_pct, lower_is_better=False) if first30 else bus_km_freq_target_base

    trip_short = max(0.0, trip_freq_target - trip_freq)
    km_short = max(0.0, bus_km_freq_target - bus_km_freq)
    # Anti-double-count: apply trip shortfall + extra km shortfall beyond trip shortfall.
    freq_dam = (trip_short * 0.01 * monthly_fee) + (max(0.0, km_short - trip_short) * 0.01 * monthly_fee)

    trip_excess = max(0.0, trip_freq - trip_freq_target)
    km_excess = max(0.0, bus_km_freq - bus_km_freq_target)
    freq_inc = (trip_excess + km_excess) * 0.0005 * monthly_fee

    results["frequency"] = {
        "trip_freq_pct": round(trip_freq, 1),
        "trip_target": round(trip_freq_target, 1),
        "trip_target_base": round(trip_freq_target_base, 1),
        "bus_km_freq_pct": round(bus_km_freq, 1),
        "bus_km_target": round(bus_km_freq_target, 1),
        "bus_km_target_base": round(bus_km_freq_target_base, 1),
        # Backward compatibility for UI/report code expecting `target`.
        "target": round(trip_freq_target, 1),
        "scheduled_trips": scheduled_trips,
        "completed_trips": completed_trips,
        "incomplete_trips": max(0, scheduled_trips - completed_trips),
        "completed_trip_threshold_pct": round(completed_trip_threshold_pct, 2),
        "scheduled_km": round(scheduled_km_total, 2),
        "actual_km": round(actual_km_total, 2),
        "damages": round(freq_dam, 2),
        "incentive": round(freq_inc, 2),
    }

    # 4b) Trip speed KPI
    speed_rows = [s for s in (_trip_speed_kmh(t) for t in trips) if s is not None and s > 0]
    avg_speed = (sum(speed_rows) / len(speed_rows)) if speed_rows else 0.0
    speed_target_base = _as_float(rules.get("trip_speed_target_kmh", "22"), 22.0)
    speed_target = _apply_relax_to_target(speed_target_base, relax_pct, lower_is_better=False) if first30 else speed_target_base
    speed_short_pct = max(0.0, ((speed_target - avg_speed) / speed_target) * 100.0) if speed_target > 0 else 0.0
    speed_excess_pct = max(0.0, ((avg_speed - speed_target) / speed_target) * 100.0) if speed_target > 0 else 0.0
    speed_penalty_rate = _as_float(rules.get("trip_speed_penalty_pct_per_1pct", "1"), 1.0)
    speed_incentive_rate = _as_float(rules.get("trip_speed_incentive_pct_per_1pct", "0.05"), 0.05)
    speed_dam = speed_short_pct * (speed_penalty_rate / 100.0) * monthly_fee
    speed_inc = speed_excess_pct * (speed_incentive_rate / 100.0) * monthly_fee
    results["trip_speed"] = {
        "avg_kmh": round(avg_speed, 2),
        "target_kmh": round(speed_target, 2),
        "target_kmh_base": round(speed_target_base, 2),
        "measured_trips": len(speed_rows),
        "damages": round(speed_dam, 2),
        "incentive": round(speed_inc, 2),
    }

    # 5) Safety (no first-30 relaxation per Article 20)
    minor_acc, major_acc = safety_kpi_counts(incidents_list)
    maf = (minor_acc * 10000.0) / bus_km if bus_km > 0 else 0.0
    maf_target = _as_float(rules.get("safety_maf_target", "0.01"), 0.01)
    safe_dam = 0.0
    safe_inc = 0.0
    if maf > maf_target:
        steps = max(0, int((maf - maf_target) / 0.01))
        safe_dam = steps * 0.02 * monthly_fee
    elif maf < 0.005:
        steps = max(0, int((0.005 - maf) / 0.001))
        safe_inc = steps * 0.0005 * monthly_fee
    safe_dam += major_acc * 0.02 * monthly_fee
    end_day = _parse_ymd(period_end) or datetime.now(timezone.utc).date()
    lookback_start = end_day - timedelta(days=89)
    serious_fire_buses = set()
    for inc in incidents_list:
        occ = _parse_ymd(str(inc.get("occurred_at", "") or inc.get("created_at", "")))
        if occ is None or occ < lookback_start or occ > end_day:
            continue
        if _is_fire_serious_incident(inc):
            bid = str(inc.get("bus_id", "") or "").strip()
            if bid:
                serious_fire_buses.add(bid)
    bus_count_scope = max(1, len(buses))
    serious_fire_pct = (len(serious_fire_buses) / bus_count_scope) * 100.0
    fire_threshold_pct = _as_float(rules.get("safety_serious_fire_lot_pct_threshold", "4"), 4.0)
    lot_shutdown_triggered = serious_fire_pct > fire_threshold_pct
    results["safety"] = {
        "maf": round(maf, 4),
        "maf_target": maf_target,
        "minor_accidents": minor_acc,
        "major_accidents": major_acc,
        "lot_fire_bus_pct_3m": round(serious_fire_pct, 2),
        "lot_fire_bus_count_3m": len(serious_fire_buses),
        "lot_fire_threshold_pct": fire_threshold_pct,
        "lot_shutdown_triggered": lot_shutdown_triggered,
        "damages": round(safe_dam, 2),
        "incentive": round(safe_inc, 2),
    }

    # Caps
    total_kpi_dam = sum(_as_float(r.get("damages", 0), 0.0) for r in results.values())
    total_inc = sum(_as_float(r.get("incentive", 0), 0.0) for r in results.values())
    kpi_dam_cap_pct = _as_float(rules.get("kpi_damages_cap_pct", "10"), 10.0)
    inc_cap_pct = _as_float(rules.get("incentive_cap_pct", "5"), 5.0)
    kpi_cap = (kpi_dam_cap_pct / 100.0) * monthly_fee
    incentive_cap = (inc_cap_pct / 100.0) * monthly_fee

    return {
        "categories": results,
        "total_damages_raw": round(total_kpi_dam, 2),
        "total_damages_capped": round(min(total_kpi_dam, kpi_cap), 2),
        "kpi_cap": round(kpi_cap, 2),
        "kpi_cap_pct": kpi_dam_cap_pct,
        "total_incentive_raw": round(total_inc, 2),
        "total_incentive_capped": round(min(total_inc, incentive_cap), 2),
        "incentive_cap": round(incentive_cap, 2),
        "incentive_cap_pct": inc_cap_pct,
        "monthly_fee_base": round(monthly_fee, 2),
        "first_30_day_relaxation_applied": first30,
        "first_30_day_relaxation_pct": relax_pct if first30 else 0.0,
        "billing_impact_flags": {
            "safety_lot_shutdown_triggered": lot_shutdown_triggered,
            "no_payment_recommended": lot_shutdown_triggered,
            "reason": "Article 20.6.6 serious incidents exceed threshold"
            if lot_shutdown_triggered
            else "",
        },
    }
