"""Database seeding for demos and local development."""

from __future__ import annotations

import logging
import os
import random
from datetime import datetime, timedelta, timezone

from app.core.config import settings as app_settings
from app.core.database import db
from app.core.energy_norms import KWH_PER_KM_BY_BUS_TYPE, kwh_per_km_for_bus_type
from app.core.security import hash_password, verify_password
from app.domain.permissions import ALL_PERMISSION_IDS, default_permission_ids_for_role
from app.domain.infractions_master import build_master_rows, normalize_catalog_infraction_code
from app.domain.user_roles import ALLOWED_ROLE_IDS, LEGACY_ROLE_TO_CANONICAL

logger = logging.getLogger(__name__)


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

    async def _normalize_conductor_ratings_five_star():
        async for doc in db.conductors.find({"rating": {"$gt": 5.01}}):
            await db.conductors.update_one(
                {"_id": doc["_id"]},
                {"$set": {"rating": _to_five_star(doc["rating"])}},
            )

    await _migrate_driver_rating()
    await _normalize_driver_ratings_five_star()
    await _normalize_conductor_ratings_five_star()
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
    # Tenders
    await db.tenders.delete_many({})
    tenders = [
        {"tender_id": "TND-001", "concessionaire": "City EV Operations Pvt Ltd", "pk_rate": 85, "energy_rate": 8.5, "subsidy_rate": 5, "subsidy_type": "per_km", "description": "Hyderabad City Routes Phase-1", "status": "active", "created_at": datetime.now(timezone.utc).isoformat()},
        {"tender_id": "TND-002", "concessionaire": "Metro Mobility Services LLP", "pk_rate": 92, "energy_rate": 9.0, "subsidy_rate": 4, "subsidy_type": "per_km", "description": "Secunderabad Express Routes", "status": "active", "created_at": datetime.now(timezone.utc).isoformat()},
        {"tender_id": "TND-003", "concessionaire": "Warangal Green Transit Co", "pk_rate": 78, "energy_rate": 8.0, "subsidy_rate": 8000, "subsidy_type": "per_bus", "description": "Warangal City Services", "status": "active", "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.tenders.insert_many(tenders)
    depot_names = ["Miyapur Depot", "LB Nagar Depot", "Secunderabad Depot", "Warangal Depot"]
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
    for i in range(1, 11):
        bt = random.choice(_bus_types)
        kwh = kwh_per_km_for_bus_type(bt)
        tid = random.choice(["TND-001", "TND-002", "TND-003"])
        buses.append({
            "bus_id": f"TS-{str(i).zfill(3)}", "bus_type": bt, "capacity": random.choice([32, 40, 50]),
            "tender_id": tid, "depot": random.choice(depot_names),
            "status": "active" if i <= 8 else random.choice(["maintenance", "inactive"]),
            "kwh_per_km": kwh, "created_at": datetime.now(timezone.utc).isoformat()
        })
    await db.buses.insert_many(buses)
    # Top up active fleet for live-tracking / telemetry demos (idempotent)
    target_fleet = 40
    for _ in range(80):
        if await db.buses.count_documents({}) >= target_fleet:
            break
        existing_ids = [b["bus_id"] for b in await db.buses.find({}, {"bus_id": 1}).to_list(500)]
        nums = []
        for bid in existing_ids:
            if isinstance(bid, str) and bid.startswith("TS-"):
                try:
                    nums.append(int(bid.split("-")[1]))
                except ValueError:
                    pass
        ni = max(nums) + 1 if nums else 1
        bt = random.choice(_bus_types)
        kwh = kwh_per_km_for_bus_type(bt)
        tid = random.choice(["TND-001", "TND-002", "TND-003"])
        await db.buses.insert_one(
            {
                "bus_id": f"TS-{str(ni).zfill(3)}",
                "bus_type": bt,
                "capacity": random.choice([32, 40, 50]),
                "tender_id": tid,
                "depot": random.choice(depot_names),
                "status": "active" if random.random() > 0.12 else random.choice(["maintenance", "inactive"]),
                "kwh_per_km": kwh,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    # Drivers
    driver_names = ["Ravi Kumar", "Suresh Reddy", "Venkat Rao", "Anjali Devi", "Prasad M", "Lakshmi K", "Srinivas P", "Kavitha B"]
    await db.drivers.delete_many({})
    drivers = []
    for i, name in enumerate(driver_names):
        drivers.append({
            "id": f"DRV-{str(i+1).zfill(3)}",
            "name": name, "license_number": f"TS-DL-{2020+i}-{str(random.randint(1000,9999))}",
            "phone": f"98{random.randint(10000000, 99999999)}",
            "bus_id": f"TS-{str(i+1).zfill(3)}" if i < 8 else "",
            "status": "active", "rating": round(random.uniform(3.6, 5.0), 1),
            "penalties": [], "created_at": datetime.now(timezone.utc).isoformat()
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
    c_names = [
        "Kiran Rao", "Neha Sharma", "Arun Prasad", "Divya Iyer", "Imran Khan",
        "Sunita Devi", "Vikram Singh", "Meera Joshi", "Rahul Nair", "Fatima Begum",
        "Harish Goud", "Priya Kulkarni", "Naveen Babu", "Deepa Reddy",
    ]
    cond = []
    for i, name in enumerate(c_names):
        cond.append(
            {
                "conductor_id": f"CND-{str(i + 1).zfill(4)}",
                "name": name,
                "badge_no": f"BDG-{2100 + i}",
                "phone": f"97{random.randint(10000000, 99999999)}",
                "depot": random.choice(depot_names),
                "status": "active" if random.random() > 0.08 else "inactive",
                "rating": round(random.uniform(3.7, 5.0), 1),
                "total_trips": random.randint(120, 2200),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    await db.conductors.insert_many(cond)

    # Unified 30-day synchronized operational dataset (replace mode).
    await db.duty_assignments.delete_many({})
    await db.trip_data.delete_many({})
    await db.energy_data.delete_many({})
    await db.revenue_data.delete_many({})
    await db.incidents.delete_many({})
    # db.infractions_logged is deprecated; removing it from seed reset logic.
    await db.billing.delete_many({})

    active_buses = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(500)
    # Maintenance buses are still part of month-end energy accounting (short downtime windows).
    operational_buses = await db.buses.find({"status": {"$in": ["active", "maintenance"]}}, {"_id": 0}).to_list(500)
    all_routes = await db.routes.find({"active": True}, {"_id": 0, "route_id": 1, "name": 1, "origin": 1, "destination": 1, "depot": 1, "distance_km": 1}).to_list(200)
    if not all_routes:
        all_routes = [
            {"route_id": "RT-101", "name": "Route-101 Miyapur-Secunderabad", "origin": "Miyapur", "destination": "Secunderabad", "depot": "Miyapur Depot", "distance_km": 28.5}
        ]
    drivers_list = await db.drivers.find({"status": "active"}, {"_id": 0}).to_list(500)
    driver_by_bus = {d.get("bus_id", ""): d for d in drivers_list if d.get("bus_id")}
    fallback_drivers = list(drivers_list)

    base_now = datetime.now(timezone.utc)
    trips_docs = []
    duties_docs = []
    energy_docs = []
    revenue_docs = []
    incidents_docs = []
    infractions_docs = []

    route_ptr = 0
    for day_offset in range(30):
        day_dt = base_now - timedelta(days=day_offset)
        day = day_dt.strftime("%Y-%m-%d")
        for bi, bus in enumerate(operational_buses):
            # Simulate maintenance buses being unavailable for 2 recent days only.
            if str(bus.get("status", "")).lower() == "maintenance" and day_offset in (0, 1):
                continue
            bus_id = bus["bus_id"]
            drv = driver_by_bus.get(bus_id) or (fallback_drivers[bi % len(fallback_drivers)] if fallback_drivers else {})
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
                scheduled_km = float(max(8, round(float(route.get("distance_km", 20) or 20) * random.uniform(0.85, 1.1), 2)))
                actual_km = float(max(0.0, round(scheduled_km * random.uniform(0.88, 1.06), 2)))
                total_sched_km += scheduled_km
                total_actual_km += actual_km
                passengers = int(max(5, bus.get("capacity", 40) * random.uniform(1.6, 4.5)))
                revenue_amount = float(round(passengers * random.uniform(9.0, 18.0), 2))
                traffic_ok = day_offset >= 2
                maint_ok = day_offset >= 4
                trip_doc = {
                    "trip_id": trip_id,
                    "bus_id": bus_id,
                    "driver_id": drv.get("license_number", ""),
                    "date": day,
                    "scheduled_km": scheduled_km,
                    "actual_km": actual_km,
                    "plan_start_time": f"{trip_start:02d}:00",
                    "plan_end_time": f"{trip_start + 1:02d}:45",
                    "actual_start_time": f"{trip_start:02d}:{random.choice(['00', '05', '10'])}",
                    "planned_trip_duration_min": 105,
                    "actual_end_time": f"{trip_start + 2:02d}:{random.choice(['00', '10', '20'])}",
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
                        "start_time": f"{trip_start:02d}:00",
                        "end_time": f"{trip_start + 2:02d}:00",
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
                    "units_charged": round(total_actual_km * kwh_per_km * random.uniform(0.95, 1.08), 2),
                    "tariff_rate": 8.5,
                }
            )
            duties_docs.append(
                {
                    "id": duty_id,
                    "driver_license": drv.get("license_number", ""),
                    "driver_name": drv.get("name", ""),
                    "driver_phone": drv.get("phone", ""),
                    "bus_id": bus_id,
                    "depot": bus.get("depot", ""),
                    "route_name": route.get("name", ""),
                    "start_point": route.get("origin", ""),
                    "end_point": route.get("destination", ""),
                    "date": day,
                    "trips": duty_trips,
                    "status": "assigned",
                    "sms_sent": day_offset <= 1,
                    "sms_message": f"TGSRTC Duty Alert: duty on {day} for {bus_id}",
                    "created_at": day_dt.isoformat(),
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

    # Demo incidents — Schedule-S + 16.6 (0xx) + O-series rows. Re-seed to refresh.
    incidents_docs = []
    if active_buses and all_routes:
        demo_specs = [
            ("INC-DEMO-001", "OVERSPEED", ["E01"], "system", "medium", "open", "Overspeed threshold breach — linked E01."),
            ("INC-DEMO-002", "ITS_GPS_FAILURE", ["B08"], "system", "high", "investigating", "AIS-140 / VTS defect — B08."),
            ("INC-DEMO-003", "ROUTE_DEVIATION", ["B06"], "system", "medium", "assigned", "Unauthorized deviation — B06."),
            ("INC-DEMO-004", "IDLE_EXCESS", ["A12"], "system", "low", "in_progress", "Excessive idle — A12."),
            ("INC-DEMO-005", "PANIC_OR_SECURITY", ["O03"], "system", "high", "open", "Security or vandalism case (O03) with narrative."),
            ("INC-DEMO-006", "BUNCHING_ALERT", ["B05"], "system", "medium", "open", "Bunching / parking — B05."),
            ("INC-DEMO-007", "HARNESS_REMOVAL", ["C09"], "system", "high", "assigned", "On-board equipment tamper — C09."),
            ("INC-DEMO-008", "ACCIDENT", ["C04"], "system", "high", "open", "Minor road accident — C04."),
            ("INC-DEMO-009", "BREAKDOWN", ["C12"], "manual", "medium", "in_progress", "Breakdown KM loss — C12 (manual report)."),
            ("INC-DEMO-010", "PASSENGER_COMPLAINT", ["C13"], "manual", "low", "open", "AC service complaint — C13 (manual)."),
            # Official C12 breakdown + O01 response row
            ("INC-DEMO-011", "BREAKDOWN", ["C12"], "manual", "low", "open", "Mock: official Table C12 breakdown KM loss."),
            ("INC-DEMO-012", "BREAKDOWN", ["C12", "O01"], "manual", "medium", "open", "Mock: C12 + breakdown response (O01)."),
            ("INC-DEMO-013", "PASSENGER_COMPLAINT", ["O08", "O11"], "manual", "medium", "assigned", "Mock: staff curtailment and PIS/GPS withdrawal (O08 + O11)."),
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
            incidents_docs.append(
                {
                    "id": iid,
                    "incident_type": itype,
                    "description": desc,
                    "occurred_at": occurred_at,
                    "vehicles_affected": [bus_id],
                    "vehicles_affected_count": 1,
                    "damage_summary": "",
                    "engineer_action": "",
                    "bus_id": bus_id,
                    "driver_id": lic,
                    "depot": bus.get("depot", ""),
                    "route_name": route.get("name", ""),
                    "route_id": route.get("route_id", ""),
                    "trip_id": f"TRP-SEED-{i + 1:02d}",
                    "duty_id": f"DTY-SEED-{i + 1:02d}",
                    "related_infraction_id": "",
                    "location_text": route.get("origin", ""),
                    "severity": sev,
                    "channel": ch,
                    "telephonic_reference": "",
                    "status": st,
                    "assigned_team": "Depot Maintenance" if st in ("assigned", "in_progress") else "",
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
        tariff = 8.5
        energy_adj = min(actual_kwh, allowed_kwh) * tariff
        missed_km = max(0.0, skm - tkm)
        avail_ded = missed_km * avg_pk
        perf_ded = base_payment * 0.02
        sys_ded = base_payment * 0.01
        infra_ded = 0.0
        for i in infractions_docs:
            if i.get("bus_id") not in dep_buses:
                continue
            code = str(i.get("infraction_code", "") or "").upper().strip()
            amount = float(i.get("amount", 0) or 0)
            if code in {"O01", "O03"} and amount <= 0:
                amount = 20.0 * avg_pk
            infra_ded += amount
        total_ded = avail_ded + perf_ded + sys_ded + infra_ded
        excess = max(0.0, tkm - skm)
        km_inc = excess * avg_pk * 0.5
        rev_sum = [r for r in revenue_docs if r.get("bus_id") in dep_buses]
        rev_key = {(r.get("date", ""), r.get("bus_id", ""), r.get("trip_id", "")): r for r in rev_sum}
        trip_rows = []
        for t in dep_trips[:3000]:
            rr = rev_key.get((t.get("date", ""), t.get("bus_id", ""), t.get("trip_id", "")), {})
            trip_rows.append(
                {
                    "date": t.get("date", ""),
                    "bus_id": t.get("bus_id", ""),
                    "route_name": t.get("route_name", ""),
                    "trip_id": t.get("trip_id", ""),
                    "duty_id": t.get("duty_id", ""),
                    "scheduled_km": round(float(t.get("scheduled_km", 0) or 0), 2),
                    "actual_km": round(float(t.get("actual_km", 0) or 0), 2),
                    "variance_km": round(float(t.get("actual_km", 0) or 0) - float(t.get("scheduled_km", 0) or 0), 2),
                    "passengers": int(rr.get("passengers", 0) or 0),
                    "revenue_amount": round(float(rr.get("revenue_amount", 0) or 0), 2),
                }
            )
        bw_map = {}
        for t in dep_trips:
            bid = t.get("bus_id", "")
            cur = bw_map.setdefault(bid, {"bus_id": bid, "depot": dep if dep != "All" else "", "trip_count": 0, "scheduled_km": 0.0, "actual_km": 0.0, "passengers": 0, "revenue_amount": 0.0, "energy_kwh": 0.0})
            cur["trip_count"] += 1
            cur["scheduled_km"] += float(t.get("scheduled_km", 0) or 0)
            cur["actual_km"] += float(t.get("actual_km", 0) or 0)
        for r in rev_sum:
            bid = r.get("bus_id", "")
            if bid in bw_map:
                bw_map[bid]["passengers"] += int(r.get("passengers", 0) or 0)
                bw_map[bid]["revenue_amount"] += float(r.get("revenue_amount", 0) or 0)
        for e in dep_energy:
            bid = e.get("bus_id", "")
            if bid in bw_map:
                bw_map[bid]["energy_kwh"] += float(e.get("units_charged", 0) or 0)
        final_payable = round(base_payment + energy_adj + km_inc - total_ded, 2)
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
                "scheduled_km": round(skm, 2),
                "avg_pk_rate": round(avg_pk, 2),
                "base_payment": round(base_payment, 2),
                "allowed_energy_kwh": round(allowed_kwh, 2),
                "actual_energy_kwh": round(actual_kwh, 2),
                "tariff_rate": tariff,
                "allowed_energy_cost": round(allowed_kwh * tariff, 2),
                "actual_energy_cost": round(actual_kwh * tariff, 2),
                "energy_adjustment": round(energy_adj, 2),
                "subsidy": 0.0,
                "excess_km": round(excess, 2),
                "km_incentive_factor": 0.5,
                "km_incentive": round(km_inc, 2),
                "missed_km": round(missed_km, 2),
                "availability_deduction": round(avail_ded, 2),
                "performance_deduction": round(perf_ded, 2),
                "system_deduction": round(sys_ded, 2),
                "infractions_deduction": round(infra_ded, 2),
                "infractions_breakdown": {"total_applied": round(infra_ded, 2), "rows": []},
                "total_deduction": round(total_ded, 2),
                "final_payable": final_payable,
                "total_due": final_payable,
                "bus_wise_summary": [
                    {
                        **v,
                        "scheduled_km": round(v["scheduled_km"], 2),
                        "actual_km": round(v["actual_km"], 2),
                        "revenue_amount": round(v["revenue_amount"], 2),
                        "energy_kwh": round(v["energy_kwh"], 2),
                    }
                    for v in sorted(bw_map.values(), key=lambda x: x["bus_id"])
                ],
                "trip_wise_details": trip_rows,
                "invoice_components": {
                    "base_payment": round(base_payment, 2),
                    "energy_adjustment": round(energy_adj, 2),
                    "subsidy_included": False,
                    "subsidy": 0.0,
                    "km_incentive": round(km_inc, 2),
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
    # Stop master — shared boarding points (same stop can appear on multiple routes)
    stop_master_seed = [
        {"stop_id": "ST-HYD-MYP-BS", "name": "Miyapur Bus Stand", "locality": "Miyapur", "landmark": "Near Miyapur metro", "region": "Hyderabad", "lat": 17.4969, "lng": 78.3567, "active": True},
        {"stop_id": "ST-HYD-KKP-HB", "name": "Kukatpally HB Colony", "locality": "Kukatpally", "landmark": "Y-junction", "region": "Hyderabad", "lat": 17.4845, "lng": 78.4102, "active": True},
        {"stop_id": "ST-HYD-AME", "name": "Ameerpet", "locality": "Ameerpet", "landmark": "Metro interchange", "region": "Hyderabad", "lat": 17.4373, "lng": 78.4389, "active": True},
        {"stop_id": "ST-HYD-BEG", "name": "Begumpet", "locality": "Begumpet", "landmark": "", "region": "Hyderabad", "lat": 17.4440, "lng": 78.4722, "active": True},
        {"stop_id": "ST-HYD-PAR", "name": "Paradise", "locality": "Secunderabad", "landmark": "Opp. railway station", "region": "Hyderabad", "lat": 17.4431, "lng": 78.4989, "active": True},
        {"stop_id": "ST-HYD-LBN-RR", "name": "LB Nagar Ring Road", "locality": "LB Nagar", "landmark": "Depot approach", "region": "Hyderabad", "lat": 17.3456, "lng": 78.5571, "active": True},
        {"stop_id": "ST-HYD-DIL", "name": "Dilsukhnagar", "locality": "Dilsukhnagar", "landmark": "Chandana Bros", "region": "Hyderabad", "lat": 17.3689, "lng": 78.5244, "active": True},
        {"stop_id": "ST-HYD-MAL", "name": "Malakpet", "locality": "Malakpet", "landmark": "", "region": "Hyderabad", "lat": 17.3772, "lng": 78.5012, "active": True},
        {"stop_id": "ST-HYD-AFZ", "name": "Afzalgunj", "locality": "Afzalgunj", "landmark": "", "region": "Hyderabad", "lat": 17.3822, "lng": 78.4801, "active": True},
        {"stop_id": "ST-HYD-MGBS", "name": "MGBS", "locality": "Mahatma Gandhi Bus Station", "landmark": "Imperial", "region": "Hyderabad", "lat": 17.3841, "lng": 78.4589, "active": True},
        {"stop_id": "ST-HYD-KPHB", "name": "KPHB Colony", "locality": "Kukatpally", "landmark": "Phase-3", "region": "Hyderabad", "lat": 17.4933, "lng": 78.3994, "active": True},
        {"stop_id": "ST-HYD-SRN", "name": "SR Nagar", "locality": "SR Nagar", "landmark": "", "region": "Hyderabad", "lat": 17.4429, "lng": 78.4294, "active": True},
        {"stop_id": "ST-HYD-ABI", "name": "Abids", "locality": "Abids", "landmark": "", "region": "Hyderabad", "lat": 17.3930, "lng": 78.4731, "active": True},
        {"stop_id": "ST-HYD-CHR", "name": "Charminar", "locality": "Old City", "landmark": "Monument circle", "region": "Hyderabad", "lat": 17.3616, "lng": 78.4747, "active": True},
        {"stop_id": "ST-HYD-SEC-STN", "name": "Secunderabad Station", "locality": "Secunderabad", "landmark": "", "region": "Hyderabad", "lat": 17.4399, "lng": 78.4983, "active": True},
        {"stop_id": "ST-HYD-UPP-OR", "name": "Uppal Ring Road", "locality": "Uppal", "landmark": "NH163", "region": "Hyderabad", "lat": 17.4012, "lng": 78.5589, "active": True},
        {"stop_id": "ST-HYD-GHT", "name": "Ghatkesar", "locality": "Ghatkesar", "landmark": "ORR exit", "region": "Telangana", "lat": 17.4512, "lng": 78.6891, "active": True},
        {"stop_id": "ST-HYD-BHO", "name": "Bhongir", "locality": "Bhongir", "landmark": "", "region": "Telangana", "lat": 17.5144, "lng": 78.8901, "active": True},
        {"stop_id": "ST-HYD-WRL", "name": "Warangal Bus Stand", "locality": "Warangal", "landmark": "GWMC", "region": "Warangal", "lat": 17.9689, "lng": 79.5941, "active": True},
        {"stop_id": "ST-HYD-UPP-MET", "name": "Uppal Metro", "locality": "Uppal", "landmark": "", "region": "Hyderabad", "lat": 17.4018, "lng": 78.5602, "active": True},
        {"stop_id": "ST-HYD-TAR", "name": "Tarnaka", "locality": "Tarnaka", "landmark": "OU / metro", "region": "Hyderabad", "lat": 17.4392, "lng": 78.5377, "active": True},
        {"stop_id": "ST-HYD-HIM", "name": "Himayatnagar", "locality": "Himayatnagar", "landmark": "", "region": "Hyderabad", "lat": 17.4066, "lng": 78.4855, "active": True},
        {"stop_id": "ST-HYD-MEH", "name": "Mehdipatnam", "locality": "Mehdipatnam", "landmark": "Rythu Bazar", "region": "Hyderabad", "lat": 17.3959, "lng": 78.4326, "active": True},
        {"stop_id": "ST-HYD-ECIL", "name": "ECIL X Roads", "locality": "ECIL", "landmark": "", "region": "Hyderabad", "lat": 17.4699, "lng": 78.5568, "active": True},
        {"stop_id": "ST-HYD-KAC", "name": "Kacheguda", "locality": "Kacheguda", "landmark": "Railway colony", "region": "Hyderabad", "lat": 17.3897, "lng": 78.5033, "active": True},
        {"stop_id": "ST-HYD-NAM", "name": "Nampally", "locality": "Nampally", "landmark": "Opp. railway station", "region": "Hyderabad", "lat": 17.3856, "lng": 78.4694, "active": True},
    ]
    await db.stop_master.delete_many({})
    now_sm = datetime.now(timezone.utc).isoformat()
    for sm in stop_master_seed:
        doc = {**sm, "updated_at": now_sm, "created_at": now_sm}
        await db.stop_master.insert_one(doc)

    def _seq(ids: list[str]) -> list[dict]:
        return [{"stop_id": sid, "seq": i + 1} for i, sid in enumerate(ids)]

    _hyd_route_stop_ids = {
        "RT-101": ["ST-HYD-MYP-BS", "ST-HYD-KKP-HB", "ST-HYD-AME", "ST-HYD-BEG", "ST-HYD-PAR"],
        "RT-202": ["ST-HYD-LBN-RR", "ST-HYD-DIL", "ST-HYD-MAL", "ST-HYD-AFZ", "ST-HYD-MGBS"],
        "RT-303": ["ST-HYD-KPHB", "ST-HYD-SRN", "ST-HYD-ABI", "ST-HYD-CHR"],
        "RT-404": ["ST-HYD-SEC-STN", "ST-HYD-UPP-OR", "ST-HYD-GHT", "ST-HYD-BHO", "ST-HYD-WRL"],
        "RT-505": ["ST-HYD-UPP-MET", "ST-HYD-TAR", "ST-HYD-HIM", "ST-HYD-MEH"],
        "RT-606": ["ST-HYD-ECIL", "ST-HYD-TAR", "ST-HYD-KAC", "ST-HYD-NAM"],
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
            "depot": "Secunderabad Depot",
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
        {
            "route_id": "RT-606",
            "name": "Route-606 ECIL-Nampally",
            "origin": "ECIL",
            "destination": "Nampally",
            "distance_km": 18.5,
            "depot": "Secunderabad Depot",
            "active": True,
        },
    ]
    for _r in route_seed_docs:
        _r["stop_sequence"] = _seq(_hyd_route_stop_ids.get(_r["route_id"], []))
    await db.routes.delete_many({})
    now_r = datetime.now(timezone.utc).isoformat()
    await db.routes.insert_many([{**r, "created_at": now_r, "updated_at": now_r} for r in route_seed_docs])
    # Backfill stop_sequence on demo routes when empty (shared Stop master)
    now_rs = datetime.now(timezone.utc).isoformat()
    for _r in route_seed_docs:
        await db.routes.update_one(
            {
                "route_id": _r["route_id"],
                "$or": [
                    {"stop_sequence": {"$exists": False}},
                    {"stop_sequence": {"$size": 0}},
                ],
            },
            {"$set": {"stop_sequence": _r["stop_sequence"], "updated_at": now_rs}, "$unset": {"stops": ""}},
        )
    tim_route_names = [r["name"] for r in route_seed_docs]
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
                "tariff_rate": 8.5,
                "allowed_energy_cost": 204430.53,
                "actual_energy_cost": 202386.7,
                "energy_adjustment": 202386.7,
                "subsidy": 92500.0,
                "missed_km": 699.5,
                "availability_deduction": 60296.9,
                "performance_deduction": 45000.0,
                "system_deduction": 12000.0,
                "total_deduction": 117296.9,
                "final_payable": 1774293.8,
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
                "tariff_rate": 8.5,
                "allowed_energy_cost": 179010.0,
                "actual_energy_cost": 180200.0,
                "energy_adjustment": 179010.0,
                "subsidy": 81000.0,
                "missed_km": 600.0,
                "availability_deduction": 50400.0,
                "performance_deduction": 38000.0,
                "system_deduction": 9500.0,
                "total_deduction": 97900.0,
                "final_payable": 1518910.0,
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
                "tariff_rate": 8.5,
                "allowed_energy_cost": 574600.0,
                "actual_energy_cost": 567800.0,
                "energy_adjustment": 567800.0,
                "subsidy": 240000.0,
                "missed_km": 1500.0,
                "availability_deduction": 127500.0,
                "performance_deduction": 95000.0,
                "system_deduction": 22000.0,
                "total_deduction": 244500.0,
                "final_payable": 4983300.0,
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
            ("ACCIDENT", "low", "open", "manual", "Minor scrape — no injuries"),
            ("BREAKDOWN", "medium", "investigating", "manual", "Inverter fault — bus immobilised"),
            ("ROUTE_DEVIATION", "medium", "assigned", "manual", "Deviation logged via control room call"),
            ("PASSENGER_COMPLAINT", "low", "in_progress", "manual", "AC complaint on city route"),
            ("ITS_GPS_FAILURE", "high", "open", "system", "AIS-140 gap > 15 min on TS-001"),
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
                    "engineer_action": "Seed — inspection scheduled." if st != "open" else "",
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
                    "assigned_team": "Depot Maintenance" if st in ("assigned", "in_progress") else "",
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
            {"key": "9m_non_ac_kwh_per_km", "value": "0.8", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "max_deduction_cap_pct", "value": "20", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "default_subsidy_rate", "value": "5", "updated_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db["settings"].insert_many(app_settings_seed)
    # Duty assignments (sample for today and next 3 days)
    if (not use_synced_operational_seed) and await db.duty_assignments.count_documents({}) == 0:
        drivers_list = await db.drivers.find({"status": "active"}, {"_id": 0}).to_list(100)
        buses_list = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(100)
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
                rd = route_defs[i % len(route_defs)]
                start_h = 6 + (i % 4) * 2
                duties.append({
                    "id": f"DTY-{date[-5:]}-{str(i+1).zfill(2)}",
                    "driver_license": driver["license_number"],
                    "driver_name": driver["name"],
                    "driver_phone": driver.get("phone", ""),
                    "bus_id": bus["bus_id"],
                    "depot": bus.get("depot", ""),
                    "route_name": rd["name"],
                    "start_point": rd["start"],
                    "end_point": rd["end"],
                    "date": date,
                    "trips": [
                        {"trip_number": 1, "start_time": f"{start_h:02d}:00", "end_time": f"{start_h+2:02d}:00", "direction": "outward"},
                        {"trip_number": 2, "start_time": f"{start_h+3:02d}:30", "end_time": f"{start_h+5:02d}:30", "direction": "return"}
                    ],
                    "status": "assigned",
                    "sms_sent": day_offset == 0,
                    "sms_message": "" if day_offset > 0 else f"TGSRTC Duty Alert: Dear {driver['name']}, duty on {date}: Bus {bus['bus_id']}, {rd['name']}.",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "created_by": "System"
                })
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
    ]
    # Business Rules (§9 + §5 overlap)
    if await db.business_rules.count_documents({}) == 0:
        br = [
            {"rule_key": "reliability_target", "rule_value": "0.5", "category": "kpi", "description": "BF target (breakdowns×10000/bus-km)"},
            {"rule_key": "availability_target", "rule_value": "95", "category": "kpi", "description": "Shift availability % target"},
            {"rule_key": "punctuality_start_target", "rule_value": "90", "category": "kpi", "description": "On-time start % target"},
            {"rule_key": "punctuality_arrival_target", "rule_value": "80", "category": "kpi", "description": "On-time arrival % target"},
            {"rule_key": "punctuality_start_relax_min", "rule_value": "5", "category": "kpi", "description": "Start relaxation (minutes)"},
            {"rule_key": "punctuality_arrival_relax_pct", "rule_value": "10", "category": "kpi", "description": "Arrival relaxation (% of trip time)"},
            {"rule_key": "punctuality_arrival_relax_max_min", "rule_value": "15", "category": "kpi", "description": "Arrival relaxation cap (minutes); PM-style max slack on scheduled trip time"},
            {"rule_key": "frequency_target", "rule_value": "94", "category": "kpi", "description": "Trip frequency % target"},
            {"rule_key": "safety_maf_target", "rule_value": "0.01", "category": "kpi", "description": "Minor Accident Factor target"},
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
            {"rule_key": "fee_excess_km_factor", "rule_value": "0.50", "category": "billing", "description": "PK factor for actual > assured km"},
            {"rule_key": "fee_shortfall_km_factor", "rule_value": "0.75", "category": "billing", "description": "PK factor for assured-actual shortfall"},
        ]
        br.extend(ebms_section5_rules)
        for r in br:
            r["updated_at"] = datetime.now(timezone.utc).isoformat()
            r["updated_by"] = "System"
        await db.business_rules.insert_many(br)
    now_br = datetime.now(timezone.utc).isoformat()
    for r in ebms_section5_rules:
        doc = {**r, "updated_at": now_br, "updated_by": "System"}
        await db.business_rules.update_one({"rule_key": r["rule_key"]}, {"$setOnInsert": doc}, upsert=True)
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
    logger.info("Seed data complete")

