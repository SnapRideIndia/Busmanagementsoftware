from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import bcrypt
import jwt as pyjwt
import secrets
import io
import json
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import random

# PDF / Excel
from fpdf import FPDF
from openpyxl import Workbook

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ── Database ─────────────────────────────────────────────
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ── App & Router ─────────────────────────────────────────
app = FastAPI(title="Bus Management System")
api = APIRouter(prefix="/api")

# ── JWT Config ───────────────────────────────────────────
JWT_ALGORITHM = "HS256"

def get_jwt_secret():
    return os.environ["JWT_SECRET"]

# ── Password helpers ─────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

# ── Token helpers ────────────────────────────────────────
def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {"sub": user_id, "email": email, "role": role, "exp": datetime.now(timezone.utc) + timedelta(minutes=60), "type": "access"}
    return pyjwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return pyjwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

# ── Auth dependency ──────────────────────────────────────
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = pyjwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ══════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════

class LoginReq(BaseModel):
    email: str
    password: str

class RegisterReq(BaseModel):
    email: str
    password: str
    name: str
    role: str = "vendor"

class ForgotPasswordReq(BaseModel):
    email: str

class ResetPasswordReq(BaseModel):
    token: str
    new_password: str

class TenderReq(BaseModel):
    tender_id: str
    pk_rate: float
    energy_rate: float
    subsidy_rate: float = 0
    subsidy_type: str = "per_km"
    description: str = ""
    status: str = "active"

class BusReq(BaseModel):
    bus_id: str
    bus_type: str = "12m_ac"
    capacity: int = 40
    tender_id: str = ""
    depot: str = ""
    status: str = "active"

class DriverReq(BaseModel):
    name: str
    license_number: str
    phone: str = ""
    bus_id: str = ""
    status: str = "active"

class EnergyReq(BaseModel):
    bus_id: str
    date: str
    units_charged: float
    tariff_rate: float = 10.0

class IncidentReq(BaseModel):
    incident_type: str
    description: str
    bus_id: str = ""
    driver_id: str = ""
    severity: str = "medium"

class DeductionRuleReq(BaseModel):
    name: str
    rule_type: str
    penalty_percent: float
    is_capped: bool = False
    cap_limit: float = 0
    description: str = ""
    active: bool = True

class SettingsReq(BaseModel):
    key: str
    value: str

class BillingGenerateReq(BaseModel):
    period_start: str
    period_end: str
    depot: str = ""

# ══════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════

@api.post("/auth/login")
async def login(req: LoginReq, request: Request, response: Response):
    email = req.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        lockout = attempt.get("last_attempt", datetime.now(timezone.utc)) + timedelta(minutes=15)
        if datetime.now(timezone.utc) < lockout:
            raise HTTPException(status_code=429, detail="Account locked. Try again in 15 minutes.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc)}},
            upsert=True
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await db.login_attempts.delete_one({"identifier": identifier})
    uid = str(user["_id"])
    access = create_access_token(uid, email, user.get("role", "vendor"))
    refresh = create_refresh_token(uid)
    response.set_cookie(key="access_token", value=access, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return {"id": uid, "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "vendor"), "token": access}

@api.post("/auth/register")
async def register(req: RegisterReq, response: Response):
    email = req.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    hashed = hash_password(req.password)
    doc = {"email": email, "password_hash": hashed, "name": req.name, "role": req.role, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.users.insert_one(doc)
    uid = str(result.inserted_id)
    access = create_access_token(uid, email, req.role)
    refresh = create_refresh_token(uid)
    response.set_cookie(key="access_token", value=access, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return {"id": uid, "email": email, "name": req.name, "role": req.role, "token": access}

@api.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api.post("/auth/forgot-password")
async def forgot_password(req: ForgotPasswordReq):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        return {"message": "If account exists, a reset link has been sent."}
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token": token, "email": email,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "used": False
    })
    logger.info(f"Password reset token for {email}: {token}")
    return {"message": "If account exists, a reset link has been sent.", "reset_token": token}

@api.post("/auth/reset-password")
async def reset_password(req: ResetPasswordReq):
    record = await db.password_reset_tokens.find_one({"token": req.token, "used": False})
    if not record or record["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    hashed = hash_password(req.new_password)
    await db.users.update_one({"email": record["email"]}, {"$set": {"password_hash": hashed}})
    await db.password_reset_tokens.update_one({"token": req.token}, {"$set": {"used": True}})
    return {"message": "Password reset successfully"}

@api.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = pyjwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        uid = str(user["_id"])
        access = create_access_token(uid, user["email"], user.get("role", "vendor"))
        response.set_cookie(key="access_token", value=access, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
        return {"message": "Token refreshed"}
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# ══════════════════════════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════════════════════════

@api.get("/dashboard")
async def get_dashboard(date_from: str = "", date_to: str = "", depot: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if depot:
        query["depot"] = depot
    buses = await db.buses.find(query, {"_id": 0}).to_list(1000)
    total_buses = len(buses)
    active_buses = len([b for b in buses if b.get("status") == "active"])
    drivers = await db.drivers.find({}, {"_id": 0}).to_list(1000)
    total_drivers = len(drivers)
    active_drivers = len([d for d in drivers if d.get("status") == "active"])
    trip_query = {}
    if date_from and date_to:
        trip_query["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        trip_query["date"] = {"$gte": date_from}
    trips = await db.trip_data.find(trip_query, {"_id": 0}).to_list(10000)
    total_km = sum(t.get("actual_km", 0) for t in trips)
    scheduled_km = sum(t.get("scheduled_km", 0) for t in trips)
    energy_query = {}
    if date_from and date_to:
        energy_query["date"] = {"$gte": date_from, "$lte": date_to}
    energy = await db.energy_data.find(energy_query, {"_id": 0}).to_list(10000)
    total_energy = sum(e.get("units_charged", 0) for e in energy)
    incidents = await db.incidents.find({"status": {"$ne": "resolved"}}, {"_id": 0}).to_list(1000)
    active_incidents = len(incidents)
    billings = await db.billing.find({}, {"_id": 0}).to_list(100)
    total_revenue = sum(b.get("final_payable", 0) for b in billings)
    # Ticket revenue
    rev_query = {}
    if date_from and date_to:
        rev_query["date"] = {"$gte": date_from, "$lte": date_to}
    rev_data = await db.revenue_data.find(rev_query, {"_id": 0}).to_list(10000)
    total_ticket_revenue = sum(r.get("revenue_amount", 0) for r in rev_data)
    # Daily KM chart data
    daily_km = {}
    for t in trips:
        d = t.get("date", "")
        if d not in daily_km:
            daily_km[d] = {"date": d, "actual_km": 0, "scheduled_km": 0}
        daily_km[d]["actual_km"] += t.get("actual_km", 0)
        daily_km[d]["scheduled_km"] += t.get("scheduled_km", 0)
    km_chart = sorted(daily_km.values(), key=lambda x: x["date"])[-30:]
    # Energy chart
    daily_energy = {}
    for e in energy:
        d = e.get("date", "")
        if d not in daily_energy:
            daily_energy[d] = {"date": d, "units": 0}
        daily_energy[d]["units"] += e.get("units_charged", 0)
    energy_chart = sorted(daily_energy.values(), key=lambda x: x["date"])[-30:]
    # Depot list
    depots = list(set(b.get("depot", "") for b in buses if b.get("depot")))
    return {
        "total_buses": total_buses, "active_buses": active_buses,
        "total_drivers": total_drivers, "active_drivers": active_drivers,
        "total_km": round(total_km, 2), "scheduled_km": round(scheduled_km, 2),
        "total_energy": round(total_energy, 2), "active_incidents": active_incidents,
        "total_revenue": round(total_revenue, 2),
        "total_ticket_revenue": round(total_ticket_revenue, 2),
        "availability_pct": round((total_km / scheduled_km * 100) if scheduled_km > 0 else 0, 1),
        "km_chart": km_chart, "energy_chart": energy_chart, "depots": depots
    }

# ══════════════════════════════════════════════════════════
# TENDERS
# ══════════════════════════════════════════════════════════

@api.get("/tenders")
async def list_tenders(user: dict = Depends(get_current_user)):
    tenders = await db.tenders.find({}, {"_id": 0}).to_list(1000)
    return tenders

@api.post("/tenders")
async def create_tender(req: TenderReq, user: dict = Depends(get_current_user)):
    existing = await db.tenders.find_one({"tender_id": req.tender_id})
    if existing:
        raise HTTPException(status_code=400, detail="Tender ID already exists")
    doc = req.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.tenders.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/tenders/{tender_id}")
async def update_tender(tender_id: str, req: TenderReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    update.pop("tender_id", None)
    result = await db.tenders.update_one({"tender_id": tender_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tender not found")
    return {"message": "Tender updated"}

@api.delete("/tenders/{tender_id}")
async def delete_tender(tender_id: str, user: dict = Depends(get_current_user)):
    buses = await db.buses.find_one({"tender_id": tender_id})
    if buses:
        raise HTTPException(status_code=400, detail="Cannot delete: buses are assigned to this tender")
    result = await db.tenders.delete_one({"tender_id": tender_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tender not found")
    return {"message": "Tender deleted"}

# ══════════════════════════════════════════════════════════
# BUSES
# ══════════════════════════════════════════════════════════

@api.get("/buses")
async def list_buses(user: dict = Depends(get_current_user)):
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    return buses

@api.post("/buses")
async def create_bus(req: BusReq, user: dict = Depends(get_current_user)):
    existing = await db.buses.find_one({"bus_id": req.bus_id})
    if existing:
        raise HTTPException(status_code=400, detail="Bus ID already exists")
    doc = req.model_dump()
    kwh_map = {"12m_ac": 1.3, "9m_ac": 1.0, "12m_non_ac": 1.1, "9m_non_ac": 0.8}
    doc["kwh_per_km"] = kwh_map.get(req.bus_type, 1.0)
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.buses.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/buses/{bus_id}")
async def update_bus(bus_id: str, req: BusReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    update.pop("bus_id", None)
    kwh_map = {"12m_ac": 1.3, "9m_ac": 1.0, "12m_non_ac": 1.1, "9m_non_ac": 0.8}
    update["kwh_per_km"] = kwh_map.get(req.bus_type, 1.0)
    result = await db.buses.update_one({"bus_id": bus_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Bus updated"}

@api.delete("/buses/{bus_id}")
async def delete_bus(bus_id: str, user: dict = Depends(get_current_user)):
    result = await db.buses.delete_one({"bus_id": bus_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Bus deleted"}

@api.put("/buses/{bus_id}/assign-tender")
async def assign_tender_to_bus(bus_id: str, tender_id: str = Query(...), user: dict = Depends(get_current_user)):
    tender = await db.tenders.find_one({"tender_id": tender_id})
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    result = await db.buses.update_one({"bus_id": bus_id}, {"$set": {"tender_id": tender_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Tender assigned to bus"}

@api.get("/buses/{bus_id}")
async def get_bus(bus_id: str, user: dict = Depends(get_current_user)):
    bus = await db.buses.find_one({"bus_id": bus_id}, {"_id": 0})
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    trips = await db.trip_data.find({"bus_id": bus_id}, {"_id": 0}).to_list(100)
    energy = await db.energy_data.find({"bus_id": bus_id}, {"_id": 0}).to_list(100)
    return {**bus, "trips": trips, "energy": energy}

# ══════════════════════════════════════════════════════════
# DRIVERS
# ══════════════════════════════════════════════════════════

@api.get("/drivers")
async def list_drivers(user: dict = Depends(get_current_user)):
    drivers = await db.drivers.find({}, {"_id": 0}).to_list(1000)
    return drivers

@api.post("/drivers")
async def create_driver(req: DriverReq, user: dict = Depends(get_current_user)):
    existing = await db.drivers.find_one({"license_number": req.license_number})
    if existing:
        raise HTTPException(status_code=400, detail="License number already exists")
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())[:8]
    doc["performance_score"] = 100.0
    doc["penalties"] = []
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.drivers.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/drivers/{license_number}")
async def update_driver(license_number: str, req: DriverReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    update.pop("license_number", None)
    result = await db.drivers.update_one({"license_number": license_number}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Driver updated"}

@api.delete("/drivers/{license_number}")
async def delete_driver(license_number: str, user: dict = Depends(get_current_user)):
    result = await db.drivers.delete_one({"license_number": license_number})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Driver deleted"}

@api.put("/drivers/{license_number}/assign-bus")
async def assign_bus_to_driver(license_number: str, bus_id: str = Query(...), user: dict = Depends(get_current_user)):
    bus = await db.buses.find_one({"bus_id": bus_id})
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    result = await db.drivers.update_one({"license_number": license_number}, {"$set": {"bus_id": bus_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Bus assigned to driver"}

@api.get("/drivers/{license_number}/performance")
async def get_driver_performance(license_number: str, user: dict = Depends(get_current_user)):
    driver = await db.drivers.find_one({"license_number": license_number}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    trips = await db.trip_data.find({"driver_id": license_number}, {"_id": 0}).to_list(1000)
    total_km = sum(t.get("actual_km", 0) for t in trips)
    total_trips = len(trips)
    incidents = await db.incidents.find({"driver_id": license_number}, {"_id": 0}).to_list(100)
    return {
        "driver": driver, "total_km": round(total_km, 2), "total_trips": total_trips,
        "incidents": len(incidents), "performance_score": driver.get("performance_score", 100)
    }

# ══════════════════════════════════════════════════════════
# LIVE OPERATIONS
# ══════════════════════════════════════════════════════════

@api.get("/live-operations")
async def get_live_operations(user: dict = Depends(get_current_user)):
    buses = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(1000)
    live_data = []
    center_lat, center_lng = 17.385, 78.486
    for bus in buses:
        lat = center_lat + random.uniform(-0.05, 0.05)
        lng = center_lng + random.uniform(-0.05, 0.05)
        speed = random.randint(15, 60)
        status = random.choice(["on_route", "on_route", "on_route", "at_stop", "charging"])
        live_data.append({
            "bus_id": bus["bus_id"], "bus_type": bus.get("bus_type", ""),
            "lat": round(lat, 6), "lng": round(lng, 6),
            "speed": speed, "status": status,
            "driver": bus.get("driver_name", ""),
            "depot": bus.get("depot", "")
        })
    return live_data

@api.get("/live-operations/alerts")
async def get_alerts(user: dict = Depends(get_current_user)):
    alerts = []
    buses = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(1000)
    alert_types = ["GPS Failure", "Overspeeding", "Route Deviation", "Late Departure", "Low Battery", "PIS Failure"]
    for _ in range(min(5, len(buses))):
        bus = random.choice(buses)
        alerts.append({
            "id": str(uuid.uuid4())[:8],
            "bus_id": bus["bus_id"],
            "alert_type": random.choice(alert_types),
            "severity": random.choice(["low", "medium", "high"]),
            "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 120))).isoformat(),
            "resolved": random.choice([True, False, False])
        })
    return alerts

# ══════════════════════════════════════════════════════════
# ENERGY MANAGEMENT
# ══════════════════════════════════════════════════════════

@api.get("/energy")
async def list_energy(date_from: str = "", date_to: str = "", bus_id: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if bus_id:
        query["bus_id"] = bus_id
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    data = await db.energy_data.find(query, {"_id": 0}).to_list(10000)
    return data

@api.post("/energy")
async def add_energy(req: EnergyReq, user: dict = Depends(get_current_user)):
    doc = req.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.energy_data.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/energy/report")
async def energy_report(date_from: str = "", date_to: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    data = await db.energy_data.find(query, {"_id": 0}).to_list(10000)
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    trips = await db.trip_data.find(query, {"_id": 0}).to_list(10000)
    bus_km = {}
    for t in trips:
        bid = t.get("bus_id", "")
        bus_km[bid] = bus_km.get(bid, 0) + t.get("actual_km", 0)
    bus_energy = {}
    for e in data:
        bid = e.get("bus_id", "")
        if bid not in bus_energy:
            bus_energy[bid] = {"bus_id": bid, "actual_kwh": 0, "tariff": e.get("tariff_rate", 10)}
        bus_energy[bid]["actual_kwh"] += e.get("units_charged", 0)
    report = []
    for bid, ed in bus_energy.items():
        bus = bus_map.get(bid, {})
        kwh_per_km = bus.get("kwh_per_km", 1.0)
        km = bus_km.get(bid, 0)
        allowed = km * kwh_per_km
        actual = ed["actual_kwh"]
        tariff = ed["tariff"]
        report.append({
            "bus_id": bid, "bus_type": bus.get("bus_type", ""),
            "km_operated": round(km, 2), "kwh_per_km": kwh_per_km,
            "allowed_kwh": round(allowed, 2), "actual_kwh": round(actual, 2),
            "efficiency": round((actual / allowed * 100) if allowed > 0 else 0, 1),
            "allowed_cost": round(allowed * tariff, 2),
            "actual_cost": round(actual * tariff, 2),
            "adjustment": round(min(actual, allowed) * tariff, 2)
        })
    total_allowed = sum(r["allowed_kwh"] for r in report)
    total_actual = sum(r["actual_kwh"] for r in report)
    return {
        "report": report,
        "summary": {
            "total_allowed_kwh": round(total_allowed, 2),
            "total_actual_kwh": round(total_actual, 2),
            "total_efficiency": round((total_actual / total_allowed * 100) if total_allowed > 0 else 0, 1)
        }
    }

# ══════════════════════════════════════════════════════════
# KPI
# ══════════════════════════════════════════════════════════

@api.get("/kpi")
async def get_kpi(date_from: str = "", date_to: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    trips = await db.trip_data.find(query, {"_id": 0}).to_list(10000)
    energy = await db.energy_data.find(query, {"_id": 0}).to_list(10000)
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    incidents = await db.incidents.find({}, {"_id": 0}).to_list(1000)
    total_scheduled = sum(t.get("scheduled_km", 0) for t in trips)
    total_actual = sum(t.get("actual_km", 0) for t in trips)
    total_energy = sum(e.get("units_charged", 0) for e in energy)
    active_buses = len([b for b in buses if b.get("status") == "active"])
    return {
        "fleet_availability": round((total_actual / total_scheduled * 100) if total_scheduled > 0 else 0, 1),
        "km_efficiency": round((total_actual / total_scheduled * 100) if total_scheduled > 0 else 0, 1),
        "energy_per_km": round((total_energy / total_actual) if total_actual > 0 else 0, 3),
        "total_km_operated": round(total_actual, 2),
        "total_scheduled_km": round(total_scheduled, 2),
        "total_energy_consumed": round(total_energy, 2),
        "active_fleet": active_buses,
        "total_incidents": len(incidents),
        "open_incidents": len([i for i in incidents if i.get("status") != "resolved"]),
        "avg_speed": round(random.uniform(28, 35), 1),
        "on_time_pct": round(random.uniform(85, 95), 1)
    }

# ══════════════════════════════════════════════════════════
# DEDUCTION ENGINE
# ══════════════════════════════════════════════════════════

@api.get("/deductions/rules")
async def list_rules(user: dict = Depends(get_current_user)):
    rules = await db.deduction_rules.find({}, {"_id": 0}).to_list(100)
    return rules

@api.post("/deductions/rules")
async def create_rule(req: DeductionRuleReq, user: dict = Depends(get_current_user)):
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())[:8]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.deduction_rules.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/deductions/rules/{rule_id}")
async def update_rule(rule_id: str, req: DeductionRuleReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    result = await db.deduction_rules.update_one({"id": rule_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule updated"}

@api.delete("/deductions/rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(get_current_user)):
    result = await db.deduction_rules.delete_one({"id": rule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule deleted"}

@api.post("/deductions/apply")
async def apply_deductions(period_start: str = Query(...), period_end: str = Query(...), user: dict = Depends(get_current_user)):
    rules = await db.deduction_rules.find({"active": True}, {"_id": 0}).to_list(100)
    trips = await db.trip_data.find({"date": {"$gte": period_start, "$lte": period_end}}, {"_id": 0}).to_list(10000)
    tenders = await db.tenders.find({}, {"_id": 0}).to_list(100)
    tender_map = {t["tender_id"]: t for t in tenders}
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    total_scheduled = sum(t.get("scheduled_km", 0) for t in trips)
    total_actual = sum(t.get("actual_km", 0) for t in trips)
    missed_km = max(0, total_scheduled - total_actual)
    avg_pk_rate = 0
    if tenders:
        avg_pk_rate = sum(t.get("pk_rate", 0) for t in tenders) / len(tenders)
    base_payment = total_actual * avg_pk_rate
    availability_deduction = missed_km * avg_pk_rate
    performance_deduction = 0
    system_deduction = 0
    capped_total = 0
    uncapped_total = 0
    breakdown = []
    for rule in rules:
        rt = rule.get("rule_type", "")
        pct = rule.get("penalty_percent", 0)
        amount = base_payment * (pct / 100)
        if rule.get("is_capped") and rule.get("cap_limit", 0) > 0:
            amount = min(amount, rule["cap_limit"])
            capped_total += amount
        else:
            uncapped_total += amount
        if rt == "performance":
            performance_deduction += amount
        elif rt == "system":
            system_deduction += amount
        breakdown.append({"rule": rule["name"], "type": rt, "percent": pct, "amount": round(amount, 2)})
    total_deduction = availability_deduction + performance_deduction + system_deduction
    return {
        "period": {"start": period_start, "end": period_end},
        "base_payment": round(base_payment, 2),
        "missed_km": round(missed_km, 2),
        "availability_deduction": round(availability_deduction, 2),
        "performance_deduction": round(performance_deduction, 2),
        "system_deduction": round(system_deduction, 2),
        "total_deduction": round(total_deduction, 2),
        "breakdown": breakdown
    }

# ══════════════════════════════════════════════════════════
# BILLING
# ══════════════════════════════════════════════════════════

@api.post("/billing/generate")
async def generate_invoice(req: BillingGenerateReq, user: dict = Depends(get_current_user)):
    period_start = req.period_start
    period_end = req.period_end
    depot = req.depot
    bus_query = {}
    if depot:
        bus_query["depot"] = depot
    buses = await db.buses.find(bus_query, {"_id": 0}).to_list(1000)
    bus_ids = [b["bus_id"] for b in buses]
    bus_map = {b["bus_id"]: b for b in buses}
    tenders = await db.tenders.find({}, {"_id": 0}).to_list(100)
    tender_map = {t["tender_id"]: t for t in tenders}
    trip_query = {"date": {"$gte": period_start, "$lte": period_end}}
    if bus_ids:
        trip_query["bus_id"] = {"$in": bus_ids}
    trips = await db.trip_data.find(trip_query, {"_id": 0}).to_list(10000)
    energy_query = {"date": {"$gte": period_start, "$lte": period_end}}
    if bus_ids:
        energy_query["bus_id"] = {"$in": bus_ids}
    energy = await db.energy_data.find(energy_query, {"_id": 0}).to_list(10000)
    # Step 1: Total KM
    total_km = sum(t.get("actual_km", 0) for t in trips)
    scheduled_km = sum(t.get("scheduled_km", 0) for t in trips)
    # Step 2: PK Rate (weighted average by bus tender)
    bus_km = {}
    for t in trips:
        bid = t.get("bus_id", "")
        bus_km[bid] = bus_km.get(bid, 0) + t.get("actual_km", 0)
    weighted_pk = 0
    for bid, km in bus_km.items():
        bus = bus_map.get(bid, {})
        tender = tender_map.get(bus.get("tender_id", ""), {})
        pk_rate = tender.get("pk_rate", 0)
        weighted_pk += km * pk_rate
    base_payment = weighted_pk
    avg_pk_rate = weighted_pk / total_km if total_km > 0 else 0
    # Step 3: Energy
    bus_energy = {}
    for e in energy:
        bid = e.get("bus_id", "")
        if bid not in bus_energy:
            bus_energy[bid] = {"actual": 0, "tariff": e.get("tariff_rate", 10)}
        bus_energy[bid]["actual"] += e.get("units_charged", 0)
    total_allowed_energy = 0
    total_actual_energy = 0
    tariff_rate = 10
    for bid in set(list(bus_km.keys()) + list(bus_energy.keys())):
        bus = bus_map.get(bid, {})
        kwh_per_km = bus.get("kwh_per_km", 1.0)
        km = bus_km.get(bid, 0)
        allowed = km * kwh_per_km
        actual = bus_energy.get(bid, {}).get("actual", 0)
        tariff_rate = bus_energy.get(bid, {}).get("tariff", 10)
        total_allowed_energy += allowed
        total_actual_energy += actual
    allowed_cost = total_allowed_energy * tariff_rate
    actual_cost = total_actual_energy * tariff_rate
    energy_adjustment = min(actual_cost, allowed_cost)
    # Step 4: Subsidy
    subsidy = 0
    for bid, km in bus_km.items():
        bus = bus_map.get(bid, {})
        tender = tender_map.get(bus.get("tender_id", ""), {})
        sr = tender.get("subsidy_rate", 0)
        st = tender.get("subsidy_type", "per_km")
        if st == "per_km":
            subsidy += km * sr
        elif st == "per_bus":
            subsidy += sr
    # Step 5: Deductions
    missed_km = max(0, scheduled_km - total_km)
    availability_deduction = missed_km * avg_pk_rate
    rules = await db.deduction_rules.find({"active": True}, {"_id": 0}).to_list(100)
    performance_deduction = 0
    system_deduction = 0
    for rule in rules:
        rt = rule.get("rule_type", "")
        pct = rule.get("penalty_percent", 0)
        amount = base_payment * (pct / 100)
        if rule.get("is_capped") and rule.get("cap_limit", 0) > 0:
            amount = min(amount, rule["cap_limit"])
        if rt == "performance":
            performance_deduction += amount
        elif rt == "system":
            system_deduction += amount
    total_deduction = availability_deduction + performance_deduction + system_deduction
    # Step 6: Final
    final_payable = base_payment + energy_adjustment + subsidy - total_deduction
    invoice = {
        "invoice_id": f"INV-{str(uuid.uuid4())[:8].upper()}",
        "period_start": period_start, "period_end": period_end,
        "depot": depot or "All",
        "total_km": round(total_km, 2), "scheduled_km": round(scheduled_km, 2),
        "avg_pk_rate": round(avg_pk_rate, 2), "base_payment": round(base_payment, 2),
        "allowed_energy_kwh": round(total_allowed_energy, 2),
        "actual_energy_kwh": round(total_actual_energy, 2),
        "tariff_rate": tariff_rate,
        "allowed_energy_cost": round(allowed_cost, 2),
        "actual_energy_cost": round(actual_cost, 2),
        "energy_adjustment": round(energy_adjustment, 2),
        "subsidy": round(subsidy, 2),
        "missed_km": round(missed_km, 2),
        "availability_deduction": round(availability_deduction, 2),
        "performance_deduction": round(performance_deduction, 2),
        "system_deduction": round(system_deduction, 2),
        "total_deduction": round(total_deduction, 2),
        "final_payable": round(final_payable, 2),
        "status": "generated",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.billing.insert_one(dict(invoice))
    invoice.pop("_id", None)
    return invoice

@api.get("/billing")
async def list_invoices(user: dict = Depends(get_current_user)):
    invoices = await db.billing.find({}, {"_id": 0}).to_list(1000)
    return invoices

@api.get("/billing/{invoice_id}")
async def get_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv

@api.get("/billing/{invoice_id}/export-pdf")
async def export_invoice_pdf(invoice_id: str, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(190, 10, "TGSRTC - Bus Management Invoice", ln=True, align="C")
    pdf.ln(5)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(190, 6, f"Invoice ID: {inv['invoice_id']}", ln=True)
    pdf.cell(190, 6, f"Period: {inv['period_start']} to {inv['period_end']}", ln=True)
    pdf.cell(190, 6, f"Depot: {inv.get('depot', 'All')}", ln=True)
    pdf.cell(190, 6, f"Generated: {inv.get('created_at', '')[:10]}", ln=True)
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(190, 8, "Billing Summary", ln=True)
    pdf.set_font("Helvetica", "", 10)
    rows = [
        ("Total KM Operated", f"{inv['total_km']:,.2f} km"),
        ("Scheduled KM", f"{inv['scheduled_km']:,.2f} km"),
        ("Avg PK Rate", f"Rs. {inv['avg_pk_rate']:,.2f}/km"),
        ("Base Payment (KM x PK Rate)", f"Rs. {inv['base_payment']:,.2f}"),
        ("", ""),
        ("Allowed Energy", f"{inv['allowed_energy_kwh']:,.2f} kWh"),
        ("Actual Energy", f"{inv['actual_energy_kwh']:,.2f} kWh"),
        ("Tariff Rate", f"Rs. {inv['tariff_rate']:,.2f}/kWh"),
        ("Energy Adjustment", f"Rs. {inv['energy_adjustment']:,.2f}"),
        ("", ""),
        ("Subsidy", f"Rs. {inv['subsidy']:,.2f}"),
        ("", ""),
        ("Missed KM", f"{inv['missed_km']:,.2f} km"),
        ("Availability Deduction", f"Rs. {inv['availability_deduction']:,.2f}"),
        ("Performance Deduction", f"Rs. {inv['performance_deduction']:,.2f}"),
        ("System Deduction", f"Rs. {inv['system_deduction']:,.2f}"),
        ("Total Deductions", f"Rs. {inv['total_deduction']:,.2f}"),
    ]
    for label, val in rows:
        if label == "":
            pdf.ln(2)
            continue
        pdf.cell(110, 6, label)
        pdf.cell(80, 6, val, ln=True, align="R")
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(110, 8, "FINAL PAYABLE")
    pdf.cell(80, 8, f"Rs. {inv['final_payable']:,.2f}", ln=True, align="R")
    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={inv['invoice_id']}.pdf"})

@api.get("/billing/{invoice_id}/export-excel")
async def export_invoice_excel(invoice_id: str, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    wb = Workbook()
    ws = wb.active
    ws.title = "Invoice"
    ws.append(["TGSRTC Bus Management Invoice"])
    ws.append([])
    ws.append(["Invoice ID", inv["invoice_id"]])
    ws.append(["Period", f"{inv['period_start']} to {inv['period_end']}"])
    ws.append(["Depot", inv.get("depot", "All")])
    ws.append([])
    ws.append(["Component", "Value"])
    fields = [
        ("Total KM", inv["total_km"]), ("Scheduled KM", inv["scheduled_km"]),
        ("Avg PK Rate (Rs/km)", inv["avg_pk_rate"]), ("Base Payment", inv["base_payment"]),
        ("Allowed Energy (kWh)", inv["allowed_energy_kwh"]), ("Actual Energy (kWh)", inv["actual_energy_kwh"]),
        ("Tariff (Rs/kWh)", inv["tariff_rate"]), ("Energy Adjustment", inv["energy_adjustment"]),
        ("Subsidy", inv["subsidy"]),
        ("Missed KM", inv["missed_km"]), ("Availability Deduction", inv["availability_deduction"]),
        ("Performance Deduction", inv["performance_deduction"]), ("System Deduction", inv["system_deduction"]),
        ("Total Deductions", inv["total_deduction"]),
        ("FINAL PAYABLE", inv["final_payable"])
    ]
    for label, val in fields:
        ws.append([label, val])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={inv['invoice_id']}.xlsx"})

# ══════════════════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════════════════

@api.get("/reports")
async def generate_report(report_type: str = "operations", date_from: str = "", date_to: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    if report_type == "operations":
        trips = await db.trip_data.find(query, {"_id": 0}).to_list(10000)
        return {"type": "operations", "data": trips, "count": len(trips)}
    elif report_type == "energy":
        data = await db.energy_data.find(query, {"_id": 0}).to_list(10000)
        return {"type": "energy", "data": data, "count": len(data)}
    elif report_type == "incidents":
        data = await db.incidents.find({}, {"_id": 0}).to_list(1000)
        return {"type": "incidents", "data": data, "count": len(data)}
    elif report_type == "billing":
        data = await db.billing.find({}, {"_id": 0}).to_list(1000)
        return {"type": "billing", "data": data, "count": len(data)}
    return {"type": report_type, "data": [], "count": 0}

@api.get("/reports/download")
async def download_report(report_type: str = "operations", date_from: str = "", date_to: str = "", fmt: str = "excel", user: dict = Depends(get_current_user)):
    query = {}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    if report_type == "operations":
        data = await db.trip_data.find(query, {"_id": 0}).to_list(10000)
        cols = ["bus_id", "driver_id", "date", "scheduled_km", "actual_km"]
    elif report_type == "energy":
        data = await db.energy_data.find(query, {"_id": 0}).to_list(10000)
        cols = ["bus_id", "date", "units_charged", "tariff_rate"]
    elif report_type == "incidents":
        data = await db.incidents.find({}, {"_id": 0}).to_list(1000)
        cols = ["id", "incident_type", "bus_id", "severity", "status", "created_at"]
    elif report_type == "billing":
        data = await db.billing.find({}, {"_id": 0}).to_list(1000)
        cols = ["invoice_id", "period_start", "period_end", "base_payment", "energy_adjustment", "total_deduction", "final_payable"]
    else:
        raise HTTPException(status_code=400, detail="Invalid report type")
    if fmt == "excel":
        wb = Workbook()
        ws = wb.active
        ws.title = report_type.capitalize()
        ws.append(cols)
        for row in data:
            ws.append([row.get(c, "") for c in cols])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f"attachment; filename={report_type}_report.xlsx"})
    else:
        pdf = FPDF()
        pdf.add_page("L")
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(270, 10, f"TGSRTC {report_type.capitalize()} Report", ln=True, align="C")
        pdf.set_font("Helvetica", "", 8)
        col_w = 270 / len(cols)
        for c in cols:
            pdf.cell(col_w, 6, c, border=1)
        pdf.ln()
        for row in data[:100]:
            for c in cols:
                val = str(row.get(c, ""))[:20]
                pdf.cell(col_w, 5, val, border=1)
            pdf.ln()
        buf = io.BytesIO()
        pdf.output(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/pdf",
                                 headers={"Content-Disposition": f"attachment; filename={report_type}_report.pdf"})

# ══════════════════════════════════════════════════════════
# INCIDENTS
# ══════════════════════════════════════════════════════════

@api.get("/incidents")
async def list_incidents(user: dict = Depends(get_current_user)):
    incidents = await db.incidents.find({}, {"_id": 0}).to_list(1000)
    return incidents

@api.post("/incidents")
async def create_incident(req: IncidentReq, user: dict = Depends(get_current_user)):
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())[:8]
    doc["status"] = "open"
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["reported_by"] = user.get("name", "")
    await db.incidents.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/incidents/{incident_id}")
async def update_incident(incident_id: str, status: str = Query(...), user: dict = Depends(get_current_user)):
    result = await db.incidents.update_one({"id": incident_id}, {"$set": {"status": status}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"message": "Incident updated"}

# ══════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════

@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    settings = await db.settings.find({}, {"_id": 0}).to_list(100)
    return settings

@api.post("/settings")
async def update_setting(req: SettingsReq, user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"key": req.key},
        {"$set": {"value": req.value, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Setting updated"}

# ══════════════════════════════════════════════════════════
# REVENUE DETAILS (Ticket Issuing Machine API data)
# ══════════════════════════════════════════════════════════

@api.get("/revenue/details")
async def get_revenue_details(
    depot: str = "", bus_id: str = "",
    date_from: str = "", date_to: str = "",
    period: str = "daily",
    user: dict = Depends(get_current_user)
):
    query = {}
    if depot:
        query["depot"] = depot
    if bus_id:
        query["bus_id"] = bus_id
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    data = await db.revenue_data.find(query, {"_id": 0}).to_list(50000)
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    depots_list = list(set(b.get("depot", "") for b in buses if b.get("depot")))
    bus_ids_list = [b["bus_id"] for b in buses]
    if period == "daily":
        for d in data:
            d["depot"] = d.get("depot") or bus_map.get(d.get("bus_id"), {}).get("depot", "")
        total = sum(d.get("revenue_amount", 0) for d in data)
        return {"data": data, "total_revenue": round(total, 2), "depots": depots_list, "bus_ids": bus_ids_list, "period": "daily"}
    elif period == "monthly":
        monthly = {}
        for d in data:
            month_key = d["date"][:7]
            key = f"{d['bus_id']}_{month_key}"
            dep = d.get("depot") or bus_map.get(d.get("bus_id"), {}).get("depot", "")
            if key not in monthly:
                monthly[key] = {"bus_id": d["bus_id"], "depot": dep, "period": month_key, "revenue_amount": 0, "passengers": 0, "days": 0, "route": d.get("route", "")}
            monthly[key]["revenue_amount"] += d.get("revenue_amount", 0)
            monthly[key]["passengers"] += d.get("passengers", 0)
            monthly[key]["days"] += 1
        result = sorted(monthly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total = sum(r["revenue_amount"] for r in result)
        return {"data": result, "total_revenue": round(total, 2), "depots": depots_list, "bus_ids": bus_ids_list, "period": "monthly"}
    elif period == "quarterly":
        quarterly = {}
        for d in data:
            year = d["date"][:4]
            month = int(d["date"][5:7])
            q = (month - 1) // 3 + 1
            quarter_key = f"{year}-Q{q}"
            key = f"{d['bus_id']}_{quarter_key}"
            dep = d.get("depot") or bus_map.get(d.get("bus_id"), {}).get("depot", "")
            if key not in quarterly:
                quarterly[key] = {"bus_id": d["bus_id"], "depot": dep, "period": quarter_key, "revenue_amount": 0, "passengers": 0, "days": 0}
            quarterly[key]["revenue_amount"] += d.get("revenue_amount", 0)
            quarterly[key]["passengers"] += d.get("passengers", 0)
            quarterly[key]["days"] += 1
        result = sorted(quarterly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total = sum(r["revenue_amount"] for r in result)
        return {"data": result, "total_revenue": round(total, 2), "depots": depots_list, "bus_ids": bus_ids_list, "period": "quarterly"}
    return {"data": [], "total_revenue": 0, "depots": depots_list, "bus_ids": bus_ids_list, "period": period}

# ══════════════════════════════════════════════════════════
# KM DETAILS (GPS API data)
# ══════════════════════════════════════════════════════════

@api.get("/km/details")
async def get_km_details(
    depot: str = "", bus_id: str = "",
    date_from: str = "", date_to: str = "",
    period: str = "daily",
    user: dict = Depends(get_current_user)
):
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    depots_list = list(set(b.get("depot", "") for b in buses if b.get("depot")))
    bus_ids_list = [b["bus_id"] for b in buses]
    query = {}
    if bus_id:
        query["bus_id"] = bus_id
    elif depot:
        depot_buses = [b["bus_id"] for b in buses if b.get("depot") == depot]
        if depot_buses:
            query["bus_id"] = {"$in": depot_buses}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    trips = await db.trip_data.find(query, {"_id": 0}).to_list(50000)
    for t in trips:
        t["depot"] = bus_map.get(t.get("bus_id"), {}).get("depot", "")
        t["source"] = "GPS API"
    if period == "daily":
        total_km = sum(t.get("actual_km", 0) for t in trips)
        return {"data": trips, "total_km": round(total_km, 2), "depots": depots_list, "bus_ids": bus_ids_list, "period": "daily"}
    elif period == "monthly":
        monthly = {}
        for t in trips:
            month_key = t["date"][:7]
            key = f"{t['bus_id']}_{month_key}"
            if key not in monthly:
                monthly[key] = {"bus_id": t["bus_id"], "depot": t.get("depot", ""), "period": month_key, "actual_km": 0, "scheduled_km": 0, "days": 0}
            monthly[key]["actual_km"] += t.get("actual_km", 0)
            monthly[key]["scheduled_km"] += t.get("scheduled_km", 0)
            monthly[key]["days"] += 1
        result = sorted(monthly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total_km = sum(r["actual_km"] for r in result)
        return {"data": result, "total_km": round(total_km, 2), "depots": depots_list, "bus_ids": bus_ids_list, "period": "monthly"}
    elif period == "quarterly":
        quarterly = {}
        for t in trips:
            year = t["date"][:4]
            month = int(t["date"][5:7])
            q = (month - 1) // 3 + 1
            quarter_key = f"{year}-Q{q}"
            key = f"{t['bus_id']}_{quarter_key}"
            if key not in quarterly:
                quarterly[key] = {"bus_id": t["bus_id"], "depot": t.get("depot", ""), "period": quarter_key, "actual_km": 0, "scheduled_km": 0, "days": 0}
            quarterly[key]["actual_km"] += t.get("actual_km", 0)
            quarterly[key]["scheduled_km"] += t.get("scheduled_km", 0)
            quarterly[key]["days"] += 1
        result = sorted(quarterly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total_km = sum(r["actual_km"] for r in result)
        return {"data": result, "total_km": round(total_km, 2), "depots": depots_list, "bus_ids": bus_ids_list, "period": "quarterly"}
    return {"data": [], "total_km": 0, "depots": depots_list, "bus_ids": bus_ids_list, "period": period}

# ══════════════════════════════════════════════════════════
# SEED DATA
# ══════════════════════════════════════════════════════════

async def seed_data():
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
    # Buses
    depots = ["Miyapur Depot", "LB Nagar Depot", "Secunderabad Depot", "Warangal Depot"]
    if await db.buses.count_documents({}) == 0:
        buses = []
        for i in range(1, 11):
            bt = random.choice(["12m_ac", "9m_ac", "12m_non_ac"])
            kwh = {"12m_ac": 1.3, "9m_ac": 1.0, "12m_non_ac": 1.1}.get(bt, 1.0)
            tid = random.choice(["TND-001", "TND-002", "TND-003"])
            buses.append({
                "bus_id": f"TS-{str(i).zfill(3)}", "bus_type": bt, "capacity": random.choice([32, 40, 50]),
                "tender_id": tid, "depot": random.choice(depots),
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
                trips.append({
                    "bus_id": bus["bus_id"], "driver_id": driver.get("license_number", "") if driver else "",
                    "date": date, "scheduled_km": scheduled, "actual_km": max(actual, 150)
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
    # Revenue data (Ticket Issuing Machine)
    if await db.revenue_data.count_documents({}) == 0:
        revenue_records = []
        buses_list = await db.buses.find({"status": "active"}, {"_id": 0}).to_list(100)
        routes = ["Route-101 Miyapur-Secunderabad", "Route-202 LB Nagar-MGBS", "Route-303 Kukatpally-Charminar",
                   "Route-404 Secunderabad-Warangal", "Route-505 Uppal-Mehdipatnam", "Route-606 ECIL-Nampally"]
        for day_offset in range(90):
            date = (datetime.now(timezone.utc) - timedelta(days=day_offset)).strftime("%Y-%m-%d")
            for bus in buses_list:
                capacity = bus.get("capacity", 40)
                base_rev = capacity * random.uniform(3.5, 7.0) * random.randint(4, 8)
                passengers = random.randint(int(capacity * 3), int(capacity * 7))
                revenue_records.append({
                    "bus_id": bus["bus_id"], "date": date,
                    "depot": bus.get("depot", ""),
                    "route": random.choice(routes),
                    "revenue_amount": round(base_rev, 2),
                    "passengers": passengers,
                    "source": "ticket_issuing_machine"
                })
        await db.revenue_data.insert_many(revenue_records)
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
    # Incidents
    if await db.incidents.count_documents({}) == 0:
        inc_types = ["Accident", "Breakdown", "Route Deviation", "Passenger Complaint", "Driver Issue"]
        incidents = []
        for i in range(5):
            incidents.append({
                "id": f"INC-{str(i+1).zfill(3)}",
                "incident_type": inc_types[i], "description": f"Sample incident: {inc_types[i]} reported",
                "bus_id": f"TS-{str(random.randint(1,8)).zfill(3)}",
                "driver_id": f"DRV-{str(random.randint(1,8)).zfill(3)}",
                "severity": random.choice(["low", "medium", "high"]),
                "status": random.choice(["open", "investigating", "resolved"]),
                "reported_by": "System",
                "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 15))).isoformat()
            })
        await db.incidents.insert_many(incidents)
    # Settings
    if await db.settings.count_documents({}) == 0:
        settings = [
            {"key": "tariff_rate", "value": "8.5", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "12m_ac_kwh_per_km", "value": "1.3", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "9m_ac_kwh_per_km", "value": "1.0", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "12m_non_ac_kwh_per_km", "value": "1.1", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "max_deduction_cap_pct", "value": "20", "updated_at": datetime.now(timezone.utc).isoformat()},
            {"key": "default_subsidy_rate", "value": "5", "updated_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db.settings.insert_many(settings)
    # Write test credentials
    os.makedirs("/app/memory", exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write("# Test Credentials\n\n")
        f.write("## Admin\n- Email: admin@tgsrtc.com\n- Password: admin123\n- Role: admin\n\n")
        f.write("## Depot Manager\n- Email: depot@tgsrtc.com\n- Password: depot123\n- Role: depot_manager\n\n")
        f.write("## Finance Officer\n- Email: finance@tgsrtc.com\n- Password: finance123\n- Role: finance_officer\n\n")
        f.write("## Vendor\n- Email: vendor@tgsrtc.com\n- Password: vendor123\n- Role: vendor\n\n")
        f.write("## Auth Endpoints\n- POST /api/auth/login\n- POST /api/auth/register\n- GET /api/auth/me\n- POST /api/auth/logout\n")
    logger.info("Seed data complete")

# ══════════════════════════════════════════════════════════
# STARTUP / SHUTDOWN
# ══════════════════════════════════════════════════════════

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.tenders.create_index("tender_id", unique=True)
    await db.buses.create_index("bus_id", unique=True)
    await db.drivers.create_index("license_number", unique=True)
    await seed_data()

@app.on_event("shutdown")
async def shutdown():
    client.close()

# Include router
app.include_router(api)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
