"""
API route handlers (v1). Split into domain routers over time.

Generated structure: single module for minimal breakage; prefer extracting
`endpoints/*.py` pieces behind `APIRouter` includes as the codebase grows.
"""

from __future__ import annotations

import io
import logging
import os
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fpdf import FPDF
from openpyxl import Workbook

from app.api.deps import get_current_user
from app.core.database import db
from app.core.pagination import normalize_page_limit, paged_payload, slice_rows
from app.core.security import (
    JWT_ALGORITHM,
    create_access_token,
    create_refresh_token,
    get_jwt_secret,
    hash_password,
    verify_password,
)
from app.domain.incident_types import (
    DEFAULT_ASSIGNMENT_TEAMS,
    IncidentChannel,
    IncidentSeverity,
    IncidentStatus,
    creatable_incident_type_codes,
    incident_types_public,
    incident_types_public_creatable,
    normalize_incident_type,
)
from app.schemas.requests import (
    BillingGenerateReq,
    BillingWorkflowReq,
    BusinessRuleReq,
    BusReq,
    DepotReq,
    DeductionRuleReq,
    DriverReq,
    DutyReq,
    EnergyReq,
    ForgotPasswordReq,
    IncidentCreateReq,
    IncidentNoteReq,
    IncidentUpdateReq,
    InfractionReq,
    InfractionLogReq,
    LoginReq,
    RegisterReq,
    ResetPasswordReq,
    RouteCreateReq,
    RouteStopRefReq,
    RouteUpdateReq,
    StopMasterCreateReq,
    StopMasterUpdateReq,
    SettingsReq,
    TenderReq,
)
from app.services.gcc_engine import compute_kpi_damages

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _norm_q(val: str) -> str:
    """Query-string normalization: empty or 'all' means no filter."""
    s = (val or "").strip()
    if not s or s.lower() == "all":
        return ""
    return s


def _trip_energy_date_match(date_from: str, date_to: str) -> dict | None:
    if date_from and date_to:
        return {"$gte": date_from, "$lte": date_to}
    if date_from:
        return {"$gte": date_from}
    if date_to:
        return {"$lte": date_to}
    return None


async def _bus_ids_in_depot(depot: str) -> list[str]:
    depot = _norm_q(depot)
    if not depot:
        return []
    cur = db.buses.find({"depot": depot}, {"bus_id": 1})
    return [b["bus_id"] async for b in cur]

# ══════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════

@router.post("/auth/login")
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

@router.post("/auth/register")
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

@router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user

@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@router.post("/auth/forgot-password")
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

@router.post("/auth/reset-password")
async def reset_password(req: ResetPasswordReq):
    record = await db.password_reset_tokens.find_one({"token": req.token, "used": False})
    if not record or record["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    hashed = hash_password(req.new_password)
    await db.users.update_one({"email": record["email"]}, {"$set": {"password_hash": hashed}})
    await db.password_reset_tokens.update_one({"token": req.token}, {"$set": {"used": True}})
    return {"message": "Password reset successfully"}

@router.post("/auth/refresh")
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

@router.get("/dashboard")
async def get_dashboard(
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    bus_id: str = "",
    user: dict = Depends(get_current_user),
):
    depot_f = _norm_q(depot)
    bus_f = _norm_q(bus_id)
    all_buses_meta = await db.buses.find({}, {"_id": 0, "bus_id": 1, "status": 1, "depot": 1}).to_list(1000)
    depots = sorted({b.get("depot", "") for b in all_buses_meta if b.get("depot")})
    bus_query: dict = {}
    if depot_f:
        bus_query["depot"] = depot_f
    if bus_f:
        bus_query["bus_id"] = bus_f
    buses = await db.buses.find(bus_query, {"_id": 0, "bus_id": 1, "status": 1, "depot": 1}).to_list(1000)
    filter_bus_ids = [b["bus_id"] for b in buses]
    total_buses = len(buses)
    active_buses = len([b for b in buses if b.get("status") == "active"])
    if bus_query:
        total_drivers = await db.drivers.count_documents({"bus_id": {"$in": filter_bus_ids}})
        active_drivers = await db.drivers.count_documents({"bus_id": {"$in": filter_bus_ids}, "status": "active"})
    else:
        total_drivers = await db.drivers.count_documents({})
        active_drivers = await db.drivers.count_documents({"status": "active"})
    trip_match: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        trip_match["date"] = dm
    if bus_query:
        trip_match["bus_id"] = {"$in": filter_bus_ids}
    trip_agg = await db.trip_data.aggregate([
        {"$match": trip_match},
        {"$group": {"_id": "$date", "actual_km": {"$sum": "$actual_km"}, "scheduled_km": {"$sum": "$scheduled_km"}}},
    ]).to_list(500)
    total_km = sum(d["actual_km"] for d in trip_agg)
    scheduled_km = sum(d["scheduled_km"] for d in trip_agg)
    km_chart = sorted(
        [{"date": d["_id"], "actual_km": d["actual_km"], "scheduled_km": d["scheduled_km"]} for d in trip_agg],
        key=lambda x: x["date"],
    )[-30:]
    energy_match: dict = {}
    if dm:
        energy_match["date"] = dm
    if bus_query:
        energy_match["bus_id"] = {"$in": filter_bus_ids}
    energy_agg = await db.energy_data.aggregate([
        {"$match": energy_match},
        {"$group": {"_id": "$date", "units": {"$sum": "$units_charged"}}},
    ]).to_list(500)
    total_energy = sum(d["units"] for d in energy_agg)
    energy_chart = sorted([{"date": d["_id"], "units": d["units"]} for d in energy_agg], key=lambda x: x["date"])[-30:]
    inc_open = {"status": {"$nin": [IncidentStatus.RESOLVED.value, IncidentStatus.CLOSED.value]}}
    if bus_query:
        or_inc = [{"bus_id": {"$in": filter_bus_ids}}]
        if depot_f:
            or_inc.append({"depot": depot_f})
        inc_q = {"$and": [inc_open, {"$or": or_inc}]}
        active_incidents = await db.incidents.count_documents(inc_q)
    else:
        active_incidents = await db.incidents.count_documents(inc_open)
    bill_match: dict = {}
    if depot_f:
        bill_match["depot"] = depot_f
    billing_agg = await db.billing.aggregate(
        [{"$match": bill_match}, {"$group": {"_id": None, "total": {"$sum": "$final_payable"}}}]
    ).to_list(1)
    total_revenue = billing_agg[0]["total"] if billing_agg else 0
    rev_match: dict = {}
    if dm:
        rev_match["date"] = dm
    if bus_query:
        rev_match["bus_id"] = {"$in": filter_bus_ids}
    rev_agg = await db.revenue_data.aggregate(
        [
            {"$match": rev_match},
            {"$group": {"_id": None, "revenue": {"$sum": "$revenue_amount"}, "passengers": {"$sum": "$passengers"}}},
        ]
    ).to_list(1)
    total_ticket_revenue = rev_agg[0]["revenue"] if rev_agg else 0
    total_passengers = rev_agg[0]["passengers"] if rev_agg else 0
    bus_ids_for_ui = sorted(
        b["bus_id"] for b in all_buses_meta if not depot_f or b.get("depot") == depot_f
    )
    return {
        "total_buses": total_buses,
        "active_buses": active_buses,
        "total_drivers": total_drivers,
        "active_drivers": active_drivers,
        "total_km": round(total_km, 2),
        "scheduled_km": round(scheduled_km, 2),
        "total_energy": round(total_energy, 2),
        "active_incidents": active_incidents,
        "total_revenue": round(total_revenue, 2),
        "total_ticket_revenue": round(total_ticket_revenue, 2),
        "total_passengers": total_passengers,
        "availability_pct": round((total_km / scheduled_km * 100) if scheduled_km > 0 else 0, 1),
        "km_chart": km_chart,
        "energy_chart": energy_chart,
        "depots": depots,
        "bus_ids": bus_ids_for_ui,
    }

# ══════════════════════════════════════════════════════════
# TENDERS
# ══════════════════════════════════════════════════════════

@router.get("/tenders")
async def list_tenders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    p, lim = normalize_page_limit(page, limit)
    total = await db.tenders.count_documents({})
    cur = db.tenders.find({}, {"_id": 0}).sort("tender_id", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/tenders")
async def create_tender(req: TenderReq, user: dict = Depends(get_current_user)):
    existing = await db.tenders.find_one({"tender_id": req.tender_id})
    if existing:
        raise HTTPException(status_code=400, detail="Tender ID already exists")
    doc = req.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.tenders.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/tenders/{tender_id}")
async def update_tender(tender_id: str, req: TenderReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    update.pop("tender_id", None)
    result = await db.tenders.update_one({"tender_id": tender_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tender not found")
    return {"message": "Tender updated"}

@router.delete("/tenders/{tender_id}")
async def delete_tender(tender_id: str, user: dict = Depends(get_current_user)):
    buses = await db.buses.find_one({"tender_id": tender_id})
    if buses:
        raise HTTPException(status_code=400, detail="Cannot delete: buses are assigned to this tender")
    result = await db.tenders.delete_one({"tender_id": tender_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tender not found")
    return {"message": "Tender deleted"}

# ══════════════════════════════════════════════════════════
# DEPOTS (master data — aligns with bus.depot and filters)
# ══════════════════════════════════════════════════════════


async def _cascade_depot_field(old: str, new: str) -> None:
    if old == new:
        return
    await db.buses.update_many({"depot": old}, {"$set": {"depot": new}})
    await db.duty_assignments.update_many({"depot": old}, {"$set": {"depot": new}})
    await db.incidents.update_many({"depot": old}, {"$set": {"depot": new}})
    await db.revenue_data.update_many({"depot": old}, {"$set": {"depot": new}})
    await db.billing.update_many({"depot": old}, {"$set": {"depot": new}})


@router.get("/depots")
async def list_depots(
    active: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    a = (active or "").strip().lower()
    if a in ("true", "1", "yes"):
        q["active"] = True
    elif a in ("false", "0", "no"):
        q["active"] = False
    p, lim = normalize_page_limit(page, limit)
    total = await db.depots.count_documents(q)
    rows = (
        await db.depots.find(q, {"_id": 0}).sort("name", 1).skip((p - 1) * lim).limit(lim).to_list(lim)
    )
    for d in rows:
        d["bus_count"] = await db.buses.count_documents({"depot": d.get("name", "")})
    return paged_payload(rows, total=total, page=page, limit=limit)


@router.post("/depots")
async def create_depot(req: DepotReq, user: dict = Depends(get_current_user)):
    name = req.name.strip()
    if await db.depots.find_one({"name": name}):
        raise HTTPException(status_code=400, detail="Depot name already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "name": name,
        "code": (req.code or "").strip(),
        "address": (req.address or "").strip(),
        "active": req.active,
        "created_at": now,
        "updated_at": now,
    }
    await db.depots.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/depots/{depot_name:path}")
async def update_depot(depot_name: str, req: DepotReq, user: dict = Depends(get_current_user)):
    old = depot_name.strip()
    existing = await db.depots.find_one({"name": old}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Depot not found")
    new_name = req.name.strip()
    if new_name != old and await db.depots.find_one({"name": new_name}):
        raise HTTPException(status_code=400, detail="Another depot already uses this name")
    await _cascade_depot_field(old, new_name)
    now = datetime.now(timezone.utc).isoformat()
    await db.depots.update_one(
        {"name": old},
        {
            "$set": {
                "name": new_name,
                "code": (req.code or "").strip(),
                "address": (req.address or "").strip(),
                "active": req.active,
                "updated_at": now,
            }
        },
    )
    out = {**existing, "name": new_name, "code": (req.code or "").strip(), "address": (req.address or "").strip(), "active": req.active, "updated_at": now}
    return out


@router.delete("/depots/{depot_name:path}")
async def delete_depot(depot_name: str, user: dict = Depends(get_current_user)):
    name = depot_name.strip()
    if not await db.depots.find_one({"name": name}):
        raise HTTPException(status_code=404, detail="Depot not found")
    bus_n = await db.buses.count_documents({"depot": name})
    if bus_n:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {bus_n} bus(es) still assigned to this depot")
    duty_n = await db.duty_assignments.count_documents({"depot": name})
    if duty_n:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {duty_n} duty row(s) reference this depot")
    await db.depots.delete_one({"name": name})
    return {"message": "Depot deleted"}


# ══════════════════════════════════════════════════════════
# STOP MASTER (shared stops — referenced by routes via stop_sequence)
# ══════════════════════════════════════════════════════════


@router.get("/stop-master")
async def list_stop_master(
    region: str = "",
    active: str = "",
    search: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    filters: list = []
    rgn = _norm_q(region)
    if rgn:
        filters.append({"region": rgn})
    a = (active or "").strip().lower()
    if a in ("true", "1", "yes"):
        filters.append({"active": True})
    elif a in ("false", "0", "no"):
        filters.append({"active": False})
    search_t = (search or "").strip()
    if search_t:
        filters.append(
            {
                "$or": [
                    {"stop_id": {"$regex": search_t, "$options": "i"}},
                    {"name": {"$regex": search_t, "$options": "i"}},
                    {"locality": {"$regex": search_t, "$options": "i"}},
                ]
            }
        )
    q: dict = {}
    if len(filters) > 1:
        q = {"$and": filters}
    elif len(filters) == 1:
        q = filters[0]
    p, lim = normalize_page_limit(page, limit)
    total = await db.stop_master.count_documents(q)
    cur = db.stop_master.find(q, {"_id": 0}).sort("stop_id", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    for it in items:
        it["route_count"] = await db.routes.count_documents({"stop_sequence.stop_id": it["stop_id"]})
    return paged_payload(items, total=total, page=page, limit=limit)


@router.post("/stop-master")
async def create_stop_master(req: StopMasterCreateReq, user: dict = Depends(get_current_user)):
    sid = req.stop_id.strip()
    if await db.stop_master.find_one({"stop_id": sid}):
        raise HTTPException(status_code=400, detail="Stop ID already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc: dict = {
        "stop_id": sid,
        "name": req.name.strip(),
        "locality": (req.locality or "").strip(),
        "landmark": (req.landmark or "").strip(),
        "region": ((req.region or "") or "Hyderabad").strip(),
        "active": req.active,
        "created_at": now,
        "updated_at": now,
    }
    if req.lat is not None:
        doc["lat"] = req.lat
    if req.lng is not None:
        doc["lng"] = req.lng
    await db.stop_master.insert_one(doc)
    doc.pop("_id", None)
    doc["route_count"] = 0
    return doc


@router.get("/stop-master/{stop_id}")
async def get_stop_master(stop_id: str, user: dict = Depends(get_current_user)):
    sid = stop_id.strip()
    doc = await db.stop_master.find_one({"stop_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Stop not found")
    doc["route_count"] = await db.routes.count_documents({"stop_sequence.stop_id": sid})
    return doc


@router.put("/stop-master/{stop_id}")
async def update_stop_master(stop_id: str, req: StopMasterUpdateReq, user: dict = Depends(get_current_user)):
    sid = stop_id.strip()
    if not await db.stop_master.find_one({"stop_id": sid}):
        raise HTTPException(status_code=404, detail="Stop not found")
    now = datetime.now(timezone.utc).isoformat()
    upd: dict = {
        "name": req.name.strip(),
        "locality": (req.locality or "").strip(),
        "landmark": (req.landmark or "").strip(),
        "region": ((req.region or "") or "Hyderabad").strip(),
        "active": req.active,
        "updated_at": now,
    }
    if req.lat is not None:
        upd["lat"] = req.lat
    if req.lng is not None:
        upd["lng"] = req.lng
    await db.stop_master.update_one({"stop_id": sid}, {"$set": upd})
    out = await db.stop_master.find_one({"stop_id": sid}, {"_id": 0})
    out["route_count"] = await db.routes.count_documents({"stop_sequence.stop_id": sid})
    return out


@router.delete("/stop-master/{stop_id}")
async def delete_stop_master(stop_id: str, user: dict = Depends(get_current_user)):
    sid = stop_id.strip()
    if not await db.stop_master.find_one({"stop_id": sid}):
        raise HTTPException(status_code=404, detail="Stop not found")
    rc = await db.routes.count_documents({"stop_sequence.stop_id": sid})
    if rc:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: used on {rc} route(s) — remove it from route stop sequences first",
        )
    await db.stop_master.delete_one({"stop_id": sid})
    return {"message": "Stop deleted"}


def _normalize_stop_sequence(seq: list[RouteStopRefReq]) -> list[dict]:
    if len(seq) > 200:
        raise HTTPException(status_code=400, detail="Too many stops per route (max 200)")
    if not seq:
        return []
    ordered = sorted(seq, key=lambda s: s.seq)
    seqnums = [s.seq for s in ordered]
    if len(seqnums) != len(set(seqnums)):
        raise HTTPException(status_code=400, detail="Duplicate stop sequence numbers on route")
    return [{"stop_id": s.stop_id.strip(), "seq": s.seq} for s in ordered]


async def _validate_stop_ids_exist(ids: list[str]) -> None:
    if not ids:
        return
    uniq = list(dict.fromkeys(ids))
    n = await db.stop_master.count_documents({"stop_id": {"$in": uniq}})
    if n != len(uniq):
        raise HTTPException(
            status_code=400,
            detail="One or more stop_id values are missing from Stop master — create them under Stops first",
        )


async def _hydrate_route_stops_row(row: dict) -> None:
    """Set `stops` (resolved) and `stop_count` on a route document for API responses."""
    seq_ref = row.get("stop_sequence")
    if isinstance(seq_ref, list) and len(seq_ref) > 0:
        ids = [x.get("stop_id") for x in seq_ref if isinstance(x, dict) and x.get("stop_id")]
        masters: dict = {}
        if ids:
            cur = db.stop_master.find({"stop_id": {"$in": ids}}, {"_id": 0})
            async for doc in cur:
                masters[doc["stop_id"]] = doc
        resolved: list = []
        for item in sorted(seq_ref, key=lambda z: int(z.get("seq") or 0)):
            sid = item.get("stop_id")
            if not sid:
                continue
            m = masters.get(sid, {})
            resolved.append(
                {
                    "seq": item.get("seq"),
                    "stop_id": sid,
                    "name": m.get("name", sid),
                    "locality": m.get("locality", ""),
                    "landmark": m.get("landmark", ""),
                    "lat": m.get("lat"),
                    "lng": m.get("lng"),
                    "region": m.get("region", ""),
                }
            )
        row["stops"] = resolved
        row["stop_count"] = len(resolved)
        return
    legacy = row.get("stops")
    if isinstance(legacy, list) and legacy:
        row["stops"] = sorted(legacy, key=lambda z: int(z.get("seq") or 0))
        row["stop_count"] = len(legacy)
    else:
        row["stops"] = []
        row["stop_count"] = 0


# ══════════════════════════════════════════════════════════
# BUS ROUTES (master — links to revenue_data.route via `name`)
# Canonical path: GET/POST /api/bus-routes (and /api/bus-routes/{route_id}).
# GET /api/routes is an alias for the list endpoint only (tools/docs that still call `/routes`).
# If /api/bus-routes returns 404 but /api/buses returns 401, the API process is stale — restart
# uvicorn from this repo's `backend` folder so this file is loaded.
# ══════════════════════════════════════════════════════════


async def _list_bus_routes_filtered(
    depot: str,
    active: str,
    search: str,
    page: int,
    limit: int,
) -> dict:
    filters: list = []
    d = _norm_q(depot)
    if d:
        filters.append({"depot": d})
    a = (active or "").strip().lower()
    if a in ("true", "1", "yes"):
        filters.append({"active": True})
    elif a in ("false", "0", "no"):
        filters.append({"active": False})
    search_t = (search or "").strip()
    if search_t:
        filters.append(
            {
                "$or": [
                    {"name": {"$regex": search_t, "$options": "i"}},
                    {"route_id": {"$regex": search_t, "$options": "i"}},
                    {"origin": {"$regex": search_t, "$options": "i"}},
                    {"destination": {"$regex": search_t, "$options": "i"}},
                ]
            }
        )
    q: dict = {}
    if len(filters) > 1:
        q = {"$and": filters}
    elif len(filters) == 1:
        q = filters[0]
    p, lim = normalize_page_limit(page, limit)
    total = await db.routes.count_documents(q)
    cur = db.routes.find(q, {"_id": 0}).sort("route_id", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    for row in items:
        row["revenue_row_count"] = await db.revenue_data.count_documents({"route": row.get("name", "")})
        await _hydrate_route_stops_row(row)
    return paged_payload(items, total=total, page=page, limit=limit)


# GET /api/bus-routes and GET /api/routes are registered on the FastAPI app in app.main (create_app).


@router.post("/bus-routes")
async def create_route(req: RouteCreateReq, user: dict = Depends(get_current_user)):
    rid = req.route_id.strip()
    if await db.routes.find_one({"route_id": rid}):
        raise HTTPException(status_code=400, detail="Route ID already exists")
    name = req.name.strip()
    if await db.routes.find_one({"name": name}):
        raise HTTPException(status_code=400, detail="Route name already exists")
    sq = _normalize_stop_sequence(req.stop_sequence)
    await _validate_stop_ids_exist([x["stop_id"] for x in sq])
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "route_id": rid,
        "name": name,
        "origin": (req.origin or "").strip(),
        "destination": (req.destination or "").strip(),
        "distance_km": float(req.distance_km),
        "depot": (req.depot or "").strip(),
        "active": req.active,
        "stop_sequence": sq,
        "created_at": now,
        "updated_at": now,
    }
    await db.routes.insert_one(doc)
    out = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    await _hydrate_route_stops_row(out)
    return out


@router.get("/bus-routes/{route_id}")
async def get_route(route_id: str, user: dict = Depends(get_current_user)):
    rid = route_id.strip()
    doc = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Route not found")
    doc["revenue_row_count"] = await db.revenue_data.count_documents({"route": doc.get("name", "")})
    await _hydrate_route_stops_row(doc)
    return doc


@router.put("/bus-routes/{route_id}")
async def update_route(route_id: str, req: RouteUpdateReq, user: dict = Depends(get_current_user)):
    rid = route_id.strip()
    existing = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Route not found")
    new_name = req.name.strip()
    old_name = existing.get("name", "")
    if new_name != old_name:
        clash = await db.routes.find_one({"name": new_name, "route_id": {"$ne": rid}})
        if clash:
            raise HTTPException(status_code=400, detail="Another route already uses this name")
        await db.revenue_data.update_many({"route": old_name}, {"$set": {"route": new_name}})
    sq = _normalize_stop_sequence(req.stop_sequence)
    await _validate_stop_ids_exist([x["stop_id"] for x in sq])
    now = datetime.now(timezone.utc).isoformat()
    await db.routes.update_one(
        {"route_id": rid},
        {
            "$set": {
                "name": new_name,
                "origin": (req.origin or "").strip(),
                "destination": (req.destination or "").strip(),
                "distance_km": float(req.distance_km),
                "depot": (req.depot or "").strip(),
                "active": req.active,
                "stop_sequence": sq,
                "updated_at": now,
            },
            "$unset": {"stops": ""},
        },
    )
    out = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    await _hydrate_route_stops_row(out)
    return out


@router.delete("/bus-routes/{route_id}")
async def delete_route(route_id: str, user: dict = Depends(get_current_user)):
    rid = route_id.strip()
    doc = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Route not found")
    n = await db.revenue_data.count_documents({"route": doc.get("name", "")})
    if n:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {n} revenue row(s) use this route name — remove or reassign data first",
        )
    await db.routes.delete_one({"route_id": rid})
    return {"message": "Route deleted"}

# ══════════════════════════════════════════════════════════
# BUSES
# ══════════════════════════════════════════════════════════

@router.get("/buses")
async def list_buses(
    depot: str = "",
    status: str = "",
    bus_id: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    d = _norm_q(depot)
    st = _norm_q(status)
    bid = _norm_q(bus_id)
    if d:
        q["depot"] = d
    if st:
        q["status"] = st
    if bid:
        q["bus_id"] = bid
    p, lim = normalize_page_limit(page, limit)
    total = await db.buses.count_documents(q)
    cur = db.buses.find(q, {"_id": 0}).sort("bus_id", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/buses")
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

@router.put("/buses/{bus_id}")
async def update_bus(bus_id: str, req: BusReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    update.pop("bus_id", None)
    kwh_map = {"12m_ac": 1.3, "9m_ac": 1.0, "12m_non_ac": 1.1, "9m_non_ac": 0.8}
    update["kwh_per_km"] = kwh_map.get(req.bus_type, 1.0)
    result = await db.buses.update_one({"bus_id": bus_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Bus updated"}

@router.delete("/buses/{bus_id}")
async def delete_bus(bus_id: str, user: dict = Depends(get_current_user)):
    result = await db.buses.delete_one({"bus_id": bus_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Bus deleted"}

@router.put("/buses/{bus_id}/assign-tender")
async def assign_tender_to_bus(bus_id: str, tender_id: str = Query(...), user: dict = Depends(get_current_user)):
    tender = await db.tenders.find_one({"tender_id": tender_id})
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    result = await db.buses.update_one({"bus_id": bus_id}, {"$set": {"tender_id": tender_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Tender assigned to bus"}

@router.get("/buses/{bus_id}")
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

@router.get("/drivers")
async def list_drivers(
    depot: str = "",
    bus_id: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    bid = _norm_q(bus_id)
    dep = _norm_q(depot)
    st = _norm_q(status)
    if bid:
        q["bus_id"] = bid
    elif dep:
        ids = await _bus_ids_in_depot(depot)
        q["bus_id"] = {"$in": ids} if ids else {"$in": []}
    if st:
        q["status"] = st
    p, lim = normalize_page_limit(page, limit)
    total = await db.drivers.count_documents(q)
    cur = db.drivers.find(q, {"_id": 0}).sort("license_number", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/drivers")
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

@router.put("/drivers/{license_number}")
async def update_driver(license_number: str, req: DriverReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    update.pop("license_number", None)
    result = await db.drivers.update_one({"license_number": license_number}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Driver updated"}

@router.delete("/drivers/{license_number}")
async def delete_driver(license_number: str, user: dict = Depends(get_current_user)):
    result = await db.drivers.delete_one({"license_number": license_number})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Driver deleted"}

@router.put("/drivers/{license_number}/assign-bus")
async def assign_bus_to_driver(license_number: str, bus_id: str = Query(...), user: dict = Depends(get_current_user)):
    bus = await db.buses.find_one({"bus_id": bus_id})
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    result = await db.drivers.update_one({"license_number": license_number}, {"$set": {"bus_id": bus_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Bus assigned to driver"}

@router.get("/drivers/{license_number}/performance")
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

@router.get("/live-operations")
async def get_live_operations(
    depot: str = "",
    bus_id: str = "",
    status: str = "",
    user: dict = Depends(get_current_user),
):
    bq: dict = {"status": "active"}
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    if d:
        bq["depot"] = d
    if bid:
        bq["bus_id"] = bid
    buses = await db.buses.find(bq, {"_id": 0}).to_list(1000)
    live_data = []
    center_lat, center_lng = 17.385, 78.486
    for bus in buses:
        lat = center_lat + random.uniform(-0.05, 0.05)
        lng = center_lng + random.uniform(-0.05, 0.05)
        speed = random.randint(15, 60)
        st = random.choices(
            ["on_route", "at_stop", "charging", "panic"],
            weights=[62, 18, 12, 8],
            k=1,
        )[0]
        live_data.append({
            "bus_id": bus["bus_id"], "bus_type": bus.get("bus_type", ""),
            "lat": round(lat, 6), "lng": round(lng, 6),
            "speed": speed, "status": st,
            "driver": bus.get("driver_name", ""),
            "depot": bus.get("depot", "")
        })
    st_f = _norm_q(status)
    if st_f:
        live_data = [x for x in live_data if x["status"] == st_f]
    return live_data

# Tender sec. 8(4): type of instances for alerts (email + dashboard)
ALERT_INSTANCE_DEFINITIONS = [
    {"alert_code": "panic", "alert_type": "Panic alert"},
    {"alert_code": "overspeed_user", "alert_type": "Overspeed (user-defined)"},
    {"alert_code": "gps_breakage", "alert_type": "GPS breakage"},
    {"alert_code": "idle", "alert_type": "Idle"},
    {"alert_code": "route_deviation", "alert_type": "Route deviation"},
    {"alert_code": "bunching_user", "alert_type": "Bunching (user-defined)"},
    {"alert_code": "harness_removal", "alert_type": "Harness removal (disconnection)"},
]


@router.get("/live-operations/alerts")
async def get_alerts(
    depot: str = "",
    bus_id: str = "",
    alert_code: str = "",
    severity: str = "",
    resolved: str = "",
    user: dict = Depends(get_current_user),
):
    bq: dict = {"status": "active"}
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    if d:
        bq["depot"] = d
    if bid:
        bq["bus_id"] = bid
    buses = await db.buses.find(bq, {"_id": 0}).to_list(1000)
    alerts = []
    for _ in range(min(5, len(buses))):
        bus = random.choice(buses)
        spec = random.choice(ALERT_INSTANCE_DEFINITIONS)
        alerts.append({
            "id": str(uuid.uuid4())[:8],
            "bus_id": bus["bus_id"],
            "alert_code": spec["alert_code"],
            "alert_type": spec["alert_type"],
            "severity": random.choice(["low", "medium", "high"]),
            "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 120))).isoformat(),
            "resolved": random.choice([True, False, False])
        })
    ac = _norm_q(alert_code)
    sev = _norm_q(severity)
    if ac:
        alerts = [a for a in alerts if a["alert_code"] == ac]
    if sev:
        alerts = [a for a in alerts if a["severity"] == sev]
    rv = _norm_q(resolved).lower()
    if rv in ("true", "1", "yes"):
        alerts = [a for a in alerts if a["resolved"] is True]
    elif rv in ("false", "0", "no"):
        alerts = [a for a in alerts if a["resolved"] is False]
    return alerts

# ══════════════════════════════════════════════════════════
# ENERGY MANAGEMENT
# ══════════════════════════════════════════════════════════

@router.get("/energy")
async def list_energy(
    date_from: str = "",
    date_to: str = "",
    bus_id: str = "",
    depot: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    bid = _norm_q(bus_id)
    if bid:
        query["bus_id"] = bid
    elif _norm_q(depot):
        ids = await _bus_ids_in_depot(depot)
        if ids:
            query["bus_id"] = {"$in": ids}
        else:
            return paged_payload([], total=0, page=page, limit=limit)
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    p, lim = normalize_page_limit(page, limit)
    total = await db.energy_data.count_documents(query)
    cur = db.energy_data.find(query, {"_id": 0}).sort("date", -1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/energy")
async def add_energy(req: EnergyReq, user: dict = Depends(get_current_user)):
    doc = req.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.energy_data.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.get("/energy/report")
async def energy_report(
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    bus_id: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    bid = _norm_q(bus_id)
    dep = _norm_q(depot)
    bus_filter_ids: list[str] | None = None
    if bid:
        query["bus_id"] = bid
        bus_filter_ids = [bid]
    elif dep:
        bus_filter_ids = await _bus_ids_in_depot(depot)
        if bus_filter_ids:
            query["bus_id"] = {"$in": bus_filter_ids}
        else:
            _, meta = slice_rows([], page, limit)
            return {
                "report": [],
                "summary": {"total_allowed_kwh": 0, "total_actual_kwh": 0, "total_efficiency": 0},
                "row_total": 0,
                "page": meta["page"],
                "limit": meta["limit"],
                "pages": meta["pages"],
            }
    data = await db.energy_data.find(query, {"_id": 0}).to_list(3000)
    bq: dict = {}
    if dep:
        bq["depot"] = dep
    if bid:
        bq["bus_id"] = bid
    buses = await db.buses.find(bq, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    trips = await db.trip_data.find(query, {"_id": 0}).to_list(3000)
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
    rep_slice, meta = slice_rows(report, page, limit)
    return {
        "report": rep_slice,
        "summary": {
            "total_allowed_kwh": round(total_allowed, 2),
            "total_actual_kwh": round(total_actual, 2),
            "total_efficiency": round((total_actual / total_allowed * 100) if total_allowed > 0 else 0, 1)
        },
        "row_total": meta["total"],
        "page": meta["page"],
        "limit": meta["limit"],
        "pages": meta["pages"],
    }

# ══════════════════════════════════════════════════════════
# KPI
# ══════════════════════════════════════════════════════════

@router.get("/kpi")
async def get_kpi(
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    bus_id: str = "",
    user: dict = Depends(get_current_user),
):
    trip_q: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        trip_q["date"] = dm
    bus_query: dict = {}
    if _norm_q(depot):
        bus_query["depot"] = _norm_q(depot)
    if _norm_q(bus_id):
        bus_query["bus_id"] = _norm_q(bus_id)
    if bus_query:
        scoped = await db.buses.find(bus_query, {"bus_id": 1}).to_list(1000)
        ids = [b["bus_id"] for b in scoped]
        trip_q["bus_id"] = {"$in": ids}
    trips = await db.trip_data.find(trip_q, {"_id": 0}).to_list(3000)
    energy = await db.energy_data.find(trip_q, {"_id": 0}).to_list(3000)
    buses = await db.buses.find(bus_query if bus_query else {}, {"_id": 0}).to_list(1000)
    inc_q: dict = {}
    if bus_query:
        ids = [b["bus_id"] for b in buses]
        inc_q = {"$or": [{"bus_id": {"$in": ids}}, *([{"depot": _norm_q(depot)}] if _norm_q(depot) else [])]}
    incidents = await db.incidents.find(inc_q, {"_id": 0}).to_list(1000)
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
        "open_incidents": len(
            [
                i
                for i in incidents
                if i.get("status")
                not in (IncidentStatus.RESOLVED.value, IncidentStatus.CLOSED.value)
            ]
        ),
        "avg_speed": round(random.uniform(28, 35), 1),
        "on_time_pct": round(random.uniform(85, 95), 1)
    }

# ══════════════════════════════════════════════════════════
# DEDUCTION ENGINE
# ══════════════════════════════════════════════════════════

@router.get("/deductions/rules")
async def list_rules(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    p, lim = normalize_page_limit(page, limit)
    total = await db.deduction_rules.count_documents({})
    cur = db.deduction_rules.find({}, {"_id": 0}).sort("name", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/deductions/rules")
async def create_rule(req: DeductionRuleReq, user: dict = Depends(get_current_user)):
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())[:8]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.deduction_rules.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/deductions/rules/{rule_id}")
async def update_rule(rule_id: str, req: DeductionRuleReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    result = await db.deduction_rules.update_one({"id": rule_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule updated"}

@router.delete("/deductions/rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(get_current_user)):
    result = await db.deduction_rules.delete_one({"id": rule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule deleted"}

@router.post("/deductions/apply")
async def apply_deductions(period_start: str = Query(...), period_end: str = Query(...), user: dict = Depends(get_current_user)):
    rules = await db.deduction_rules.find({"active": True}, {"_id": 0}).to_list(100)
    trips = await db.trip_data.find({"date": {"$gte": period_start, "$lte": period_end}}, {"_id": 0}).to_list(3000)
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

@router.post("/billing/generate")
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
    trips = await db.trip_data.find(trip_query, {"_id": 0}).to_list(3000)
    energy_query = {"date": {"$gte": period_start, "$lte": period_end}}
    if bus_ids:
        energy_query["bus_id"] = {"$in": bus_ids}
    energy = await db.energy_data.find(energy_query, {"_id": 0}).to_list(3000)
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
        "status": "draft",
        "workflow_state": "draft",
        "workflow_log": [],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.billing.insert_one(dict(invoice))
    invoice.pop("_id", None)
    return invoice

@router.get("/billing")
async def list_invoices(
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    d = _norm_q(depot)
    st = _norm_q(status)
    if d:
        q["depot"] = d
    if st:
        q["status"] = st
    if date_from and date_to:
        q["$and"] = [{"period_start": {"$lte": date_to}}, {"period_end": {"$gte": date_from}}]
    p, lim = normalize_page_limit(page, limit)
    total = await db.billing.count_documents(q)
    cur = db.billing.find(q, {"_id": 0}).sort("created_at", -1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.get("/billing/{invoice_id}")
async def get_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv

@router.get("/billing/{invoice_id}/export-pdf")
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

@router.get("/billing/{invoice_id}/export-excel")
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


async def _collect_report_rows(
    *,
    report_type: str,
    date_from: str,
    date_to: str,
    depot: str,
    bus_id: str,
    status: str,
    incident_type: str,
    severity: str,
) -> tuple[str, list]:
    query: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    bid = _norm_q(bus_id)
    dep = _norm_q(depot)
    if bid:
        query["bus_id"] = bid
    elif dep and report_type in ("operations", "energy"):
        ids = await _bus_ids_in_depot(depot)
        if ids:
            query["bus_id"] = {"$in": ids}
        else:
            return report_type, []
    if report_type == "operations":
        trips = await db.trip_data.find(query, {"_id": 0}).to_list(3000)
        return "operations", trips
    if report_type == "energy":
        data = await db.energy_data.find(query, {"_id": 0}).to_list(3000)
        return "energy", data
    if report_type == "incidents":
        iq: dict = {}
        st = _norm_q(status)
        if st:
            iq["status"] = st
        it = _norm_q(incident_type)
        if it:
            iq["incident_type"] = normalize_incident_type(it)
        sev = _norm_q(severity)
        if sev:
            iq["severity"] = sev
        if dep:
            iq["depot"] = dep
        if bid:
            iq["bus_id"] = bid
        elif dep and "bus_id" not in iq:
            ids = await _bus_ids_in_depot(depot)
            if ids:
                iq["bus_id"] = {"$in": ids}
        if date_from:
            iq.setdefault("created_at", {})["$gte"] = f"{date_from[:10]}T00:00:00"
        if date_to:
            iq.setdefault("created_at", {})["$lte"] = f"{date_to[:10]}T23:59:59.999999"
        data = await db.incidents.find(iq, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return "incidents", data
    if report_type == "billing":
        bq: dict = {}
        if dep:
            bq["depot"] = dep
        if date_from and date_to:
            bq["$and"] = [{"period_start": {"$lte": date_to}}, {"period_end": {"$gte": date_from}}]
        data = await db.billing.find(bq, {"_id": 0}).to_list(1000)
        return "billing", data
    return report_type, []


@router.get("/reports")
async def generate_report(
    report_type: str = "operations",
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    bus_id: str = "",
    status: str = "",
    incident_type: str = "",
    severity: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    rtype, rows = await _collect_report_rows(
        report_type=report_type,
        date_from=date_from,
        date_to=date_to,
        depot=depot,
        bus_id=bus_id,
        status=status,
        incident_type=incident_type,
        severity=severity,
    )
    data_slice, meta = slice_rows(rows, page, limit)
    return {
        "type": rtype,
        "data": data_slice,
        "count": meta["total"],
        "page": meta["page"],
        "limit": meta["limit"],
        "pages": meta["pages"],
    }


@router.get("/reports/download")
async def download_report(
    report_type: str = "operations",
    date_from: str = "",
    date_to: str = "",
    fmt: str = "excel",
    depot: str = "",
    bus_id: str = "",
    status: str = "",
    incident_type: str = "",
    severity: str = "",
    user: dict = Depends(get_current_user),
):
    _, data = await _collect_report_rows(
        report_type=report_type,
        date_from=date_from,
        date_to=date_to,
        depot=depot,
        bus_id=bus_id,
        status=status,
        incident_type=incident_type,
        severity=severity,
    )
    if report_type == "operations":
        cols = ["bus_id", "driver_id", "date", "scheduled_km", "actual_km"]
    elif report_type == "energy":
        cols = ["bus_id", "date", "units_charged", "tariff_rate"]
    elif report_type == "incidents":
        cols = [
            "id",
            "incident_type",
            "channel",
            "bus_id",
            "depot",
            "assigned_team",
            "severity",
            "status",
            "created_at",
        ]
    elif report_type == "billing":
        cols = ["invoice_id", "period_start", "period_end", "depot", "base_payment", "energy_adjustment", "total_deduction", "final_payable"]
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
# INCIDENTS (IRMS — prompt §14)
# ══════════════════════════════════════════════════════════


def _incident_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_incident_activity(
    existing: list | None,
    *,
    action: str,
    user_name: str,
    detail: str,
) -> list:
    log = list(existing or [])
    log.append(
        {
            "at": _incident_now_iso(),
            "action": action,
            "by": user_name,
            "detail": detail[:2000],
        }
    )
    return log


@router.get("/incidents/meta")
async def incidents_meta(user: dict = Depends(get_current_user)):
    """Canonical types, channels, statuses, and default assignment teams for UI."""
    return {
        "incident_types": incident_types_public_creatable(),
        "incident_types_reference": incident_types_public(),
        "channels": [e.value for e in IncidentChannel],
        "severities": [e.value for e in IncidentSeverity],
        "statuses": [e.value for e in IncidentStatus],
        "assignment_teams": list(DEFAULT_ASSIGNMENT_TEAMS),
    }


@router.get("/incidents")
async def list_incidents(
    status: str = "",
    incident_type: str = "",
    depot: str = "",
    bus_id: str = "",
    driver_id: str = "",
    severity: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    st = _norm_q(status)
    if st:
        q["status"] = st
    it = _norm_q(incident_type)
    if it:
        q["incident_type"] = normalize_incident_type(it)
    d = _norm_q(depot)
    if d:
        q["depot"] = d
    bid = _norm_q(bus_id)
    if bid:
        q["bus_id"] = bid
    drv = _norm_q(driver_id)
    if drv:
        q["driver_id"] = drv
    sev = _norm_q(severity)
    if sev:
        q["severity"] = sev
    if date_from:
        q.setdefault("created_at", {})["$gte"] = f"{date_from[:10]}T00:00:00"
    if date_to:
        q.setdefault("created_at", {})["$lte"] = f"{date_to[:10]}T23:59:59.999999"
    p, lim = normalize_page_limit(page, limit)
    total = await db.incidents.count_documents(q)
    cur = db.incidents.find(q, {"_id": 0}).sort("created_at", -1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, user: dict = Depends(get_current_user)):
    doc = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return doc


@router.post("/incidents")
async def create_incident(req: IncidentCreateReq, user: dict = Depends(get_current_user)):
    code = normalize_incident_type(req.incident_type)
    if code not in creatable_incident_type_codes():
        raise HTTPException(
            status_code=400,
            detail="Invalid incident_type — choose a code from GET /api/incidents/meta (OTHER is not allowed on new tickets).",
        )
    now = _incident_now_iso()
    bus_id = (req.bus_id or "").strip()
    if bus_id.lower() in ("none", "null"):
        bus_id = ""
    depot_in = (req.depot or "").strip()
    if bus_id:
        bus_doc = await db.buses.find_one({"bus_id": bus_id}, {"_id": 0, "depot": 1})
        if not bus_doc:
            raise HTTPException(status_code=400, detail=f"Unknown bus_id: {bus_id}")
        bus_depot = (bus_doc.get("depot") or "").strip()
        if depot_in and bus_depot and depot_in != bus_depot:
            raise HTTPException(
                status_code=400,
                detail="depot does not match bus master — leave depot blank to auto-fill from bus",
            )
        depot_final = depot_in or bus_depot
    else:
        depot_final = depot_in
    driver_id = (req.driver_id or "").strip()
    if driver_id:
        drv_ok = await db.drivers.find_one({"license_number": driver_id}, {"_id": 1})
        if not drv_ok:
            raise HTTPException(status_code=400, detail=f"Unknown driver_id (license): {driver_id}")
    rel_inf = (req.related_infraction_id or "").strip()
    if rel_inf:
        if not await db.infractions_logged.find_one({"id": rel_inf}, {"_id": 1}):
            raise HTTPException(status_code=400, detail=f"related_infraction_id not found: {rel_inf}")
    name = user.get("name", "") or user.get("email", "")
    doc = {
        "id": f"INC-{uuid.uuid4().hex[:8].upper()}",
        "incident_type": code,
        "description": req.description.strip(),
        "bus_id": bus_id,
        "driver_id": driver_id,
        "depot": depot_final,
        "route_name": (req.route_name or "").strip(),
        "route_id": (req.route_id or "").strip(),
        "trip_id": (req.trip_id or "").strip(),
        "duty_id": (req.duty_id or "").strip(),
        "location_text": (req.location_text or "").strip(),
        "related_infraction_id": rel_inf,
        "severity": req.severity,
        "channel": req.channel,
        "telephonic_reference": (req.telephonic_reference or "").strip(),
        "status": IncidentStatus.OPEN.value,
        "assigned_team": "",
        "assigned_to": "",
        "reported_by": name,
        "created_at": now,
        "updated_at": now,
        "activity_log": _append_incident_activity(
            None, action="created", user_name=name, detail="Incident reported"
        ),
    }
    await db.incidents.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/incidents/{incident_id}")
async def update_incident(
    incident_id: str,
    req: IncidentUpdateReq,
    user: dict = Depends(get_current_user),
):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    updates: dict = {"updated_at": _incident_now_iso()}
    name = user.get("name", "") or user.get("email", "")
    log = existing.get("activity_log") or []
    if req.status is not None and req.status != existing.get("status"):
        updates["status"] = req.status
        log = _append_incident_activity(
            log,
            action="status_change",
            user_name=name,
            detail=f"Status → {req.status}",
        )
    if req.assigned_team is not None:
        nt = req.assigned_team.strip()
        if nt != (existing.get("assigned_team") or ""):
            updates["assigned_team"] = nt
            log = _append_incident_activity(
                log,
                action="assign_team",
                user_name=name,
                detail=f"Team: {nt}",
            )
    if req.assigned_to is not None:
        nu = req.assigned_to.strip()
        if nu != (existing.get("assigned_to") or ""):
            updates["assigned_to"] = nu
            log = _append_incident_activity(
                log,
                action="assign_user",
                user_name=name,
                detail=f"Assignee: {nu}",
            )
    if req.description is not None:
        nd = req.description.strip()
        if nd != (existing.get("description") or ""):
            updates["description"] = nd
            log = _append_incident_activity(
                log,
                action="description_update",
                user_name=name,
                detail="Description updated",
            )
    updates["activity_log"] = log
    await db.incidents.update_one({"id": incident_id}, {"$set": updates})
    return {"message": "Incident updated", "id": incident_id}


@router.put("/incidents/{incident_id}/status-legacy")
async def update_incident_status_legacy(
    incident_id: str,
    status: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Backward-compatible query-param status update for older clients."""
    body = IncidentUpdateReq(status=status)
    return await update_incident(incident_id, body, user)


@router.post("/incidents/{incident_id}/notes")
async def add_incident_note(
    incident_id: str,
    req: IncidentNoteReq,
    user: dict = Depends(get_current_user),
):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    name = user.get("name", "") or user.get("email", "")
    log = _append_incident_activity(
        existing.get("activity_log"),
        action="note",
        user_name=name,
        detail=req.note.strip(),
    )
    await db.incidents.update_one(
        {"id": incident_id},
        {"$set": {"activity_log": log, "updated_at": _incident_now_iso()}},
    )
    return {"message": "Note added", "id": incident_id}

# ══════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════

@router.get("/settings")
async def get_settings(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    p, lim = normalize_page_limit(page, limit)
    total = await db.settings.count_documents({})
    cur = db.settings.find({}, {"_id": 0}).sort("key", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/settings")
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

@router.get("/revenue/details")
async def get_revenue_details(
    depot: str = "", bus_id: str = "",
    date_from: str = "", date_to: str = "",
    period: str = "daily", route: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    rt = _norm_q(route)
    if d:
        query["depot"] = d
    if bid:
        query["bus_id"] = bid
    if rt:
        query["route"] = rt
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    data = await db.revenue_data.find(query, {"_id": 0}).to_list(5000)
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    depots_list = sorted(set(b.get("depot", "") for b in buses if b.get("depot")))
    bus_ids_list = sorted(b["bus_id"] for b in buses if not d or b.get("depot") == d)
    routes_list = sorted(
        r for r in await db.revenue_data.distinct("route") if r
    )
    if period == "daily":
        for row in data:
            row["depot"] = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
        total = sum(row.get("revenue_amount", 0) for row in data)
        sl, meta = slice_rows(data, page, limit)
        return {
            "data": sl,
            "total_revenue": round(total, 2),
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "routes": routes_list,
            "period": "daily",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    if period == "monthly":
        monthly = {}
        for row in data:
            month_key = row["date"][:7]
            key = f"{row['bus_id']}_{month_key}"
            dep = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
            if key not in monthly:
                monthly[key] = {
                    "bus_id": row["bus_id"],
                    "depot": dep,
                    "period": month_key,
                    "revenue_amount": 0,
                    "passengers": 0,
                    "days": 0,
                    "route": row.get("route", ""),
                }
            monthly[key]["revenue_amount"] += row.get("revenue_amount", 0)
            monthly[key]["passengers"] += row.get("passengers", 0)
            monthly[key]["days"] += 1
        result = sorted(monthly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total = sum(r["revenue_amount"] for r in result)
        sl, meta = slice_rows(result, page, limit)
        return {
            "data": sl,
            "total_revenue": round(total, 2),
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "routes": routes_list,
            "period": "monthly",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    if period == "quarterly":
        quarterly = {}
        for row in data:
            year = row["date"][:4]
            month = int(row["date"][5:7])
            qn = (month - 1) // 3 + 1
            quarter_key = f"{year}-Q{qn}"
            key = f"{row['bus_id']}_{quarter_key}"
            dep = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
            if key not in quarterly:
                quarterly[key] = {
                    "bus_id": row["bus_id"],
                    "depot": dep,
                    "period": quarter_key,
                    "revenue_amount": 0,
                    "passengers": 0,
                    "days": 0,
                }
            quarterly[key]["revenue_amount"] += row.get("revenue_amount", 0)
            quarterly[key]["passengers"] += row.get("passengers", 0)
            quarterly[key]["days"] += 1
        result = sorted(quarterly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total = sum(r["revenue_amount"] for r in result)
        sl, meta = slice_rows(result, page, limit)
        return {
            "data": sl,
            "total_revenue": round(total, 2),
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "routes": routes_list,
            "period": "quarterly",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    _, meta = slice_rows([], page, limit)
    return {
        "data": [],
        "total_revenue": 0,
        "depots": depots_list,
        "bus_ids": bus_ids_list,
        "routes": routes_list,
        "period": period,
        "row_total": 0,
        "page": meta["page"],
        "limit": meta["limit"],
        "pages": meta["pages"],
    }

# ══════════════════════════════════════════════════════════
# KM DETAILS (GPS API data)
# ══════════════════════════════════════════════════════════

@router.get("/km/details")
async def get_km_details(
    depot: str = "", bus_id: str = "",
    date_from: str = "", date_to: str = "",
    period: str = "daily",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    depots_list = sorted(set(b.get("depot", "") for b in buses if b.get("depot")))
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    bus_ids_list = sorted(b["bus_id"] for b in buses if not d or b.get("depot") == d)
    query: dict = {}
    if bid:
        query["bus_id"] = bid
    elif d:
        depot_buses = [b["bus_id"] for b in buses if b.get("depot") == d]
        if depot_buses:
            query["bus_id"] = {"$in": depot_buses}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    trips = await db.trip_data.find(query, {"_id": 0}).to_list(5000)
    for t in trips:
        t["depot"] = bus_map.get(t.get("bus_id"), {}).get("depot", "")
        t["source"] = "GPS API"
    if period == "daily":
        total_km = sum(t.get("actual_km", 0) for t in trips)
        sl, meta = slice_rows(trips, page, limit)
        return {
            "data": sl,
            "total_km": round(total_km, 2),
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "period": "daily",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
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
        sl, meta = slice_rows(result, page, limit)
        return {
            "data": sl,
            "total_km": round(total_km, 2),
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "period": "monthly",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
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
        sl, meta = slice_rows(result, page, limit)
        return {
            "data": sl,
            "total_km": round(total_km, 2),
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "period": "quarterly",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    _, meta = slice_rows([], page, limit)
    return {
        "data": [],
        "total_km": 0,
        "depots": depots_list,
        "bus_ids": bus_ids_list,
        "period": period,
        "row_total": 0,
        "page": meta["page"],
        "limit": meta["limit"],
        "pages": meta["pages"],
    }

# ══════════════════════════════════════════════════════════
# DUTY ASSIGNMENTS
# ══════════════════════════════════════════════════════════

@router.get("/duties")
async def list_duties(
    date: str = "",
    driver_license: str = "",
    bus_id: str = "",
    depot: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    if date:
        query["date"] = date
    dl = _norm_q(driver_license)
    if dl:
        query["driver_license"] = dl
    bid = _norm_q(bus_id)
    if bid:
        query["bus_id"] = bid
    d = _norm_q(depot)
    if d:
        query["depot"] = d
    p, lim = normalize_page_limit(page, limit)
    total = await db.duty_assignments.count_documents(query)
    cur = (
        db.duty_assignments.find(query, {"_id": 0}).sort([("date", -1), ("id", -1)]).skip((p - 1) * lim).limit(lim)
    )
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/duties")
async def create_duty(req: DutyReq, user: dict = Depends(get_current_user)):
    driver = await db.drivers.find_one({"license_number": req.driver_license}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    bus = await db.buses.find_one({"bus_id": req.bus_id}, {"_id": 0})
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    doc = req.model_dump()
    doc["id"] = f"DTY-{str(uuid.uuid4())[:8].upper()}"
    doc["driver_name"] = driver.get("name", req.driver_name)
    doc["driver_phone"] = driver.get("phone", req.driver_phone)
    doc["depot"] = bus.get("depot", "")
    doc["status"] = "assigned"
    doc["sms_sent"] = False
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["created_by"] = user.get("name", "")
    await db.duty_assignments.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/duties/{duty_id}")
async def update_duty(duty_id: str, req: DutyReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    driver = await db.drivers.find_one({"license_number": req.driver_license}, {"_id": 0})
    if driver:
        update["driver_name"] = driver.get("name", "")
        update["driver_phone"] = driver.get("phone", "")
    result = await db.duty_assignments.update_one({"id": duty_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Duty not found")
    return {"message": "Duty updated"}

@router.delete("/duties/{duty_id}")
async def delete_duty(duty_id: str, user: dict = Depends(get_current_user)):
    result = await db.duty_assignments.delete_one({"id": duty_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Duty not found")
    return {"message": "Duty deleted"}

@router.post("/duties/{duty_id}/send-sms")
async def send_duty_sms(duty_id: str, user: dict = Depends(get_current_user)):
    duty = await db.duty_assignments.find_one({"id": duty_id}, {"_id": 0})
    if not duty:
        raise HTTPException(status_code=404, detail="Duty not found")
    trips_text = ""
    for t in duty.get("trips", []):
        trips_text += f"Trip {t['trip_number']}: {t.get('direction','').title()} {t['start_time']}-{t['end_time']}. "
    sms_message = (
        f"TGSRTC Duty Alert: Dear {duty['driver_name']}, "
        f"your duty on {duty['date']}: "
        f"Bus {duty['bus_id']}, Route: {duty['route_name']} "
        f"({duty['start_point']} to {duty['end_point']}). "
        f"{trips_text}"
        f"Report on time. -TGSRTC"
    )
    logger.info(f"SMS to {duty['driver_phone']}: {sms_message}")
    await db.duty_assignments.update_one({"id": duty_id}, {"$set": {"sms_sent": True, "sms_message": sms_message}})
    return {"message": "SMS sent successfully", "sms_text": sms_message, "phone": duty["driver_phone"]}

@router.post("/duties/send-all-sms")
async def send_all_duty_sms(date: str = Query(...), user: dict = Depends(get_current_user)):
    duties = await db.duty_assignments.find({"date": date, "sms_sent": False}, {"_id": 0}).to_list(1000)
    sent_count = 0
    for duty in duties:
        trips_text = ""
        for t in duty.get("trips", []):
            trips_text += f"Trip {t['trip_number']}: {t.get('direction','').title()} {t['start_time']}-{t['end_time']}. "
        sms_message = (
            f"TGSRTC Duty Alert: Dear {duty['driver_name']}, "
            f"your duty on {duty['date']}: "
            f"Bus {duty['bus_id']}, Route: {duty['route_name']} "
            f"({duty['start_point']} to {duty['end_point']}). "
            f"{trips_text}-TGSRTC"
        )
        logger.info(f"SMS to {duty['driver_phone']}: {sms_message}")
        await db.duty_assignments.update_one({"id": duty["id"]}, {"$set": {"sms_sent": True, "sms_message": sms_message}})
        sent_count += 1
    return {"message": f"SMS sent to {sent_count} drivers", "count": sent_count}

# ══════════════════════════════════════════════════════════
# PASSENGER DETAILS (Ticket Issuing Machine API data)
# ══════════════════════════════════════════════════════════

@router.get("/passengers/details")
async def get_passenger_details(
    depot: str = "", bus_id: str = "",
    date_from: str = "", date_to: str = "",
    period: str = "daily", route: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    rt = _norm_q(route)
    if d:
        query["depot"] = d
    if bid:
        query["bus_id"] = bid
    if rt:
        query["route"] = rt
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    data = await db.revenue_data.find(query, {"_id": 0}).to_list(5000)
    buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
    bus_map = {b["bus_id"]: b for b in buses}
    depots_list = sorted(set(b.get("depot", "") for b in buses if b.get("depot")))
    bus_ids_list = sorted(b["bus_id"] for b in buses if not d or b.get("depot") == d)
    routes_list = sorted(r for r in await db.revenue_data.distinct("route") if r)
    if period == "daily":
        for row in data:
            row["depot"] = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
        total_pax = sum(row.get("passengers", 0) for row in data)
        sl, meta = slice_rows(data, page, limit)
        return {
            "data": sl,
            "total_passengers": total_pax,
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "routes": routes_list,
            "period": "daily",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    if period == "monthly":
        monthly = {}
        for row in data:
            month_key = row["date"][:7]
            key = f"{row['bus_id']}_{month_key}"
            dep = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
            if key not in monthly:
                monthly[key] = {"bus_id": row["bus_id"], "depot": dep, "period": month_key, "passengers": 0, "revenue_amount": 0, "days": 0, "route": row.get("route", "")}
            monthly[key]["passengers"] += row.get("passengers", 0)
            monthly[key]["revenue_amount"] += row.get("revenue_amount", 0)
            monthly[key]["days"] += 1
        result = sorted(monthly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total_pax = sum(r["passengers"] for r in result)
        sl, meta = slice_rows(result, page, limit)
        return {
            "data": sl,
            "total_passengers": total_pax,
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "routes": routes_list,
            "period": "monthly",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    if period == "quarterly":
        quarterly = {}
        for row in data:
            year = row["date"][:4]
            month = int(row["date"][5:7])
            qn = (month - 1) // 3 + 1
            quarter_key = f"{year}-Q{qn}"
            key = f"{row['bus_id']}_{quarter_key}"
            dep = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
            if key not in quarterly:
                quarterly[key] = {"bus_id": row["bus_id"], "depot": dep, "period": quarter_key, "passengers": 0, "revenue_amount": 0, "days": 0}
            quarterly[key]["passengers"] += row.get("passengers", 0)
            quarterly[key]["revenue_amount"] += row.get("revenue_amount", 0)
            quarterly[key]["days"] += 1
        result = sorted(quarterly.values(), key=lambda x: (x["period"], x["bus_id"]))
        total_pax = sum(r["passengers"] for r in result)
        sl, meta = slice_rows(result, page, limit)
        return {
            "data": sl,
            "total_passengers": total_pax,
            "depots": depots_list,
            "bus_ids": bus_ids_list,
            "routes": routes_list,
            "period": "quarterly",
            "row_total": meta["total"],
            "page": meta["page"],
            "limit": meta["limit"],
            "pages": meta["pages"],
        }
    _, meta = slice_rows([], page, limit)
    return {
        "data": [],
        "total_passengers": 0,
        "depots": depots_list,
        "bus_ids": bus_ids_list,
        "routes": routes_list,
        "period": period,
        "row_total": 0,
        "page": meta["page"],
        "limit": meta["limit"],
        "pages": meta["pages"],
    }

# ══════════════════════════════════════════════════════════
@router.get("/kpi/gcc-engine")
async def gcc_kpi_engine(
    period_start: str = "",
    period_end: str = "",
    depot: str = "",
    bus_id: str = "",
    user: dict = Depends(get_current_user),
):
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    bus_q: dict = {"status": "active"}
    if d:
        bus_q["depot"] = d
    if bid:
        bus_q["bus_id"] = bid
    buses = await db.buses.find(bus_q, {"_id": 0}).to_list(1000)
    bus_ids = [b["bus_id"] for b in buses]
    trip_q: dict = {}
    if period_start and period_end:
        trip_q["date"] = {"$gte": period_start, "$lte": period_end}
    trip_q["bus_id"] = {"$in": bus_ids} if bus_ids else {"$in": []}
    trips = await db.trip_data.find(trip_q, {"_id": 0}).to_list(3000)
    inc_q: dict = (
        {"$or": [{"bus_id": {"$in": bus_ids}}, *([{"depot": d}] if d else [])]}
        if bus_ids
        else {"id": "__none__"}
    )
    incidents = await db.incidents.find(inc_q, {"_id": 0}).to_list(1000)
    bus_km = sum(t.get("actual_km", 0) for t in trips)
    tenders = await db.tenders.find({}, {"_id": 0}).to_list(100)
    avg_pk = sum(t.get("pk_rate", 0) for t in tenders) / len(tenders) if tenders else 85
    monthly_fee = bus_km * avg_pk
    rules_docs = await db.business_rules.find({}, {"_id": 0}).to_list(100)
    rules = {r["rule_key"]: r["rule_value"] for r in rules_docs}
    rules["avg_pk_rate"] = str(avg_pk)
    kpi = compute_kpi_damages(monthly_fee, trips, buses, incidents, bus_km, rules)
    kpi["monthly_fee_base"] = round(monthly_fee, 2)
    kpi["bus_km"] = round(bus_km, 2)
    kpi["bus_count"] = len(buses)
    kpi["period"] = {"start": period_start, "end": period_end}
    return kpi

# ══════════════════════════════════════════════════════════
# FEE / PK ENGINE (§20)
# ══════════════════════════════════════════════════════════

@router.get("/fee-pk/compute")
async def compute_fee_pk(
    period_start: str = "",
    period_end: str = "",
    depot: str = "",
    bus_id: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    bus_q = {}
    d = _norm_q(depot)
    if d:
        bus_q["depot"] = d
    bid = _norm_q(bus_id)
    if bid:
        bus_q["bus_id"] = bid
    buses = await db.buses.find(bus_q, {"_id": 0}).to_list(1000)
    bus_ids = [b["bus_id"] for b in buses]
    bus_map = {b["bus_id"]: b for b in buses}
    tenders = await db.tenders.find({}, {"_id": 0}).to_list(100)
    tender_map = {t["tender_id"]: t for t in tenders}
    trip_q = {}
    if period_start and period_end:
        trip_q["date"] = {"$gte": period_start, "$lte": period_end}
    if bus_ids:
        trip_q["bus_id"] = {"$in": bus_ids}
    trips = await db.trip_data.find(trip_q, {"_id": 0}).to_list(3000)
    # Per-bus computation
    bus_data = {}
    for t in trips:
        bid = t.get("bus_id", "")
        if bid not in bus_data:
            bus_data[bid] = {"actual_km": 0, "scheduled_km": 0}
        bus_data[bid]["actual_km"] += t.get("actual_km", 0)
        bus_data[bid]["scheduled_km"] += t.get("scheduled_km", 0)
    results = []
    total_fee = 0
    for bid, km in bus_data.items():
        bus = bus_map.get(bid, {})
        tender = tender_map.get(bus.get("tender_id", ""), {})
        pk = tender.get("pk_rate", 85)
        actual = km["actual_km"]
        assured = km["scheduled_km"]
        # §20 formula
        if actual >= assured:
            fee = pk * assured + pk * 0.50 * (actual - assured)
        elif actual < assured:
            fee = pk * actual + pk * 0.75 * (assured - actual)
        else:
            fee = pk * actual
        total_fee += fee
        results.append({
            "bus_id": bid, "depot": bus.get("depot", ""),
            "pk_rate": pk, "actual_km": round(actual, 2),
            "assured_km": round(assured, 2),
            "fee": round(fee, 2),
            "band": "actual>=assured" if actual >= assured else "actual<assured"
        })
    results_sorted = sorted(results, key=lambda x: x["bus_id"])
    chunk, meta = slice_rows(results_sorted, page, limit)
    return {
        "bus_results": chunk,
        "total_fee": round(total_fee, 2),
        "bus_count": len(results_sorted),
        "row_total": meta["total"],
        "page": meta["page"],
        "limit": meta["limit"],
        "pages": meta["pages"],
        "period": {"start": period_start, "end": period_end},
    }

# ══════════════════════════════════════════════════════════
# SCHEDULE-S INFRACTIONS (§19 — Categories A–G)
# ══════════════════════════════════════════════════════════

@router.get("/infractions/catalogue")
async def list_infraction_catalogue(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    p, lim = normalize_page_limit(page, limit)
    total = await db.infraction_catalogue.count_documents({})
    cur = db.infraction_catalogue.find({}, {"_id": 0}).sort("code", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/infractions/catalogue")
async def add_infraction_item(req: InfractionReq, user: dict = Depends(get_current_user)):
    doc = req.model_dump()
    doc["id"] = f"INF-{str(uuid.uuid4())[:6].upper()}"
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.infraction_catalogue.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/infractions/catalogue/{inf_id}")
async def update_infraction_item(inf_id: str, req: InfractionReq, user: dict = Depends(get_current_user)):
    update = req.model_dump()
    result = await db.infraction_catalogue.update_one({"id": inf_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Infraction not found")
    return {"message": "Updated"}

@router.delete("/infractions/catalogue/{inf_id}")
async def delete_infraction_item(inf_id: str, user: dict = Depends(get_current_user)):
    result = await db.infraction_catalogue.delete_one({"id": inf_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}

@router.get("/infractions/logged")
async def list_logged_infractions(
    date_from: str = "",
    date_to: str = "",
    bus_id: str = "",
    depot: str = "",
    category: str = "",
    driver_id: str = "",
    infraction_code: str = "",
    route_id: str = "",
    route_name: str = "",
    related_incident_id: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        q["date"] = dm
    bid = _norm_q(bus_id)
    if bid:
        q["bus_id"] = bid
    elif _norm_q(depot):
        ids = await _bus_ids_in_depot(depot)
        if ids:
            q["bus_id"] = {"$in": ids}
        else:
            return paged_payload([], total=0, page=page, limit=limit)
    cat = _norm_q(category)
    if cat:
        q["category"] = cat.upper()
    drv = _norm_q(driver_id)
    if drv:
        q["driver_id"] = drv
    icode = _norm_q(infraction_code)
    if icode:
        q["infraction_code"] = icode
    rid = _norm_q(route_id)
    if rid:
        q["route_id"] = rid
    rn = (route_name or "").strip()
    if rn:
        q["route_name"] = {"$regex": rn, "$options": "i"}
    rel = _norm_q(related_incident_id)
    if rel:
        q["related_incident_id"] = rel
    p, lim = normalize_page_limit(page, limit)
    total = await db.infractions_logged.count_documents(q)
    cur = db.infractions_logged.find(q, {"_id": 0}).sort("created_at", -1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)


@router.post("/infractions/log")
async def log_infraction(req: InfractionLogReq, user: dict = Depends(get_current_user)):
    infraction_code = req.infraction_code.strip()
    cat = await db.infraction_catalogue.find_one({"code": infraction_code}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Infraction code not found")
    bus_id = (req.bus_id or "").strip()
    driver_id = (req.driver_id or "").strip()
    depot_in = (req.depot or "").strip()
    if bus_id:
        bus_doc = await db.buses.find_one({"bus_id": bus_id}, {"_id": 0, "depot": 1})
        if not bus_doc:
            raise HTTPException(status_code=400, detail=f"Unknown bus_id: {bus_id}")
        bus_depot = (bus_doc.get("depot") or "").strip()
        if depot_in and bus_depot and depot_in != bus_depot:
            raise HTTPException(
                status_code=400,
                detail="depot does not match bus master — clear depot or use the bus's depot",
            )
        depot_final = depot_in or bus_depot
    else:
        depot_final = depot_in
    rel = (req.related_incident_id or "").strip()
    if rel:
        if not await db.incidents.find_one({"id": rel}, {"_id": 1}):
            raise HTTPException(status_code=400, detail=f"related_incident_id not found: {rel}")
    doc = {
        "id": f"IL-{str(uuid.uuid4())[:8].upper()}",
        "bus_id": bus_id,
        "driver_id": driver_id,
        "infraction_code": infraction_code,
        "category": cat["category"],
        "description": cat["description"],
        "amount": cat["amount"],
        "amount_snapshot": cat["amount"],
        "safety_flag": cat.get("safety_flag", False),
        "date": (req.date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "remarks": (req.remarks or "").strip(),
        "logged_by": user.get("name", "") or user.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "depot": depot_final,
        "route_name": (req.route_name or "").strip(),
        "route_id": (req.route_id or "").strip(),
        "trip_id": (req.trip_id or "").strip(),
        "duty_id": (req.duty_id or "").strip(),
        "location_text": (req.location_text or "").strip(),
        "cause_code": (req.cause_code or "").strip(),
        "related_incident_id": rel,
    }
    if req.deductible is not None:
        doc["deductible"] = req.deductible
    await db.infractions_logged.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ══════════════════════════════════════════════════════════
# CONCESSIONAIRE BILLING WORKFLOW (§12) — State Machine
# ══════════════════════════════════════════════════════════

WORKFLOW_STATES = [
    "draft", "submitted", "processing", "proposed",
    "depot_approved", "regional_approved", "rm_sanctioned",
    "voucher_raised", "hq_approved", "paid"
]
WORKFLOW_TRANSITIONS = {
    "submit": ("draft", "submitted"),
    "process": ("submitted", "processing"),
    "propose": ("processing", "proposed"),
    "depot_approve": ("proposed", "depot_approved"),
    "regional_approve": ("depot_approved", "regional_approved"),
    "rm_sanction": ("regional_approved", "rm_sanctioned"),
    "voucher": ("rm_sanctioned", "voucher_raised"),
    "hq_approve": ("voucher_raised", "hq_approved"),
    "pay": ("hq_approved", "paid"),
}

@router.post("/billing/workflow")
async def advance_billing_workflow(req: BillingWorkflowReq, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": req.invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    current = inv.get("workflow_state", "draft")
    transition = WORKFLOW_TRANSITIONS.get(req.action)
    if not transition:
        raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")
    expected_from, new_state = transition
    if current != expected_from:
        raise HTTPException(status_code=400, detail=f"Cannot {req.action}: invoice is in '{current}', expected '{expected_from}'")
    log_entry = {"action": req.action, "from": current, "to": new_state,
                 "by": user.get("name", ""), "role": user.get("role", ""),
                 "remarks": req.remarks, "at": datetime.now(timezone.utc).isoformat()}
    await db.billing.update_one(
        {"invoice_id": req.invoice_id},
        {"$set": {"workflow_state": new_state, "status": new_state},
         "$push": {"workflow_log": log_entry}}
    )
    return {"message": f"Invoice advanced to {new_state}", "invoice_id": req.invoice_id, "new_state": new_state}

@router.get("/billing/{invoice_id}/workflow")
async def get_billing_workflow(invoice_id: str, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {
        "invoice_id": invoice_id,
        "current_state": inv.get("workflow_state", "draft"),
        "workflow_log": inv.get("workflow_log", []),
        "states": WORKFLOW_STATES,
        "available_actions": [a for a, (fr, to) in WORKFLOW_TRANSITIONS.items() if fr == inv.get("workflow_state", "draft")]
    }

# ══════════════════════════════════════════════════════════
# CONFIGURABLE BUSINESS RULES (§9)
# ══════════════════════════════════════════════════════════

@router.get("/business-rules")
async def list_business_rules(
    category: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q = {}
    if category:
        q["category"] = category
    p, lim = normalize_page_limit(page, limit)
    total = await db.business_rules.count_documents(q)
    cur = db.business_rules.find(q, {"_id": 0}).sort("rule_key", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/business-rules")
async def upsert_business_rule(req: BusinessRuleReq, user: dict = Depends(get_current_user)):
    await db.business_rules.update_one(
        {"rule_key": req.rule_key},
        {"$set": {"rule_value": req.rule_value, "category": req.category,
                  "description": req.description, "updated_at": datetime.now(timezone.utc).isoformat(),
                  "updated_by": user.get("name", "")}},
        upsert=True
    )
    return {"message": f"Rule '{req.rule_key}' saved"}

@router.delete("/business-rules/{rule_key}")
async def delete_business_rule(rule_key: str, user: dict = Depends(get_current_user)):
    result = await db.business_rules.delete_one({"rule_key": rule_key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule deleted"}

