"""Database seeding for demos and local development."""

from __future__ import annotations

import logging
import os
import random
from datetime import datetime, timedelta, timezone

from app.core.config import settings as app_settings
from app.core.database import db
from app.core.security import hash_password, verify_password

logger = logging.getLogger(__name__)


async def run_seed_data():
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
    # Extra users
    users_seed = [
        {"email": "depot@tgsrtc.com", "name": "Depot Manager", "role": "depot_manager", "password": "depot123"},
        {"email": "finance@tgsrtc.com", "name": "Finance Officer", "role": "finance_officer", "password": "finance123"},
        {"email": "vendor@tgsrtc.com", "name": "Vendor User", "role": "vendor", "password": "vendor123"},
    ]
    for u in users_seed:
        if not await db.users.find_one({"email": u["email"]}):
            await db.users.insert_one({
                "email": u["email"], "password_hash": hash_password(u["password"]),
                "name": u["name"], "role": u["role"], "created_at": datetime.now(timezone.utc).isoformat()
            })
    # Tenders
    if await db.tenders.count_documents({}) == 0:
        tenders = [
            {"tender_id": "TND-001", "pk_rate": 85, "energy_rate": 8.5, "subsidy_rate": 5, "subsidy_type": "per_km", "description": "Hyderabad City Routes Phase-1", "status": "active", "created_at": datetime.now(timezone.utc).isoformat()},
            {"tender_id": "TND-002", "pk_rate": 92, "energy_rate": 9.0, "subsidy_rate": 4, "subsidy_type": "per_km", "description": "Secunderabad Express Routes", "status": "active", "created_at": datetime.now(timezone.utc).isoformat()},
            {"tender_id": "TND-003", "pk_rate": 78, "energy_rate": 8.0, "subsidy_rate": 8000, "subsidy_type": "per_bus", "description": "Warangal City Services", "status": "active", "created_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db.tenders.insert_many(tenders)
    depot_names = ["Miyapur Depot", "LB Nagar Depot", "Secunderabad Depot", "Warangal Depot"]
    if await db.depots.count_documents({}) == 0:
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
    # Buses
    if await db.buses.count_documents({}) == 0:
        buses = []
        for i in range(1, 11):
            bt = random.choice(["12m_ac", "9m_ac", "12m_non_ac"])
            kwh = {"12m_ac": 1.3, "9m_ac": 1.0, "12m_non_ac": 1.1}.get(bt, 1.0)
            tid = random.choice(["TND-001", "TND-002", "TND-003"])
            buses.append({
                "bus_id": f"TS-{str(i).zfill(3)}", "bus_type": bt, "capacity": random.choice([32, 40, 50]),
                "tender_id": tid, "depot": random.choice(depot_names),
                "status": "active" if i <= 8 else random.choice(["maintenance", "inactive"]),
                "kwh_per_km": kwh, "created_at": datetime.now(timezone.utc).isoformat()
            })
        await db.buses.insert_many(buses)
    # Drivers
    driver_names = ["Ravi Kumar", "Suresh Reddy", "Venkat Rao", "Anjali Devi", "Prasad M", "Lakshmi K", "Srinivas P", "Kavitha B"]
    if await db.drivers.count_documents({}) == 0:
        drivers = []
        for i, name in enumerate(driver_names):
            drivers.append({
                "id": f"DRV-{str(i+1).zfill(3)}",
                "name": name, "license_number": f"TS-DL-{2020+i}-{str(random.randint(1000,9999))}",
                "phone": f"98{random.randint(10000000, 99999999)}",
                "bus_id": f"TS-{str(i+1).zfill(3)}" if i < 8 else "",
                "status": "active", "performance_score": round(random.uniform(75, 100), 1),
                "penalties": [], "created_at": datetime.now(timezone.utc).isoformat()
            })
        await db.drivers.insert_many(drivers)
    # Trip data (last 30 days)
    if await db.trip_data.count_documents({}) == 0:
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

                trips.append({
                    "bus_id": bus["bus_id"], "driver_id": driver.get("license_number", "") if driver else "",
                    "date": date, "scheduled_km": scheduled, "actual_km": max(actual, 150),
                    "plan_start_time": _fmt_mins(plan_start_min),
                    "actual_start_time": _fmt_mins(actual_start_min),
                    "planned_trip_duration_min": trip_duration_min,
                    "actual_end_time": _fmt_mins(actual_end_min),
                })
        await db.trip_data.insert_many(trips)
    # Energy data
    if await db.energy_data.count_documents({}) == 0:
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
    now_sm = datetime.now(timezone.utc).isoformat()
    for sm in stop_master_seed:
        ex = await db.stop_master.find_one({"stop_id": sm["stop_id"]})
        doc = {**sm, "updated_at": now_sm}
        if ex:
            doc["created_at"] = ex.get("created_at", now_sm)
            await db.stop_master.replace_one({"stop_id": sm["stop_id"]}, doc)
        else:
            doc["created_at"] = now_sm
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
    if await db.routes.count_documents({}) == 0:
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
    if await db.revenue_data.count_documents({}) == 0:
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
    if await db.billing.count_documents({}) == 0:
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
                "status": "proposed",
                "workflow_state": "proposed",
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
    if await db.incidents.count_documents({}) == 0:
        now_base = datetime.now(timezone.utc)
        seed_specs = [
            ("ACCIDENT", "low", "open", "web", "Minor scrape — no injuries"),
            ("BREAKDOWN", "medium", "investigating", "web", "Inverter fault — bus immobilised"),
            ("ROUTE_DEVIATION", "medium", "assigned", "telephonic", "Deviation logged via control room call"),
            ("PASSENGER_COMPLAINT", "low", "in_progress", "web", "AC complaint on city route"),
            ("ITS_GPS_FAILURE", "high", "open", "web", "AIS-140 gap > 15 min on TS-001"),
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
                    "bus_id": f"TS-{str(random.randint(1, 8)).zfill(3)}",
                    "driver_id": f"DRV-{str(random.randint(1, 8)).zfill(3)}",
                    "depot": depot,
                    "route_name": "Sample Route",
                    "location_text": "Hyderabad",
                    "severity": sev,
                    "channel": ch,
                    "telephonic_reference": "TC-1001" if ch == "telephonic" else "",
                    "status": st,
                    "assigned_team": "Depot Maintenance" if st in ("assigned", "in_progress") else "",
                    "assigned_to": "",
                    "reported_by": "System",
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
            {"key": "max_deduction_cap_pct", "value": "20", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "default_subsidy_rate", "value": "5", "updated_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db["settings"].insert_many(app_settings_seed)
    # Duty assignments (sample for today and next 3 days)
    if await db.duty_assignments.count_documents({}) == 0:
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
    # Schedule-S Infraction Catalogue (§19)
    if await db.infraction_catalogue.count_documents({}) == 0:
        infractions = [
            {"id": "INF-A01", "code": "A01", "category": "A", "description": "Minor uniform violation", "amount": 100, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-A02", "code": "A02", "description": "Late log submission", "category": "A", "amount": 100, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-B01", "code": "B01", "description": "Rude behaviour to passenger", "category": "B", "amount": 500, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-B02", "code": "B02", "description": "Unclean bus interior", "category": "B", "amount": 500, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-C01", "code": "C01", "description": "GPS device tampered", "category": "C", "amount": 1000, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-C02", "code": "C02", "description": "Skipping scheduled stop", "category": "C", "amount": 1000, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-D01", "code": "D01", "description": "Unauthorised route deviation", "category": "D", "amount": 1500, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-D02", "code": "D02", "description": "PIS system disabled", "category": "D", "amount": 1500, "safety_flag": False, "repeat_escalation": True, "active": True},
            {"id": "INF-E01", "code": "E01", "description": "Overspeeding (>60 km/h city)", "category": "E", "amount": 3000, "safety_flag": True, "repeat_escalation": True, "active": True},
            {"id": "INF-E02", "code": "E02", "description": "CCTV cameras non-functional", "category": "E", "amount": 3000, "safety_flag": True, "repeat_escalation": True, "active": True},
            {"id": "INF-F01", "code": "F01", "description": "Fire safety equipment missing", "category": "F", "amount": 10000, "safety_flag": True, "repeat_escalation": False, "active": True},
            {"id": "INF-F02", "code": "F02", "description": "Critical brake failure", "category": "F", "amount": 10000, "safety_flag": True, "repeat_escalation": False, "active": True},
            {"id": "INF-G01", "code": "G01", "description": "Major accident due to negligence", "category": "G", "amount": 200000, "safety_flag": True, "repeat_escalation": False, "active": True},
        ]
        for inf in infractions:
            inf["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.infraction_catalogue.insert_many(infractions)
    # Logged infractions (Schedule-S history tab)
    if await db.infractions_logged.count_documents({}) == 0:
        log_specs = [
            ("TS-001", "DRV-001", "A01", "Uniform reminder"),
            ("TS-002", "DRV-002", "B01", "Passenger feedback"),
            ("TS-003", "DRV-003", "C01", "GPS check"),
            ("TS-004", "DRV-004", "D01", "Route adherence"),
            ("TS-005", "DRV-005", "E01", "Speed camera match"),
            ("TS-006", "DRV-006", "A02", "Late paperwork"),
        ]
        logged_docs = []
        now_il = datetime.now(timezone.utc)
        for i, (bus_id, drv, code, remarks) in enumerate(log_specs):
            cat = await db.infraction_catalogue.find_one({"code": code}, {"_id": 0})
            if not cat:
                continue
            day = (now_il - timedelta(days=i * 3)).strftime("%Y-%m-%d")
            bus_doc = await db.buses.find_one({"bus_id": bus_id}, {"_id": 0, "depot": 1})
            depot_val = (bus_doc or {}).get("depot") or "Miyapur Depot"
            logged_docs.append({
                "id": f"IL-SEED-{str(i + 1).zfill(3)}",
                "bus_id": bus_id,
                "driver_id": drv,
                "infraction_code": code,
                "category": cat["category"],
                "description": cat["description"],
                "amount": cat["amount"],
                "amount_snapshot": cat["amount"],
                "safety_flag": cat.get("safety_flag", False),
                "date": day,
                "remarks": remarks,
                "logged_by": "System",
                "created_at": (now_il - timedelta(days=i * 3)).isoformat(),
                "depot": depot_val,
                "route_id": f"RT-{100 + i}",
                "route_name": f"City corridor {i + 1}",
                "trip_id": f"TRIP-SEED-{i + 1:03d}" if i % 2 == 0 else "",
                "duty_id": "",
                "location_text": "Hyderabad" if i % 2 == 0 else "",
                "cause_code": "SEED",
                "related_incident_id": "INC-SEED-001" if i == 0 else "",
            })
        if logged_docs:
            await db.infractions_logged.insert_many(logged_docs)
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
        f.write("## Admin\n- Email: admin@tgsrtc.com\n- Password: admin123\n- Role: admin\n\n")
        f.write("## Depot Manager\n- Email: depot@tgsrtc.com\n- Password: depot123\n- Role: depot_manager\n\n")
        f.write("## Finance Officer\n- Email: finance@tgsrtc.com\n- Password: finance123\n- Role: finance_officer\n\n")
        f.write("## Vendor\n- Email: vendor@tgsrtc.com\n- Password: vendor123\n- Role: vendor\n\n")
        f.write("## Auth Endpoints\n- POST /api/auth/login\n- POST /api/auth/register\n- GET /api/auth/me\n- POST /api/auth/logout\n")
    logger.info("Seed data complete")

