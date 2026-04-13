"""GCC-style KPI damage / incentive calculator (prompt §18).

All 5 categories now compute from REAL data — no random fallbacks.
"""

from __future__ import annotations

from typing import Any

from app.domain.incident_types import is_breakdown_for_reliability, safety_kpi_counts
from app.services.punctuality import punctuality_percentages_from_trips


def compute_kpi_damages(
    monthly_fee: float,
    trips: list[dict[str, Any]],
    buses: list[dict[str, Any]],
    incidents_list: list[dict[str, Any]],
    bus_km: float,
    rules: dict[str, str],
    duty_assignments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return KPI category breakdown, raw/capped damages and incentives.

    All values computed from real operational data. No random numbers.
    """
    results: dict[str, Any] = {}

    # ────────────────────────────────────────────────────
    # 1. RELIABILITY — BF = (breakdowns × 10,000) / bus_km
    # ────────────────────────────────────────────────────
    breakdowns = sum(1 for i in incidents_list if is_breakdown_for_reliability(i))
    bf = (breakdowns * 10000) / bus_km if bus_km > 0 else 0
    bf_target = float(rules.get("reliability_target", "0.5"))
    rel_dam = 0.0
    rel_inc = 0.0
    if bf > bf_target:
        steps = int(round((bf - bf_target) / 0.1))
        rel_dam = steps * 0.001 * monthly_fee
    elif bf < bf_target:
        steps = int(round((bf_target - bf) / 0.1))
        rel_inc = steps * 0.0005 * monthly_fee
    results["reliability"] = {
        "bf": round(bf, 4),
        "target": bf_target,
        "breakdowns": breakdowns,
        "bus_km": round(bus_km, 2),
        "damages": round(rel_dam, 2),
        "incentive": round(rel_inc, 2),
    }

    # ────────────────────────────────────────────────────
    # 2. AVAILABILITY — % of buses that actually operated
    #    in the period vs total buses in scope.
    #    Computed from trip_data: if a bus has at least 1 trip
    #    record, it was "ready/available".
    # ────────────────────────────────────────────────────
    total_buses_in_scope = len(buses)
    # Unique buses that have trip records in the period
    buses_with_trips = set()
    for t in trips:
        bid = str(t.get("bus_id", "") or "").strip()
        if bid:
            buses_with_trips.add(bid)
    buses_operated = len(buses_with_trips)

    # Calculate per-day availability for more granularity
    all_dates = sorted(set(str(t.get("date", "")) for t in trips if t.get("date")))
    total_bus_days_planned = total_buses_in_scope * max(len(all_dates), 1)
    bus_days_operated = 0
    for d in all_dates:
        buses_on_date = set(str(t.get("bus_id", "")) for t in trips if str(t.get("date", "")) == d and float(t.get("actual_km", 0) or 0) > 0)
        bus_days_operated += len(buses_on_date)

    avail_pct = (bus_days_operated / total_bus_days_planned * 100) if total_bus_days_planned > 0 else 100
    avail_target = float(rules.get("availability_target", "95"))
    pk_rate = float(rules.get("avg_pk_rate", "85"))
    avail_dam = 0.0
    if avail_pct < avail_target:
        missed_bus_days = total_bus_days_planned - bus_days_operated
        if avail_pct >= 90:
            avail_dam = missed_bus_days * 50 * pk_rate
        elif avail_pct >= 85:
            avail_dam = missed_bus_days * 60 * pk_rate
        else:
            avail_dam = missed_bus_days * 70 * pk_rate
    results["availability"] = {
        "pct": round(avail_pct, 1),
        "target": avail_target,
        "buses_in_scope": total_buses_in_scope,
        "buses_operated": buses_operated,
        "bus_days_planned": total_bus_days_planned,
        "bus_days_operated": bus_days_operated,
        "operating_days": len(all_dates),
        "damages": round(avail_dam, 2),
    }

    # ────────────────────────────────────────────────────
    # 3. PUNCTUALITY — from actual trip start/arrival times
    #    Uses the punctuality service which checks:
    #    - plan_start_time vs actual_start_time (±5 min relax)
    #    - plan_end_time vs actual_end_time (10% trip time relax, max 15 min)
    #    No random fallback — if no time data, report as "insufficient data".
    # ────────────────────────────────────────────────────
    sp_data, ap_data, p_meta = punctuality_percentages_from_trips(trips, rules)
    start_measured = p_meta.get("trips_start_measured", 0)
    arrival_measured = p_meta.get("trips_arrival_measured", 0)
    total_trips = len(trips)

    if start_measured > 0 and sp_data is not None:
        start_pct = sp_data
    else:
        # Compute from actual_start_time vs plan_start_time manually
        on_time = 0
        measured = 0
        start_relax = int(float(rules.get("punctuality_start_relax_min", "5")))
        for t in trips:
            plan = t.get("plan_start_time") or t.get("start_time")
            actual = t.get("actual_start_time")
            if plan and actual:
                try:
                    ph, pm = int(plan.split(":")[0]), int(plan.split(":")[1])
                    ah, am = int(actual.split(":")[0]), int(actual.split(":")[1])
                    plan_min = ph * 60 + pm
                    actual_min = ah * 60 + am
                    measured += 1
                    if actual_min <= plan_min + start_relax:
                        on_time += 1
                except (ValueError, IndexError):
                    pass
        start_pct = (on_time / measured * 100) if measured > 0 else 100.0
        start_measured = measured

    if arrival_measured > 0 and ap_data is not None:
        arrival_pct = ap_data
    else:
        # Compute from actual_end_time vs plan_end_time manually
        on_time = 0
        measured = 0
        arrival_relax_pct = float(rules.get("punctuality_arrival_relax_pct", "10"))
        arrival_relax_max = float(rules.get("punctuality_arrival_relax_max_min", "15"))
        for t in trips:
            plan_end = t.get("plan_end_time") or t.get("end_time")
            actual_end = t.get("actual_end_time")
            plan_start = t.get("plan_start_time") or t.get("start_time")
            if plan_end and actual_end and plan_start:
                try:
                    psh, psm = int(plan_start.split(":")[0]), int(plan_start.split(":")[1])
                    peh, pem = int(plan_end.split(":")[0]), int(plan_end.split(":")[1])
                    aeh, aem = int(actual_end.split(":")[0]), int(actual_end.split(":")[1])
                    plan_start_min = psh * 60 + psm
                    plan_end_min = peh * 60 + pem
                    actual_end_min = aeh * 60 + aem
                    duration = max(plan_end_min - plan_start_min, 1)
                    slack = min(arrival_relax_max, (arrival_relax_pct / 100) * duration)
                    measured += 1
                    if actual_end_min <= plan_end_min + slack:
                        on_time += 1
                except (ValueError, IndexError):
                    pass
        arrival_pct = (on_time / measured * 100) if measured > 0 else 100.0
        arrival_measured = measured

    start_target = float(rules.get("punctuality_start_target", "90"))
    arrival_target = float(rules.get("punctuality_arrival_target", "80"))
    punct_dam = 0.0
    punct_inc = 0.0
    # Anti-double-count: if arrival failure is solely because of late start, count only one
    start_shortfall = max(0, start_target - start_pct)
    arrival_shortfall = max(0, arrival_target - arrival_pct)
    if start_shortfall > 0:
        punct_dam += start_shortfall * 0.01 * monthly_fee
    if arrival_shortfall > 0 and arrival_shortfall > start_shortfall:
        # Only add the EXTRA arrival shortfall beyond what start caused
        punct_dam += (arrival_shortfall - start_shortfall) * 0.01 * monthly_fee
    elif arrival_shortfall > 0 and start_shortfall == 0:
        punct_dam += arrival_shortfall * 0.01 * monthly_fee
    # Incentive: only if BOTH are above target
    if start_pct > start_target and arrival_pct > arrival_target:
        start_excess = start_pct - start_target
        punct_inc = start_excess * 0.0005 * monthly_fee
    results["punctuality"] = {
        "start_pct": round(start_pct, 1),
        "arrival_pct": round(arrival_pct, 1),
        "start_target_pct": round(start_target, 1),
        "arrival_target_pct": round(arrival_target, 1),
        "trips_start_measured": start_measured,
        "trips_arrival_measured": arrival_measured,
        "total_trips": total_trips,
        "damages": round(punct_dam, 2),
        "incentive": round(punct_inc, 2),
        "data_source": "real" if (start_measured > 0 or arrival_measured > 0) else "insufficient_data",
    }

    # ────────────────────────────────────────────────────
    # 4. FREQUENCY — completed trips / scheduled trips
    #    A trip is "completed" if actual_km >= 80% of scheduled_km.
    #    Scheduled trips = total trip records in period.
    # ────────────────────────────────────────────────────
    completed_trips = 0
    scheduled_trips = 0
    for t in trips:
        sched = float(t.get("scheduled_km", 0) or 0)
        actual = float(t.get("actual_km", 0) or 0)
        if sched > 0:
            scheduled_trips += 1
            # Trip is "completed" if operator ran at least 80% of scheduled km
            if actual >= sched * 0.80:
                completed_trips += 1
        elif actual > 0:
            # Trip exists with actual km but no schedule — count as both
            scheduled_trips += 1
            completed_trips += 1

    trip_freq = (completed_trips / scheduled_trips * 100) if scheduled_trips > 0 else 100.0
    freq_target = float(rules.get("frequency_target", "94"))
    freq_dam = 0.0
    freq_inc = 0.0
    if trip_freq < freq_target:
        shortfall = freq_target - trip_freq
        freq_dam = shortfall * 0.01 * monthly_fee
    elif trip_freq > freq_target:
        excess = trip_freq - freq_target
        freq_inc = excess * 0.0005 * monthly_fee
    results["frequency"] = {
        "trip_freq_pct": round(trip_freq, 1),
        "target": freq_target,
        "scheduled_trips": scheduled_trips,
        "completed_trips": completed_trips,
        "incomplete_trips": scheduled_trips - completed_trips,
        "damages": round(freq_dam, 2),
        "incentive": round(freq_inc, 2),
    }

    # ────────────────────────────────────────────────────
    # 5. SAFETY — MAF from real incident data
    # ────────────────────────────────────────────────────
    minor_acc, major_acc = safety_kpi_counts(incidents_list)
    maf = (minor_acc * 10000) / bus_km if bus_km > 0 else 0
    maf_target = float(rules.get("safety_maf_target", "0.01"))
    safe_dam = 0.0
    safe_inc = 0.0
    if maf > maf_target:
        steps = int(round((maf - maf_target) / 0.01))
        safe_dam = steps * 0.02 * monthly_fee
    elif maf < 0.005:
        steps = int(round((0.005 - maf) / 0.001))
        safe_inc = steps * 0.0005 * monthly_fee
    safe_dam += major_acc * 0.02 * monthly_fee
    results["safety"] = {
        "maf": round(maf, 4),
        "maf_target": maf_target,
        "minor_accidents": minor_acc,
        "major_accidents": major_acc,
        "damages": round(safe_dam, 2),
        "incentive": round(safe_inc, 2),
    }

    # ────────────────────────────────────────────────────
    # CAPS — §18: KPI damages ≤10%, incentives ≤5%
    # ────────────────────────────────────────────────────
    total_kpi_dam = sum(r["damages"] for r in results.values())
    total_inc = sum(r.get("incentive", 0) for r in results.values())
    kpi_dam_cap_pct = float(rules.get("kpi_damages_cap_pct", "10"))
    inc_cap_pct = float(rules.get("incentive_cap_pct", "5"))
    kpi_cap = (kpi_dam_cap_pct / 100) * monthly_fee
    incentive_cap = (inc_cap_pct / 100) * monthly_fee
    capped_dam = min(total_kpi_dam, kpi_cap)
    capped_inc = min(total_inc, incentive_cap)

    # First-30-day relaxation (if applicable)
    first_30_relax = float(rules.get("first_30_day_kpi_relaxation_pct", "0"))
    if first_30_relax > 0:
        # Apply relaxation to non-safety damages only
        non_safety_dam = sum(r["damages"] for k, r in results.items() if k != "safety")
        safety_dam = results["safety"]["damages"]
        relaxed_non_safety = non_safety_dam * (1 - first_30_relax / 100)
        total_kpi_dam_relaxed = relaxed_non_safety + safety_dam
        capped_dam = min(total_kpi_dam_relaxed, kpi_cap)

    return {
        "categories": results,
        "total_damages_raw": round(total_kpi_dam, 2),
        "total_damages_capped": round(capped_dam, 2),
        "kpi_cap": round(kpi_cap, 2),
        "kpi_cap_pct": kpi_dam_cap_pct,
        "total_incentive_raw": round(total_inc, 2),
        "total_incentive_capped": round(capped_inc, 2),
        "incentive_cap": round(incentive_cap, 2),
        "incentive_cap_pct": inc_cap_pct,
        "monthly_fee_base": round(monthly_fee, 2),
    }
