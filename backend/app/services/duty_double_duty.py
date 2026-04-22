"""
Double duty (hours) uses **driver-day totals**: sum scheduled spans and sum actual spans
across **all** duties for the same ``driver_license`` on the same ``date``.

Having two roster blocks in a day is **not** automatically double duty; only when
**combined** scheduled hours or **combined** actual hours exceed ``max_duty_hours``
(operations business rule, default 10).

Per-duty ``scheduled_duty_hours`` / ``actual_duty_hours`` are still each duty's own span
(trip legs only; breaks excluded).
"""

from __future__ import annotations

from typing import Any

from pymongo import UpdateOne

from app.services.punctuality import parse_hhmm_to_minutes

DEFAULT_MAX_DUTY_HOURS = 10.0


def _is_break_segment(t: dict | None) -> bool:
    if not isinstance(t, dict):
        return False
    return str(t.get("segment_type") or "trip").strip().lower() == "break"


def _trip_legs_ordered(duty_doc: dict) -> list[dict]:
    legs = [dict(t) for t in (duty_doc.get("trips") or []) if isinstance(t, dict) and not _is_break_segment(t)]
    return sorted(legs, key=lambda t: int(t.get("trip_number") or 0))


def _minutes_span_same_day(start_m: int | None, end_m: int | None) -> float | None:
    if start_m is None or end_m is None:
        return None
    if end_m >= start_m:
        return (end_m - start_m) / 60.0
    return ((24 * 60 - start_m) + end_m) / 60.0


def _scheduled_span_hours(duty_doc: dict) -> float | None:
    legs = _trip_legs_ordered(duty_doc)
    if legs:
        first = legs[0]
        last = legs[-1]
        sm = parse_hhmm_to_minutes(str(first.get("start_time") or "").strip())
        em = parse_hhmm_to_minutes(str(last.get("end_time") or "").strip())
        return _minutes_span_same_day(sm, em)
    sd = parse_hhmm_to_minutes(str(duty_doc.get("punctuality_scheduled_departure") or "").strip())
    sa = parse_hhmm_to_minutes(str(duty_doc.get("punctuality_scheduled_arrival") or "").strip())
    return _minutes_span_same_day(sd, sa)


def _actual_span_hours(duty_doc: dict) -> float | None:
    legs = _trip_legs_ordered(duty_doc)
    if legs:
        first = legs[0]
        last = legs[-1]
        a0 = str(first.get("actual_start_time") or "").strip() or str(first.get("start_time") or "").strip()
        a1 = str(last.get("actual_end_time") or "").strip() or str(last.get("end_time") or "").strip()
        sm = parse_hhmm_to_minutes(a0)
        em = parse_hhmm_to_minutes(a1)
        got = _minutes_span_same_day(sm, em)
        if got is not None:
            return got
    ad = parse_hhmm_to_minutes(str(duty_doc.get("punctuality_actual_departure") or "").strip())
    aa = parse_hhmm_to_minutes(str(duty_doc.get("punctuality_actual_arrival") or "").strip())
    return _minutes_span_same_day(ad, aa)


def duty_scheduled_and_actual_hours(duty_doc: dict) -> tuple[float | None, float | None]:
    """This duty's scheduled and actual span (hours), independent of other duties."""
    return _scheduled_span_hours(duty_doc), _actual_span_hours(duty_doc)


def merge_driver_day_load_fields(
    duty_doc: dict,
    same_day_duties_for_driver: list[dict],
    *,
    max_duty_hours: float = DEFAULT_MAX_DUTY_HOURS,
) -> dict[str, Any]:
    """
    Merge load fields for ``duty_doc`` using aggregates over **all** duties in
    ``same_day_duties_for_driver`` (same calendar date + same driver).

    Every duty in that driver-day list should receive the same ``double_duty``,
    ``driver_day_*_total``, and ``duty_load_kind`` when computed with the full list.
    """
    mh = float(max_duty_hours) if max_duty_hours and max_duty_hours > 0 else DEFAULT_MAX_DUTY_HOURS
    group = same_day_duties_for_driver if same_day_duties_for_driver else [duty_doc]

    sched_parts: list[float] = []
    actual_parts: list[float] = []
    for d in group:
        s, a = duty_scheduled_and_actual_hours(d)
        if s is not None:
            sched_parts.append(s)
        if a is not None:
            actual_parts.append(a)

    sum_sched = round(sum(sched_parts), 3) if sched_parts else None
    sum_actual = round(sum(actual_parts), 3) if actual_parts else None

    per_s, per_a = duty_scheduled_and_actual_hours(duty_doc)

    triggers: list[str] = []
    if sum_sched is not None and sum_sched > mh:
        triggers.append("driver_day_scheduled_total_exceeds")
    if sum_actual is not None and sum_actual > mh:
        triggers.append("driver_day_actual_total_exceeds")

    double = len(triggers) > 0
    kind = "double" if double else "single"

    reason_parts: list[str] = []
    if "driver_day_scheduled_total_exceeds" in triggers:
        reason_parts.append(f"combined scheduled hours for the day {sum_sched:g} h over {mh:g} h")
    if "driver_day_actual_total_exceeds" in triggers:
        reason_parts.append(f"combined actual hours for the day {sum_actual:g} h over {mh:g} h")

    return {
        "scheduled_duty_hours": round(per_s, 3) if per_s is not None else None,
        "actual_duty_hours": round(per_a, 3) if per_a is not None else None,
        "driver_day_scheduled_hours_total": sum_sched,
        "driver_day_actual_hours_total": sum_actual,
        "driver_day_duty_count": len(group),
        "double_duty": double,
        "duty_load_kind": kind,
        "max_duty_hours_rule": round(mh, 3),
        "double_duty_triggers": triggers,
        "double_duty_reason": "; ".join(reason_parts) if reason_parts else "",
    }


def compute_duty_load_fields(duty_doc: dict, *, max_duty_hours: float = DEFAULT_MAX_DUTY_HOURS) -> dict[str, Any]:
    """Backward-compatible: one duty in isolation (same as a driver-day with a single assignment)."""
    return merge_driver_day_load_fields(duty_doc, [duty_doc], max_duty_hours=max_duty_hours)


async def fetch_duties_same_driver_day(db, date: str, driver_license: str) -> list[dict]:
    """All duty assignments for one driver on one calendar date."""
    dv = (date or "").strip()
    lic = (driver_license or "").strip()
    if not dv or not lic:
        return []
    cur = await db.duty_assignments.find({"date": dv, "driver_license": lic}, {"_id": 0}).to_list(500)
    return list(cur)


async def persist_driver_day_load_fields(db, date: str, driver_license: str, max_h: float) -> None:
    """Recompute and store load fields on every duty for this driver-day."""
    docs = await fetch_duties_same_driver_day(db, date, driver_license)
    if not docs:
        return
    ops: list[UpdateOne] = []
    for d in docs:
        fields = merge_driver_day_load_fields(d, docs, max_duty_hours=max_h)
        did = str(d.get("id") or "").strip()
        if did:
            ops.append(UpdateOne({"id": did}, {"$set": fields}))
    if ops:
        await db.duty_assignments.bulk_write(ops)


async def enrich_duty_document_with_driver_day(db, doc: dict | None, max_h: float) -> dict | None:
    if not doc:
        return doc
    date_v = str(doc.get("date") or "").strip()
    lic = str(doc.get("driver_license") or "").strip()
    group = await fetch_duties_same_driver_day(db, date_v, lic) if date_v and lic else []
    g = group if group else [doc]
    merged = merge_driver_day_load_fields(doc, g, max_duty_hours=max_h)
    return {**doc, **merged}


async def enrich_duty_documents_list(db, docs: list[dict], max_h: float) -> list[dict]:
    """Attach driver-day fields for each row (queries each distinct driver-day once)."""
    if not docs:
        return docs
    cache: dict[tuple[str, str], list[dict]] = {}
    out: list[dict] = []
    for d in docs:
        date_v = str(d.get("date") or "").strip()
        lic = str(d.get("driver_license") or "").strip()
        key = (date_v, lic)
        if key not in cache:
            if date_v and lic:
                cache[key] = await fetch_duties_same_driver_day(db, date_v, lic)
            else:
                cache[key] = [d]
        group = cache[key] if cache[key] else [d]
        fld = merge_driver_day_load_fields(d, group, max_duty_hours=max_h)
        out.append({**d, **fld})
    return out


async def fetch_max_duty_hours_threshold(db) -> float:
    """Reads ``max_duty_hours`` from business_rules (operations)."""
    try:
        doc = await db.business_rules.find_one({"rule_key": "max_duty_hours"}, {"_id": 0, "rule_value": 1})
        if doc:
            v = float(str(doc.get("rule_value", "10")).strip())
            if v > 0:
                return v
    except (TypeError, ValueError, AttributeError):
        pass
    return DEFAULT_MAX_DUTY_HOURS
