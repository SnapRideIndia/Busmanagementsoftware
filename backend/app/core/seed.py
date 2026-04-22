"""Database seeding for demos and local development."""

from __future__ import annotations

import json
import logging
import math
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import settings as app_settings
from app.core.database import db
from app.core.energy_norms import KWH_PER_KM_BY_BUS_TYPE, kwh_per_km_for_bus_type
from app.core.security import hash_password, verify_password
from app.domain.permissions import ALL_PERMISSION_IDS, default_permission_ids_for_role
from app.domain.infractions_master import build_master_rows, normalize_catalog_infraction_code
from app.domain.incident_infraction_bridge import infer_incident_type_from_infraction_code
from app.domain.user_roles import ALLOWED_ROLE_IDS, LEGACY_ROLE_TO_CANONICAL
from app.services.electricity_tariff import clause_22_5_2_variation_rs

logger = logging.getLogger(__name__)

# Canonical coords for stops that were corrected after initial demo seed (idempotent sync on every startup).
_DEMO_STOP_COORD_OVERRIDES: dict[str, tuple[float, float]] = {
    "ST-HYD-BHO": (17.51656714753325, 78.88727898775723),
    "ST-HYD-GHT": (17.452164285002805, 78.68239941614085),
    "ST-HYD-UPP-OR": (17.401812306203425, 78.56877445564773),
    "ST-HYD-UPP-MET": (17.40194053306272, 78.56208812043853),
}


# Clause 22.5.2 — initial values from agreement illustration (PM E §22.5.2 table); stored in DB only ($setOnInsert).
# Operators edit in Business rules (Billing). Application code does not substitute numeric fallbacks.
BILLING_ELECTRICITY_RULE_DEFAULTS: list[dict] = [
    {
        "rule_key": "electricity_base_tariff",
        "rule_value": "5",
        "category": "billing",
        "description": "Clause 22.5.2 — Base electricity tariff B (INR/kWh). From the agreement / DISCOM bid at due date.",
    },
    {
        "rule_key": "electricity_actual_tariff",
        "rule_value": "7",
        "category": "billing",
        "description": "Clause 22.5.2 — Actual electricity tariff C (INR/kWh). Used for billing and energy adjustment; from DISCOM or audited bills.",
    },
]


async def retire_electricity_actual_tariff_default_rule() -> None:
    """Remove legacy rule_key electricity_actual_tariff_default (same meaning as electricity_actual_tariff)."""
    legacies = await db.business_rules.find({"rule_key": "electricity_actual_tariff_default"}).to_list(50)
    if not legacies:
        return
    desc_actual = next(
        (x["description"] for x in BILLING_ELECTRICITY_RULE_DEFAULTS if x["rule_key"] == "electricity_actual_tariff"),
        "Clause 22.5.2 — Actual electricity tariff C (INR/kWh).",
    )
    now_br = datetime.now(timezone.utc).isoformat()
    for legacy in legacies:
        lid = legacy["_id"]
        cat = str(legacy.get("category", "") or "").strip() or "billing"
        leg_val = str(legacy.get("rule_value", "")).strip()
        canon = await db.business_rules.find_one({"rule_key": "electricity_actual_tariff", "category": cat})
        can_val = str(canon.get("rule_value", "")).strip() if canon else ""
        if leg_val and not can_val:
            await db.business_rules.update_one(
                {"rule_key": "electricity_actual_tariff", "category": cat},
                {
                    "$set": {
                        "rule_value": leg_val,
                        "description": desc_actual,
                        "updated_at": now_br,
                        "updated_by": "System",
                    },
                    "$setOnInsert": {"rule_key": "electricity_actual_tariff", "category": cat},
                },
                upsert=True,
            )
        elif leg_val and can_val and leg_val != can_val:
            logger.info(
                "Removed legacy business rule electricity_actual_tariff_default=%s (%s); keeping electricity_actual_tariff=%s",
                leg_val,
                cat,
                can_val,
            )
        await db.business_rules.delete_one({"_id": lid})


async def ensure_billing_electricity_rules() -> None:
    """Ensure electricity tariff rules exist. Runs every startup (not only full demo seed)."""
    now_br = datetime.now(timezone.utc).isoformat()
    for br_e in BILLING_ELECTRICITY_RULE_DEFAULTS:
        await db.business_rules.update_one(
            {"rule_key": br_e["rule_key"], "category": br_e["category"]},
            {"$setOnInsert": {**br_e, "updated_at": now_br, "updated_by": "System"}},
            upsert=True,
        )
    await retire_electricity_actual_tariff_default_rule()


async def _billing_clause_2252_b_c_from_rules() -> tuple[float | None, float | None]:
    """Authoritative Clause 22.5.2 B and C from Business rules (Billing), when present."""
    b: float | None = None
    doc_b = await db.business_rules.find_one(
        {"rule_key": "electricity_base_tariff", "category": "billing"},
        {"_id": 0, "rule_value": 1},
    )
    if doc_b and doc_b.get("rule_value") is not None and str(doc_b.get("rule_value", "")).strip() != "":
        try:
            v = float(str(doc_b["rule_value"]).strip())
            if v >= 0 and not math.isnan(v):
                b = v
        except (TypeError, ValueError):
            pass
    c: float | None = None
    doc_c = await db.business_rules.find_one(
        {"rule_key": "electricity_actual_tariff", "category": "billing"},
        {"_id": 0, "rule_value": 1},
    )
    if doc_c and doc_c.get("rule_value") is not None and str(doc_c.get("rule_value", "")).strip() != "":
        try:
            v = float(str(doc_c["rule_value"]).strip())
            if v >= 0 and not math.isnan(v):
                c = v
        except (TypeError, ValueError):
            pass
    return b, c


async def repair_billing_clause_2252_snapshots() -> None:
    """Recompute energy_adjustment and energy_variation_kwh from Clause 22.5.2 (fixes legacy A×C-style errors)."""
    repaired = 0
    db_b, db_c = await _billing_clause_2252_b_c_from_rules()
    async for inv in db.billing.find({}, {"_id": 0}):
        iid = inv.get("invoice_id")
        if not iid:
            continue
        try:
            a = float(inv.get("allowed_energy_kwh") or 0)
            d = float(inv.get("actual_energy_kwh") or 0)
        except (TypeError, ValueError):
            continue

        def _f(x: object, default: float | None = None) -> float | None:
            if x is None:
                return default
            try:
                v = float(x)
                return v if v >= 0 and not math.isnan(v) else default
            except (TypeError, ValueError):
                return default

        if db_b is not None:
            b = db_b
        else:
            b = _f(inv.get("base_electricity_tariff"))
            if b is None:
                try:
                    aec = float(inv.get("allowed_energy_cost") or 0)
                    b = aec / a if a > 0 else 5.0
                except (TypeError, ValueError, ZeroDivisionError):
                    b = 5.0
        if db_c is not None:
            c = db_c
        else:
            c = _f(inv.get("actual_electricity_tariff"))
            if c is None:
                c = _f(inv.get("tariff_rate"))
            if c is None:
                try:
                    acc = float(inv.get("actual_energy_cost") or 0)
                    c = acc / d if d > 0 else 5.0
                except (TypeError, ValueError, ZeroDivisionError):
                    c = 5.0

        e_units, adj = clause_22_5_2_variation_rs(a, d, float(b), float(c))
        old_adj = float(inv.get("energy_adjustment") or 0)
        old_e = inv.get("energy_variation_kwh")
        try:
            old_e_f = float(old_e) if old_e is not None else None
        except (TypeError, ValueError):
            old_e_f = None
        if abs(old_adj - adj) < 0.02 and old_e_f is not None and abs(old_e_f - e_units) < 0.06:
            continue
        old_fp = float(inv.get("final_payable") or 0)
        new_fp = round(old_fp - old_adj + adj, 2)
        comp = dict(inv.get("invoice_components") or {})
        comp["energy_adjustment"] = round(adj, 2)
        await db.billing.update_one(
            {"invoice_id": iid},
            {
                "$set": {
                    "base_electricity_tariff": round(float(b), 4),
                    "actual_electricity_tariff": round(float(c), 4),
                    "energy_variation_kwh": round(e_units, 2),
                    "energy_adjustment": round(adj, 2),
                    "final_payable": new_fp,
                    "total_due": new_fp,
                    "invoice_components": comp,
                }
            },
        )
        repaired += 1
    if repaired:
        logger.info("repair_billing_clause_2252_snapshots: updated %s invoice(s)", repaired)


async def sync_duty_templates_and_backfill() -> None:
    """Create roster templates from existing duties and ensure each duty has template_id."""
    existing_templates = await db.duty_templates.find({}, {"_id": 0}).to_list(10000)
    template_by_signature: dict[tuple[str, str, str, str], dict] = {}
    for t in existing_templates:
        sig = (
            str(t.get("driver_license", "") or "").strip(),
            str(t.get("conductor_id", "") or "").strip(),
            str(t.get("bus_id", "") or "").strip(),
            str(t.get("route_id", "") or "").strip(),
        )
        template_by_signature[sig] = t

    duties = await db.duty_assignments.find({}, {"_id": 0}).to_list(50000)
    created = 0
    backfilled = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for d in duties:
        route_id = str(d.get("route_id", "") or "").strip()
        if not route_id:
            route_name = str(d.get("route_name", "") or "").strip()
            if route_name:
                route = await db.routes.find_one({"name": route_name}, {"_id": 0, "route_id": 1})
                if route:
                    route_id = str(route.get("route_id", "") or "").strip()
        sig = (
            str(d.get("driver_license", "") or "").strip(),
            str(d.get("conductor_id", "") or "").strip(),
            str(d.get("bus_id", "") or "").strip(),
            route_id,
        )
        tpl = template_by_signature.get(sig)
        if not tpl:
            tpl = {
                "template_id": f"DTP-{str(uuid.uuid4())[:8].upper()}",
                "template_name": f"{d.get('driver_name') or d.get('driver_license') or 'Duty'} - {d.get('bus_id') or ''}".strip(" -"),
                "active": True,
                "driver_license": sig[0],
                "driver_name": str(d.get("driver_name", "") or "").strip(),
                "driver_phone": str(d.get("driver_phone", "") or "").strip(),
                "conductor_id": sig[1],
                "conductor_name": str(d.get("conductor_name", "") or "").strip(),
                "conductor_phone": str(d.get("conductor_phone", "") or "").strip(),
                "bus_id": sig[2],
                "depot": str(d.get("depot", "") or "").strip(),
                "route_id": route_id,
                "route_name": str(d.get("route_name", "") or "").strip(),
                "start_point": str(d.get("start_point", "") or "").strip(),
                "end_point": str(d.get("end_point", "") or "").strip(),
                "punctuality_scheduled_departure": str(d.get("punctuality_scheduled_departure", "") or "").strip(),
                "punctuality_scheduled_arrival": str(d.get("punctuality_scheduled_arrival", "") or "").strip(),
                "trips": list(d.get("trips") or []),
                "notes": "Auto-created from existing duty roster.",
                "created_at": now_iso,
                "created_by": "System",
                "updated_at": now_iso,
                "updated_by": "System",
            }
            await db.duty_templates.insert_one(tpl)
            template_by_signature[sig] = tpl
            created += 1
        if not str(d.get("template_id", "") or "").strip():
            await db.duty_assignments.update_one({"id": d.get("id")}, {"$set": {"template_id": tpl["template_id"]}})
            backfilled += 1
    if created or backfilled:
        logger.info("sync_duty_templates_and_backfill: created_templates=%s backfilled_duties=%s", created, backfilled)


async def migrate_duties_to_standalone_date_tabs() -> None:
    """Collapse legacy date-wise duty rows into standalone duty masters with embedded duty_dates tabs."""
    docs = await db.duty_assignments.find({}, {"_id": 0}).to_list(50000)
    if not docs:
        return
    if all(isinstance(d.get("duty_dates"), list) and d.get("duty_dates") for d in docs):
        return

    grouped: dict[tuple[str, str, str, str, str], list[dict]] = {}
    for d in docs:
        key = (
            str(d.get("template_id", "") or "").strip(),
            str(d.get("driver_license", "") or "").strip(),
            str(d.get("conductor_id", "") or "").strip(),
            str(d.get("bus_id", "") or "").strip(),
            str(d.get("route_id", "") or "").strip(),
        )
        grouped.setdefault(key, []).append(d)

    migrated_docs: list[dict] = []
    remap_pairs: list[tuple[str, str]] = []
    for _key, rows in grouped.items():
        rows_sorted = sorted(rows, key=lambda x: str(x.get("date", "") or ""))
        master = dict(rows_sorted[0])
        duty_dates: list[dict] = []
        for r in rows_sorted:
            dt = str(r.get("date", "") or "").strip()
            if not dt:
                continue
            duty_dates.append(
                {
                    "date": dt,
                    "punctuality_scheduled_departure": str(r.get("punctuality_scheduled_departure", "") or "").strip(),
                    "punctuality_scheduled_arrival": str(r.get("punctuality_scheduled_arrival", "") or "").strip(),
                    "punctuality_actual_departure": str(r.get("punctuality_actual_departure", "") or "").strip(),
                    "punctuality_actual_arrival": str(r.get("punctuality_actual_arrival", "") or "").strip(),
                    "trips": list(r.get("trips") or []),
                }
            )
        duty_dates.sort(key=lambda x: x["date"])
        master["duty_dates"] = duty_dates
        if duty_dates:
            latest = duty_dates[-1]
            master["date"] = latest["date"]
            master["trips"] = latest["trips"]
            master["punctuality_scheduled_departure"] = latest["punctuality_scheduled_departure"]
            master["punctuality_scheduled_arrival"] = latest["punctuality_scheduled_arrival"]
            master["punctuality_actual_departure"] = latest["punctuality_actual_departure"]
            master["punctuality_actual_arrival"] = latest["punctuality_actual_arrival"]
        for r in rows_sorted[1:]:
            old_id = str(r.get("id", "") or "").strip()
            new_id = str(master.get("id", "") or "").strip()
            if old_id and new_id and old_id != new_id:
                remap_pairs.append((old_id, new_id))
        migrated_docs.append(master)

    for old_id, new_id in remap_pairs:
        await db.trip_data.update_many({"duty_id": old_id}, {"$set": {"duty_id": new_id}})
        await db.incidents.update_many({"duty_id": old_id}, {"$set": {"duty_id": new_id}})
        await db.infractions_logged.update_many({"duty_id": old_id}, {"$set": {"duty_id": new_id}})

    await db.duty_assignments.delete_many({})
    if migrated_docs:
        await db.duty_assignments.insert_many(migrated_docs)
        logger.info("migrate_duties_to_standalone_date_tabs: migrated_rows=%s masters=%s", len(docs), len(migrated_docs))


async def ensure_mock_standalone_duties() -> None:
    """Ensure 5 standalone duties with past2/current/future2 date tabs and synced trip rows."""
    buses = await db.buses.find({}, {"_id": 0, "bus_id": 1, "depot": 1}).to_list(200)
    drivers = await db.drivers.find({}, {"_id": 0, "license_number": 1, "name": 1, "phone": 1}).to_list(200)
    conductors = await db.conductors.find({}, {"_id": 0, "conductor_id": 1, "name": 1, "phone": 1}).to_list(200)
    routes = await db.routes.find({}, {"_id": 0}).to_list(500)
    if not buses or not drivers or not routes:
        return
    today = datetime.now(timezone.utc).date()
    dates = [(today + timedelta(days=d)).isoformat() for d in (-2, -1, 0, 1, 2)]
    for i in range(5):
        bus = buses[i % len(buses)]
        driver = drivers[i % len(drivers)]
        conductor = conductors[i % len(conductors)] if conductors else {"conductor_id": "", "name": "", "phone": ""}
        route = routes[i % len(routes)]
        duty_id = f"DTY-MOCK-{i+1:02d}"
        start_point = str(route.get("origin", "") or "Origin")
        end_point = str(route.get("destination", "") or "Destination")
        duty_dates = []
        for idx, d in enumerate(dates):
            base_h = 7 + i
            sdep = f"{base_h:02d}:00"
            sarr = f"{base_h+4:02d}:00"
            is_future = idx >= 3
            is_current = idx == 2
            trips = []
            for leg in range(2):
                trip_id = f"{duty_id}-{d}-{leg+1}"
                st = f"{base_h + (leg*2):02d}:00"
                et = f"{base_h + (leg*2) + 2:02d}:00"
                status = "scheduled" if is_future else ("completed" if (not is_current or leg == 0) else "scheduled")
                trips.append(
                    {
                        "trip_number": leg + 1,
                        "trip_id": trip_id,
                        "start_point": start_point if leg % 2 == 0 else end_point,
                        "end_point": end_point if leg % 2 == 0 else start_point,
                        "start_time": st,
                        "end_time": et,
                        "actual_start_time": "" if is_future else st,
                        "actual_end_time": "" if is_future else et,
                        "trip_status": status,
                        "cancel_reason_code": "none",
                        "cancel_reason_custom": "",
                        "direction": "outward" if leg % 2 == 0 else "inward",
                    }
                )
                await db.trip_data.update_one(
                    {"trip_id": trip_id},
                    {"$set": {
                        "trip_id": trip_id,
                        "date": d,
                        "bus_id": bus.get("bus_id", ""),
                        "driver_id": driver.get("license_number", ""),
                        "route_id": route.get("route_id", ""),
                        "route_name": route.get("name", ""),
                        "scheduled_km": float(route.get("distance_km", 40) or 40),
                        "actual_km": float(route.get("distance_km", 40) or 40) if not is_future else 0.0,
                        "duty_id": duty_id,
                        "trip_status": status,
                    }},
                    upsert=True,
                )
            duty_dates.append(
                {
                    "date": d,
                    "punctuality_scheduled_departure": sdep,
                    "punctuality_scheduled_arrival": sarr,
                    "punctuality_actual_departure": "" if is_future else sdep,
                    "punctuality_actual_arrival": "" if is_future else sarr,
                    "trips": trips,
                }
            )
        doc = {
            "id": duty_id,
            "template_id": "",
            "driver_license": str(driver.get("license_number", "") or ""),
            "driver_name": str(driver.get("name", "") or ""),
            "driver_phone": str(driver.get("phone", "") or ""),
            "conductor_id": str(conductor.get("conductor_id", "") or ""),
            "conductor_name": str(conductor.get("name", "") or ""),
            "conductor_phone": str(conductor.get("phone", "") or ""),
            "bus_id": str(bus.get("bus_id", "") or ""),
            "depot": str(bus.get("depot", "") or ""),
            "route_id": str(route.get("route_id", "") or ""),
            "route_name": str(route.get("name", "") or ""),
            "start_point": start_point,
            "end_point": end_point,
            "duty_dates": duty_dates,
            "date": duty_dates[2]["date"],
            "trips": duty_dates[2]["trips"],
            "punctuality_scheduled_departure": duty_dates[2]["punctuality_scheduled_departure"],
            "punctuality_scheduled_arrival": duty_dates[2]["punctuality_scheduled_arrival"],
            "punctuality_actual_departure": duty_dates[2]["punctuality_actual_departure"],
            "punctuality_actual_arrival": duty_dates[2]["punctuality_actual_arrival"],
            "attribution_context": "operator_fault",
            "duty_exception_reason": "",
            "punctuality_review": {"policy": "punctuality", "violations": [], "decisions": []},
            "status": "assigned",
            "sms_sent": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": "System",
        }
        await db.duty_assignments.update_one({"id": duty_id}, {"$set": doc}, upsert=True)
    logger.info("ensure_mock_standalone_duties: ensured 5 duties with 5 date tabs each")


async def sync_tender_annual_assured_bus_km_defaults() -> None:
    """Article 22.3.1 — backfill tender annual assured km for fleet UI.

    Runs even when destructive demo seed is skipped (SEED_MODE=once + seed marker / incidents),
    so GET /buses can populate assured_km_yearly from tenders.
    """
    await db.tenders.update_many(
        {"$or": [{"annual_assured_bus_km": {"$exists": False}}, {"annual_assured_bus_km": None}]},
        {"$set": {"annual_assured_bus_km": 72000}},
    )


async def sync_demo_bus_annual_assured_km_overrides() -> None:
    """Demo overrides for TS-001 / TS-002 when full bus seed did not run."""
    await db.buses.update_one(
        {"bus_id": "TS-001", "annual_assured_km_override": {"$exists": False}},
        {"$set": {"annual_assured_km_override": 75000}},
    )
    await db.buses.update_one(
        {"bus_id": "TS-002", "annual_assured_km_override": {"$exists": False}},
        {"$set": {"annual_assured_km_override": 68000}},
    )


async def sync_route_corridors_from_path_points_file() -> None:
    """Update ROUTE-RT-* polyline_buffer geofences from route_path_points.json when the file has paths."""
    from app.core.route_path_points import load_route_path_points

    pts_map = load_route_path_points()
    if not pts_map:
        return
    now = datetime.now(timezone.utc).isoformat()
    for rid, pts in pts_map.items():
        if len(pts) < 2:
            continue
        await db.geofences.update_one(
            {"geofence_id": f"ROUTE-{rid}"},
            {"$set": {"path_points": pts, "updated_at": now}},
        )


async def sync_demo_stop_coordinates_to_db() -> None:
    """Push corrected lat/lng into stop_master, stop circles, and route corridor polylines (runs even when full seed is skipped)."""
    now = datetime.now(timezone.utc).isoformat()
    for sid, (la, ln) in _DEMO_STOP_COORD_OVERRIDES.items():
        await db.stop_master.update_one(
            {"stop_id": sid},
            {"$set": {"lat": la, "lng": ln, "updated_at": now}},
        )
        await db.geofences.update_one(
            {"geofence_id": f"STOP-{sid}"},
            {"$set": {"center_lat": la, "center_lng": ln, "updated_at": now}},
        )

    affected = set(_DEMO_STOP_COORD_OVERRIDES.keys())
    async for r in db.routes.find({"stop_sequence.stop_id": {"$in": list(affected)}}, {"_id": 0, "route_id": 1, "stop_sequence": 1}):
        rid = str(r.get("route_id") or "").strip()
        if not rid:
            continue
        seq = r.get("stop_sequence") or []
        stop_ids: list[str] = []
        for item in sorted(seq, key=lambda z: int((z or {}).get("seq") or 0)):
            sid = str((item or {}).get("stop_id") or "").strip()
            if sid:
                stop_ids.append(sid)
        if len(stop_ids) < 2:
            continue
        rows = await db.stop_master.find({"stop_id": {"$in": stop_ids}}, {"_id": 0, "stop_id": 1, "lat": 1, "lng": 1}).to_list(400)
        by_sid = {str(x.get("stop_id") or ""): x for x in rows}
        points: list[dict] = []
        for sid in stop_ids:
            srow = by_sid.get(sid) or {}
            if srow.get("lat") is None or srow.get("lng") is None:
                continue
            points.append({"lat": float(srow["lat"]), "lng": float(srow["lng"])})
        if len(points) >= 2:
            await db.geofences.update_one(
                {"geofence_id": f"ROUTE-{rid}"},
                {"$set": {"path_points": points, "updated_at": now}},
            )


def _add_days_ymd(ymd: str, days: int) -> str:
    """Add integer days to a YYYY-MM-DD string; returns YYYY-MM-DD."""
    try:
        dt = datetime.strptime(ymd, "%Y-%m-%d")
        return (dt + timedelta(days=max(0, int(days)))).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return ymd


async def _migrate_incident_infraction_codes_to_others() -> None:
    """Persist legacy codes to canonical N6x / O02 / O03 on embedded infraction rows (idempotent)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    q = {
        "$or": [
            {
                "infractions": {
                    "$elemMatch": {
                        "infraction_code": {
                            "$in": [
                                "A21",
                                "A22",
                                "OTHER",
                                "OTHERS",
                                "OD01",
                                "OD12",
                                "O01",
                                "O04",
                                "O05",
                                "O06",
                                "O07",
                                "O08",
                                "O09",
                                "O10",
                                "C18",
                                "C19",
                            ]
                        }
                    }
                }
            },
            {"infractions": {"$elemMatch": {"infraction_code": ""}}},
        ]
    }
    async for doc in db.incidents.find(q, {"_id": 1, "infractions": 1}):
        infs = doc.get("infractions")
        if not isinstance(infs, list):
            continue
        new_infs = []
        changed = False
        for inf in infs:
            if not isinstance(inf, dict):
                new_infs.append(inf)
                continue
            prev = str(inf.get("infraction_code") or "").strip().upper()
            new_c = normalize_catalog_infraction_code(inf.get("infraction_code"))
            if prev != new_c:
                changed = True
            new_infs.append({**inf, "infraction_code": new_c})
        if changed:
            await db.incidents.update_one(
                {"_id": doc["_id"]},
                {"$set": {"infractions": new_infs, "updated_at": now_iso}},
            )


async def run_seed_data():
    def _to_five_star(raw: float) -> float:
        """Map legacy 0–100 scores to 0–5 (linear)."""
        return round(min(5.0, max(0.0, float(raw) / 20.0)), 1)

    async def _migrate_driver_rating():
        async for doc in db.drivers.find({"performance_score": {"$exists": True}}):
            r5 = _to_five_star(doc.get("performance_score", 100.0))
            await db.drivers.update_one(
                {"_id": doc["_id"]},
                {"$set": {"rating": r5}, "$unset": {"performance_score": ""}},
            )

    async def _normalize_driver_ratings_five_star():
        """Legacy rows stored as 0–100 after rename, or old API default 100.0."""
        async for doc in db.drivers.find({"rating": {"$gt": 5.01}}):
            await db.drivers.update_one(
                {"_id": doc["_id"]},
                {"$set": {"rating": _to_five_star(doc["rating"])}},
            )

    await _migrate_driver_rating()
    await _normalize_driver_ratings_five_star()
    # Admin user
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@tgsrtc.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "email": admin_email, "password_hash": hash_password(admin_password),
            "name": "Admin", "role": "admin", "created_at": datetime.now(timezone.utc).isoformat()
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    async def _migrate_legacy_user_roles() -> None:
        for old_id, new_id in LEGACY_ROLE_TO_CANONICAL.items():
            await db.users.update_many({"role": old_id}, {"$set": {"role": new_id}})

    await _migrate_legacy_user_roles()
    await db.users.update_many(
        {"role": {"$nin": list(ALLOWED_ROLE_IDS)}},
        {"$set": {"role": "vendor"}},
    )

    async def _migrate_legacy_incident_statuses() -> None:
        """Map retired IRMS statuses (open/assigned) to investigating/in_progress."""
        for old, new in (("open", "investigating"), ("assigned", "in_progress")):
            result = await db.incidents.update_many({"status": old}, {"$set": {"status": new}})
            if result.modified_count:
                logger.info(
                    "Migrated %s incident(s): status %s → %s",
                    result.modified_count,
                    old,
                    new,
                )

    async def _migrate_resolved_to_closed_incidents() -> None:
        """Terminal status is `closed` only (no separate `resolved`)."""
        result = await db.incidents.update_many({"status": "resolved"}, {"$set": {"status": "closed"}})
        if result.modified_count:
            logger.info("Migrated %s incident(s): status resolved → closed", result.modified_count)

    await _migrate_legacy_incident_statuses()
    await _migrate_resolved_to_closed_incidents()

    await sync_demo_stop_coordinates_to_db()
    await sync_route_corridors_from_path_points_file()
    await sync_tender_annual_assured_bus_km_defaults()
    await sync_demo_bus_annual_assured_km_overrides()
    await db.tenders.update_many({}, {"$unset": {"subsidy_rate": "", "subsidy_type": ""}})

    await ensure_billing_electricity_rules()
    await repair_billing_clause_2252_snapshots()
    await sync_duty_templates_and_backfill()
    await migrate_duties_to_standalone_date_tabs()
    await ensure_mock_standalone_duties()

    # Seed strategy:
    # - once  (default): run destructive demo seed only first time on an empty incidents collection
    # - force           : always run destructive demo seed (dev reset)
    # - off             : never run destructive demo seed
    seed_mode = os.environ.get("SEED_MODE", "once").strip().lower()
    if seed_mode not in {"once", "force", "off"}:
        seed_mode = "once"
    seed_state_key = "__system.seed_state"
    seed_state_doc = await db.settings.find_one({"key": seed_state_key}, {"_id": 0, "value": 1})
    seed_state_value = {}
    if seed_state_doc and seed_state_doc.get("value"):
        try:
            seed_state_value = json.loads(seed_state_doc.get("value", "{}"))
        except (json.JSONDecodeError, TypeError):
            seed_state_value = {}
    already_seeded = bool(seed_state_value.get("demo_seed_completed"))
    if seed_mode == "off":
        logger.info("SEED_MODE=off → skipping destructive demo seed")
        return
    if seed_mode == "once":
        if already_seeded:
            logger.info("SEED_MODE=once and seed marker found → skipping destructive demo seed")
            return
        existing_incidents = await db.incidents.count_documents({})
        if existing_incidents > 0:
            logger.info(
                "SEED_MODE=once with %s existing incident(s) and no seed marker → preserving data and marking seed complete",
                existing_incidents,
            )
            await db.settings.update_one(
                {"key": seed_state_key},
                {
                    "$set": {
                        "key": seed_state_key,
                        "value": json.dumps({
                            "demo_seed_completed": True,
                            "seed_mode": "once",
                            "seeded_at": datetime.now(timezone.utc).isoformat(),
                            "preserved_existing_data": True,
                        }),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
                upsert=True,
            )
            return

    # Demo users — one per tender-aligned role (+ second admin for last-admin tests); local/dev only
    users_seed = [
        {"email": "admin2@tgsrtc.com", "name": "Administrator (2)", "role": "admin", "password": "Admin2123!"},
        {"email": "management@tgsrtc.com", "name": "Management demo", "role": "management", "password": "Mgmt123!"},
        {"email": "depot@tgsrtc.com", "name": "Depot operations demo", "role": "depot", "password": "depot123"},
        {"email": "vendor@tgsrtc.com", "name": "Vendor / concessionaire demo", "role": "vendor", "password": "vendor123"},
    ]
    for u in users_seed:
        if not await db.users.find_one({"email": u["email"]}):
            await db.users.insert_one({
                "email": u["email"], "password_hash": hash_password(u["password"]),
                "name": u["name"], "role": u["role"], "created_at": datetime.now(timezone.utc).isoformat()
            })
    # Tenders (lean demo: 2)
    await db.tenders.delete_many({})
    tenders = [
        {"tender_id": "TND-001", "concessionaire": "City EV Operations Pvt Ltd", "pk_rate": 85, "energy_rate": 8.5, "description": "Hyderabad City Routes Phase-1", "status": "active", "annual_assured_bus_km": 72000, "created_at": datetime.now(timezone.utc).isoformat()},
        {"tender_id": "TND-002", "concessionaire": "Metro Mobility Services LLP", "pk_rate": 92, "energy_rate": 9.0, "description": "Secunderabad Express Routes", "status": "active", "annual_assured_bus_km": 72000, "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.tenders.insert_many(tenders)
    await sync_tender_annual_assured_bus_km_defaults()
    depot_names = ["Miyapur Depot", "LB Nagar Depot"]
    await db.depots.delete_many({})
    now_d = datetime.now(timezone.utc).isoformat()
    await db.depots.insert_many(
        [
            {
                "name": n,
                "code": "",
                "address": "Telangana, India",
                "active": True,
                "created_at": now_d,
                "updated_at": now_d,
            }
            for n in depot_names
        ]
    )
    await db.buses.delete_many({})
    buses = []
    _bus_types = list(KWH_PER_KM_BY_BUS_TYPE.keys())
    tender_alternation = ["TND-001", "TND-002"]
    depot_alternation = ["Miyapur Depot", "LB Nagar Depot"]
    for i in range(5):
        bt = _bus_types[i % len(_bus_types)]
        kwh = kwh_per_km_for_bus_type(bt)
        tid = tender_alternation[i % 2]
        dep = depot_alternation[i % 2]
        row = {
            "bus_id": f"TS-{str(i + 1).zfill(3)}",
            "bus_type": bt,
            "capacity": [32, 40, 50][i % 3],
            "tender_id": tid,
            "depot": dep,
            "status": "active",
            "kwh_per_km": kwh,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        # Demo assignable assured km (per year): first two buses carry explicit overrides (wins over tender in UI).
        if i == 0:
            row["annual_assured_km_override"] = 75000
        elif i == 1:
            row["annual_assured_km_override"] = 68000
        buses.append(row)
    await db.buses.insert_many(buses)
    # Drivers (5; TS-001..005)
    driver_names = ["Ravi Kumar", "Suresh Reddy", "Venkat Rao", "Anjali Devi", "Prasad M"]
    await db.drivers.delete_many({})
    drivers = []
    for i, name in enumerate(driver_names):
        drivers.append({
            "id": f"DRV-{str(i + 1).zfill(3)}",
            "name": name,
            "license_number": f"TS-DL-{2020 + i}-100{i + 1}",
            "phone": f"987654321{i}",
            "bus_id": f"TS-{str(i + 1).zfill(3)}",
            "status": "active",
            "rating": round(4.0 + 0.2 * i, 1),
            "penalties": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    await db.drivers.insert_many(drivers)
    await db.role_permissions.delete_many({"role_id": {"$nin": list(ALLOWED_ROLE_IDS)}})
    for rid in ALLOWED_ROLE_IDS:
        if not await db.role_permissions.find_one({"role_id": rid}):
            await db.role_permissions.insert_one(
                {"role_id": rid, "permission_ids": default_permission_ids_for_role(rid)}
            )

    async def _resync_stale_role_permissions():
        """Reset matrix rows that reference removed permission ids (catalog upgrades)."""
        await db.role_permissions.delete_many({"role_id": {"$nin": list(ALLOWED_ROLE_IDS)}})
        async for doc in db.role_permissions.find({}):
            rid = doc.get("role_id")
            ids = list(doc.get("permission_ids") or [])
            if not ids or any(x not in ALL_PERMISSION_IDS for x in ids):
                await db.role_permissions.update_one(
                    {"role_id": rid},
                    {"$set": {"permission_ids": default_permission_ids_for_role(rid)}},
                )

    await _resync_stale_role_permissions()
    await db.conductors.delete_many({})
    c_names = ["Kiran Rao", "Neha Sharma", "Arun Prasad", "Divya Iyer", "Imran Khan"]
    cond = []
    for i, name in enumerate(c_names):
        cond.append(
            {
                "conductor_id": f"CND-{str(i + 1).zfill(4)}",
                "name": name,
                "badge_no": f"BDG-{2100 + i}",
                "phone": f"976543210{i}",
                "depot": depot_alternation[i % 2],
                "status": "active",
                "total_trips": 200 + i * 10,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    await db.conductors.insert_many(cond)

    def _stop_seq(ids: list[str]) -> list[dict]:
        return [{"stop_id": sid, "seq": j + 1} for j, sid in enumerate(ids)]

    lean_stop_master_seed = [
        {"stop_id": "ST-HYD-MYP-BS", "name": "Miyapur Bus Stand", "locality": "Miyapur", "landmark": "Near Miyapur metro", "region": "Hyderabad", "lat": 17.4979, "lng": 78.3617, "active": True},
        {"stop_id": "ST-HYD-KKP-HB", "name": "Kukatpally HB Colony", "locality": "Kukatpally", "landmark": "Y-junction", "region": "Hyderabad", "lat": 17.4949, "lng": 78.4002, "active": True},
        {"stop_id": "ST-HYD-AME", "name": "Ameerpet", "locality": "Ameerpet", "landmark": "Metro interchange", "region": "Hyderabad", "lat": 17.4353, "lng": 78.4447, "active": True},
        {"stop_id": "ST-HYD-BEG", "name": "Begumpet", "locality": "Begumpet", "landmark": "", "region": "Hyderabad", "lat": 17.4442, "lng": 78.4708, "active": True},
        {"stop_id": "ST-HYD-PAR", "name": "Paradise", "locality": "Secunderabad", "landmark": "Opp. railway station", "region": "Hyderabad", "lat": 17.4417, "lng": 78.4872, "active": True},
        {"stop_id": "ST-HYD-LBN-RR", "name": "LB Nagar Ring Road", "locality": "LB Nagar", "landmark": "Depot approach", "region": "Hyderabad", "lat": 17.3507, "lng": 78.5475, "active": True},
        {"stop_id": "ST-HYD-DIL", "name": "Dilsukhnagar", "locality": "Dilsukhnagar", "landmark": "Chandana Bros", "region": "Hyderabad", "lat": 17.3704, "lng": 78.5254, "active": True},
        {"stop_id": "ST-HYD-MAL", "name": "Malakpet", "locality": "Malakpet", "landmark": "", "region": "Hyderabad", "lat": 17.3736, "lng": 78.4988, "active": True},
        {"stop_id": "ST-HYD-AFZ", "name": "Afzalgunj", "locality": "Afzalgunj", "landmark": "", "region": "Hyderabad", "lat": 17.3744, "lng": 78.4761, "active": True},
        {"stop_id": "ST-HYD-MGBS", "name": "MGBS", "locality": "MGBS", "landmark": "Imperial", "region": "Hyderabad", "lat": 17.3773, "lng": 78.4836, "active": True},
        {"stop_id": "ST-HYD-KPHB", "name": "KPHB Colony", "locality": "Kukatpally", "landmark": "Phase-3", "region": "Hyderabad", "lat": 17.4878, "lng": 78.3955, "active": True},
        {"stop_id": "ST-HYD-SRN", "name": "SR Nagar", "locality": "SR Nagar", "landmark": "", "region": "Hyderabad", "lat": 17.4432, "lng": 78.4406, "active": True},
        {"stop_id": "ST-HYD-ABI", "name": "Abids", "locality": "Abids", "landmark": "", "region": "Hyderabad", "lat": 17.3935, "lng": 78.4763, "active": True},
        {"stop_id": "ST-HYD-CHR", "name": "Charminar", "locality": "Old City", "landmark": "Monument circle", "region": "Hyderabad", "lat": 17.3616, "lng": 78.4747, "active": True},
        {"stop_id": "ST-HYD-SEC-STN", "name": "Secunderabad Station", "locality": "Secunderabad", "landmark": "", "region": "Hyderabad", "lat": 17.4337, "lng": 78.5016, "active": True},
        {
            "stop_id": "ST-HYD-UPP-OR",
            "name": "Uppal Ring Road",
            "locality": "Uppal",
            "landmark": "NH163",
            "region": "Hyderabad",
            "lat": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-UPP-OR"][0],
            "lng": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-UPP-OR"][1],
            "active": True,
        },
        {
            "stop_id": "ST-HYD-GHT",
            "name": "Ghatkesar",
            "locality": "Ghatkesar",
            "landmark": "ORR exit",
            "region": "Hyderabad",
            "lat": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-GHT"][0],
            "lng": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-GHT"][1],
            "active": True,
        },
        {
            "stop_id": "ST-HYD-BHO",
            "name": "Bhongir",
            "locality": "Bhongir",
            "landmark": "",
            "region": "Hyderabad",
            "lat": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-BHO"][0],
            "lng": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-BHO"][1],
            "active": True,
        },
        {"stop_id": "ST-HYD-WRL", "name": "Warangal Bus Stand", "locality": "Warangal", "landmark": "GWMC", "region": "Hyderabad", "lat": 17.9745, "lng": 79.6054, "active": True},
        {
            "stop_id": "ST-HYD-UPP-MET",
            "name": "Uppal Metro",
            "locality": "Uppal",
            "landmark": "",
            "region": "Hyderabad",
            "lat": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-UPP-MET"][0],
            "lng": _DEMO_STOP_COORD_OVERRIDES["ST-HYD-UPP-MET"][1],
            "active": True,
        },
    ]
    lean_route_stop_ids = {
        "RT-101": ["ST-HYD-MYP-BS", "ST-HYD-KKP-HB", "ST-HYD-AME", "ST-HYD-BEG", "ST-HYD-PAR"],
        "RT-202": ["ST-HYD-LBN-RR", "ST-HYD-DIL", "ST-HYD-MAL", "ST-HYD-AFZ", "ST-HYD-MGBS"],
        "RT-303": ["ST-HYD-KPHB", "ST-HYD-SRN", "ST-HYD-ABI", "ST-HYD-CHR"],
        "RT-404": ["ST-HYD-SEC-STN", "ST-HYD-UPP-OR", "ST-HYD-GHT", "ST-HYD-BHO", "ST-HYD-WRL"],
        "RT-505": ["ST-HYD-UPP-MET", "ST-HYD-PAR", "ST-HYD-BEG", "ST-HYD-AME"],
    }
    route_seed_docs = [
        {
            "route_id": "RT-101",
            "name": "Route-101 Miyapur-Secunderabad",
            "origin": "Miyapur",
            "destination": "Secunderabad",
            "distance_km": 28.5,
            "depot": "Miyapur Depot",
            "active": True,
        },
        {
            "route_id": "RT-202",
            "name": "Route-202 LB Nagar-MGBS",
            "origin": "LB Nagar",
            "destination": "MGBS",
            "distance_km": 22.0,
            "depot": "LB Nagar Depot",
            "active": True,
        },
        {
            "route_id": "RT-303",
            "name": "Route-303 Kukatpally-Charminar",
            "origin": "Kukatpally",
            "destination": "Charminar",
            "distance_km": 19.0,
            "depot": "Miyapur Depot",
            "active": True,
        },
        {
            "route_id": "RT-404",
            "name": "Route-404 Secunderabad-Warangal",
            "origin": "Secunderabad",
            "destination": "Warangal",
            "distance_km": 145.0,
            "depot": "Miyapur Depot",
            "active": True,
        },
        {
            "route_id": "RT-505",
            "name": "Route-505 Uppal-Mehdipatnam",
            "origin": "Uppal",
            "destination": "Mehdipatnam",
            "distance_km": 24.0,
            "depot": "LB Nagar Depot",
            "active": True,
        },
    ]
    poly_path = Path(__file__).resolve().parent / "data" / "route_polylines.json"
    poly_map: dict = {}
    if poly_path.is_file():
        try:
            poly_map = json.loads(poly_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            poly_map = {}
    _charging_demo_status = ("available", "occupied", "maintenance", "offline", "unknown")
    for _i, _r in enumerate(route_seed_docs):
        _ids = lean_route_stop_ids.get(_r["route_id"], [])
        _r["stop_sequence"] = _stop_seq(_ids)
        _r["encoded_polyline"] = poly_map.get(_r["route_id"], "")
        # Alternate EV charging point: pick a stop on this route (2nd leg when possible).
        _r["alternate_charging_stop_id"] = _ids[1] if len(_ids) > 1 else (_ids[0] if _ids else "")
        _r["charging_point_status"] = _charging_demo_status[_i % len(_charging_demo_status)]
    await db.stop_master.delete_many({})
    await db.routes.delete_many({})
    await db.terminal_master.delete_many({})
    now_sm = datetime.now(timezone.utc).isoformat()
    for sm in lean_stop_master_seed:
        await db.stop_master.insert_one({**sm, "updated_at": now_sm, "created_at": now_sm})
    now_r = datetime.now(timezone.utc).isoformat()
    await db.routes.insert_many([{**r, "created_at": now_r, "updated_at": now_r} for r in route_seed_docs])
    # Bus stands (terminals): linked_stop_ids tie to stop_master; lat/lng overrides from map research (demo).
    now_tm = datetime.now(timezone.utc).isoformat()
    _terminal_lean_seed = [
        {
            "terminal_id": "TRM-HYD-MGBS",
            "name": "Mahatma Gandhi Bus Station (MGBS)",
            "locality": "Imperial",
            "landmark": "Imlibun",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-MGBS"],
            "lat": 17.3844,
            "lng": 78.4877,
            "active": True,
            "notes": "Major intercity terminal — demo override coords",
        },
        {
            "terminal_id": "TRM-HYD-MYP-BS",
            "name": "Miyapur Bus Stand",
            "locality": "Miyapur",
            "landmark": "Near Miyapur metro",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-MYP-BS"],
            "lat": 17.4969,
            "lng": 78.3576,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-LBN-RR",
            "name": "LB Nagar Bus Stand (Ring Road)",
            "locality": "LB Nagar",
            "landmark": "Depot approach",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-LBN-RR"],
            "lat": 17.3473,
            "lng": 78.5571,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-KPHB",
            "name": "KPHB Colony Bus Stand",
            "locality": "Kukatpally",
            "landmark": "Phase-3",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-KPHB"],
            "lat": 17.4938,
            "lng": 78.3994,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-SEC-STN",
            "name": "Secunderabad Station Bus Stand",
            "locality": "Secunderabad",
            "landmark": "Railway station",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-SEC-STN"],
            "lat": 17.4397,
            "lng": 78.4983,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-PAR",
            "name": "Paradise Bus Stand",
            "locality": "Secunderabad",
            "landmark": "Opp. railway station",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-PAR"],
            "lat": 17.4437,
            "lng": 78.4872,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-DIL",
            "name": "Dilsukhnagar Bus Stand",
            "locality": "Dilsukhnagar",
            "landmark": "Chandana Bros",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-DIL"],
            "lat": 17.3612,
            "lng": 78.5241,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-AFZ",
            "name": "Afzalgunj Bus Stand",
            "locality": "Afzalgunj",
            "landmark": "",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-AFZ"],
            "lat": 17.3762,
            "lng": 78.4742,
            "active": True,
            "notes": "",
        },
        {
            "terminal_id": "TRM-HYD-WRL",
            "name": "Warangal Bus Stand (GWMC)",
            "locality": "Warangal",
            "landmark": "GWMC",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-WRL"],
            "lat": 17.9779,
            "lng": 79.5947,
            "active": True,
            "notes": "Outstation terminal — demo",
        },
        {
            "terminal_id": "TRM-HYD-UPP-MET",
            "name": "Uppal Metro Bus Stand",
            "locality": "Uppal",
            "landmark": "Metro corridor",
            "region": "Hyderabad",
            "linked_stop_ids": ["ST-HYD-UPP-MET"],
            "lat": 17.4056,
            "lng": 78.5592,
            "active": True,
            "notes": "",
        },
    ]
    await db.terminal_master.insert_many(
        [{**t, "created_at": now_tm, "updated_at": now_tm} for t in _terminal_lean_seed]
    )
    tim_route_names = [r["name"] for r in route_seed_docs]

    # Unified synchronized operational dataset (lean: 5 duties, 10 trips, one service day).
    await db.duty_assignments.delete_many({})
    await db.trip_data.delete_many({})
    await db.energy_data.delete_many({})
    await db.revenue_data.delete_many({})
    await db.incidents.delete_many({})
    # db.infractions_logged is deprecated; removing it from seed reset logic.
    await db.billing.delete_many({})

    active_buses = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(500)
    operational_buses = await db.buses.find({"status": {"$in": ["active", "maintenance"]}}, {"_id": 0}).to_list(500)
    all_routes = [
        {
            "route_id": r["route_id"],
            "name": r["name"],
            "origin": r["origin"],
            "destination": r["destination"],
            "depot": r["depot"],
            "distance_km": r["distance_km"],
        }
        for r in route_seed_docs
    ]
    drivers_list = await db.drivers.find({"status": "active"}, {"_id": 0}).to_list(500)
    driver_by_bus = {d.get("bus_id", ""): d for d in drivers_list if d.get("bus_id")}
    fallback_drivers = list(drivers_list)
    conductors_list = await db.conductors.find({"status": "active"}, {"_id": 0}).to_list(500)
    conductors_by_depot: dict[str, list[dict]] = {}
    for c in conductors_list:
        dep = str(c.get("depot", "") or "")
        conductors_by_depot.setdefault(dep, []).append(c)
    fallback_conductors = list(conductors_list)

    base_now = datetime.now(timezone.utc)
    trips_docs = []
    duties_docs = []
    energy_docs = []
    revenue_docs = []
    incidents_docs = []

    random.seed(42)
    route_ptr = 0
    day_dt = base_now
    day = day_dt.strftime("%Y-%m-%d")
    # One service day, five buses → five duties, two trip legs each (10 trip_data rows).
    for bi, bus in enumerate(operational_buses[:5]):
        if str(bus.get("status", "")).lower() != "active":
            continue
        bus_id = bus["bus_id"]
        drv = driver_by_bus.get(bus_id) or (fallback_drivers[bi % len(fallback_drivers)] if fallback_drivers else {})
        depot_name = str(bus.get("depot", "") or "")
        dep_cond = conductors_by_depot.get(depot_name) or fallback_conductors
        cond = dep_cond[bi % len(dep_cond)] if dep_cond else {}
        route = all_routes[route_ptr % len(all_routes)]
        route_ptr += 1

        duty_id = f"DTY-{day.replace('-', '')}-{bus_id}"
        start_h = 6 + (bi % 4) * 2
        duty_trips = []
        total_actual_km = 0.0
        total_sched_km = 0.0

        for trip_no in (1, 2):
            trip_start = start_h + (trip_no - 1) * 3
            trip_id = f"TRP-{day.replace('-', '')}-{bus_id}-{trip_no}"
            is_tim_completed = bi < 2 and trip_no == 1
            scheduled_km = float(max(8, round(float(route.get("distance_km", 20) or 20) * (0.88 + 0.015 * bi), 2)))
            actual_km = float(max(0.0, round(scheduled_km * 0.96, 2)))
            total_sched_km += scheduled_km
            total_actual_km += actual_km
            cap = int(bus.get("capacity", 40) or 40)
            passengers = int(max(8, min(cap * 3, 140)))
            revenue_amount = float(round(passengers * 12.0, 2))
            traffic_ok = True
            maint_ok = True
            trip_doc = {
                "trip_id": trip_id,
                "bus_id": bus_id,
                "driver_id": drv.get("license_number", ""),
                "date": day,
                "scheduled_km": scheduled_km,
                "actual_km": actual_km,
                "plan_start_time": f"{trip_start:02d}:00",
                "plan_end_time": f"{trip_start + 1:02d}:45",
                "actual_start_time": f"{trip_start:02d}:05",
                "planned_trip_duration_min": 105,
                "actual_end_time": f"{trip_start + 2:02d}:10",
                "start_time": f"{trip_start:02d}:00",
                "end_time": f"{trip_start + 2:02d}:00",
                "traffic_km_approved": traffic_ok,
                "traffic_km_approved_at": day_dt.isoformat() if traffic_ok else "",
                "traffic_km_approved_by": "Seed / First verification" if traffic_ok else "",
                "maintenance_km_finalized": maint_ok,
                "maintenance_km_finalized_at": day_dt.isoformat() if maint_ok else "",
                "maintenance_km_finalized_by": "Seed / Final verification" if maint_ok else "",
                "route_id": route.get("route_id", ""),
                "route_name": route.get("name", ""),
                "duty_id": duty_id,
            }
            trips_docs.append(trip_doc)
            duty_trips.append(
                {
                    "trip_number": trip_no,
                    "trip_id": trip_id,
                    "start_point": route.get("origin", "") if trip_no == 1 else route.get("destination", ""),
                    "end_point": route.get("destination", "") if trip_no == 1 else route.get("origin", ""),
                    "start_time": f"{trip_start:02d}:00",
                    "end_time": f"{trip_start + 2:02d}:00",
                    "actual_start_time": f"{trip_start:02d}:05",
                    "actual_end_time": f"{trip_start + 2:02d}:10",
                    "trip_status": "completed" if is_tim_completed else "scheduled",
                    "cancel_reason_code": "none",
                    "cancel_reason_custom": "",
                    "direction": "outward" if trip_no == 1 else "return",
                }
            )
            revenue_docs.append(
                {
                    "bus_id": bus_id,
                    "date": day,
                    "depot": bus.get("depot", ""),
                    "route": route.get("name", ""),
                    "revenue_amount": revenue_amount,
                    "passengers": passengers,
                    "trip_id": trip_id,
                    "duty_id": duty_id,
                    "source": "ticket_issuing_machine",
                }
            )

        kwh_per_km = float(bus.get("kwh_per_km", 1.0) or 1.0)
        energy_docs.append(
            {
                "bus_id": bus_id,
                "date": day,
                "units_charged": round(total_actual_km * kwh_per_km * 1.02, 2),
                "tariff_rate": 8.5,
            }
        )
        duties_docs.append(
            {
                "id": duty_id,
                "driver_license": drv.get("license_number", ""),
                "driver_name": drv.get("name", ""),
                "driver_phone": drv.get("phone", ""),
                "conductor_id": cond.get("conductor_id", ""),
                "conductor_name": cond.get("name", ""),
                "conductor_phone": cond.get("phone", ""),
                "bus_id": bus_id,
                "depot": bus.get("depot", ""),
                "route_id": route.get("route_id", ""),
                "route_name": route.get("name", ""),
                "start_point": route.get("origin", ""),
                "end_point": route.get("destination", ""),
                "punctuality_scheduled_departure": duty_trips[0].get("start_time", "") if duty_trips else "",
                "punctuality_scheduled_arrival": duty_trips[-1].get("end_time", "") if duty_trips else "",
                "punctuality_actual_departure": duty_trips[0].get("actual_start_time", "") if duty_trips else "",
                "punctuality_actual_arrival": duty_trips[-1].get("actual_end_time", "") if duty_trips else "",
                "date": day,
                "trips": duty_trips,
                "attribution_context": "operator_fault",
                "duty_exception_reason": "",
                "punctuality_review": {
                    "policy": "punctuality",
                    "violations": [],
                    "decisions": [],
                    "computed_at": day_dt.isoformat(),
                },
                "status": "assigned",
                "sms_sent": True,
                "sms_message": f"TGSRTC Duty Alert: duty on {day} for {bus_id}",
                "created_at": day_dt.isoformat(),
                "created_by": "System",
            }
        )

    # Fixed demo duty for docs / KPI references: DTY-20260419-TS-002 (first leg completed, second scheduled).
    _anchor_ids = {d["id"] for d in duties_docs}
    _anchor_bus = next(
        (
            b
            for b in operational_buses
            if str(b.get("bus_id", "")).strip() == "TS-002" and str(b.get("status", "")).lower() == "active"
        ),
        None,
    )
    if _anchor_bus and all_routes and "DTY-20260419-TS-002" not in _anchor_ids:
        _day = "2026-04-19"
        _route = all_routes[0]
        bus = _anchor_bus
        bus_id = str(bus.get("bus_id", "TS-002"))
        drv = driver_by_bus.get(bus_id) or (fallback_drivers[0] if fallback_drivers else {})
        depot_name = str(bus.get("depot", "") or "")
        dep_cond = conductors_by_depot.get(depot_name) or fallback_conductors
        cond = dep_cond[0] if dep_cond else {}
        duty_id = "DTY-20260419-TS-002"
        anchor_dt = datetime(2026, 4, 19, 8, 0, 0, tzinfo=timezone.utc)
        start_h = 7
        duty_trips: list[dict] = []
        total_actual_km = 0.0
        total_sched_km = 0.0
        for trip_no in (1, 2):
            trip_start = start_h + (trip_no - 1) * 3
            trip_id = f"TRP-{_day.replace('-', '')}-{bus_id}-{trip_no}"
            is_first_completed = trip_no == 1
            scheduled_km = float(max(8, round(float(_route.get("distance_km", 20) or 20) * 0.9, 2)))
            actual_km = float(max(0.0, round(scheduled_km * 0.96, 2)))
            total_sched_km += scheduled_km
            total_actual_km += actual_km
            cap = int(bus.get("capacity", 40) or 40)
            passengers = int(max(8, min(cap * 3, 140)))
            revenue_amount = float(round(passengers * 12.0, 2))
            traffic_ok = True
            maint_ok = True
            trip_doc = {
                "trip_id": trip_id,
                "bus_id": bus_id,
                "driver_id": drv.get("license_number", ""),
                "date": _day,
                "scheduled_km": scheduled_km,
                "actual_km": actual_km,
                "plan_start_time": f"{trip_start:02d}:00",
                "plan_end_time": f"{trip_start + 1:02d}:45",
                "actual_start_time": f"{trip_start:02d}:05",
                "planned_trip_duration_min": 105,
                "actual_end_time": f"{trip_start + 2:02d}:10",
                "start_time": f"{trip_start:02d}:00",
                "end_time": f"{trip_start + 2:02d}:00",
                "traffic_km_approved": traffic_ok,
                "traffic_km_approved_at": anchor_dt.isoformat() if traffic_ok else "",
                "traffic_km_approved_by": "Seed / First verification" if traffic_ok else "",
                "maintenance_km_finalized": maint_ok,
                "maintenance_km_finalized_at": anchor_dt.isoformat() if maint_ok else "",
                "maintenance_km_finalized_by": "Seed / Final verification" if maint_ok else "",
                "route_id": _route.get("route_id", ""),
                "route_name": _route.get("name", ""),
                "duty_id": duty_id,
            }
            trips_docs.append(trip_doc)
            duty_trips.append(
                {
                    "trip_number": trip_no,
                    "trip_id": trip_id,
                    "start_point": _route.get("origin", "") if trip_no == 1 else _route.get("destination", ""),
                    "end_point": _route.get("destination", "") if trip_no == 1 else _route.get("origin", ""),
                    "start_time": f"{trip_start:02d}:00",
                    "end_time": f"{trip_start + 2:02d}:00",
                    "actual_start_time": f"{trip_start:02d}:05",
                    "actual_end_time": f"{trip_start + 2:02d}:10",
                    "trip_status": "completed" if is_first_completed else "scheduled",
                    "cancel_reason_code": "none",
                    "cancel_reason_custom": "",
                    "direction": "outward" if trip_no == 1 else "return",
                }
            )
            revenue_docs.append(
                {
                    "bus_id": bus_id,
                    "date": _day,
                    "depot": bus.get("depot", ""),
                    "route": _route.get("name", ""),
                    "revenue_amount": revenue_amount,
                    "passengers": passengers,
                    "trip_id": trip_id,
                    "duty_id": duty_id,
                    "source": "ticket_issuing_machine",
                }
            )
        kwh_per_km = float(bus.get("kwh_per_km", 1.0) or 1.0)
        energy_docs.append(
            {
                "bus_id": bus_id,
                "date": _day,
                "units_charged": round(total_actual_km * kwh_per_km * 1.02, 2),
                "tariff_rate": 8.5,
            }
        )
        duties_docs.append(
            {
                "id": duty_id,
                "driver_license": drv.get("license_number", ""),
                "driver_name": drv.get("name", ""),
                "driver_phone": drv.get("phone", ""),
                "conductor_id": cond.get("conductor_id", ""),
                "conductor_name": cond.get("name", ""),
                "conductor_phone": cond.get("phone", ""),
                "bus_id": bus_id,
                "depot": bus.get("depot", ""),
                "route_id": _route.get("route_id", ""),
                "route_name": _route.get("name", ""),
                "start_point": _route.get("origin", ""),
                "end_point": _route.get("destination", ""),
                "punctuality_scheduled_departure": duty_trips[0].get("start_time", "") if duty_trips else "",
                "punctuality_scheduled_arrival": duty_trips[-1].get("end_time", "") if duty_trips else "",
                "punctuality_actual_departure": duty_trips[0].get("actual_start_time", "") if duty_trips else "",
                "punctuality_actual_arrival": duty_trips[-1].get("actual_end_time", "") if duty_trips else "",
                "date": _day,
                "trips": duty_trips,
                "attribution_context": "operator_fault",
                "duty_exception_reason": "",
                "punctuality_review": {
                    "policy": "punctuality",
                    "violations": [],
                    "decisions": [],
                    "computed_at": anchor_dt.isoformat(),
                },
                "status": "assigned",
                "sms_sent": True,
                "sms_message": f"TGSRTC Duty Alert: duty on {_day} for {bus_id}",
                "created_at": anchor_dt.isoformat(),
                "created_by": "System",
            }
        )

    master_rows = build_master_rows()
    by_code = {m["code"]: m for m in master_rows}

    def _embed_infractions_for_seed(codes: list[str], occurred_iso: str, inf_status: str = "open") -> list[dict]:
        out = []
        now_iso = datetime.now(timezone.utc).isoformat()
        occ_d = (occurred_iso or "")[:10]
        for code in codes:
            cat = by_code.get(code, {})
            res_days = int(cat.get("resolve_days", 1))
            res_by = _add_days_ymd(occ_d, res_days)
            amt = float(cat.get("amount", 0))
            out.append(
                {
                    "infraction_code": code,
                    "category": str(cat.get("category", "A")),
                    "description": cat.get("description", ""),
                    "amount": amt,
                    "amount_current": amt,
                    "amount_snapshot": amt,
                    "safety_flag": bool(cat.get("safety_flag", False)),
                    "schedule_group": str(cat.get("schedule_group") or cat.get("pillar", "operations")),
                    "pillar": str(cat.get("schedule_group") or cat.get("pillar", "operations")),
                    "resolve_days": res_days,
                    "resolve_by": res_by,
                    "deductible": True,
                    "status": inf_status,
                    "opened_at": now_iso,
                    "created_at": now_iso,
                    "closed_at": "" if inf_status == "open" else now_iso,
                    "close_remarks": "" if inf_status == "open" else "Seed closure",
                }
            )
        return out

    # Demo incidents — Schedule-S + 16.6 (0xx) + O-series rows (lean set of 10). Re-seed to refresh.
    if active_buses and all_routes:
        demo_specs = [
            ("INC-DEMO-001", "OVERSPEED", ["E01"], "system", "medium", "investigating", "Overspeed threshold breach — linked E01."),
            ("INC-DEMO-002", "ITS_GPS_FAILURE", ["B08"], "system", "high", "investigating", "AIS-140 / VTS defect — B08."),
            ("INC-DEMO-003", "ROUTE_DEVIATION", ["B06"], "system", "medium", "in_progress", "Unauthorized deviation — B06."),
            ("INC-DEMO-004", "IDLE_EXCESS", ["A12"], "system", "low", "in_progress", "Excessive idle — A12."),
            ("INC-DEMO-005", "PANIC_OR_SECURITY", ["O03"], "system", "high", "investigating", "Security or vandalism case (O03) with narrative."),
            ("INC-DEMO-006", "BUNCHING_ALERT", ["B05"], "system", "medium", "investigating", "Bunching / parking — B05."),
            ("INC-DEMO-007", "HARNESS_REMOVAL", ["C09"], "system", "high", "in_progress", "On-board equipment tamper — C09."),
            ("INC-DEMO-008", "ACCIDENT", ["C04"], "system", "high", "investigating", "Minor road accident — C04."),
            ("INC-DEMO-009", "BREAKDOWN", ["C12"], "manual", "medium", "in_progress", "Breakdown KM loss — C12 (manual report)."),
            ("INC-DEMO-010", "PASSENGER_COMPLAINT", ["C13"], "manual", "low", "investigating", "AC service complaint — C13 (manual)."),
        ]
        for i, (iid, itype, icodes, ch, sev, st, desc) in enumerate(demo_specs):
            bus = active_buses[i % len(active_buses)]
            route = all_routes[i % len(all_routes)]
            bus_id = bus["bus_id"]
            drv = driver_by_bus.get(bus_id) or (fallback_drivers[i % len(fallback_drivers)] if fallback_drivers else {})
            lic = str(drv.get("license_number", "") or "")
            day_dt = base_now - timedelta(days=i + 1)
            occurred_at = day_dt.replace(hour=10, minute=15, second=0, microsecond=0).isoformat()
            inf_st = "closed" if i in (1, 3, 8) else "open"
            # Keep incident trip/duty linkage consistent with seeded trip_data rows.
            linked_trip = trips_docs[i % len(trips_docs)] if trips_docs else {}
            linked_trip_id = str(linked_trip.get("trip_id", "") or "")
            linked_duty_id = str(linked_trip.get("duty_id", "") or "")
            linked_route_id = str(linked_trip.get("route_id", "") or route.get("route_id", ""))
            linked_route_name = str(linked_trip.get("route_name", "") or route.get("name", ""))
            # Keep mock incident_type in sync with current bridge mapping.
            inferred_type = infer_incident_type_from_infraction_code(icodes[0]) if icodes else itype
            incidents_docs.append(
                {
                    "id": iid,
                    "incident_type": inferred_type,
                    "description": desc,
                    "occurred_at": occurred_at,
                    "vehicles_affected": [bus_id],
                    "vehicles_affected_count": 1,
                    "damage_summary": "",
                    "engineer_action": "",
                    "bus_id": bus_id,
                    "driver_id": lic,
                    "depot": bus.get("depot", ""),
                    "route_name": linked_route_name,
                    "route_id": linked_route_id,
                    "trip_id": linked_trip_id,
                    "duty_id": linked_duty_id,
                    "related_infraction_id": "",
                    "location_text": route.get("origin", ""),
                    "severity": sev,
                    "channel": ch,
                    "telephonic_reference": "",
                    "status": st,
                    "assigned_team": "Depot Maintenance" if st == "in_progress" else "",
                    "assigned_to": "",
                    "reported_by": "System",
                    "attachments": [],
                    "created_at": occurred_at,
                    "updated_at": occurred_at,
                    "activity_log": [{"at": occurred_at, "action": "created", "by": "System", "detail": "Seed incident (demo set)"}],
                    "infractions": _embed_infractions_for_seed(icodes, occurred_at, inf_st),
                }
            )

    if duties_docs:
        await db.duty_assignments.insert_many(duties_docs)
    if trips_docs:
        await db.trip_data.insert_many(trips_docs)
    if energy_docs:
        await db.energy_data.insert_many(energy_docs)
    if revenue_docs:
        await db.revenue_data.insert_many(revenue_docs)
    if incidents_docs:
        await db.incidents.insert_many(incidents_docs)

    # Seed synchronized billing invoices for latest period by depot + consolidated.
    today = base_now.date()
    p_start = (today - timedelta(days=29)).isoformat()
    p_end = today.isoformat()
    depot_values = sorted({b.get("depot", "") for b in operational_buses if b.get("depot")}) + ["All"]
    billing_seed_docs = []
    tender_by_id = {str(t.get("tender_id", "") or ""): t for t in tenders}
    seed_b, seed_c = await _billing_clause_2252_b_c_from_rules()
    seed_base_tar_b = (
        float(seed_b)
        if seed_b is not None
        else float(next(r["rule_value"] for r in BILLING_ELECTRICITY_RULE_DEFAULTS if r["rule_key"] == "electricity_base_tariff"))
    )
    seed_actual_tar_c = (
        float(seed_c)
        if seed_c is not None
        else float(next(r["rule_value"] for r in BILLING_ELECTRICITY_RULE_DEFAULTS if r["rule_key"] == "electricity_actual_tariff"))
    )
    for dep in depot_values:
        dep_buses = [b["bus_id"] for b in operational_buses if dep == "All" or b.get("depot") == dep]
        dep_bus_rows = [b for b in operational_buses if b.get("bus_id") in dep_buses]
        dep_tender_ids = sorted({str(b.get("tender_id", "") or "").strip() for b in dep_bus_rows if str(b.get("tender_id", "") or "").strip()})
        dep_concessionaires = sorted(
            {
                str(tender_by_id.get(tid, {}).get("concessionaire", "") or "").strip()
                for tid in dep_tender_ids
                if str(tender_by_id.get(tid, {}).get("concessionaire", "") or "").strip()
            }
        )
        dep_concessionaire_label = (
            dep_concessionaires[0]
            if len(dep_concessionaires) == 1
            else (" / ".join(dep_concessionaires[:3]) + (f" (+{len(dep_concessionaires) - 3})" if len(dep_concessionaires) > 3 else ""))
            if dep_concessionaires
            else "Unassigned"
        )
        dep_trips = [t for t in trips_docs if t.get("bus_id") in dep_buses]
        if not dep_trips:
            continue
        tkm = sum(float(t.get("actual_km", 0) or 0) for t in dep_trips)
        skm = sum(float(t.get("scheduled_km", 0) or 0) for t in dep_trips)
        bus_km = {}
        for t in dep_trips:
            bid = str(t.get("bus_id", "") or "")
            bus_km[bid] = bus_km.get(bid, 0.0) + float(t.get("actual_km", 0) or 0)
        weighted_pk = 0.0
        for brow in dep_bus_rows:
            bid = str(brow.get("bus_id", "") or "")
            km = float(bus_km.get(bid, 0.0) or 0.0)
            tid = str(brow.get("tender_id", "") or "")
            pk_rate = float(tender_by_id.get(tid, {}).get("pk_rate", 0) or 0)
            weighted_pk += km * pk_rate
        base_payment = weighted_pk
        avg_pk = (weighted_pk / tkm) if tkm > 0 else 0.0
        dep_energy = [e for e in energy_docs if e.get("bus_id") in dep_buses]
        actual_kwh = sum(float(e.get("units_charged", 0) or 0) for e in dep_energy)
        kwh_by_bus = {b["bus_id"]: float(b.get("kwh_per_km", 1.0) or 1.0) for b in operational_buses}
        allowed_kwh = sum(
            float(t.get("actual_km", 0) or 0) * kwh_by_bus.get(str(t.get("bus_id", "") or ""), 1.0)
            for t in dep_trips
        )
        base_tar_b = seed_base_tar_b
        actual_tar_c = seed_actual_tar_c
        energy_variation_kwh, energy_adj = clause_22_5_2_variation_rs(allowed_kwh, actual_kwh, base_tar_b, actual_tar_c)
        missed_km = max(0.0, skm - tkm)
        avail_ded = missed_km * avg_pk
        perf_ded = base_payment * 0.02
        sys_ded = base_payment * 0.01
        infra_ded = 0.0
        dep_bus_set = set(dep_buses)
        for inc in incidents_docs:
            if str(inc.get("bus_id", "") or "") not in dep_bus_set:
                continue
            for inf in inc.get("infractions") or []:
                code = str(inf.get("infraction_code", "") or "").upper().strip()
                amount = float(inf.get("amount", 0) or inf.get("amount_current", 0) or 0)
                if code in {"O01", "O03"} and amount <= 0:
                    amount = 20.0 * avg_pk
                infra_ded += amount
        total_ded = avail_ded + perf_ded + sys_ded + infra_ded
        excess = max(0.0, tkm - skm)
        final_payable = round(base_payment + energy_adj - total_ded, 2)
        wf = random.choice(["draft", "submitted", "paid"])
        appr = {"submitted_at": "", "approved_at": "", "paid_at": ""}
        if wf == "submitted":
            appr["submitted_at"] = base_now.isoformat()
        elif wf == "paid":
            appr["submitted_at"] = (base_now - timedelta(days=5)).isoformat()
            appr["paid_at"] = base_now.isoformat()
        billing_seed_docs.append(
            {
                "invoice_id": f"INV-SEED-{dep.replace(' ', '')[:8].upper()}",
                "period_start": p_start,
                "period_end": p_end,
                "depot": dep,
                "concessionaire": dep_concessionaire_label,
                "concessionaires": dep_concessionaires,
                "tender_ids": dep_tender_ids,
                "selected_bus_id": "",
                "selected_trip_id": "",
                "bus_ids": sorted(dep_buses),
                "bus_count": len(dep_buses),
                "total_km": round(tkm, 2),
                "avg_pk_rate": round(avg_pk, 2),
                "base_payment": round(base_payment, 2),
                "allowed_energy_kwh": round(allowed_kwh, 2),
                "actual_energy_kwh": round(actual_kwh, 2),
                "base_electricity_tariff": base_tar_b,
                "actual_electricity_tariff": actual_tar_c,
                "energy_variation_kwh": round(energy_variation_kwh, 2),
                "tariff_rate": actual_tar_c,
                "allowed_energy_cost": round(allowed_kwh * base_tar_b, 2),
                "actual_energy_cost": round(actual_kwh * actual_tar_c, 2),
                "energy_adjustment": round(energy_adj, 2),
                "excess_km": round(excess, 2),
                "km_incentive_factor": 0.0,
                "km_incentive": 0.0,
                "availability_deduction": round(avail_ded, 2),
                "performance_deduction": round(perf_ded, 2),
                "system_deduction": round(sys_ded, 2),
                "infractions_deduction": round(infra_ded, 2),
                "infractions_breakdown": {"total_applied": round(infra_ded, 2), "rows": []},
                "total_deduction": round(total_ded, 2),
                "final_payable": final_payable,
                "total_due": final_payable,
                "bus_wise_summary": [],
                "trip_wise_details": [],
                "invoice_components": {
                    "base_payment": round(base_payment, 2),
                    "energy_adjustment": round(energy_adj, 2),
                    "km_incentive": 0.0,
                    "total_deduction": round(total_ded, 2),
                },
                "artifact_refs": {
                    "payment_processing_note": "",
                    "proposal_note": "",
                    "show_cause_notice": "",
                    "gst_proof_ref": "",
                    "tax_withholding_ref": "",
                },
                "approval_dates": appr,
                "status": wf,
                "workflow_state": wf,
                "workflow_log": [],
                "created_at": base_now.isoformat(),
            }
        )
    if billing_seed_docs:
        await db.billing.insert_many(billing_seed_docs)
    use_synced_operational_seed = True
    # Trip data (last 30 days)
    if (not use_synced_operational_seed) and await db.trip_data.count_documents({}) == 0:
        trips = []
        buses_list = await db.buses.find({}, {"_id": 0}).to_list(100)
        drivers_list = await db.drivers.find({}, {"_id": 0}).to_list(100)
        for day_offset in range(30):
            date = (datetime.now(timezone.utc) - timedelta(days=day_offset)).strftime("%Y-%m-%d")
            for bus in buses_list:
                if bus.get("status") != "active":
                    continue
                scheduled = random.randint(180, 250)
                actual = scheduled - random.randint(0, 30)
                driver = next((d for d in drivers_list if d.get("bus_id") == bus["bus_id"]), None)
                # Planned vs actual trip times (concessionaire / deployment plan) for punctuality KPI
                plan_start_min = 6 * 60 + random.randint(0, 90)
                start_late_min = random.randint(0, 12)
                actual_start_min = plan_start_min + start_late_min
                trip_duration_min = random.randint(90, 150)
                end_late_min = random.randint(0, 22)
                actual_end_min = plan_start_min + trip_duration_min + end_late_min

                def _fmt_mins(m: int) -> str:
                    return f"{m // 60:02d}:{m % 60:02d}"

                # Tender §5 / matrix #10: traffic 1st-level KM sign-off; maintenance final (demo: older days complete).
                traffic_ok = day_offset >= 2
                maint_ok = traffic_ok and day_offset >= 5 and random.random() < 0.92
                now_iso = datetime.now(timezone.utc).isoformat()
                trips.append({
                    "trip_id": f"TRP-{bus['bus_id']}-{date}",
                    "bus_id": bus["bus_id"], "driver_id": driver.get("license_number", "") if driver else "",
                    "date": date, "scheduled_km": scheduled, "actual_km": max(actual, 150),
                    "plan_start_time": _fmt_mins(plan_start_min),
                    "plan_end_time": _fmt_mins(plan_start_min + trip_duration_min),
                    "actual_start_time": _fmt_mins(actual_start_min),
                    "planned_trip_duration_min": trip_duration_min,
                    "actual_end_time": _fmt_mins(actual_end_min),
                    # Friendly aliases used by KM verification table.
                    "start_time": _fmt_mins(actual_start_min),
                    "end_time": _fmt_mins(actual_end_min),
                    "traffic_km_approved": traffic_ok,
                    "traffic_km_approved_at": now_iso if traffic_ok else "",
                    "traffic_km_approved_by": "Seed / First verification" if traffic_ok else "",
                    "maintenance_km_finalized": maint_ok,
                    "maintenance_km_finalized_at": now_iso if maint_ok else "",
                    "maintenance_km_finalized_by": "Seed / Final verification" if maint_ok else "",
                })
        await db.trip_data.insert_many(trips)
    # Legacy trip rows: ensure KM approval flags exist (idempotent).
    await db.trip_data.update_many(
        {"traffic_km_approved": {"$exists": False}},
        {"$set": {"traffic_km_approved": False}},
    )
    await db.trip_data.update_many(
        {"maintenance_km_finalized": {"$exists": False}},
        {"$set": {"maintenance_km_finalized": False}},
    )
    # Energy data
    if (not use_synced_operational_seed) and await db.energy_data.count_documents({}) == 0:
        energy_records = []
        buses_list = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(100)
        for day_offset in range(30):
            date = (datetime.now(timezone.utc) - timedelta(days=day_offset)).strftime("%Y-%m-%d")
            for bus in buses_list:
                kwh = bus.get("kwh_per_km", 1.0)
                km = random.randint(160, 240)
                expected = km * kwh
                actual_units = expected * random.uniform(0.9, 1.15)
                energy_records.append({
                    "bus_id": bus["bus_id"], "date": date,
                    "units_charged": round(actual_units, 2),
                    "tariff_rate": 8.5
                })
        await db.energy_data.insert_many(energy_records)
    # Revenue data (Ticket Issuing Machine)
    if (not use_synced_operational_seed) and await db.revenue_data.count_documents({}) == 0:
        revenue_records = []
        buses_list = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(100)
        for day_offset in range(90):
            date = (datetime.now(timezone.utc) - timedelta(days=day_offset)).strftime("%Y-%m-%d")
            for bus in buses_list:
                capacity = bus.get("capacity", 40)
                base_rev = capacity * random.uniform(3.5, 7.0) * random.randint(4, 8)
                passengers = random.randint(int(capacity * 3), int(capacity * 7))
                revenue_records.append({
                    "bus_id": bus["bus_id"], "date": date,
                    "depot": bus.get("depot", ""),
                    "route": random.choice(tim_route_names),
                    "revenue_amount": round(base_rev, 2),
                    "passengers": passengers,
                    "source": "ticket_issuing_machine"
                })
        await db.revenue_data.insert_many(revenue_records)
    # Sample billing invoices (PK / energy / workflow demos)
    if (not use_synced_operational_seed) and await db.billing.count_documents({}) == 0:
        today = datetime.now(timezone.utc).date()
        p0_end = today.isoformat()
        p0_start = (today - timedelta(days=30)).isoformat()
        p1_start = (today - timedelta(days=60)).isoformat()
        p1_end = (today - timedelta(days=31)).isoformat()
        seed_invoices = [
            {
                "invoice_id": "INV-SEED-001",
                "period_start": p0_start,
                "period_end": p0_end,
                "depot": "Miyapur Depot",
                "concessionaire": "City EV Operations Pvt Ltd",
                "concessionaires": ["City EV Operations Pvt Ltd"],
                "tender_ids": ["TND-001"],
                "total_km": 18500.5,
                "scheduled_km": 19200.0,
                "avg_pk_rate": 86.2,
                "base_payment": 1594703.0,
                "allowed_energy_kwh": 24050.65,
                "actual_energy_kwh": 23810.2,
                "base_electricity_tariff": 5.0,
                "actual_electricity_tariff": 8.5,
                "tariff_rate": 8.5,
                "energy_variation_kwh": 23810.2,
                "allowed_energy_cost": 120253.25,
                "actual_energy_cost": 202386.7,
                "energy_adjustment": 83335.7,
                "missed_km": 699.5,
                "availability_deduction": 60296.9,
                "performance_deduction": 45000.0,
                "system_deduction": 12000.0,
                "total_deduction": 117296.9,
                "final_payable": 1560741.8,
                "approval_dates": {
                    "submitted_at": datetime.now(timezone.utc).isoformat(),
                    "approved_at": "",
                    "paid_at": "",
                },
                "status": "submitted",
                "workflow_state": "submitted",
                "workflow_log": [
                    {"action": "submit", "from": "draft", "to": "submitted", "by": "System", "role": "admin", "remarks": "Seed", "at": datetime.now(timezone.utc).isoformat()},
                ],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            {
                "invoice_id": "INV-SEED-002",
                "period_start": p0_start,
                "period_end": p0_end,
                "depot": "LB Nagar Depot",
                "concessionaire": "Metro Mobility Services LLP",
                "concessionaires": ["Metro Mobility Services LLP"],
                "tender_ids": ["TND-002"],
                "total_km": 16200.0,
                "scheduled_km": 16800.0,
                "avg_pk_rate": 84.0,
                "base_payment": 1360800.0,
                "allowed_energy_kwh": 21060.0,
                "actual_energy_kwh": 21200.0,
                "base_electricity_tariff": 5.0,
                "actual_electricity_tariff": 8.5,
                "tariff_rate": 8.5,
                "energy_variation_kwh": 21060.0,
                "allowed_energy_cost": 105300.0,
                "actual_energy_cost": 180200.0,
                "energy_adjustment": 73710.0,
                "missed_km": 600.0,
                "availability_deduction": 50400.0,
                "performance_deduction": 38000.0,
                "system_deduction": 9500.0,
                "total_deduction": 97900.0,
                "final_payable": 1338610.0,
                "approval_dates": {"submitted_at": "", "approved_at": "", "paid_at": ""},
                "status": "draft",
                "workflow_state": "draft",
                "workflow_log": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            {
                "invoice_id": "INV-SEED-003",
                "period_start": p1_start,
                "period_end": p1_end,
                "depot": "All",
                "concessionaire": "City EV Operations Pvt Ltd / Metro Mobility Services LLP / Warangal Green Transit Co",
                "concessionaires": ["City EV Operations Pvt Ltd", "Metro Mobility Services LLP", "Warangal Green Transit Co"],
                "tender_ids": ["TND-001", "TND-002", "TND-003"],
                "total_km": 52000.0,
                "scheduled_km": 53500.0,
                "avg_pk_rate": 85.0,
                "base_payment": 4420000.0,
                "allowed_energy_kwh": 67600.0,
                "actual_energy_kwh": 66800.0,
                "base_electricity_tariff": 5.0,
                "actual_electricity_tariff": 8.5,
                "tariff_rate": 8.5,
                "energy_variation_kwh": 66800.0,
                "allowed_energy_cost": 338000.0,
                "actual_energy_cost": 567800.0,
                "energy_adjustment": 233800.0,
                "missed_km": 1500.0,
                "availability_deduction": 127500.0,
                "performance_deduction": 95000.0,
                "system_deduction": 22000.0,
                "total_deduction": 244500.0,
                "final_payable": 4409300.0,
                "approval_dates": {
                    "submitted_at": (datetime.now(timezone.utc) - timedelta(days=50)).isoformat(),
                    "approved_at": "",
                    "paid_at": (datetime.now(timezone.utc) - timedelta(days=10)).isoformat(),
                },
                "status": "paid",
                "workflow_state": "paid",
                "workflow_log": [],
                "created_at": (datetime.now(timezone.utc) - timedelta(days=45)).isoformat(),
            },
        ]
        await db.billing.insert_many(seed_invoices)
    # Deduction rules
    if await db.deduction_rules.count_documents({}) == 0:
        rules = [
            {"id": "R001", "name": "Rash Driving", "rule_type": "performance", "penalty_percent": 3, "is_capped": False, "cap_limit": 0, "description": "Penalty for rash driving incidents", "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "R002", "name": "Late Departure", "rule_type": "performance", "penalty_percent": 2, "is_capped": True, "cap_limit": 50000, "description": "Late start penalty", "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "R003", "name": "Breakdown", "rule_type": "performance", "penalty_percent": 5, "is_capped": False, "cap_limit": 0, "description": "Vehicle breakdown penalty", "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "R004", "name": "GPS Failure", "rule_type": "system", "penalty_percent": 1.5, "is_capped": True, "cap_limit": 25000, "description": "GPS system failure", "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "R005", "name": "PIS Failure", "rule_type": "system", "penalty_percent": 1, "is_capped": True, "cap_limit": 20000, "description": "Passenger info system failure", "active": True, "created_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db.deduction_rules.insert_many(rules)
    # Incidents (canonical IRMS types — prompt §14, §5.7)
    if (not use_synced_operational_seed) and await db.incidents.count_documents({}) == 0:
        now_base = datetime.now(timezone.utc)
        seed_specs = [
            ("ACCIDENT", "low", "investigating", "manual", "Minor scrape — no injuries"),
            ("BREAKDOWN", "medium", "investigating", "manual", "Inverter fault — bus immobilised"),
            ("ROUTE_DEVIATION", "medium", "in_progress", "manual", "Deviation logged via control room call"),
            ("PASSENGER_COMPLAINT", "low", "in_progress", "manual", "AC complaint on city route"),
            ("ITS_GPS_FAILURE", "high", "investigating", "system", "AIS-140 gap > 15 min on TS-001"),
        ]
        incidents = []
        for i, (itype, sev, st, ch, desc) in enumerate(seed_specs):
            ts = (now_base - timedelta(days=random.randint(0, 15))).isoformat()
            depot = random.choice(["Miyapur Depot", "LB Nagar Depot", "Secunderabad Depot"])
            incidents.append(
                {
                    "id": f"INC-SEED-{str(i + 1).zfill(3)}",
                    "incident_type": itype,
                    "description": desc,
                    "occurred_at": ts,
                    "vehicles_affected": [],
                    "vehicles_affected_count": 1,
                    "damage_summary": "Seed — minimal damage narrative for PM fields.",
                    "engineer_action": "Seed — inspection scheduled." if st != "investigating" else "",
                    "bus_id": f"TS-{str(random.randint(1, 8)).zfill(3)}",
                    "driver_id": f"DRV-{str(random.randint(1, 8)).zfill(3)}",
                    "depot": depot,
                    "route_name": "Sample Route",
                    "route_id": "",
                    "trip_id": "",
                    "duty_id": "",
                    "related_infraction_id": "",
                    "location_text": "Hyderabad",
                    "severity": sev,
                    "channel": ch,
                    "telephonic_reference": "TC-1001" if i == 2 else "",
                    "status": st,
                    "assigned_team": "Depot Maintenance" if st == "in_progress" else "",
                    "assigned_to": "",
                    "reported_by": "System",
                    "attachments": [],
                    "created_at": ts,
                    "updated_at": ts,
                    "activity_log": [
                        {
                            "at": ts,
                            "action": "created",
                            "by": "System",
                            "detail": "Seed incident",
                        }
                    ],
                }
            )
        await db.incidents.insert_many(incidents)
    # Settings
    if await db["settings"].count_documents({}) == 0:
        app_settings_seed = [
            {"key": "tariff_rate", "value": "8.5", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "12m_ac_kwh_per_km", "value": "1.3", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "9m_ac_kwh_per_km", "value": "1.0", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "12m_non_ac_kwh_per_km", "value": "1.1", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "9m_non_ac_kwh_per_km", "value": "0.85", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "max_deduction_cap_pct", "value": "20", "updated_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db["settings"].insert_many(app_settings_seed)
    # Duty assignments (sample for today and next 3 days)
    if (not use_synced_operational_seed) and await db.duty_assignments.count_documents({}) == 0:
        drivers_list = await db.drivers.find({"status": "active"}, {"_id": 0}).to_list(100)
        buses_list = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(100)
        conductors_list = await db.conductors.find({"status": "active"}, {"_id": 0}).to_list(100)
        route_defs = [
            {"name": "Miyapur-Secunderabad Express", "start": "Miyapur", "end": "Secunderabad"},
            {"name": "LB Nagar-MGBS City", "start": "LB Nagar", "end": "MGBS"},
            {"name": "Kukatpally-Charminar", "start": "Kukatpally", "end": "Charminar"},
            {"name": "Uppal-Mehdipatnam", "start": "Uppal", "end": "Mehdipatnam"},
            {"name": "ECIL-Nampally", "start": "ECIL", "end": "Nampally"},
            {"name": "Secunderabad-Warangal", "start": "Secunderabad", "end": "Warangal"},
            {"name": "Dilsukhnagar-Ameerpet", "start": "Dilsukhnagar", "end": "Ameerpet"},
            {"name": "Habsiguda-Jubilee Hills", "start": "Habsiguda", "end": "Jubilee Hills"},
        ]
        duties = []
        for day_offset in range(4):
            date = (datetime.now(timezone.utc) + timedelta(days=day_offset)).strftime("%Y-%m-%d")
            for i, driver in enumerate(drivers_list[:8]):
                bus = buses_list[i] if i < len(buses_list) else buses_list[0]
                conductor = conductors_list[i % len(conductors_list)] if conductors_list else {}
                rd = route_defs[i % len(route_defs)]
                start_h = 6 + (i % 4) * 2
                # Demo double-duty (hours): (0) scheduled span > 10h; (1) ~9h scheduled but actual span > 10h
                if day_offset == 0 and i == 0:
                    trips_seed = [
                        {
                            "trip_number": 1,
                            "start_point": rd["start"],
                            "end_point": rd["end"],
                            "start_time": "05:00",
                            "end_time": "09:00",
                            "actual_start_time": "05:05",
                            "actual_end_time": "09:05",
                            "trip_status": "completed",
                            "cancel_reason_code": "none",
                            "cancel_reason_custom": "",
                            "direction": "outward",
                        },
                        {
                            "trip_number": 2,
                            "start_point": rd["end"],
                            "end_point": rd["start"],
                            "start_time": "11:00",
                            "end_time": "18:30",
                            "actual_start_time": "11:02",
                            "actual_end_time": "18:32",
                            "trip_status": "scheduled",
                            "cancel_reason_code": "none",
                            "cancel_reason_custom": "",
                            "direction": "return",
                        },
                    ]
                    psd, psa = "05:00", "18:30"
                    pad, paa = "05:05", "18:32"
                elif day_offset == 0 and i == 1:
                    trips_seed = [
                        {
                            "trip_number": 1,
                            "start_point": rd["start"],
                            "end_point": rd["end"],
                            "start_time": "09:00",
                            "end_time": "12:00",
                            "actual_start_time": "09:00",
                            "actual_end_time": "12:00",
                            "trip_status": "completed",
                            "cancel_reason_code": "none",
                            "cancel_reason_custom": "",
                            "direction": "outward",
                        },
                        {
                            "trip_number": 2,
                            "start_point": rd["end"],
                            "end_point": rd["start"],
                            "start_time": "14:00",
                            "end_time": "18:00",
                            "actual_start_time": "14:05",
                            "actual_end_time": "21:10",
                            "trip_status": "scheduled",
                            "cancel_reason_code": "none",
                            "cancel_reason_custom": "",
                            "direction": "return",
                        },
                    ]
                    psd, psa = "09:00", "18:00"
                    pad, paa = "09:00", "21:10"
                else:
                    trips_seed = [
                        {
                            "trip_number": 1,
                            "start_point": rd["start"],
                            "end_point": rd["end"],
                            "start_time": f"{start_h:02d}:00",
                            "end_time": f"{start_h+2:02d}:00",
                            "actual_start_time": f"{start_h:02d}:05",
                            "actual_end_time": f"{start_h+2:02d}:05",
                            "trip_status": "completed" if (day_offset == 0 and i < 2) else "scheduled",
                            "cancel_reason_code": "none",
                            "cancel_reason_custom": "",
                            "direction": "outward",
                        },
                        {
                            "trip_number": 2,
                            "start_point": rd["end"],
                            "end_point": rd["start"],
                            "start_time": f"{start_h+3:02d}:30",
                            "end_time": f"{start_h+5:02d}:30",
                            "actual_start_time": f"{start_h+3:02d}:35",
                            "actual_end_time": f"{start_h+5:02d}:35",
                            "trip_status": "scheduled",
                            "cancel_reason_code": "none",
                            "cancel_reason_custom": "",
                            "direction": "return",
                        },
                    ]
                    psd, psa = f"{start_h:02d}:00", f"{start_h+5:02d}:30"
                    pad, paa = f"{start_h:02d}:05", f"{start_h+5:02d}:35"
                duties.append({
                    "id": f"DTY-{date[-5:]}-{str(i+1).zfill(2)}",
                    "driver_license": driver["license_number"],
                    "driver_name": driver["name"],
                    "driver_phone": driver.get("phone", ""),
                    "conductor_id": conductor.get("conductor_id", ""),
                    "conductor_name": conductor.get("name", ""),
                    "conductor_phone": conductor.get("phone", ""),
                    "bus_id": bus["bus_id"],
                    "depot": bus.get("depot", ""),
                    "route_id": "",
                    "route_name": rd["name"],
                    "start_point": rd["start"],
                    "end_point": rd["end"],
                    "punctuality_scheduled_departure": psd,
                    "punctuality_scheduled_arrival": psa,
                    "punctuality_actual_departure": pad,
                    "punctuality_actual_arrival": paa,
                    "date": date,
                    "trips": trips_seed,
                    "attribution_context": "operator_fault",
                    "duty_exception_reason": "",
                    "punctuality_review": {
                        "policy": "punctuality",
                        "violations": [],
                        "decisions": [],
                        "computed_at": datetime.now(timezone.utc).isoformat(),
                    },
                    "status": "assigned",
                    "sms_sent": day_offset == 0,
                    "sms_message": "" if day_offset > 0 else f"TGSRTC Duty Alert: Dear {driver['name']}, duty on {date}: Bus {bus['bus_id']}, {rd['name']}.",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "created_by": "System"
                })
        # Same calendar day, second roster block for first driver (multi-block / day — not hour-based double duty)
        if drivers_list and buses_list and conductors_list:
            date0 = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            d0 = drivers_list[0]
            bus_b = buses_list[min(1, len(buses_list) - 1)]
            conductor = conductors_list[0]
            rd = route_defs[1]
            start_h = 14
            duties.append({
                "id": f"DTY-{date0[-5:]}-PM01",
                "driver_license": d0["license_number"],
                "driver_name": d0["name"],
                "driver_phone": d0.get("phone", ""),
                "conductor_id": conductor.get("conductor_id", ""),
                "conductor_name": conductor.get("name", ""),
                "conductor_phone": conductor.get("phone", ""),
                "bus_id": bus_b["bus_id"],
                "depot": bus_b.get("depot", ""),
                "route_id": "",
                "route_name": rd["name"],
                "start_point": rd["start"],
                "end_point": rd["end"],
                "punctuality_scheduled_departure": f"{start_h:02d}:00",
                "punctuality_scheduled_arrival": f"{start_h + 5:02d}:30",
                "punctuality_actual_departure": f"{start_h:02d}:00",
                "punctuality_actual_arrival": f"{start_h + 5:02d}:25",
                "date": date0,
                "trips": [
                    {
                        "trip_number": 1,
                        "start_point": rd["start"],
                        "end_point": rd["end"],
                        "start_time": f"{start_h:02d}:00",
                        "end_time": f"{start_h + 2:02d}:00",
                        "actual_start_time": f"{start_h:02d}:00",
                        "actual_end_time": f"{start_h + 2:02d}:00",
                        "trip_status": "scheduled",
                        "cancel_reason_code": "none",
                        "cancel_reason_custom": "",
                        "direction": "outward",
                    }
                ],
                "attribution_context": "operator_fault",
                "duty_exception_reason": "",
                "punctuality_review": {"policy": "punctuality", "violations": [], "decisions": [], "computed_at": datetime.now(timezone.utc).isoformat()},
                "status": "assigned",
                "sms_sent": False,
                "sms_message": "",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "created_by": "System",
            })
        from collections import defaultdict

        from app.services.duty_double_duty import merge_driver_day_load_fields

        by_driver_day: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for d in duties:
            key = (str(d.get("date") or ""), str(d.get("driver_license") or ""))
            by_driver_day[key].append(d)
        for group in by_driver_day.values():
            for d in group:
                d.update(merge_driver_day_load_fields(d, group, max_duty_hours=10.0))
        await db.duty_assignments.insert_many(duties)
    # Schedule-S Infraction Catalogue (§19) — tender-frozen master
    master = build_master_rows()
    now_iso = datetime.now(timezone.utc).isoformat()
    for inf in master:
        payload = dict(inf)
        payload["created_at"] = payload.get("created_at", now_iso)
        await db.infraction_catalogue.update_one(
            {"code": payload["code"]},
            {"$set": payload},
            upsert=True,
        )
    # Logged infractions (Schedule-S history tab)
    # Separate infractions_logged seeding removed per unified infractions logic.
    pass
    # Tender §5 — extra EBMS incident rules (defaults; TGSRTC formalizes in consultation)
    ebms_section5_rules = [
        {"rule_key": "geofence_stoppage_radius_m", "rule_value": "50", "category": "operations", "description": "EBMS tender 5(a): stoppage geofencing radius (m)"},
        {"rule_key": "geofence_terminal_radius_m", "rule_value": "100", "category": "operations", "description": "EBMS tender 5(b): terminal geofencing radius (m)"},
        {"rule_key": "geofence_depot_radius_m", "rule_value": "150", "category": "operations", "description": "EBMS tender 5(c): depot geofencing radius (m)"},
        {"rule_key": "route_fence_buffer_m", "rule_value": "500", "category": "operations", "description": "EBMS tender 5(d): route fencing buffer (m)"},
        {"rule_key": "depot_outgoing_early_relax_min", "rule_value": "5", "category": "operations", "description": "EBMS tender 5(f): early depot outgoing relaxation (min)"},
        {"rule_key": "bus_stop_geofence_speed_kmh", "rule_value": "30", "category": "operations", "description": "EBMS tender 5(k): speed at bus-stop geofence to cover stop (km/h)"},
        {"rule_key": "trip_not_started_grace_min", "rule_value": "10", "category": "operations", "description": "EBMS tender 5(l): trip not started from origin — grace (min)"},
        {"rule_key": "trip_not_completed_grace_min", "rule_value": "15", "category": "operations", "description": "EBMS tender 5(m): trip not completed — grace (min)"},
        {"rule_key": "same_depot_round_trip_required", "rule_value": "1", "category": "operations", "description": "EBMS tender 5(o): same depot outgoing to same depot incoming (1=yes, 0=no)"},
        {"rule_key": "max_duties_per_day", "rule_value": "3", "category": "operations", "description": "EBMS tender 5(p): max duties per day"},
        {"rule_key": "max_conductors_per_duty", "rule_value": "2", "category": "operations", "description": "EBMS tender 5(q): max conductors in a single duty"},
        {"rule_key": "max_drivers_per_duty", "rule_value": "1", "category": "operations", "description": "EBMS tender 5(r): max drivers in a single duty"},
        {"rule_key": "overspeed_user_threshold_kmh", "rule_value": "70", "category": "operations", "description": "Tender alert 4(b): user-defined overspeed threshold (km/h) for alerts/reports"},
        {"rule_key": "bunching_min_headway_min", "rule_value": "5", "category": "operations", "description": "Tender alert 4(f): user-defined bunching — min headway between buses (min)"},
        {"rule_key": "geofence_feature_enabled", "rule_value": "1", "category": "operations", "description": "Feature flag for geofence engine (1=enabled,0=disabled)"},
    ]
    # Business Rules (§9 + §5 overlap)
    if await db.business_rules.count_documents({}) == 0:
        br = [
            {"rule_key": "reliability_target", "rule_value": "0.5", "category": "kpi", "description": "BF target (breakdowns×10000/bus-km)"},
            {"rule_key": "availability_target", "rule_value": "95", "category": "kpi", "description": "Shift availability % target"},
            {"rule_key": "availability_refurbishment_relax_active", "rule_value": "0", "category": "kpi", "description": "Apply refurbishment availability relaxation toggle (1=yes, 0=no)"},
            {"rule_key": "availability_refurbishment_relax_pct", "rule_value": "5", "category": "kpi", "description": "Availability relaxation during refurbishment (%)"},
            {"rule_key": "punctuality_start_target", "rule_value": "90", "category": "kpi", "description": "On-time start % target"},
            {"rule_key": "punctuality_arrival_target", "rule_value": "80", "category": "kpi", "description": "On-time arrival % target"},
            {"rule_key": "punctuality_start_relax_min", "rule_value": "5", "category": "kpi", "description": "Start relaxation (minutes)"},
            {"rule_key": "punctuality_arrival_relax_pct", "rule_value": "10", "category": "kpi", "description": "Arrival relaxation (% of trip time)"},
            {"rule_key": "punctuality_arrival_relax_max_min", "rule_value": "15", "category": "kpi", "description": "Arrival relaxation cap (minutes); PM-style max slack on scheduled trip time"},
            {"rule_key": "frequency_target", "rule_value": "94", "category": "kpi", "description": "Trip frequency % target"},
            {"rule_key": "frequency_trip_target", "rule_value": "94", "category": "kpi", "description": "Trip frequency % target (Article 20.5.1a)"},
            {"rule_key": "frequency_bus_km_target", "rule_value": "94", "category": "kpi", "description": "Bus-km frequency % target (Article 20.5.1b)"},
            {"rule_key": "frequency_completed_trip_threshold_pct", "rule_value": "100", "category": "kpi", "description": "Trip completion threshold as % of scheduled km"},
            {"rule_key": "trip_speed_target_kmh", "rule_value": "22", "category": "kpi", "description": "Trip speed target (km/h)"},
            {"rule_key": "trip_speed_penalty_pct_per_1pct", "rule_value": "1", "category": "kpi", "description": "Trip speed penalty % of monthly fee per 1% shortfall"},
            {"rule_key": "trip_speed_incentive_pct_per_1pct", "rule_value": "0.05", "category": "kpi", "description": "Trip speed incentive % of monthly fee per 1% excess"},
            {"rule_key": "safety_maf_target", "rule_value": "0.01", "category": "kpi", "description": "Minor Accident Factor target"},
            {"rule_key": "safety_serious_fire_lot_pct_threshold", "rule_value": "4", "category": "kpi", "description": "Article 20.6.6 serious incident lot threshold (%)"},
            {"rule_key": "kpi_damages_cap_pct", "rule_value": "10", "category": "kpi", "description": "KPI damages cap (% of Monthly Fee)"},
            {"rule_key": "incentive_cap_pct", "rule_value": "5", "category": "kpi", "description": "Incentive cap (% of Monthly Fee)"},
            {"rule_key": "non_safety_infraction_cap_pct", "rule_value": "5", "category": "infraction", "description": "Non-safety A-D cap (% monthly due)"},
            {"rule_key": "infraction_repeat_cap", "rule_value": "3000", "category": "infraction", "description": "A-E repeat cap (Rs) then stop bus"},
            {"rule_key": "overspeed_threshold_city", "rule_value": "60", "category": "operations", "description": "EBMS tender 5(i): overspeed threshold city (km/h)"},
            {"rule_key": "overspeed_threshold_highway", "rule_value": "80", "category": "operations", "description": "EBMS tender 5(i): overspeed threshold highway (km/h)"},
            {"rule_key": "critical_overspeed", "rule_value": "90", "category": "operations", "description": "EBMS tender 5(j): critical overspeed (km/h)"},
            {"rule_key": "depot_outgoing_relax_min", "rule_value": "5", "category": "operations", "description": "EBMS tender 5(e): delay (late) depot outgoing relaxation (min)"},
            {"rule_key": "trip_start_relax_min", "rule_value": "3", "category": "operations", "description": "EBMS tender 5(g): every trip start time relaxation (min)"},
            {"rule_key": "route_deviation_tolerance_m", "rule_value": "500", "category": "operations", "description": "EBMS tender 5(h): route diversion / deviation tolerance (m)"},
            {"rule_key": "gps_km_tolerance_pct", "rule_value": "5", "category": "operations", "description": "EBMS tender 5(n): GPS km of trip plus/minus range (%)"},
            {"rule_key": "night_depot_hours", "rule_value": "5", "category": "operations", "description": "Night hours per bus at depot"},
            {"rule_key": "max_duty_hours", "rule_value": "10", "category": "operations", "description": "EBMS tender 5(s): max duty hours (per driver / duty)"},
            {"rule_key": "data_fleet_param_target_pct", "rule_value": "98", "category": "data", "description": "Fleet parameter availability target (%)"},
            {"rule_key": "breakdown_tow_time_h", "rule_value": "1", "category": "operations", "description": "En-route breakdown tow time (hours)"},
            {"rule_key": "breakdown_penalty_km", "rule_value": "20", "category": "operations", "description": "Breakdown penalty (km-equivalent)"},
            {"rule_key": "first_30_day_kpi_relaxation_pct", "rule_value": "25", "category": "kpi", "description": "First 30 days KPI relaxation (%) except safety"},
            {"rule_key": "first_30_day_active", "rule_value": "0", "category": "kpi", "description": "Apply first-30-day KPI relaxation toggle (1=yes, 0=no)"},
            {"rule_key": "lot_cod_date", "rule_value": "", "category": "kpi", "description": "Lot COD date (YYYY-MM-DD) for automatic first-30-day relaxation window"},
            {"rule_key": "passenger_charter_compliance", "rule_value": "1", "category": "kpi", "description": "Passenger charter compliance flag (1=compliant, 0=non-compliant)"},
            {"rule_key": "driver_rating_weight_punctuality", "rule_value": "0.4", "category": "kpi", "description": "Driver rating weight for punctuality"},
            {"rule_key": "driver_rating_weight_accidents", "rule_value": "0.4", "category": "kpi", "description": "Driver rating weight for accidents/safety"},
            {"rule_key": "driver_rating_weight_behavior", "rule_value": "0.2", "category": "kpi", "description": "Driver rating weight for behavior/complaints"},
            {"rule_key": "fee_excess_km_factor", "rule_value": "0.50", "category": "billing", "description": "PK factor for actual > assured km"},
            {"rule_key": "fee_shortfall_km_factor", "rule_value": "0.75", "category": "billing", "description": "PK factor for assured-actual shortfall"},
        ]
        br.extend(ebms_section5_rules)
        br.extend(BILLING_ELECTRICITY_RULE_DEFAULTS)
        for r in br:
            r["updated_at"] = datetime.now(timezone.utc).isoformat()
            r["updated_by"] = "System"
        await db.business_rules.insert_many(br)
    now_br = datetime.now(timezone.utc).isoformat()
    for r in ebms_section5_rules:
        doc = {**r, "updated_at": now_br, "updated_by": "System"}
        await db.business_rules.update_one({"rule_key": r["rule_key"]}, {"$setOnInsert": doc}, upsert=True)
    await ensure_billing_electricity_rules()
    await sync_duty_templates_and_backfill()
    await migrate_duties_to_standalone_date_tabs()
    await ensure_mock_standalone_duties()
    # Bootstrap stop/depot geofences when missing (route fences can be generated via API bootstrap action).
    if await db.geofences.count_documents({}) == 0:
        stop_rows = await db.stop_master.find({"lat": {"$ne": None}, "lng": {"$ne": None}}, {"_id": 0}).to_list(5000)
        depot_rows = await db.depots.find({}, {"_id": 0, "name": 1}).to_list(2000)
        stop_radius = float(next((x["rule_value"] for x in ebms_section5_rules if x["rule_key"] == "geofence_stoppage_radius_m"), "50"))
        depot_radius = float(next((x["rule_value"] for x in ebms_section5_rules if x["rule_key"] == "geofence_depot_radius_m"), "150"))
        route_buffer_m = float(next((x["rule_value"] for x in ebms_section5_rules if x["rule_key"] == "route_fence_buffer_m"), "500"))
        term_radius_m = float(next((x["rule_value"] for x in ebms_section5_rules if x["rule_key"] == "geofence_terminal_radius_m"), "100"))
        geos = []
        now_geo = datetime.now(timezone.utc).isoformat()
        stop_by_id = {str(s.get("stop_id") or "").strip(): s for s in stop_rows}
        for s in stop_rows:
            sid = str(s.get("stop_id") or "").strip()
            if not sid:
                continue
            geos.append(
                {
                    "geofence_id": f"STOP-{sid}",
                    "type": "stop",
                    "entity_ref": sid,
                    "geometry_type": "circle",
                    "center_lat": s.get("lat"),
                    "center_lng": s.get("lng"),
                    "radius_m": stop_radius,
                    "buffer_m": None,
                    "path_points": [],
                    "active": True,
                    "source": "auto_seeded",
                    "version": 1,
                    "effective_from": "",
                    "notes": "Seeded from stop master",
                    "created_at": now_geo,
                    "updated_at": now_geo,
                    "updated_by": "System",
                }
            )
        for d in depot_rows:
            name = str(d.get("name") or "").strip()
            if not name:
                continue
            geos.append(
                {
                    "geofence_id": f"DEPOT-{name}",
                    "type": "depot",
                    "entity_ref": name,
                    "geometry_type": "circle",
                    "center_lat": 17.385,
                    "center_lng": 78.4867,
                    "radius_m": depot_radius,
                    "buffer_m": None,
                    "path_points": [],
                    "active": True,
                    "source": "auto_seeded",
                    "version": 1,
                    "effective_from": "",
                    "notes": "Seeded with default depot center",
                    "created_at": now_geo,
                    "updated_at": now_geo,
                    "updated_by": "System",
                }
            )
        async for r in db.routes.find({}, {"_id": 0, "route_id": 1, "stop_sequence": 1}):
            rid = str(r.get("route_id") or "").strip()
            if not rid:
                continue
            seq = r.get("stop_sequence") or []
            stop_ids = [x.get("stop_id") for x in seq if isinstance(x, dict) and x.get("stop_id")]
            points = []
            if stop_ids:
                for item in sorted(seq, key=lambda z: int(z.get("seq") or 0)):
                    sid = item.get("stop_id")
                    srow = stop_by_id.get(str(sid).strip()) if sid else None
                    if not srow or srow.get("lat") is None or srow.get("lng") is None:
                        continue
                    points.append({"lat": float(srow["lat"]), "lng": float(srow["lng"])})
            if len(points) < 2:
                continue
            geos.append(
                {
                    "geofence_id": f"ROUTE-{rid}",
                    "type": "route",
                    "entity_ref": rid,
                    "geometry_type": "polyline_buffer",
                    "center_lat": None,
                    "center_lng": None,
                    "radius_m": None,
                    "buffer_m": route_buffer_m,
                    "path_points": points,
                    "active": True,
                    "source": "auto_seeded",
                    "version": 1,
                    "effective_from": "",
                    "notes": "Seeded from route stop sequence",
                    "created_at": now_geo,
                    "updated_at": now_geo,
                    "updated_by": "System",
                }
            )
        async for t in db.terminal_master.find({"active": True}, {"_id": 0}):
            tid = str(t.get("terminal_id") or "").strip()
            if not tid:
                continue
            lat, lng = t.get("lat"), t.get("lng")
            if lat is None or lng is None:
                for sid in t.get("linked_stop_ids") or []:
                    s = stop_by_id.get(str(sid).strip())
                    if s and s.get("lat") is not None and s.get("lng") is not None:
                        lat, lng = s["lat"], s["lng"]
                        break
            if lat is None or lng is None:
                continue
            geos.append(
                {
                    "geofence_id": f"TERM-{tid}",
                    "type": "terminal",
                    "entity_ref": tid,
                    "geometry_type": "circle",
                    "center_lat": float(lat),
                    "center_lng": float(lng),
                    "radius_m": term_radius_m,
                    "buffer_m": None,
                    "path_points": [],
                    "active": True,
                    "source": "auto_seeded",
                    "version": 1,
                    "effective_from": "",
                    "notes": "Seeded from terminal (bus stand) master",
                    "created_at": now_geo,
                    "updated_at": now_geo,
                    "updated_by": "System",
                }
            )
        if geos:
            await db.geofences.insert_many(geos)
    # Write test credentials
    app_settings.memory_dir.mkdir(parents=True, exist_ok=True)
    cred_path = app_settings.memory_dir / "test_credentials.md"
    with open(cred_path, "w", encoding="utf-8") as f:
        f.write("# Test Credentials\n\n")
        f.write("| Role | Email | Password |\n|------|-------|----------|\n")
        f.write("| admin | admin@tgsrtc.com | admin123 |\n")
        f.write("| admin | admin2@tgsrtc.com | Admin2123! |\n")
        f.write("| management | management@tgsrtc.com | Mgmt123! |\n")
        f.write("| depot | depot@tgsrtc.com | depot123 |\n")
        f.write("| vendor | vendor@tgsrtc.com | vendor123 |\n\n")
        f.write("## Auth\n- POST /api/auth/login — GET /api/auth/me — POST /api/auth/logout\n")
    await _migrate_incident_infraction_codes_to_others()
    await db.settings.update_one(
        {"key": seed_state_key},
        {
            "$set": {
                "key": seed_state_key,
                "value": json.dumps({
                    "demo_seed_completed": True,
                    "seed_mode": seed_mode,
                    "seeded_at": datetime.now(timezone.utc).isoformat(),
                }),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )
    logger.info("Seed data complete")

