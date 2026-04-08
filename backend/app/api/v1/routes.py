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
import re
import textwrap
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt as pyjwt
from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fpdf import FPDF
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

from app.api.deps import get_current_user, require_permission, require_any_permission, permissions_for_role
from app.core.config import settings
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
from app.domain.user_roles import ALLOWED_ROLE_IDS, PLATFORM_ADMIN_ROLES, ROLE_DEFINITIONS
from app.domain.permissions import (
    PERMISSION_DEFINITIONS,
    permission_matrix_from_db_rows,
    validate_permission_ids,
)
from app.domain.infractions_master import (
    ESCALATION_CEILING_RS,
    ESCALATION_CHAIN,
    INFRACTION_SLABS,
    MASTER_BY_CODE,
    TENDER_REPORT_HEADS,
    build_master_rows,
)
from app.services.punctuality import minutes_to_hhmm, parse_hhmm_to_minutes
from app.domain.incident_evidence import occurred_at_range_mongo_filter
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
    TripKmExceptionReq,
    TripKmKeysReq,
    EnergyReq,
    ForgotPasswordReq,
    IncidentCreateReq,
    IncidentNoteReq,
    IncidentUpdateReq,
    InfractionCloseReq,
    InfractionEntryReq,
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
    UserRoleUpdateReq,
    RolePermissionsUpdateReq,
    ConductorReq,
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


def _rating_out_of_five(val, default: float = 4.5) -> float:
    """Driver/conductor rating on a 0–5 scale (one decimal)."""
    try:
        return round(max(0.0, min(5.0, float(val))), 1)
    except (TypeError, ValueError):
        return round(default, 1)


def _trip_energy_date_match(date_from: str, date_to: str) -> dict | None:
    if date_from and date_to:
        return {"$gte": date_from, "$lte": date_to}
    if date_from:
        return {"$gte": date_from}
    if date_to:
        return {"$lte": date_to}
    return None


def _parse_ymd(ymd: str) -> datetime | None:
    try:
        return datetime.strptime((ymd or "").strip()[:10], "%Y-%m-%d")
    except Exception:
        return None


def _add_days_ymd(ymd: str, days: int) -> str:
    dt = _parse_ymd(ymd)
    if not dt:
        dt = datetime.now(timezone.utc)
    return (dt + timedelta(days=max(0, int(days)))).strftime("%Y-%m-%d")


def _incident_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _incident_public_doc(doc: dict) -> dict:
    if not doc:
        return {}
    doc.pop("_id", None)
    return doc


def _append_incident_activity(log: list | None, *, action: str, user_name: str, detail: str = "") -> list:
    if log is None:
        log = []
    log.append({
        "at": _incident_now_iso(),
        "action": action,
        "by": user_name,
        "detail": detail
    })
    return log


async def _get_flattened_infractions(period_start: str, period_end: str, bus_ids: list[str] = None) -> list[dict]:
    """Fetch infractions from unified incidents collection and flatten them into rows."""
    # Find incidents within period. Using occurred_at as defined in the schema.
    # period_start/end are usually YYYY-MM-DD. 
    # occurred_at is ISO string. We can use string range.
    q: dict = {"occurred_at": {"$gte": period_start, "$lte": period_end + "T23:59:59"}}
    if bus_ids:
        q["bus_id"] = {"$in": bus_ids}
    
    cursor = db.incidents.find(q, {"_id": 0})
    flat = []
    async for inc in cursor:
        base_meta = {
            "incident_id": inc.get("id"),
            "bus_id": inc.get("bus_id"),
            "depot": inc.get("depot"),
            "driver_id": inc.get("driver_id"),
            "date": (inc.get("occurred_at") or "")[:10],
            "route_id": inc.get("route_id"),
            "duty_id": inc.get("duty_id"),
            "trip_id": inc.get("trip_id"),
        }
        for inf in (inc.get("infractions") or []):
            row = dict(base_meta)
            row.update(inf)
            flat.append(row)
    return flat


def _resolve_infraction_amount(row: dict, *, as_of_ymd: str) -> float:
    """Compute the effective penalty for an infraction, applying repeated
    slab escalation for each resolve-period that elapses without closure.

    Example (category A, resolve_days=1, logged resolve_by = 2026-04-02):
      as_of = 2026-04-02  → still within deadline  → Rs.100 (A)
      as_of = 2026-04-03  → 1 period overdue       → Rs.500 (B)
      as_of = 2026-04-04  → 2 periods overdue      → Rs.1000 (C)
      as_of = 2026-04-05  → 3 periods overdue      → Rs.1500 (D)
      as_of = 2026-04-06  → 4+ periods overdue     → Rs.3000 (E, ceiling)
    """
    from datetime import date as _date

    category = str(row.get("category") or "").upper()
    base = float(row.get("amount_snapshot", row.get("amount", 0)) or 0)
    if category not in ESCALATION_CHAIN:
        return base
    if row.get("status") == "closed":
        return float(row.get("amount_current", base) or 0)
    resolve_by = str(row.get("resolve_by") or "").strip()
    if not resolve_by or resolve_by >= as_of_ymd:
        return base

    # How many resolve-day periods have elapsed past the deadline?
    try:
        rb = _date.fromisoformat(resolve_by)
        ao = _date.fromisoformat(as_of_ymd[:10])
        resolve_days = int(row.get("resolve_days") or 1) or 1
        overdue_days = (ao - rb).days
        steps = max(0, overdue_days // resolve_days)
    except (ValueError, TypeError):
        steps = 1  # fallback: at least one escalation

    # Walk the escalation chain for each step
    cur_cat = category
    for _ in range(steps):
        nxt = ESCALATION_CHAIN.get(cur_cat)
        if not nxt:
            break  # reached end of chain (E→E)
        cur_cat = nxt

    escalated_amt = INFRACTION_SLABS.get(cur_cat, INFRACTION_SLABS[category]).amount
    return min(float(escalated_amt), ESCALATION_CEILING_RS)


def _infraction_deduction_rollup(rows: list[dict], monthly_due: float, *, as_of_ymd: str) -> dict:
    capped_sum = 0.0
    uncapped_sum = 0.0
    detail: list[dict] = []
    for row in rows:
        if row.get("deductible") is False:
            continue
        amt = _resolve_infraction_amount(row, as_of_ymd=as_of_ymd)
        cat = str(row.get("category") or "").upper()
        safety = bool(row.get("safety_flag"))
        code = str(row.get("infraction_code") or "")
        is_capped = cat in {"A", "B", "C", "D"} and not safety
        if is_capped:
            capped_sum += amt
        else:
            uncapped_sum += amt
        detail.append(
            {
                "id": row.get("id", ""),
                "code": code,
                "category": cat,
                "date": row.get("date", ""),
                "created_at": row.get("created_at", ""),
                "safety_flag": safety,
                "status": row.get("status", "open"),
                "amount_applied": round(amt, 2),
                "is_capped_non_safety": is_capped,
            }
        )
    cap_limit = max(0.0, float(monthly_due) * 0.05)
    capped_applied = min(capped_sum, cap_limit)
    return {
        "capped_raw": round(capped_sum, 2),
        "capped_cap_limit": round(cap_limit, 2),
        "capped_applied": round(capped_applied, 2),
        "uncapped_applied": round(uncapped_sum, 2),
        "total_applied": round(capped_applied + uncapped_sum, 2),
        "rows": detail,
    }


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
    perms = await permissions_for_role(user.get("role"))
    return {**user, "permissions": perms}

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
# ADMIN — users & roles (admin console)
# ══════════════════════════════════════════════════════════


@router.get("/roles")
async def list_roles(_: dict = Depends(require_permission("admin.users.read"))):
    """Role catalog for admin UI (assignable roles)."""
    return list(ROLE_DEFINITIONS)


@router.get("/users")
async def list_users(
    page: int = 1,
    limit: int = 100,
    _: dict = Depends(require_permission("admin.users.read")),
):
    p, lim = normalize_page_limit(page, limit)
    total = await db.users.count_documents({})
    skip = (p - 1) * lim
    cursor = (
        db.users.find({}, {"password_hash": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(lim)
    )
    rows = await cursor.to_list(lim)
    items = []
    for u in rows:
        uid = str(u["_id"])
        items.append(
            {
                "user_id": uid,
                "_id": uid,
                "email": u.get("email", ""),
                "name": u.get("name", ""),
                "role": u.get("role", "vendor"),
                "created_at": u.get("created_at"),
            }
        )
    return paged_payload(items, total=total, page=p, limit=lim)


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    req: UserRoleUpdateReq,
    actor: dict = Depends(require_permission("admin.users.update")),
):
    if req.role not in ALLOWED_ROLE_IDS:
        raise HTTPException(status_code=400, detail="Invalid role")
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")
    target = await db.users.find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(actor["_id"]) == user_id and req.role not in PLATFORM_ADMIN_ROLES:
        raise HTTPException(status_code=400, detail="You cannot remove your own administrator role")
    if target.get("role") in PLATFORM_ADMIN_ROLES and req.role not in PLATFORM_ADMIN_ROLES:
        admin_count = await db.users.count_documents({"role": {"$in": list(PLATFORM_ADMIN_ROLES)}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last platform administrator")
    await db.users.update_one({"_id": oid}, {"$set": {"role": req.role}})
    return {"message": "Role updated", "user_id": user_id, "role": req.role}


@router.get("/permissions/catalog")
async def permissions_catalog(_: dict = Depends(require_permission("admin.permissions.read"))):
    return list(PERMISSION_DEFINITIONS)


@router.get("/permissions/matrix")
async def permissions_matrix(_: dict = Depends(require_permission("admin.permissions.read"))):
    rows = await db.role_permissions.find({}, {"_id": 0}).to_list(100)
    matrix = permission_matrix_from_db_rows(rows)
    return {"roles": list(ROLE_DEFINITIONS), "matrix": matrix}


@router.put("/permissions/roles/{role_id}")
async def put_role_permissions(
    role_id: str,
    req: RolePermissionsUpdateReq,
    _: dict = Depends(require_permission("admin.permissions.update")),
):
    if role_id not in ALLOWED_ROLE_IDS:
        raise HTTPException(status_code=400, detail="Invalid role")
    try:
        validate_permission_ids(req.permission_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.role_permissions.update_one(
        {"role_id": role_id},
        {"$set": {"role_id": role_id, "permission_ids": sorted(set(req.permission_ids))}},
        upsert=True,
    )
    return {"message": "Permissions updated", "role_id": role_id, "permission_ids": sorted(set(req.permission_ids))}


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
        [
            {"$match": bill_match},
            {
                "$group": {
                    "_id": None,
                    "total_payable": {"$sum": "$final_payable"},
                    "total_deduction": {"$sum": "$total_deduction"},
                    "invoice_count": {"$sum": 1},
                }
            },
        ]
    ).to_list(1)
    total_revenue = billing_agg[0]["total_payable"] if billing_agg else 0
    billing_total_deduction = billing_agg[0]["total_deduction"] if billing_agg else 0
    billing_invoice_count = billing_agg[0]["invoice_count"] if billing_agg else 0
    pending_match = dict(bill_match)
    pending_match["status"] = {"$ne": "paid"}
    billing_pending_count = await db.billing.count_documents(pending_match)
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
    availability_pct = round((total_km / scheduled_km * 100) if scheduled_km > 0 else 0, 1)
    fleet_utilization = round((active_buses / total_buses * 100) if total_buses > 0 else 0, 1)
    # Demo telemetry-style fields (no persistent SOC store); deterministic from fleet size
    avg_soc = round(72.0 + (total_buses % 23) + (active_buses % 7) * 0.5, 1)
    avg_soc = min(96.0, max(45.0, avg_soc))
    on_time_pct = round(min(99.2, availability_pct + (1.5 if scheduled_km > 0 else 0)), 1)
    today_s = datetime.now(timezone.utc).date().isoformat()
    trip_today = await db.trip_data.aggregate([
        {"$match": {**( {"bus_id": {"$in": filter_bus_ids}} if bus_query else {}), "date": today_s}},
        {"$group": {"_id": None, "a": {"$sum": "$actual_km"}, "s": {"$sum": "$scheduled_km"}}},
    ]).to_list(1)
    total_km_today = round(trip_today[0]["a"], 2) if trip_today else 0.0
    scheduled_km_today = round(trip_today[0]["s"], 2) if trip_today else 0.0
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
        "billing_total_deduction": round(billing_total_deduction, 2),
        "billing_invoice_count": billing_invoice_count,
        "billing_pending_count": billing_pending_count,
        "total_ticket_revenue": round(total_ticket_revenue, 2),
        "total_passengers": total_passengers,
        "availability_pct": availability_pct,
        "fleet_utilization": fleet_utilization,
        "avg_soc": avg_soc,
        "on_time_pct": on_time_pct,
        "total_km_today": total_km_today,
        "scheduled_km_today": scheduled_km_today,
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
    search: str = "",
    status: str = "",
    concessionaire: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    st = _norm_q(status)
    if st:
        q["status"] = st
    con = (concessionaire or "").strip()
    if con:
        q["concessionaire"] = {"$regex": re.escape(con), "$options": "i"}
    s = (search or "").strip()
    if s:
        pat = {"$regex": re.escape(s), "$options": "i"}
        q["$or"] = [
            {"tender_id": pat},
            {"description": pat},
            {"concessionaire": pat},
        ]
    p, lim = normalize_page_limit(page, limit)
    total = await db.tenders.count_documents(q)
    cur = db.tenders.find(q, {"_id": 0}).sort("tender_id", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/tenders")
async def create_tender(req: TenderReq, _: dict = Depends(require_permission("masters.tenders.create"))):
    existing = await db.tenders.find_one({"tender_id": req.tender_id})
    if existing:
        raise HTTPException(status_code=400, detail="Tender ID already exists")
    doc = req.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.tenders.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/tenders/{tender_id}")
async def update_tender(tender_id: str, req: TenderReq, _: dict = Depends(require_permission("masters.tenders.update"))):
    update = req.model_dump()
    update.pop("tender_id", None)
    result = await db.tenders.update_one({"tender_id": tender_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tender not found")
    return {"message": "Tender updated"}

@router.delete("/tenders/{tender_id}")
async def delete_tender(tender_id: str, _: dict = Depends(require_permission("masters.tenders.delete"))):
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
    # Batch bus-count in single aggregation (avoids N+1)
    depot_names = [d.get("name", "") for d in rows]
    bus_counts_agg = await db.buses.aggregate([
        {"$match": {"depot": {"$in": depot_names}}},
        {"$group": {"_id": "$depot", "count": {"$sum": 1}}}
    ]).to_list(500)
    bus_count_map = {doc["_id"]: doc["count"] for doc in bus_counts_agg}
    for d in rows:
        d["bus_count"] = bus_count_map.get(d.get("name", ""), 0)
    return paged_payload(rows, total=total, page=page, limit=limit)


@router.post("/depots")
async def create_depot(req: DepotReq, _: dict = Depends(require_permission("masters.depots.create"))):
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
async def update_depot(depot_name: str, req: DepotReq, _: dict = Depends(require_permission("masters.depots.update"))):
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
async def delete_depot(depot_name: str, _: dict = Depends(require_permission("masters.depots.delete"))):
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
    # Batch route-count in single aggregation (avoids N+1)
    stop_ids = [it["stop_id"] for it in items]
    if stop_ids:
        route_counts_agg = await db.routes.aggregate([
            {"$match": {"stop_sequence.stop_id": {"$in": stop_ids}}},
            {"$unwind": "$stop_sequence"},
            {"$match": {"stop_sequence.stop_id": {"$in": stop_ids}}},
            {"$group": {"_id": "$stop_sequence.stop_id", "count": {"$sum": 1}}}
        ]).to_list(500)
        route_count_map = {doc["_id"]: doc["count"] for doc in route_counts_agg}
    else:
        route_count_map = {}
    for it in items:
        it["route_count"] = route_count_map.get(it["stop_id"], 0)
    return paged_payload(items, total=total, page=page, limit=limit)


@router.post("/stop-master")
async def create_stop_master(req: StopMasterCreateReq, _: dict = Depends(require_permission("masters.stops.create"))):
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
async def update_stop_master(stop_id: str, req: StopMasterUpdateReq, _: dict = Depends(require_permission("masters.stops.update"))):
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
async def delete_stop_master(stop_id: str, _: dict = Depends(require_permission("masters.stops.delete"))):
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
        await _hydrate_route_stops_row(row)
    return paged_payload(items, total=total, page=page, limit=limit)


# GET /api/bus-routes and GET /api/routes are registered on the FastAPI app in app.main (create_app).


@router.post("/bus-routes")
async def create_route(req: RouteCreateReq, _: dict = Depends(require_permission("masters.routes.create"))):
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
    await _hydrate_route_stops_row(doc)
    return doc


@router.put("/bus-routes/{route_id}")
async def update_route(route_id: str, req: RouteUpdateReq, _: dict = Depends(require_permission("masters.routes.update"))):
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
async def delete_route(route_id: str, _: dict = Depends(require_permission("masters.routes.delete"))):
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
async def create_bus(req: BusReq, _: dict = Depends(require_permission("masters.buses.create"))):
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
async def update_bus(bus_id: str, req: BusReq, _: dict = Depends(require_permission("masters.buses.update"))):
    update = req.model_dump()
    update.pop("bus_id", None)
    kwh_map = {"12m_ac": 1.3, "9m_ac": 1.0, "12m_non_ac": 1.1, "9m_non_ac": 0.8}
    update["kwh_per_km"] = kwh_map.get(req.bus_type, 1.0)
    result = await db.buses.update_one({"bus_id": bus_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Bus updated"}

@router.delete("/buses/{bus_id}")
async def delete_bus(bus_id: str, _: dict = Depends(require_permission("masters.buses.delete"))):
    result = await db.buses.delete_one({"bus_id": bus_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bus not found")
    return {"message": "Bus deleted"}

@router.put("/buses/{bus_id}/assign-tender")
async def assign_tender_to_bus(bus_id: str, tender_id: str = Query(...), _: dict = Depends(require_permission("masters.buses.update"))):
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
    for it in items:
        it["rating"] = _rating_out_of_five(it.get("rating", 4.5))
    return paged_payload(items, total=total, page=page, limit=limit)

@router.post("/drivers")
async def create_driver(req: DriverReq, _: dict = Depends(require_permission("masters.drivers.create"))):
    existing = await db.drivers.find_one({"license_number": req.license_number})
    if existing:
        raise HTTPException(status_code=400, detail="License number already exists")
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())[:8]
    doc["rating"] = 4.5
    doc["penalties"] = []
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.drivers.insert_one(doc)
    doc.pop("_id", None)
    doc["rating"] = _rating_out_of_five(doc.get("rating", 4.5))
    return doc

@router.put("/drivers/{license_number}")
async def update_driver(license_number: str, req: DriverReq, _: dict = Depends(require_permission("masters.drivers.update"))):
    update = req.model_dump()
    update.pop("license_number", None)
    result = await db.drivers.update_one({"license_number": license_number}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Driver updated"}

@router.delete("/drivers/{license_number}")
async def delete_driver(license_number: str, _: dict = Depends(require_permission("masters.drivers.delete"))):
    result = await db.drivers.delete_one({"license_number": license_number})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"message": "Driver deleted"}

@router.put("/drivers/{license_number}/assign-bus")
async def assign_bus_to_driver(license_number: str, bus_id: str = Query(...), _: dict = Depends(require_permission("masters.drivers.update"))):
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
    r5 = _rating_out_of_five(driver.get("rating", 4.5))
    driver_out = {**driver, "rating": r5}
    return {
        "driver": driver_out,
        "total_km": round(total_km, 2),
        "total_trips": total_trips,
        "incidents": len(incidents),
        "rating": r5,
    }

# ══════════════════════════════════════════════════════════
# CONDUCTORS
# ══════════════════════════════════════════════════════════


def _next_conductor_id() -> str:
    return f"CND-{uuid.uuid4().hex[:8].upper()}"


@router.get("/conductors")
async def list_conductors(
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
    p, lim = normalize_page_limit(page, limit)
    total = await db.conductors.count_documents(q)
    cur = db.conductors.find(q, {"_id": 0}).sort("conductor_id", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    for it in items:
        it["rating"] = _rating_out_of_five(it.get("rating", 4.5))
    return paged_payload(items, total=total, page=p, limit=lim)


@router.post("/conductors")
async def create_conductor(req: ConductorReq, _: dict = Depends(require_permission("masters.conductors.create"))):
    if await db.conductors.find_one({"badge_no": req.badge_no}):
        raise HTTPException(status_code=400, detail="Badge number already exists")
    cid = _next_conductor_id()
    while await db.conductors.find_one({"conductor_id": cid}):
        cid = _next_conductor_id()
    doc = req.model_dump()
    doc["conductor_id"] = cid
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.conductors.insert_one(doc)
    saved = await db.conductors.find_one({"conductor_id": cid}, {"_id": 0})
    out = saved or doc
    out["rating"] = _rating_out_of_five(out.get("rating", 4.5))
    return out


@router.put("/conductors/{conductor_id}")
async def update_conductor(
    conductor_id: str,
    req: ConductorReq,
    _: dict = Depends(require_permission("masters.conductors.update")),
):
    other = await db.conductors.find_one({"badge_no": req.badge_no, "conductor_id": {"$ne": conductor_id}})
    if other:
        raise HTTPException(status_code=400, detail="Badge number already exists")
    update = req.model_dump()
    result = await db.conductors.update_one({"conductor_id": conductor_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conductor not found")
    return {"message": "Conductor updated"}


@router.delete("/conductors/{conductor_id}")
async def delete_conductor(
    conductor_id: str,
    _: dict = Depends(require_permission("masters.conductors.delete")),
):
    result = await db.conductors.delete_one({"conductor_id": conductor_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conductor not found")
    return {"message": "Conductor deleted"}


# ══════════════════════════════════════════════════════════
# TELEMETRY (live positions — mock / concessionaire-shaped)
# ══════════════════════════════════════════════════════════

_HYD_CENTER = (17.385, 78.4867)
_ROUTE_CODES = ("10K", "5", "65", "195", "225", "300", "47M", "38")
_BUS_MODEL_LABEL = {"12m_ac": "12m AC", "9m_ac": "9m AC", "12m_non_ac": "12m Non-AC"}
# Status weights: in_service, at_depot, charging, idle, breakdown, panic (stable mapping below)
_TELEM_STATUSES = ("in_service", "at_depot", "charging", "idle", "breakdown", "panic")
_TELEM_WEIGHT_CEILS = (48, 62, 76, 88, 97, 100)


def _telem_u01(key: str, slot: int) -> float:
    h = slot & 0xFFFFFFFF
    for c in key:
        h = (h * 131 + ord(c)) & 0xFFFFFFFF
    return (h % 10001) / 10000.0


@router.get("/telemetry/live-positions")
async def get_telemetry_live_positions(
    depot: str = "",
    bus_id: str = "",
    status: str = "",
    user: dict = Depends(get_current_user),
):
    """One synthetic row per active bus: speed, SOC, SOH, route, driver (for Live Tracking UI)."""
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    st_f = _norm_q(status)
    bq: dict = {"status": "active"}
    if d:
        bq["depot"] = d
    if bid:
        bq["bus_id"] = bid
    buses = await db.buses.find(bq, {"_id": 0}).to_list(2000)
    center_lat, center_lng = _HYD_CENTER
    bus_ids = [b.get("bus_id") for b in buses if b.get("bus_id")]
    driver_by_bus: dict[str, str] = {}
    async for d in db.drivers.find({"bus_id": {"$in": bus_ids}}, {"_id": 0, "bus_id": 1, "name": 1}):
        driver_by_bus[d["bus_id"]] = d.get("name") or "—"
    positions: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for bus in buses:
        bid_s = bus.get("bus_id", "")
        seed = bid_s or "unknown"
        r = _telem_u01(seed, 7) * 100.0
        telem_status = _TELEM_STATUSES[-1]
        for i, ceil in enumerate(_TELEM_WEIGHT_CEILS):
            if r < ceil:
                telem_status = _TELEM_STATUSES[i]
                break
        if telem_status in ("in_service", "idle"):
            lat = center_lat + (_telem_u01(seed, 1) - 0.5) * 0.16
            lng = center_lng + (_telem_u01(seed, 2) - 0.5) * 0.16
            speed = int(12 + _telem_u01(seed, 3) * 46) if telem_status == "in_service" else 0
        else:
            lat = center_lat + (_telem_u01(seed, 4) - 0.5) * 0.04
            lng = center_lng + (_telem_u01(seed, 5) - 0.5) * 0.04
            speed = 0
        driver_name = driver_by_bus.get(bid_s, "—")
        reg = bus.get("registration_no") or f"TS09ED{bid_s.replace('TS-', '').zfill(4)}"
        bt = bus.get("bus_type", "12m_ac")
        model = _BUS_MODEL_LABEL.get(bt, bt)
        soc = int(18 + _telem_u01(seed, 8) * 81)
        soh = int(82 + _telem_u01(seed, 9) * 18)
        rc = _ROUTE_CODES[int(_telem_u01(seed, 10) * len(_ROUTE_CODES)) % len(_ROUTE_CODES)]
        row = {
            "bus_id": bid_s,
            "registration_no": reg,
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "speed": speed,
            "heading": int(_telem_u01(seed, 11) * 360) % 360,
            "status": telem_status,
            "soc": soc,
            "soh": soh,
            "route": f"Route {rc}",
            "driver": driver_name,
            "depot": bus.get("depot", ""),
            "bus_model": model,
            "last_update": now_iso,
            "ignition": telem_status == "in_service",
        }
        if not st_f or row["status"] == st_f:
            positions.append(row)
    return positions


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

_ALERT_DEF_BY_CODE = {a["alert_code"]: a["alert_type"] for a in ALERT_INSTANCE_DEFINITIONS}
_ALERT_SEVERITY_BY_CODE = {
    "panic": "high",
    "overspeed_user": "medium",
    "gps_breakage": "high",
    "idle": "low",
    "route_deviation": "medium",
    "bunching_user": "medium",
    "harness_removal": "high",
}


def _alert_slot_5min() -> int:
    return int(datetime.now(timezone.utc).timestamp() // 300)


def _synth_alert_rows_for_buses(buses: list[dict]) -> list[dict]:
    """
    Deterministic synthetic alerts for active buses (stable for 5-minute windows),
    so Alert Center does not flicker on refresh.
    """
    now = datetime.now(timezone.utc)
    slot = _alert_slot_5min()
    rows: list[dict] = []
    if not buses:
        return rows
    defs = list(ALERT_INSTANCE_DEFINITIONS)
    for bus in buses:
        bid = str(bus.get("bus_id") or "").strip()
        if not bid:
            continue
        k = f"{bid}|{slot}"
        # Roughly 28% buses produce at least one alert in this slot.
        if _telem_u01(k, 901) < 0.72:
            continue
        n_alerts = 2 if _telem_u01(k, 902) > 0.93 else 1
        for i in range(n_alerts):
            pick = int(_telem_u01(k, 910 + i) * len(defs)) % len(defs)
            spec = defs[pick]
            code = spec["alert_code"]
            sev = _ALERT_SEVERITY_BY_CODE.get(code, "medium")
            mins_ago = int(1 + _telem_u01(k, 920 + i) * 179)
            ts = (now - timedelta(minutes=mins_ago)).isoformat()
            resolved = _telem_u01(k, 930 + i) > 0.78
            aid = f"AL-{bid}-{slot}-{pick}-{i}"
            route_code = _ROUTE_CODES[int(_telem_u01(k, 940 + i) * len(_ROUTE_CODES)) % len(_ROUTE_CODES)]
            route_label = f"Route {route_code}"
            rows.append(
                {
                    "id": aid,
                    "bus_id": bid,
                    "depot": bus.get("depot", ""),
                    "alert_code": code,
                    "alert_type": spec["alert_type"],
                    "severity": sev,
                    "timestamp": ts,
                    "resolved": resolved,
                    "route": route_label,
                    "source": "live_operations",
                    "message": f"{spec['alert_type']} detected on {bid} ({route_label})",
                }
            )
    # Active first, then high->low severity, then most-recent timestamp.
    sev_rank = {"high": 3, "medium": 2, "low": 1}
    rows.sort(
        key=lambda r: (
            r.get("resolved") is True,
            -(sev_rank.get(r.get("severity"), 0)),
            -datetime.fromisoformat(r.get("timestamp", now.isoformat())).timestamp(),
        )
    )
    return rows


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
    alerts = _synth_alert_rows_for_buses(buses)
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


@router.get("/alerts/center")
async def alerts_center(
    depot: str = "",
    bus_id: str = "",
    alert_code: str = "",
    severity: str = "",
    resolved: str = "",
    search: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    bq: dict = {"status": "active"}
    d = _norm_q(depot)
    bid = _norm_q(bus_id)
    if d:
        bq["depot"] = d
    if bid:
        bq["bus_id"] = bid
    buses = await db.buses.find(bq, {"_id": 0}).to_list(2000)
    alerts = _synth_alert_rows_for_buses(buses)
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
    s = (search or "").strip().lower()
    if s:
        alerts = [
            a
            for a in alerts
            if s in str(a.get("bus_id", "")).lower()
            or s in str(a.get("alert_type", "")).lower()
            or s in str(a.get("alert_code", "")).lower()
            or s in str(a.get("depot", "")).lower()
            or s in str(a.get("route", "")).lower()
            or s in str(a.get("message", "")).lower()
        ]
    summary = {
        "active": sum(1 for a in alerts if not a.get("resolved")),
        "resolved": sum(1 for a in alerts if a.get("resolved")),
        "high": sum(1 for a in alerts if a.get("severity") == "high"),
        "medium": sum(1 for a in alerts if a.get("severity") == "medium"),
        "low": sum(1 for a in alerts if a.get("severity") == "low"),
    }
    payload = paged_payload(alerts, total=len(alerts), page=page, limit=limit)
    payload["summary"] = summary
    payload["alert_codes"] = [a["alert_code"] for a in ALERT_INSTANCE_DEFINITIONS]
    payload["alert_types"] = [_ALERT_DEF_BY_CODE[c] for c in payload["alert_codes"]]
    return payload

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
async def add_energy(req: EnergyReq, _: dict = Depends(require_permission("operations.energy.create"))):
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
async def create_rule(req: DeductionRuleReq, _: dict = Depends(require_permission("operations.deductions.create"))):
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())[:8]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.deduction_rules.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/deductions/rules/{rule_id}")
async def update_rule(rule_id: str, req: DeductionRuleReq, _: dict = Depends(require_permission("operations.deductions.update"))):
    update = req.model_dump()
    result = await db.deduction_rules.update_one({"id": rule_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule updated"}

@router.delete("/deductions/rules/{rule_id}")
async def delete_rule(rule_id: str, _: dict = Depends(require_permission("operations.deductions.delete"))):
    result = await db.deduction_rules.delete_one({"id": rule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule deleted"}

@router.post("/deductions/apply")
async def apply_deductions(
    period_start: str = Query(...),
    period_end: str = Query(...),
    depot: str = "",
    bus_id: str = "",
    _: dict = Depends(require_permission("operations.deductions.update")),
):
    rules = await db.deduction_rules.find({"active": True}, {"_id": 0}).to_list(100)
    dep = _norm_q(depot)
    bid = _norm_q(bus_id)
    scope_bus_ids: list[str] = []
    if bid:
        scope_bus_ids = [bid]
    elif dep:
        scope_bus_ids = await _bus_ids_in_depot(dep)
        if not scope_bus_ids:
            return {
                "period": {"start": period_start, "end": period_end},
                "scope": {"depot": dep, "bus_id": bid},
                "base_payment": 0,
                "missed_km": 0,
                "availability_deduction": 0,
                "performance_deduction": 0,
                "system_deduction": 0,
                "infractions_deduction": 0,
                "total_deduction": 0,
                "breakdown": [],
                "infractions_breakdown": _infraction_deduction_rollup([], 0, as_of_ymd=period_end),
            }
    trip_q: dict = {"date": {"$gte": period_start, "$lte": period_end}}
    if scope_bus_ids:
        trip_q["bus_id"] = {"$in": scope_bus_ids}
    trips = await db.trip_data.find(trip_q, {"_id": 0}).to_list(3000)
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
    infraction_rows = await _get_flattened_infractions(period_start, period_end, scope_bus_ids)
    infraction_rollup = _infraction_deduction_rollup(infraction_rows, base_payment, as_of_ymd=period_end)
    infractions_deduction = infraction_rollup["total_applied"]
    total_deduction = availability_deduction + performance_deduction + system_deduction + infractions_deduction
    return {
        "period": {"start": period_start, "end": period_end},
        "scope": {"depot": dep, "bus_id": bid},
        "base_payment": round(base_payment, 2),
        "missed_km": round(missed_km, 2),
        "availability_deduction": round(availability_deduction, 2),
        "performance_deduction": round(performance_deduction, 2),
        "system_deduction": round(system_deduction, 2),
        "infractions_deduction": round(infractions_deduction, 2),
        "total_deduction": round(total_deduction, 2),
        "breakdown": breakdown,
        "infractions_breakdown": infraction_rollup,
    }

# ══════════════════════════════════════════════════════════
# BILLING
# ══════════════════════════════════════════════════════════

@router.post("/billing/generate")
async def generate_invoice(req: BillingGenerateReq, _: dict = Depends(require_permission("finance.billing.create"))):
    period_start = req.period_start
    period_end = req.period_end
    depot = req.depot
    bus_id = _norm_q(req.bus_id)
    trip_id = _norm_q(req.trip_id)
    bus_query = {}
    if depot:
        bus_query["depot"] = depot
    if bus_id:
        bus_query["bus_id"] = bus_id
    buses = await db.buses.find(bus_query, {"_id": 0}).to_list(1000)
    bus_ids = [b["bus_id"] for b in buses]
    bus_map = {b["bus_id"]: b for b in buses}
    tenders = await db.tenders.find({}, {"_id": 0}).to_list(100)
    tender_map = {t["tender_id"]: t for t in tenders}
    trip_query = {"date": {"$gte": period_start, "$lte": period_end}}
    if bus_ids:
        trip_query["bus_id"] = {"$in": bus_ids}
    if trip_id:
        trip_query["trip_id"] = trip_id
    trips = await db.trip_data.find(trip_query, {"_id": 0}).to_list(3000)
    energy_query = {"date": {"$gte": period_start, "$lte": period_end}}
    if bus_ids:
        energy_query["bus_id"] = {"$in": bus_ids}
    energy = await db.energy_data.find(energy_query, {"_id": 0}).to_list(3000)
    revenue_query = {"date": {"$gte": period_start, "$lte": period_end}}
    if bus_ids:
        revenue_query["bus_id"] = {"$in": bus_ids}
    if trip_id:
        revenue_query["trip_id"] = trip_id
    revenue_rows = await db.revenue_data.find(revenue_query, {"_id": 0}).to_list(5000)
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
    billing_rules_docs = await db.business_rules.find({"category": "billing"}, {"_id": 0}).to_list(100)
    billing_rules = {r.get("rule_key", ""): r.get("rule_value", "") for r in billing_rules_docs}
    try:
        excess_km_factor = float(billing_rules.get("fee_excess_km_factor", 0))
    except (TypeError, ValueError):
        excess_km_factor = 0.0
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
    # Step 4: Subsidy excluded by default unless contractually enabled.
    subsidy = 0
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
    infraction_rows = await _get_flattened_infractions(period_start, period_end, bus_ids)
    infraction_rollup = _infraction_deduction_rollup(infraction_rows, base_payment, as_of_ymd=period_end)
    infractions_deduction = infraction_rollup["total_applied"]
    total_deduction = availability_deduction + performance_deduction + system_deduction + infractions_deduction
    excess_km = max(0, total_km - scheduled_km)
    km_incentive = excess_km * avg_pk_rate * max(excess_km_factor, 0)
    revenue_by_bus: dict[str, dict] = {}
    revenue_key_trip: dict[tuple[str, str, str], dict] = {}
    revenue_key_route: dict[tuple[str, str, str], dict] = {}
    for r in revenue_rows:
        bid = str(r.get("bus_id", "") or "")
        rec = revenue_by_bus.setdefault(bid, {"passengers": 0, "revenue": 0.0})
        rec["passengers"] += int(r.get("passengers", 0) or 0)
        rec["revenue"] += float(r.get("revenue_amount", 0) or 0)
        trip_key = (str(r.get("date", "") or ""), bid, str(r.get("trip_id", "") or ""))
        if trip_key[2]:
            rk_trip = revenue_key_trip.setdefault(trip_key, {"passengers": 0, "revenue": 0.0})
            rk_trip["passengers"] += int(r.get("passengers", 0) or 0)
            rk_trip["revenue"] += float(r.get("revenue_amount", 0) or 0)
        route_key = (str(r.get("date", "") or ""), bid, str(r.get("route", "") or ""))
        rk_route = revenue_key_route.setdefault(route_key, {"passengers": 0, "revenue": 0.0})
        rk_route["passengers"] += int(r.get("passengers", 0) or 0)
        rk_route["revenue"] += float(r.get("revenue_amount", 0) or 0)

    bus_trip_counts: dict[str, int] = {}
    bus_sched: dict[str, float] = {}
    bus_actual: dict[str, float] = {}
    trip_wise_details: list[dict] = []
    for t in trips:
        bid = str(t.get("bus_id", "") or "")
        sk = float(t.get("scheduled_km", 0) or 0)
        ak = float(t.get("actual_km", 0) or 0)
        bus_trip_counts[bid] = bus_trip_counts.get(bid, 0) + 1
        bus_sched[bid] = bus_sched.get(bid, 0) + sk
        bus_actual[bid] = bus_actual.get(bid, 0) + ak
        route_name = str(t.get("route_name", "") or "")
        trip_code = str(t.get("trip_id", "") or "")
        rev = revenue_key_trip.get((str(t.get("date", "") or ""), bid, trip_code)) if trip_code else None
        if rev is None:
            rev = revenue_key_route.get((str(t.get("date", "") or ""), bid, route_name), {"passengers": 0, "revenue": 0.0})
        trip_wise_details.append(
            {
                "date": str(t.get("date", "") or ""),
                "bus_id": bid,
                "route_name": route_name,
                "trip_id": str(t.get("trip_id", "") or ""),
                "duty_id": str(t.get("duty_id", "") or ""),
                "scheduled_km": round(sk, 2),
                "actual_km": round(ak, 2),
                "variance_km": round(ak - sk, 2),
                "passengers": int(rev.get("passengers", 0) or 0),
                "revenue_amount": round(float(rev.get("revenue", 0) or 0), 2),
            }
        )
    bus_wise_summary: list[dict] = []
    for bid in sorted(set(list(bus_ids) + list(bus_trip_counts.keys()) + list(revenue_by_bus.keys()))):
        rev = revenue_by_bus.get(bid, {"passengers": 0, "revenue": 0.0})
        be = bus_energy.get(bid, {"actual": 0})
        bus_wise_summary.append(
            {
                "bus_id": bid,
                "depot": bus_map.get(bid, {}).get("depot", ""),
                "trip_count": int(bus_trip_counts.get(bid, 0)),
                "scheduled_km": round(float(bus_sched.get(bid, 0) or 0), 2),
                "actual_km": round(float(bus_actual.get(bid, 0) or 0), 2),
                "passengers": int(rev.get("passengers", 0) or 0),
                "revenue_amount": round(float(rev.get("revenue", 0) or 0), 2),
                "energy_kwh": round(float(be.get("actual", 0) or 0), 2),
            }
        )
    # Step 6: Final
    final_payable = base_payment + energy_adjustment + km_incentive - total_deduction
    now_iso = datetime.now(timezone.utc).isoformat()
    invoice = {
        "invoice_id": f"INV-{str(uuid.uuid4())[:8].upper()}",
        "period_start": period_start, "period_end": period_end,
        "depot": depot or "All",
        "selected_bus_id": bus_id or "",
        "selected_trip_id": trip_id or "",
        "bus_ids": sorted([b for b in bus_ids if b]),
        "bus_count": len([b for b in bus_ids if b]),
        "total_km": round(total_km, 2), "scheduled_km": round(scheduled_km, 2),
        "avg_pk_rate": round(avg_pk_rate, 2), "base_payment": round(base_payment, 2),
        "allowed_energy_kwh": round(total_allowed_energy, 2),
        "actual_energy_kwh": round(total_actual_energy, 2),
        "tariff_rate": tariff_rate,
        "allowed_energy_cost": round(allowed_cost, 2),
        "actual_energy_cost": round(actual_cost, 2),
        "energy_adjustment": round(energy_adjustment, 2),
        "subsidy": round(subsidy, 2),
        "excess_km": round(excess_km, 2),
        "km_incentive_factor": round(excess_km_factor, 4),
        "km_incentive": round(km_incentive, 2),
        "missed_km": round(missed_km, 2),
        "availability_deduction": round(availability_deduction, 2),
        "performance_deduction": round(performance_deduction, 2),
        "system_deduction": round(system_deduction, 2),
        "infractions_deduction": round(infractions_deduction, 2),
        "infractions_breakdown": infraction_rollup,
        "total_deduction": round(total_deduction, 2),
        "final_payable": round(final_payable, 2),
        "bus_wise_summary": bus_wise_summary,
        "trip_wise_details": trip_wise_details,
        "invoice_components": {
            "base_payment": round(base_payment, 2),
            "energy_adjustment": round(energy_adjustment, 2),
            "subsidy_included": False,
            "subsidy": 0.0,
            "km_incentive": round(km_incentive, 2),
            "total_deduction": round(total_deduction, 2),
        },
        "artifact_refs": {
            "payment_processing_note": "",
            "proposal_note": "",
            "show_cause_notice": "",
            "gst_proof_ref": "",
            "tax_withholding_ref": "",
        },
        "approval_dates": {"submitted_at": "", "approved_at": "", "paid_at": ""},
        "status": "draft",
        "workflow_state": "draft",
        "workflow_log": [],
        "created_at": now_iso
    }
    await db.billing.insert_one(dict(invoice))
    invoice.pop("_id", None)
    return invoice

@router.get("/billing/trip-ids")
async def list_billing_trip_ids(
    period_start: str,
    period_end: str,
    depot: str = "",
    bus_id: str = "",
    user: dict = Depends(get_current_user),
):
    q: dict = {"date": {"$gte": period_start, "$lte": period_end}}
    dep = _norm_q(depot)
    bid = _norm_q(bus_id)
    if bid:
        q["bus_id"] = bid
    elif dep:
        ids = await _bus_ids_in_depot(dep)
        if not ids:
            return {"trip_ids": []}
        q["bus_id"] = {"$in": ids}
    rows = await db.trip_data.find(q, {"_id": 0, "trip_id": 1}).to_list(10000)
    trip_ids = sorted({str(r.get("trip_id", "")).strip() for r in rows if str(r.get("trip_id", "")).strip()})
    return {"trip_ids": trip_ids}

@router.get("/billing")
async def list_invoices(
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    status: str = "",
    workflow_state: str = "",
    invoice_id: str = "",
    bus_id: str = "",
    trip_id: str = "",
    submitted_from: str = "",
    submitted_to: str = "",
    paid_from: str = "",
    paid_to: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    d = _norm_q(depot)
    st = _norm_q(status)
    wf = _norm_q(workflow_state)
    iid = _norm_q(invoice_id)
    bid = _norm_q(bus_id)
    tid = _norm_q(trip_id)
    if d:
        q["depot"] = d
    if st:
        q["status"] = st
    if wf:
        q["workflow_state"] = wf
    if iid:
        q["invoice_id"] = {"$regex": re.escape(iid), "$options": "i"}
    if bid:
        q["bus_ids"] = bid
    if tid:
        q["trip_wise_details.trip_id"] = {"$regex": re.escape(tid), "$options": "i"}
    if date_from and date_to:
        q["$and"] = [{"period_start": {"$lte": date_to}}, {"period_end": {"$gte": date_from}}]
    if submitted_from:
        q.setdefault("approval_dates.submitted_at", {})["$gte"] = f"{submitted_from}T00:00:00"
    if submitted_to:
        q.setdefault("approval_dates.submitted_at", {})["$lte"] = f"{submitted_to}T23:59:59.999999"
    if paid_from:
        q.setdefault("approval_dates.paid_at", {})["$gte"] = f"{paid_from}T00:00:00"
    if paid_to:
        q.setdefault("approval_dates.paid_at", {})["$lte"] = f"{paid_to}T23:59:59.999999"
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
    bus_rows = list(inv.get("bus_wise_summary") or [])
    trip_rows = list(inv.get("trip_wise_details") or [])
    def _row_revenue(row: dict) -> float:
        return float(row.get("revenue_amount", row.get("revenue", 0)) or 0)
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(190, 10, "TGSRTC - Bus Management Invoice", ln=True, align="C")
    pdf.ln(5)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(190, 6, f"Invoice ID: {inv['invoice_id']}", ln=True)
    pdf.cell(190, 6, _fpdf_cell_text(f"Period: {_to_indian_date_text(inv.get('period_start', ''))} to {_to_indian_date_text(inv.get('period_end', ''))}"), ln=True)
    pdf.cell(190, 6, f"Depot: {inv.get('depot', 'All')}", ln=True)
    pdf.cell(190, 6, _fpdf_cell_text(f"Generated: {_to_indian_date_text(inv.get('created_at', ''))}"), ln=True)
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
        ("KM Incentive", f"Rs. {inv.get('km_incentive', 0):,.2f}"),
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

    pdf.ln(6)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(190, 8, "Bus-wise Summary", ln=True)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(38, 7, "Bus ID", border=1)
    pdf.cell(26, 7, "Trips", border=1, align="R")
    pdf.cell(32, 7, "Passengers", border=1, align="R")
    pdf.cell(32, 7, "Revenue", border=1, align="R")
    pdf.cell(31, 7, "Actual KM", border=1, align="R")
    pdf.cell(31, 7, "Sched KM", border=1, align="R", ln=True)
    pdf.set_font("Helvetica", "", 8)
    if not bus_rows:
        pdf.cell(190, 7, "No bus-wise rows available", border=1, ln=True)
    else:
        for row in bus_rows:
            pdf.cell(38, 6, _fpdf_cell_text(row.get("bus_id", ""), 16), border=1)
            pdf.cell(26, 6, _fpdf_cell_text(row.get("trip_count", 0), 10), border=1, align="R")
            pdf.cell(32, 6, _fpdf_cell_text(row.get("passengers", 0), 12), border=1, align="R")
            pdf.cell(32, 6, _fpdf_cell_text(_row_revenue(row), 12), border=1, align="R")
            pdf.cell(31, 6, _fpdf_cell_text(row.get("actual_km", 0), 12), border=1, align="R")
            pdf.cell(31, 6, _fpdf_cell_text(row.get("scheduled_km", 0), 12), border=1, align="R", ln=True)

    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(190, 8, "Trip-wise Details", ln=True)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(26, 7, "Trip ID", border=1)
    pdf.cell(22, 7, "Bus", border=1)
    pdf.cell(24, 7, "Date", border=1)
    pdf.cell(42, 7, "Route", border=1)
    pdf.cell(18, 7, "Pax", border=1, align="R")
    pdf.cell(26, 7, "Revenue", border=1, align="R")
    pdf.cell(16, 7, "Act KM", border=1, align="R")
    pdf.cell(16, 7, "Sch KM", border=1, align="R", ln=True)
    pdf.set_font("Helvetica", "", 7)
    if not trip_rows:
        pdf.cell(190, 7, "No trip-wise rows available", border=1, ln=True)
    else:
        for idx, row in enumerate(trip_rows):
            if idx > 0 and idx % 40 == 0:
                pdf.add_page()
                pdf.set_font("Helvetica", "B", 8)
                pdf.cell(26, 7, "Trip ID", border=1)
                pdf.cell(22, 7, "Bus", border=1)
                pdf.cell(24, 7, "Date", border=1)
                pdf.cell(42, 7, "Route", border=1)
                pdf.cell(18, 7, "Pax", border=1, align="R")
                pdf.cell(26, 7, "Revenue", border=1, align="R")
                pdf.cell(16, 7, "Act KM", border=1, align="R")
                pdf.cell(16, 7, "Sch KM", border=1, align="R", ln=True)
                pdf.set_font("Helvetica", "", 7)
            pdf.cell(26, 6, _fpdf_cell_text(row.get("trip_id", ""), 12), border=1)
            pdf.cell(22, 6, _fpdf_cell_text(row.get("bus_id", ""), 10), border=1)
            pdf.cell(24, 6, _fpdf_cell_text(row.get("date", ""), 12), border=1)
            pdf.cell(42, 6, _fpdf_cell_text(row.get("route_name", ""), 22), border=1)
            pdf.cell(18, 6, _fpdf_cell_text(row.get("passengers", 0), 8), border=1, align="R")
            pdf.cell(26, 6, _fpdf_cell_text(_row_revenue(row), 12), border=1, align="R")
            pdf.cell(16, 6, _fpdf_cell_text(row.get("actual_km", 0), 8), border=1, align="R")
            pdf.cell(16, 6, _fpdf_cell_text(row.get("scheduled_km", 0), 8), border=1, align="R", ln=True)

    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={inv['invoice_id']}.pdf"})

@router.get("/billing/{invoice_id}/export-excel")
async def export_invoice_excel(invoice_id: str, user: dict = Depends(get_current_user)):
    inv = await db.billing.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    bus_rows = list(inv.get("bus_wise_summary") or [])
    trip_rows = list(inv.get("trip_wise_details") or [])
    def _row_revenue(row: dict) -> float:
        return float(row.get("revenue_amount", row.get("revenue", 0)) or 0)
    wb = Workbook()
    ws = wb.active
    ws.title = "Invoice"
    ws.append(["TGSRTC Bus Management Invoice"])
    ws.append([])
    ws.append(["Invoice ID", inv["invoice_id"]])
    ws.append(["Period", f"{_to_indian_date_text(inv.get('period_start', ''))} to {_to_indian_date_text(inv.get('period_end', ''))}"])
    ws.append(["Depot", inv.get("depot", "All")])
    ws.append([])
    ws.append(["Component", "Value"])
    fields = [
        ("Total KM", inv["total_km"]), ("Scheduled KM", inv["scheduled_km"]),
        ("Avg PK Rate (Rs/km)", inv["avg_pk_rate"]), ("Base Payment", inv["base_payment"]),
        ("Allowed Energy (kWh)", inv["allowed_energy_kwh"]), ("Actual Energy (kWh)", inv["actual_energy_kwh"]),
        ("Tariff (Rs/kWh)", inv["tariff_rate"]), ("Energy Adjustment", inv["energy_adjustment"]),
        ("KM Incentive", inv.get("km_incentive", 0)),
        ("Missed KM", inv["missed_km"]), ("Availability Deduction", inv["availability_deduction"]),
        ("Performance Deduction", inv["performance_deduction"]), ("System Deduction", inv["system_deduction"]),
        ("Total Deductions", inv["total_deduction"]),
        ("FINAL PAYABLE", inv["final_payable"])
    ]
    for label, val in fields:
        ws.append([label, val])

    ws_bus = wb.create_sheet("Bus Wise")
    ws_bus.append(["Bus ID", "Trips", "Passengers", "Revenue", "Actual KM", "Scheduled KM"])
    if bus_rows:
        for row in bus_rows:
            ws_bus.append([
                _excel_cell_value(row.get("bus_id", "")),
                _excel_cell_value(row.get("trip_count", 0)),
                _excel_cell_value(row.get("passengers", 0)),
                _excel_cell_value(_row_revenue(row)),
                _excel_cell_value(row.get("actual_km", 0)),
                _excel_cell_value(row.get("scheduled_km", 0)),
            ])
    else:
        ws_bus.append(["No bus-wise rows available", "", "", "", "", ""])

    ws_trip = wb.create_sheet("Trip Wise")
    ws_trip.append(["Trip ID", "Bus ID", "Date", "Route", "Passengers", "Revenue", "Actual KM", "Scheduled KM", "Duty ID"])
    if trip_rows:
        for row in trip_rows:
            ws_trip.append([
                _excel_cell_value(row.get("trip_id", "")),
                _excel_cell_value(row.get("bus_id", "")),
                _excel_cell_value(row.get("date", "")),
                _excel_cell_value(row.get("route_name", "")),
                _excel_cell_value(row.get("passengers", 0)),
                _excel_cell_value(_row_revenue(row)),
                _excel_cell_value(row.get("actual_km", 0)),
                _excel_cell_value(row.get("scheduled_km", 0)),
                _excel_cell_value(row.get("duty_id", "")),
            ])
    else:
        ws_trip.append(["No trip-wise rows available", "", "", "", "", "", "", "", ""])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={inv['invoice_id']}.xlsx"})

# ══════════════════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════════════════

# Tender Section-5 (Scope of Work) — journey / operational reports: start & end times.
OPERATIONS_REPORT_COLS = [
    "bus_id",
    "driver_id",
    "date",
    "scheduled_bus_out",
    "actual_bus_out",
    "scheduled_bus_in",
    "actual_bus_in",
    "scheduled_km",
    "actual_km",
]
OPERATIONS_REPORT_HEADER_LABELS = {
    "bus_id": "Bus ID",
    "driver_id": "Driver ID",
    "date": "Date",
    "scheduled_bus_out": "Sched bus out",
    "actual_bus_out": "Actual bus out",
    "scheduled_bus_in": "Sched bus in",
    "actual_bus_in": "Actual bus in",
    "scheduled_km": "Sched KM",
    "actual_km": "Actual KM",
}

TRIP_KM_REPORT_COLS = [
    "trip_key",
    "bus_id",
    "depot",
    "date",
    "driver_id",
    "scheduled_km",
    "actual_km",
    "km_variance",
    "km_variance_pct",
    "scheduled_bus_out",
    "actual_bus_out",
    "scheduled_bus_in",
    "actual_bus_in",
    "start_time",
    "end_time",
    "needs_exception_action",
    "exception_action_status",
    "traffic_km_approved",
    "maintenance_km_finalized",
    "traffic_km_approved_by",
    "maintenance_km_finalized_by",
]

TRIP_KM_REPORT_HEADER_LABELS = {
    "trip_key": "Trip key",
    "km_variance": "KM variance",
    "km_variance_pct": "Variance %",
    "needs_exception_action": "Exception review",
    "exception_action_status": "Exception status",
    "traffic_km_approved": "First verification",
    "maintenance_km_finalized": "Final verification",
    "traffic_km_approved_by": "First by",
    "maintenance_km_finalized_by": "Final by",
}


async def _user_has_permission(user: dict | None, permission_id: str) -> bool:
    if not user:
        return False
    return permission_id in set(await permissions_for_role(user.get("role")))


async def _collect_ticket_revenue_rows(
    date_from: str,
    date_to: str,
    depot: str,
    bus_id: str,
    route: str,
    period: str,
) -> list[dict]:
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
    per = (period or "daily").strip().lower()
    if per not in ("daily", "monthly", "quarterly"):
        per = "daily"
    if per == "daily":
        for row in data:
            row["depot"] = row.get("depot") or bus_map.get(row.get("bus_id"), {}).get("depot", "")
        return data
    if per == "monthly":
        monthly: dict = {}
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
        return sorted(monthly.values(), key=lambda x: (x["period"], x["bus_id"]))
    quarterly: dict = {}
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
    return sorted(quarterly.values(), key=lambda x: (x["period"], x["bus_id"]))


REPORTS_CATALOG = [
    {
        "id": "operations",
        "name": "Operations & journey times",
        "description": "Scheduled vs actual bus out and bus in (HH:MM), scheduled and actual KM — daily trips.",
        "category": "Operational",
        "report_type": "operations",
        "filters": ["date_from", "date_to", "depot", "bus_id"],
    },
    {
        "id": "km_gps",
        "name": "Kilometre operated (GPS / trips)",
        "description": "Daily scheduled vs actual KM and driver by bus — trip-level summary.",
        "category": "Operational",
        "report_type": "km_gps",
        "filters": ["date_from", "date_to", "depot", "bus_id"],
    },
    {
        "id": "trip_km_verification",
        "name": "Trip KM verification queue",
        "description": "First verification and final verification status, variance and exception actions.",
        "category": "Operational",
        "report_type": "trip_km_verification",
        "permission": "operations.trip_km.read",
        "filters": ["date_from", "date_to", "depot", "bus_id", "queue"],
    },
    {
        "id": "energy",
        "name": "Energy consumption (raw)",
        "description": "Units charged and tariff by bus and date.",
        "category": "Energy",
        "report_type": "energy",
        "filters": ["date_from", "date_to", "depot", "bus_id"],
    },
    {
        "id": "energy_efficiency",
        "name": "Energy efficiency vs allowance",
        "description": "Allowed kWh from KM × kWh/km vs actual consumption, cost and adjustment by bus.",
        "category": "Energy",
        "report_type": "energy_efficiency",
        "filters": ["date_from", "date_to", "depot", "bus_id"],
    },
    {
        "id": "ticket_revenue",
        "name": "Ticket revenue & passengers (TIM)",
        "description": "Fare revenue and passenger counts from TIM — daily, monthly, or quarterly.",
        "category": "Revenue",
        "report_type": "ticket_revenue",
        "filters": ["date_from", "date_to", "depot", "bus_id", "route", "period"],
    },
    {
        "id": "incidents",
        "name": "Incidents (IRMS)",
        "description": "Incident log with type, severity, channel and status.",
        "category": "Incident",
        "report_type": "incidents",
        "filters": [
            "date_from",
            "date_to",
            "occurred_from",
            "occurred_to",
            "depot",
            "bus_id",
            "status",
            "severity",
            "incident_type",
        ],
    },
    {
        "id": "infractions_catalogue",
        "name": "All infractions catalogue",
        "description": "Tender-frozen Schedule-S A-G master list (all infractions).",
        "category": "Infraction",
        "report_type": "infractions_catalogue",
        "filters": ["category", "infraction_code"],
    },
    {
        "id": "infractions_logged",
        "name": "Service wise infractions report",
        "description": "Tender head u: service wise infractions report with lifecycle and deduction status.",
        "category": "Infraction",
        "report_type": "infractions_logged",
        "filters": [
            "date_from",
            "date_to",
            "depot",
            "bus_id",
            "category",
            "driver_id",
            "infraction_code",
            "route_id",
            "infraction_route_name",
            "related_incident_id",
        ],
    },
    {
        "id": "infractions_driver_wise",
        "name": "Driver wise infractions report",
        "description": "Driver-level infraction totals from logged infractions.",
        "category": "Infraction",
        "report_type": "infractions_driver_wise",
        "filters": ["date_from", "date_to", "depot", "driver_id", "category"],
    },
    {
        "id": "infractions_vehicle_wise",
        "name": "Vehicle wise infractions report",
        "description": "Bus/vehicle-level infractions summary.",
        "category": "Infraction",
        "report_type": "infractions_vehicle_wise",
        "filters": ["date_from", "date_to", "depot", "bus_id", "category"],
    },
    {
        "id": "infractions_conductor_wise",
        "name": "Conductor wise infractions report",
        "description": "No driver / no conductor and related logged infractions by conductor id.",
        "category": "Infraction",
        "report_type": "infractions_conductor_wise",
        "filters": ["date_from", "date_to", "depot", "category"],
    },
    {
        "id": "incident_penalty_report",
        "name": "Incident and penalty report",
        "description": "Tender head h: incidents linked with infraction penalties.",
        "category": "Infraction",
        "report_type": "incident_penalty_report",
        "filters": ["date_from", "date_to", "depot", "bus_id", "related_incident_id"],
    },
    {
        "id": "billing",
        "name": "Concessionaire billing periods",
        "description": "Invoice periods, base payment, adjustments and final payable.",
        "category": "Billing",
        "report_type": "billing",
        "filters": ["date_from", "date_to", "depot", "bus_id", "status", "workflow_state", "invoice_id"],
    },
    {
        "id": "billing_trip_wise_km",
        "name": "Trip wise KM (billing purpose)",
        "description": "Trip-wise scheduled vs operated KM and variance for billing validation.",
        "category": "Billing",
        "report_type": "billing_trip_wise_km",
        "filters": ["date_from", "date_to", "depot", "bus_id", "route", "trip_id", "duty_id"],
    },
    {
        "id": "billing_day_wise_km",
        "name": "Day wise Sch KM vs Optd KM",
        "description": "Day-wise scheduled and operated kilometers across selected scope.",
        "category": "Billing",
        "report_type": "billing_day_wise_km",
        "filters": ["date_from", "date_to", "depot", "bus_id", "route"],
    },
    {
        "id": "billing_bus_wise_km",
        "name": "Bus wise KM summary",
        "description": "Bus-wise scheduled and operated kilometers for billing reconciliation.",
        "category": "Billing",
        "report_type": "billing_bus_wise_km",
        "filters": ["date_from", "date_to", "depot", "bus_id", "route"],
    },
    {
        "id": "assured_km_reconciliation",
        "name": "Assured KMs reconciliation report",
        "description": "Reconcilation of scheduled versus operated KM with variance and achievement percentage.",
        "category": "Billing",
        "report_type": "assured_km_reconciliation",
        "filters": ["date_from", "date_to", "depot", "bus_id", "route"],
    },
    {
        "id": "service_wise_infractions",
        "name": "Service wise infractions report",
        "description": "Service/route wise infraction counts and amount for billing action.",
        "category": "Billing",
        "report_type": "service_wise_infractions",
        "filters": ["date_from", "date_to", "depot", "bus_id", "route", "category"],
    },
]


def _compute_scheduled_bus_in(trip: dict) -> str:
    """Planned end time: explicit plan_end_time, else plan_start + planned_trip_duration_min."""
    pe = trip.get("plan_end_time")
    if isinstance(pe, str) and pe.strip():
        return pe.strip()
    ps = parse_hhmm_to_minutes(trip.get("plan_start_time"))
    raw_dur = trip.get("planned_trip_duration_min")
    if ps is None or raw_dur is None:
        return ""
    try:
        d = int(raw_dur)
    except (TypeError, ValueError):
        return ""
    return minutes_to_hhmm(ps + d)


def _normalize_operations_report_row(trip: dict) -> dict:
    row = dict(trip)
    row["scheduled_bus_out"] = str(trip.get("plan_start_time") or "").strip()
    row["actual_bus_out"] = str(trip.get("actual_start_time") or "").strip()
    row["scheduled_bus_in"] = _compute_scheduled_bus_in(trip)
    row["actual_bus_in"] = str(trip.get("actual_end_time") or "").strip()
    # Canonical names for UI wording: start time / end time.
    row["start_time"] = str(trip.get("start_time") or row["actual_bus_out"] or row["scheduled_bus_out"] or "").strip()
    row["end_time"] = str(trip.get("end_time") or row["actual_bus_in"] or row["scheduled_bus_in"] or "").strip()
    return row


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
    user: dict | None = None,
    route: str = "",
    period: str = "daily",
    category: str = "",
    driver_id: str = "",
    infraction_code: str = "",
    route_id: str = "",
    infraction_route_name: str = "",
    related_incident_id: str = "",
    workflow_state: str = "",
    invoice_id: str = "",
    trip_id: str = "",
    duty_id: str = "",
    queue: str = "all",
    occurred_from: str = "",
    occurred_to: str = "",
) -> tuple[str, list]:
    bid = _norm_q(bus_id)
    dep = _norm_q(depot)

    if report_type == "ticket_revenue":
        rows = await _collect_ticket_revenue_rows(date_from, date_to, depot, bus_id, route, period)
        return "ticket_revenue", rows

    if report_type == "billing":
        bq: dict = {}
        if dep:
            bq["depot"] = dep
        if bid:
            bq["bus_ids"] = bid
        st = _norm_q(status)
        if st:
            bq["status"] = st
        wf = _norm_q(workflow_state)
        if wf:
            bq["workflow_state"] = wf
        iid = _norm_q(invoice_id)
        if iid:
            bq["invoice_id"] = {"$regex": re.escape(iid), "$options": "i"}
        if date_from and date_to:
            bq["$and"] = [{"period_start": {"$lte": date_to}}, {"period_end": {"$gte": date_from}}]
        data = await db.billing.find(bq, {"_id": 0}).to_list(1000)
        for row in data:
            ids = row.get("bus_ids") or []
            row["bus_id"] = ", ".join(ids[:5]) + (f" (+{len(ids) - 5} more)" if len(ids) > 5 else "")
        return "billing", data

    if report_type in ("billing_trip_wise_km", "billing_day_wise_km", "billing_bus_wise_km", "assured_km_reconciliation"):
        tq: dict = {}
        dm = _trip_energy_date_match(date_from, date_to)
        if dm:
            tq["date"] = dm
        if bid:
            tq["bus_id"] = bid
        elif dep:
            ids = await _bus_ids_in_depot(depot)
            if ids:
                tq["bus_id"] = {"$in": ids}
            else:
                return report_type, []
        if route:
            tq["route_name"] = {"$regex": route, "$options": "i"}
        if trip_id:
            tq["trip_id"] = {"$regex": re.escape(trip_id), "$options": "i"}
        if duty_id:
            tq["duty_id"] = {"$regex": re.escape(duty_id), "$options": "i"}
        trips = await db.trip_data.find(tq, {"_id": 0}).to_list(10000)
        if report_type == "billing_trip_wise_km":
            rows = []
            for t in trips:
                sk = float(t.get("scheduled_km", 0) or 0)
                ak = float(t.get("actual_km", 0) or 0)
                rows.append(
                    {
                        "date": t.get("date", ""),
                        "bus_id": t.get("bus_id", ""),
                        "route_name": t.get("route_name", ""),
                        "trip_id": t.get("trip_id", ""),
                        "duty_id": t.get("duty_id", ""),
                        "scheduled_km": round(sk, 2),
                        "actual_km": round(ak, 2),
                        "variance_km": round(ak - sk, 2),
                    }
                )
            return "billing_trip_wise_km", rows
        if report_type == "billing_day_wise_km":
            by_day: dict[str, dict] = {}
            for t in trips:
                dkey = str(t.get("date", "") or "")
                cur = by_day.setdefault(dkey, {"date": dkey, "scheduled_km": 0.0, "actual_km": 0.0})
                cur["scheduled_km"] += float(t.get("scheduled_km", 0) or 0)
                cur["actual_km"] += float(t.get("actual_km", 0) or 0)
            rows = []
            for dkey in sorted(by_day.keys()):
                cur = by_day[dkey]
                sk = cur["scheduled_km"]
                ak = cur["actual_km"]
                rows.append(
                    {
                        "date": dkey,
                        "scheduled_km": round(sk, 2),
                        "actual_km": round(ak, 2),
                        "variance_km": round(ak - sk, 2),
                        "achievement_pct": round((ak / sk * 100) if sk > 0 else 0, 2),
                    }
                )
            return "billing_day_wise_km", rows
        # bus-wise + assured reconciliation (same rollup shape)
        by_bus: dict[str, dict] = {}
        for t in trips:
            bkey = str(t.get("bus_id", "") or "")
            cur = by_bus.setdefault(
                bkey,
                {"bus_id": bkey, "scheduled_km": 0.0, "actual_km": 0.0, "trip_count": 0},
            )
            cur["scheduled_km"] += float(t.get("scheduled_km", 0) or 0)
            cur["actual_km"] += float(t.get("actual_km", 0) or 0)
            cur["trip_count"] += 1
        rows = []
        for bkey in sorted(by_bus.keys()):
            cur = by_bus[bkey]
            sk = cur["scheduled_km"]
            ak = cur["actual_km"]
            rows.append(
                {
                    "bus_id": bkey,
                    "trip_count": cur["trip_count"],
                    "scheduled_km": round(sk, 2),
                    "actual_km": round(ak, 2),
                    "variance_km": round(ak - sk, 2),
                    "achievement_pct": round((ak / sk * 100) if sk > 0 else 0, 2),
                }
            )
        if report_type == "billing_bus_wise_km":
            return "billing_bus_wise_km", rows
        return "assured_km_reconciliation", rows

    if report_type == "service_wise_infractions":
        q: dict = {}
        dm = _trip_energy_date_match(date_from, date_to)
        if dm:
            q["date"] = dm
        if bid:
            q["bus_id"] = bid
        elif dep:
            ids = await _bus_ids_in_depot(depot)
            if ids:
                q["bus_id"] = {"$in": ids}
            else:
                return "service_wise_infractions", []
        cat = _norm_q(category)
        data = await _get_flattened_infractions(date_from or "1970-01-01", date_to or "2099-12-31")
        # Filter by service if provided
        if route:
            regex = re.compile(route, re.I)
            data = [r for r in data if regex.search(r.get("route_name", ""))]
        if cat:
            data = [r for r in data if r.get("category", "").upper() == cat.upper()]
        
        agg: dict[tuple[str, str], dict] = {}
        for r in data:
            svc = str(r.get("route_name", "") or "UNASSIGNED")
            c = str(r.get("category", "") or "")
            key = (svc, c)
            cur = agg.setdefault(
                key,
                {"service": svc, "category": c, "count": 0, "total_amount": 0.0},
            )
            cur["count"] += 1
            cur["total_amount"] += float(r.get("amount", 0) or 0)
        rows = sorted(agg.values(), key=lambda x: (-x["total_amount"], x["service"]))
        return "service_wise_infractions", rows

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
        occ_f = occurred_at_range_mongo_filter(occurred_from, occurred_to)
        if occ_f is not None:
            iq["occurred_at"] = occ_f
        raw = await db.incidents.find(iq, {"_id": 0}).sort("created_at", -1).to_list(2000)
        data = []
        for d in raw:
            row = dict(d)
            atts = row.get("attachments") or []
            if atts:
                names = "; ".join(str(a.get("original_name") or a.get("id")) for a in atts[:20])
                if len(atts) > 20:
                    names += f" (+{len(atts) - 20} more)"
                row["attachments_summary"] = f"{len(atts)}: {names}"
            else:
                row["attachments_summary"] = ""
            if "vehicles_affected_count" not in row:
                row["vehicles_affected_count"] = ""
            if "occurred_at" not in row:
                row["occurred_at"] = ""
            if "damage_summary" not in row:
                row["damage_summary"] = ""
            if "engineer_action" not in row:
                row["engineer_action"] = ""
            data.append(row)
        return "incidents", data

    if report_type in (
        "infractions_catalogue",
        "infractions_logged",
        "infractions_driver_wise",
        "infractions_vehicle_wise",
        "infractions_conductor_wise",
        "incident_penalty_report",
    ):
        if report_type == "infractions_catalogue":
            cq: dict = {"code": {"$in": sorted(MASTER_BY_CODE.keys())}}
            cat = _norm_q(category)
            if cat:
                cq["category"] = cat.upper()
            icode = _norm_q(infraction_code)
            if icode:
                cq["code"] = icode.upper()
            rows = await db.infraction_catalogue.find(cq, {"_id": 0}).sort("code", 1).to_list(1000)
            return "infractions_catalogue", rows

        q: dict = {}
        dm = _trip_energy_date_match(date_from, date_to)
        if dm:
            q["date"] = dm
        if bid:
            q["bus_id"] = bid
        elif dep:
            ids = await _bus_ids_in_depot(depot)
            if ids:
                q["bus_id"] = {"$in": ids}
            else:
                return "infractions_logged", []
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
        rn = (infraction_route_name or "").strip()
        if rn:
            q["route_name"] = {"$regex": rn, "$options": "i"}
        rel = _norm_q(related_incident_id)
        if rel:
            q["related_incident_id"] = rel
        st = _norm_q(status)
        
        # Fetch all for the period
        data = await _get_flattened_infractions(date_from or "1970-01-01", date_to or "2099-12-31")
        
        # Apply filters in-memory
        filtered = []
        for r in data:
            if bid and r.get("bus_id") != bid: continue
            if dep and r.get("depot") != dep: continue
            if driver_id and r.get("driver_id") != driver_id: continue
            if infraction_code and r.get("infraction_code") != infraction_code: continue
            if rid and r.get("route_id") != rid: continue
            if rn:
                if rn.lower() not in (r.get("route_name") or "").lower(): continue
            if rel and r.get("incident_id") != rel: continue
            if st and r.get("status") != st: continue
            filtered.append(r)
        
        data = sorted(filtered, key=lambda x: x.get("date", ""), reverse=True)
        
        if report_type == "infractions_logged":
            return "infractions_logged", data
        if report_type == "infractions_driver_wise":
            agg: dict[tuple[str, str], dict] = {}
            for r in data:
                key = (r.get("driver_id", "") or "UNASSIGNED", r.get("category", ""))
                cur = agg.setdefault(
                    key,
                    {"driver_id": key[0], "category": key[1], "count": 0, "total_amount": 0.0},
                )
                cur["count"] += 1
                cur["total_amount"] += float(r.get("amount", 0) or 0)
            rows = sorted(agg.values(), key=lambda x: (-x["total_amount"], x["driver_id"]))
            return "infractions_driver_wise", rows
        if report_type == "infractions_vehicle_wise":
            agg: dict[tuple[str, str], dict] = {}
            for r in data:
                key = (r.get("bus_id", "") or "UNASSIGNED", r.get("category", ""))
                cur = agg.setdefault(
                    key,
                    {"bus_id": key[0], "category": key[1], "count": 0, "total_amount": 0.0},
                )
                cur["count"] += 1
                cur["total_amount"] += float(r.get("amount", 0) or 0)
            rows = sorted(agg.values(), key=lambda x: (-x["total_amount"], x["bus_id"]))
            return "infractions_vehicle_wise", rows
        if report_type == "infractions_conductor_wise":
            agg: dict[str, dict] = {}
            for r in data:
                cid = r.get("conductor_id", "") or "UNASSIGNED"
                cur = agg.setdefault(cid, {"conductor_id": cid, "count": 0, "total_amount": 0.0})
                cur["count"] += 1
                cur["total_amount"] += float(r.get("amount", 0) or 0)
            rows = sorted(agg.values(), key=lambda x: (-x["total_amount"], x["conductor_id"]))
            return "infractions_conductor_wise", rows
        # incident_penalty_report
        rows = [r for r in data if str(r.get("related_incident_id", "")).strip()]
        return "incident_penalty_report", rows

    if report_type == "trip_km_verification":
        if not await _user_has_permission(user, "operations.trip_km.read"):
            raise HTTPException(status_code=403, detail="Permission denied")
        tq: dict = {}
        dm = _trip_energy_date_match(date_from, date_to)
        if dm:
            tq["date"] = dm
        if bid:
            tq["bus_id"] = bid
        elif dep:
            ids = await _bus_ids_in_depot(depot)
            if ids:
                tq["bus_id"] = {"$in": ids}
            else:
                return "trip_km_verification", []
        qn = (queue or "all").strip().lower()
        if qn == "traffic_pending":
            tq["$or"] = [{"traffic_km_approved": {"$ne": True}}, {"traffic_km_approved": {"$exists": False}}]
        elif qn == "maintenance_pending":
            tq["traffic_km_approved"] = True
            tq["$or"] = [
                {"maintenance_km_finalized": {"$ne": True}},
                {"maintenance_km_finalized": {"$exists": False}},
            ]
        elif qn == "complete":
            tq["traffic_km_approved"] = True
            tq["maintenance_km_finalized"] = True
        raw = await db.trip_data.find(tq, {"_id": 0}).sort([("date", -1), ("bus_id", 1)]).to_list(5000)
        buses = await db.buses.find({}, {"_id": 0, "bus_id": 1, "depot": 1}).to_list(2000)
        bus_depot = {b["bus_id"]: b.get("depot", "") for b in buses}
        items = [_enrich_trip_km_list_item(row, bus_depot.get(row.get("bus_id", ""), "")) for row in raw]
        return "trip_km_verification", items

    query: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        query["date"] = dm
    if bid:
        query["bus_id"] = bid
    elif dep and report_type in ("operations", "energy", "km_gps", "energy_efficiency"):
        ids = await _bus_ids_in_depot(depot)
        if ids:
            query["bus_id"] = {"$in": ids}
        else:
            return report_type, []

    if report_type == "operations":
        trips = await db.trip_data.find(query, {"_id": 0}).to_list(3000)
        return "operations", [_normalize_operations_report_row(t) for t in trips]
    if report_type == "km_gps":
        trips = await db.trip_data.find(query, {"_id": 0}).to_list(5000)
        buses = await db.buses.find({}, {"_id": 0}).to_list(1000)
        bus_map = {b["bus_id"]: b for b in buses}
        rows = []
        for t in trips:
            b = t.get("bus_id", "")
            rows.append(
                {
                    "bus_id": b,
                    "date": t.get("date", ""),
                    "depot": bus_map.get(b, {}).get("depot", ""),
                    "driver_id": t.get("driver_id", ""),
                    "scheduled_km": t.get("scheduled_km", 0),
                    "actual_km": t.get("actual_km", 0),
                }
            )
        return "km_gps", rows
    if report_type == "energy":
        data = await db.energy_data.find(query, {"_id": 0}).to_list(3000)
        return "energy", data
    if report_type == "energy_efficiency":
        data = await db.energy_data.find(query, {"_id": 0}).to_list(3000)
        bq_bus: dict = {}
        if dep:
            bq_bus["depot"] = dep
        if bid:
            bq_bus["bus_id"] = bid
        buses = await db.buses.find(bq_bus, {"_id": 0}).to_list(1000)
        bus_map = {b["bus_id"]: b for b in buses}
        trips = await db.trip_data.find(query, {"_id": 0}).to_list(3000)
        bus_km: dict = {}
        for t in trips:
            b = t.get("bus_id", "")
            bus_km[b] = bus_km.get(b, 0) + t.get("actual_km", 0)
        bus_energy: dict = {}
        for e in data:
            b = e.get("bus_id", "")
            if b not in bus_energy:
                bus_energy[b] = {"bus_id": b, "actual_kwh": 0, "tariff": e.get("tariff_rate", 10)}
            bus_energy[b]["actual_kwh"] += e.get("units_charged", 0)
        report = []
        for b, ed in bus_energy.items():
            bus = bus_map.get(b, {})
            kwh_per_km = bus.get("kwh_per_km", 1.0)
            km = bus_km.get(b, 0)
            allowed = km * kwh_per_km
            actual = ed["actual_kwh"]
            tariff = ed["tariff"]
            report.append(
                {
                    "bus_id": b,
                    "bus_type": bus.get("bus_type", ""),
                    "km_operated": round(km, 2),
                    "kwh_per_km": kwh_per_km,
                    "allowed_kwh": round(allowed, 2),
                    "actual_kwh": round(actual, 2),
                    "efficiency": round((actual / allowed * 100) if allowed > 0 else 0, 1),
                    "allowed_cost": round(allowed * tariff, 2),
                    "actual_cost": round(actual * tariff, 2),
                    "adjustment": round(min(actual, allowed) * tariff, 2),
                }
            )
        return "energy_efficiency", report

    return report_type, []


@router.get("/reports/catalog")
async def reports_catalog(user: dict = Depends(get_current_user)):
    perms = set(await permissions_for_role(user.get("role")))
    out: list[dict] = []
    for r in REPORTS_CATALOG:
        req = r.get("permission")
        if req and req not in perms:
            continue
        out.append({k: v for k, v in r.items() if k != "permission"})
    return out


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
    route: str = "",
    period: str = "daily",
    category: str = "",
    driver_id: str = "",
    infraction_code: str = "",
    route_id: str = "",
    infraction_route_name: str = "",
    related_incident_id: str = "",
    workflow_state: str = "",
    invoice_id: str = "",
    trip_id: str = "",
    duty_id: str = "",
    queue: str = "all",
    occurred_from: str = "",
    occurred_to: str = "",
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
        user=user,
        route=route,
        period=period,
        category=category,
        driver_id=driver_id,
        infraction_code=infraction_code,
        route_id=route_id,
        infraction_route_name=infraction_route_name,
        related_incident_id=related_incident_id,
        workflow_state=workflow_state,
        invoice_id=invoice_id,
        trip_id=trip_id,
        duty_id=duty_id,
        queue=queue,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
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


def _report_download_headers(report_type: str, cols: list[str]) -> list[str]:
    if report_type == "operations":
        return [OPERATIONS_REPORT_HEADER_LABELS.get(c, c) for c in cols]
    if report_type == "trip_km_verification":
        return [TRIP_KM_REPORT_HEADER_LABELS.get(c, c.replace("_", " ").title()) for c in cols]
    return [str(c).replace("_", " ").title() for c in cols]


def _to_indian_date_text(value: object) -> object:
    """Convert common YYYY-MM-DD / ISO datetime strings to Indian display format."""
    if not isinstance(value, str):
        return value
    s = value.strip()
    if not s:
        return value
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        try:
            return datetime.strptime(s, "%Y-%m-%d").strftime("%d/%m/%Y")
        except Exception:
            return value
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        return value


def _fpdf_cell_text(value: object, maxlen: int | None = None) -> str:
    """fpdf2 core fonts only support latin-1; strip/replace Unicode so PDF generation never 500s."""
    t = "" if value is None else str(_to_indian_date_text(value))
    t = (
        t.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2026", "...")
        .replace("\u00a0", " ")
        .replace("\u20b9", "Rs.")
    )
    t = t.encode("latin-1", "replace").decode("latin-1")
    if maxlen is not None:
        t = t[:maxlen]
    return t


def _excel_cell_value(value: object):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return str(value)
    return _to_indian_date_text(value)


TRIP_KM_PDF_COLS = [
    "trip_key",
    "bus_id",
    "depot",
    "date",
    "scheduled_km",
    "actual_km",
    "km_variance_pct",
    "traffic_km_approved",
    "maintenance_km_finalized",
    "exception_action_status",
]


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
    route: str = "",
    period: str = "daily",
    category: str = "",
    driver_id: str = "",
    infraction_code: str = "",
    route_id: str = "",
    infraction_route_name: str = "",
    related_incident_id: str = "",
    workflow_state: str = "",
    invoice_id: str = "",
    trip_id: str = "",
    duty_id: str = "",
    queue: str = "all",
    occurred_from: str = "",
    occurred_to: str = "",
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
        user=user,
        route=route,
        period=period,
        category=category,
        driver_id=driver_id,
        infraction_code=infraction_code,
        route_id=route_id,
        infraction_route_name=infraction_route_name,
        related_incident_id=related_incident_id,
        workflow_state=workflow_state,
        invoice_id=invoice_id,
        trip_id=trip_id,
        duty_id=duty_id,
        queue=queue,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
    )
    cols: list[str]
    if report_type == "operations":
        cols = list(OPERATIONS_REPORT_COLS)
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
            "occurred_at",
            "vehicles_affected",
            "vehicles_affected_count",
            "damage_summary",
            "engineer_action",
            "attachments_summary",
            "created_at",
        ]
    elif report_type == "billing":
        cols = [
            "invoice_id",
            "period_start",
            "period_end",
            "depot",
            "bus_id",
            "base_payment",
            "energy_adjustment",
            "km_incentive",
            "total_deduction",
            "final_payable",
            "status",
            "workflow_state",
        ]
    elif report_type == "billing_trip_wise_km":
        cols = ["date", "bus_id", "route_name", "trip_id", "duty_id", "scheduled_km", "actual_km", "variance_km"]
    elif report_type == "billing_day_wise_km":
        cols = ["date", "scheduled_km", "actual_km", "variance_km", "achievement_pct"]
    elif report_type == "billing_bus_wise_km":
        cols = ["bus_id", "trip_count", "scheduled_km", "actual_km", "variance_km", "achievement_pct"]
    elif report_type == "assured_km_reconciliation":
        cols = ["bus_id", "trip_count", "scheduled_km", "actual_km", "variance_km", "achievement_pct"]
    elif report_type == "service_wise_infractions":
        cols = ["service", "category", "count", "total_amount"]
    elif report_type == "ticket_revenue":
        per = (period or "daily").strip().lower()
        if per == "daily":
            cols = ["date", "bus_id", "depot", "route", "passengers", "revenue_amount"]
        elif per == "monthly":
            cols = ["bus_id", "depot", "period", "route", "passengers", "revenue_amount", "days"]
        else:
            cols = ["bus_id", "depot", "period", "passengers", "revenue_amount", "days"]
    elif report_type == "km_gps":
        cols = ["bus_id", "date", "depot", "driver_id", "scheduled_km", "actual_km"]
    elif report_type == "energy_efficiency":
        cols = [
            "bus_id",
            "bus_type",
            "km_operated",
            "kwh_per_km",
            "allowed_kwh",
            "actual_kwh",
            "efficiency",
            "allowed_cost",
            "actual_cost",
            "adjustment",
        ]
    elif report_type == "infractions_logged":
        cols = [
            "id",
            "date",
            "bus_id",
            "driver_id",
            "depot",
            "infraction_code",
            "category",
            "description",
            "amount",
            "route_name",
            "route_id",
            "related_incident_id",
            "status",
            "remarks",
            "created_at",
        ]
    elif report_type == "infractions_catalogue":
        cols = [
            "code",
            "category",
            "table",
            "description",
            "amount",
            "resolve_days",
            "safety_flag",
            "is_capped_non_safety",
            "repeat_escalation",
            "active",
        ]
    elif report_type == "infractions_driver_wise":
        cols = ["driver_id", "category", "count", "total_amount"]
    elif report_type == "infractions_vehicle_wise":
        cols = ["bus_id", "category", "count", "total_amount"]
    elif report_type == "infractions_conductor_wise":
        cols = ["conductor_id", "count", "total_amount"]
    elif report_type == "incident_penalty_report":
        cols = [
            "related_incident_id",
            "id",
            "date",
            "bus_id",
            "driver_id",
            "infraction_code",
            "category",
            "amount",
            "status",
            "close_remarks",
        ]
    elif report_type == "trip_km_verification":
        cols = list(TRIP_KM_REPORT_COLS)
    else:
        raise HTTPException(status_code=400, detail="Invalid report type")

    pdf_cols = list(cols)
    if report_type == "trip_km_verification" and fmt != "excel":
        pdf_cols = list(TRIP_KM_PDF_COLS)

    if fmt == "excel":
        wb = Workbook()
        ws = wb.active
        ws.title = report_type[:31].capitalize() if report_type else "Report"
        header_row = _report_download_headers(report_type, cols)
        ws.append(header_row)
        for row in data:
            ws.append([_excel_cell_value(row.get(c, "")) for c in cols])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={report_type}_report.xlsx"},
        )

    if fmt != "pdf":
        raise HTTPException(status_code=400, detail="fmt must be excel or pdf")

    pdf = FPDF()
    pdf.add_page("L")
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(270, 10, _fpdf_cell_text(f"TGSRTC {report_type.replace('_', ' ').title()} Report"), ln=True, align="C")
    if report_type == "operations":
        pdf.set_font("Helvetica", "I", 8)
        pdf.cell(
            270,
            5,
            _fpdf_cell_text(
                "Section-5 (Scope of Work): journey times - scheduled vs actual bus out / in (HH:MM)"
            ),
            ln=True,
            align="C",
        )
    pdf.set_font("Helvetica", "", 8)
    col_w = 270 / max(len(pdf_cols), 1)
    headers = _report_download_headers(report_type, pdf_cols)
    for h in headers:
        pdf.cell(col_w, 6, _fpdf_cell_text(h, 18), border=1)
    pdf.ln()
    for row in data[:100]:
        for c in pdf_cols:
            pdf.cell(col_w, 5, _fpdf_cell_text(row.get(c, ""), 20), border=1)
        pdf.ln()
    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={report_type}_report.pdf"},
    )

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


_INCIDENT_CT_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}


def _incident_attachment_dir(incident_id: str) -> Path:
    safe_id = "".join(c for c in incident_id if c.isalnum() or c in "-_")[:64] or "unknown"
    return settings.upload_dir / "incidents" / safe_id


def _incident_public_doc(doc: dict) -> dict:
    """Omit server-only attachment paths from API JSON."""
    out = dict(doc)
    atts = out.get("attachments")
    if isinstance(atts, list):
        out["attachments"] = [{k: v for k, v in a.items() if k != "stored_name"} for a in atts if isinstance(a, dict)]
    return out


def _incident_attachment_disk_path(incident_id: str, stored_name: str) -> Path:
    base = _incident_attachment_dir(incident_id).resolve()
    path = (base / stored_name).resolve()
    if not str(path).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Invalid attachment path")
    return path


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
        "upload_limits": {
            "max_bytes": settings.max_upload_bytes,
            "allowed_content_types": sorted(settings.allowed_upload_content_types),
        },
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
    occurred_from: str = "",
    occurred_to: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """List incidents. date_from/date_to filter on created_at (reported). occurred_from/occurred_to filter on occurred_at (PM evidence time) for documents that have occurred_at set."""
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
    occ_f = occurred_at_range_mongo_filter(occurred_from, occurred_to)
    if occ_f is not None:
        q["occurred_at"] = occ_f
    p, lim = normalize_page_limit(page, limit)
    total = await db.incidents.count_documents(q)
    cur = db.incidents.find(q, {"_id": 0}).sort("created_at", -1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload([_incident_public_doc(x) for x in items], total=total, page=page, limit=limit)


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, user: dict = Depends(get_current_user)):
    doc = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return _incident_public_doc(doc)


def _resolve_infractions_list(request_infractions: list, occurred_at: str) -> list[dict]:
    """Helper to take a list of InfractionEntryReq and return fully-hydrated infraction snapshots."""
    now_date = (occurred_at or datetime.now(timezone.utc).isoformat())[:10]
    out = []
    for entry in request_infractions:
        code = str(entry.code if hasattr(entry, "code") else entry.get("code", "")).strip().upper()
        if not code:
            continue
        master = MASTER_BY_CODE.get(code)
        if not master:
            continue # skipped if not in catalogue
        
        # Calculate resolve_by date
        res_days = int(master.get("resolve_days", 1))
        res_by = _add_days_ymd(now_date, res_days)
        
        out.append({
            "infraction_code": master["code"],
            "category": master["category"],
            "description": master["description"],
            "amount": master["amount"],
            "amount_snapshot": master["amount"], # base frozen at creation
            "resolve_days": res_days,
            "resolve_by": res_by,
            "safety_flag": bool(master.get("safety_flag")),
            "deductible": entry.deductible if hasattr(entry, "deductible") else entry.get("deductible", True),
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "closed_at": None,
            "close_remarks": ""
        })
    return out


@router.post("/incidents")
async def create_incident(req: IncidentCreateReq, user: dict = Depends(require_permission("operations.incidents.create"))):
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
    # related_infraction_id is legacy; new system embeds infractions directly. 
    # Validations against db.infractions_logged removed.
    vehicles = [v.strip() for v in (req.vehicles_affected or []) if str(v).strip()]
    if vehicles:
        # Validate vehicles against bus master
        missing = []
        for vid in vehicles:
            if not await db.buses.find_one({"bus_id": vid}, {"_id": 1}):
                missing.append(vid)
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown vehicles_affected bus_id(s): {', '.join(missing[:10])}")
    # If a primary bus is selected, ensure it's included in vehicles list
    if bus_id and bus_id not in vehicles:
        vehicles = [bus_id] + vehicles
    vehicles_count = len(vehicles) if vehicles else (req.vehicles_affected_count or (1 if bus_id else 1))

    name = user.get("name", "") or user.get("email", "")
    # Unified Infractions Logic
    infractions_to_log = list(req.infractions)
    
    # Auto-attach logic (Choice 3.A)
    auto_mappings = {
        "OVERSPEED": "E01",
        "OVERSPEED_CRITICAL": "E01",
        "ITS_GPS_FAILURE": "B08",
        "ROUTE_DEVIATION": "B06",
    }
    if code in auto_mappings:
        auto_code = auto_mappings[code]
        if not any(inf.code == auto_code for inf in infractions_to_log):
            infractions_to_log.append(InfractionEntryReq(code=auto_code, deductible=True))

    resolved_infractions = await _resolve_infractions_list(infractions_to_log, req.occurred_at)

    doc = {
        "id": f"INC-{uuid.uuid4().hex[:8].upper()}",
        "incident_type": code,
        "description": req.description.strip(),
        "occurred_at": req.occurred_at,
        "vehicles_affected": vehicles,
        "vehicles_affected_count": vehicles_count,
        "damage_summary": (req.damage_summary or "").strip(),
        "engineer_action": (req.engineer_action or "").strip(),
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
        "infractions": resolved_infractions,
        "status": IncidentStatus.OPEN.value,
        "assigned_team": "",
        "assigned_to": "",
        "reported_by": name,
        "attachments": [],
        "created_at": now,
        "updated_at": now,
        "activity_log": _append_incident_activity(
            None, action="created", user_name=name, detail="Incident reported"
        ),
    }
    await db.incidents.insert_one(doc)
    doc.pop("_id", None)
    return _incident_public_doc(doc)


@router.put("/incidents/{incident_id}")
async def update_incident(
    incident_id: str,
    req: IncidentUpdateReq,
    user: dict = Depends(require_permission("operations.incidents.update")),
):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    updates: dict = {"updated_at": _incident_now_iso()}
    name = user.get("name", "") or user.get("email", "")
    log = existing.get("activity_log") or []
    if req.status is not None and req.status != existing.get("status"):
        updates["status"] = req.status
        if req.status == IncidentStatus.RESOLVED.value:
            updates["resolved_at"] = _incident_now_iso()
        elif req.status in (IncidentStatus.OPEN.value, IncidentStatus.ASSIGNED.value, IncidentStatus.IN_PROGRESS.value, IncidentStatus.INVESTIGATING.value):
            updates["resolved_at"] = ""
        elif req.status == IncidentStatus.CLOSED.value and not existing.get("resolved_at"):
            # Preserve a sensible timestamp for older records directly closed after migration.
            updates["resolved_at"] = _incident_now_iso()
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
    if req.occurred_at is not None:
        updates["occurred_at"] = req.occurred_at
        if req.occurred_at != (existing.get("occurred_at") or ""):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail="Occurrence time updated",
            )
    if req.vehicles_affected is not None:
        vehicles = [v.strip() for v in (req.vehicles_affected or []) if str(v).strip()]
        if vehicles:
            missing = []
            for vid in vehicles:
                if not await db.buses.find_one({"bus_id": vid}, {"_id": 1}):
                    missing.append(vid)
            if missing:
                raise HTTPException(status_code=400, detail=f"Unknown vehicles_affected bus_id(s): {', '.join(missing[:10])}")
        updates["vehicles_affected"] = vehicles
        updates["vehicles_affected_count"] = len(vehicles) if vehicles else existing.get("vehicles_affected_count", 1)
        log = _append_incident_activity(
            log,
            action="pm_field_update",
            user_name=name,
            detail=f"Vehicles affected list updated ({len(vehicles)})",
        )
    if req.vehicles_affected_count is not None:
        updates["vehicles_affected_count"] = req.vehicles_affected_count
        if req.vehicles_affected_count != existing.get("vehicles_affected_count", 1):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail=f"Vehicles affected → {req.vehicles_affected_count}",
            )
    if req.damage_summary is not None:
        ndmg = req.damage_summary.strip()
        updates["damage_summary"] = ndmg
        if ndmg != (existing.get("damage_summary") or ""):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail="Damage summary updated",
            )
    if req.engineer_action is not None:
        ne = req.engineer_action.strip()
        updates["engineer_action"] = ne
        if ne != (existing.get("engineer_action") or ""):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail="Engineer / O&M action updated",
            )
    
    # Handle infractions update
    inf_list = list(existing.get("infractions") or [])
    if req.infractions is not None:
        # Resolve new list from request
        inf_list = await _resolve_infractions_list(req.infractions, existing.get("occurred_at", ""))
        updates["infractions"] = inf_list
        log = _append_incident_activity(
            log,
            action="infractions_update",
            user_name=name,
            detail=f"Infractions list updated ({len(inf_list)} codes)",
        )

    # Auto-close infractions only at final stage (closed).
    if updates.get("status") == IncidentStatus.CLOSED.value:
        now_iso = _incident_now_iso()
        closed_any = False
        as_of_ymd = now_iso[:10]
        for inf in inf_list:
            if inf.get("status") != "closed":
                # Freeze deduction at close time (with escalation up to close date).
                inf["amount_current"] = _resolve_infraction_amount(inf, as_of_ymd=as_of_ymd)
                inf["status"] = "closed"
                inf["closed_at"] = now_iso
                closed_any = True
        if closed_any:
            updates["infractions"] = inf_list
            log = _append_incident_activity(
                log,
                action="infractions_close",
                user_name=name,
                detail="All open infractions closed with incident",
            )

    updates["activity_log"] = log
    await db.incidents.update_one({"id": incident_id}, {"$set": updates})
    return {"message": "Incident updated", "id": incident_id}


@router.put("/incidents/{incident_id}/infractions/{idx}/close")
async def close_specific_infraction(
    incident_id: str,
    idx: int,
    req: InfractionCloseReq,
    user: dict = Depends(require_permission("operations.incidents.update")),
):
    """Close one specific infraction within an incident."""
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    inf_list = list(existing.get("infractions") or [])
    if idx < 0 or idx >= len(inf_list):
        raise HTTPException(status_code=400, detail="Invalid infraction index")
    
    inf = inf_list[idx]
    if inf.get("status") == "closed":
        return {"message": "Infraction already closed"}
    
    name = user.get("name", "") or user.get("email", "")
    now_iso = _incident_now_iso()
    inf["status"] = "closed"
    inf["closed_at"] = now_iso
    inf["close_remarks"] = req.close_remarks
    
    log = existing.get("activity_log") or []
    log = _append_incident_activity(
        log,
        action="infractions_close",
        user_name=name,
        detail=f"Infraction {inf.get('infraction_code')} closed manually",
    )
    
    await db.incidents.update_one(
        {"id": incident_id}, 
        {"$set": {"infractions": inf_list, "activity_log": log, "updated_at": now_iso}}
    )
    return {"message": "Infraction closed"}


@router.put("/incidents/{incident_id}/status-legacy")
async def update_incident_status_legacy(
    incident_id: str,
    status: str = Query(...),
    user: dict = Depends(require_permission("operations.incidents.update")),
):
    """Backward-compatible query-param status update for older clients."""
    body = IncidentUpdateReq(status=status)
    return await update_incident(incident_id, body, user)


@router.post("/incidents/{incident_id}/notes")
async def add_incident_note(
    incident_id: str,
    req: IncidentNoteReq,
    user: dict = Depends(require_permission("operations.incidents.update")),
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
    now = _incident_now_iso()
    set_updates: dict = {"updated_at": now}
    payload = req.model_dump(exclude_unset=True)
    if "occurred_at" in payload and payload["occurred_at"] is not None:
        na = payload["occurred_at"]
        set_updates["occurred_at"] = na
        if na != (existing.get("occurred_at") or ""):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail="Occurrence time updated (with note)",
            )
    if "vehicles_affected_count" in payload:
        vc = payload["vehicles_affected_count"]
        set_updates["vehicles_affected_count"] = vc
        if vc != existing.get("vehicles_affected_count", 1):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail=f"Vehicles affected → {vc} (with note)",
            )
    if "vehicles_affected" in payload:
        vehicles = [v.strip() for v in (payload["vehicles_affected"] or []) if str(v).strip()]
        if vehicles:
            missing = []
            for vid in vehicles:
                if not await db.buses.find_one({"bus_id": vid}, {"_id": 1}):
                    missing.append(vid)
            if missing:
                raise HTTPException(status_code=400, detail=f"Unknown vehicles_affected bus_id(s): {', '.join(missing[:10])}")
        set_updates["vehicles_affected"] = vehicles
        set_updates["vehicles_affected_count"] = len(vehicles) if vehicles else set_updates.get(
            "vehicles_affected_count", existing.get("vehicles_affected_count", 1)
        )
        log = _append_incident_activity(
            log,
            action="pm_field_update",
            user_name=name,
            detail=f"Vehicles affected list updated ({len(vehicles)}) (with note)",
        )
    if "damage_summary" in payload:
        dmg = (payload["damage_summary"] or "").strip()
        set_updates["damage_summary"] = dmg
        if dmg != (existing.get("damage_summary") or ""):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail="Damage summary updated (with note)",
            )
    if "engineer_action" in payload:
        eng = (payload["engineer_action"] or "").strip()
        set_updates["engineer_action"] = eng
        if eng != (existing.get("engineer_action") or ""):
            log = _append_incident_activity(
                log,
                action="pm_field_update",
                user_name=name,
                detail="Engineer / O&M action updated (with note)",
            )
    set_updates["activity_log"] = log
    await db.incidents.update_one({"id": incident_id}, {"$set": set_updates})
    return {"message": "Note added", "id": incident_id}


@router.post("/incidents/{incident_id}/attachments")
async def upload_incident_attachment(
    incident_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("operations.incidents.update")),
):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in settings.allowed_upload_content_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(settings.allowed_upload_content_types))}",
        )
    ext = _INCIDENT_CT_EXT.get(ct)
    if not ext:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    body = await file.read()
    if len(body) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.max_upload_bytes} bytes)")
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest_dir = _incident_attachment_dir(incident_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / stored_name
    tmp_path = dest_path.with_suffix(dest_path.suffix + ".part")
    try:
        tmp_path.write_bytes(body)
        tmp_path.replace(dest_path)
    except OSError as e:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}") from e
    att_id = f"ATT-{uuid.uuid4().hex[:10].upper()}"
    orig = (file.filename or "upload").replace("\x00", "")[:240]
    name = user.get("name", "") or user.get("email", "")
    meta = {
        "id": att_id,
        "original_name": orig,
        "content_type": ct,
        "size_bytes": len(body),
        "stored_name": stored_name,
        "uploaded_at": _incident_now_iso(),
        "uploaded_by": name,
    }
    atts = list(existing.get("attachments") or [])
    atts.append(meta)
    log = _append_incident_activity(
        existing.get("activity_log"),
        action="attachment_added",
        user_name=name,
        detail=orig[:500],
    )
    await db.incidents.update_one(
        {"id": incident_id},
        {"$set": {"attachments": atts, "activity_log": log, "updated_at": _incident_now_iso()}},
    )
    return {k: v for k, v in meta.items() if k != "stored_name"}


@router.get("/incidents/{incident_id}/attachments/{attachment_id}/file")
async def download_incident_attachment(
    incident_id: str,
    attachment_id: str,
    user: dict = Depends(get_current_user),
):
    doc = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    atts = doc.get("attachments") or []
    meta = next((a for a in atts if a.get("id") == attachment_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = _incident_attachment_disk_path(incident_id, meta["stored_name"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Attachment file missing on server")
    return FileResponse(
        path,
        media_type=meta.get("content_type") or "application/octet-stream",
        filename=meta.get("original_name") or "file",
    )


@router.delete("/incidents/{incident_id}/attachments/{attachment_id}")
async def delete_incident_attachment(
    incident_id: str,
    attachment_id: str,
    user: dict = Depends(require_permission("operations.incidents.update")),
):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    atts = list(existing.get("attachments") or [])
    meta = next((a for a in atts if a.get("id") == attachment_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = _incident_attachment_disk_path(incident_id, meta["stored_name"])
    if path.is_file():
        try:
            path.unlink()
        except OSError:
            pass
    atts = [a for a in atts if a.get("id") != attachment_id]
    name = user.get("name", "") or user.get("email", "")
    log = _append_incident_activity(
        existing.get("activity_log"),
        action="attachment_removed",
        user_name=name,
        detail=(meta.get("original_name") or attachment_id)[:500],
    )
    await db.incidents.update_one(
        {"id": incident_id},
        {"$set": {"attachments": atts, "activity_log": log, "updated_at": _incident_now_iso()}},
    )
    return {"message": "Attachment removed", "id": incident_id, "attachment_id": attachment_id}


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
async def update_setting(req: SettingsReq, _: dict = Depends(require_permission("admin.settings.update"))):
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


def _duty_text_search_filter(q: str) -> dict:
    esc = re.escape((q or "").strip())
    pat = {"$regex": esc, "$options": "i"}
    return {
        "$or": [
            {"driver_name": pat},
            {"driver_license": pat},
            {"route_name": pat},
            {"start_point": pat},
            {"end_point": pat},
            {"bus_id": pat},
            {"trips": {"$elemMatch": {"trip_id": pat}}},
        ]
    }


def _apply_duty_trip_ids(duty_id: str, trips: list) -> list:
    """Assign each trip a stable server-owned id: ``{duty_id}-T{trip_number}`` (e.g. DTY-A1B2C3D4-T1)."""
    out = []
    for i, raw in enumerate(trips or []):
        t = dict(raw) if isinstance(raw, dict) else {}
        tn = t.get("trip_number", i + 1)
        try:
            tn_int = int(tn)
        except (TypeError, ValueError):
            tn_int = i + 1
        t["trip_number"] = tn_int
        t["trip_id"] = f"{duty_id}-T{tn_int}"
        out.append(t)
    return out


def _duty_trip_sms_fragment(t: dict) -> str:
    num = t.get("trip_number", "")
    direction = (t.get("direction") or "").strip().title() or "Trip"
    st, et = t.get("start_time", ""), t.get("end_time", "")
    frag = f"Trip {num}: {direction} scheduled {st}-{et}."
    a_st = (t.get("actual_start_time") or "").strip()
    a_et = (t.get("actual_end_time") or "").strip()
    if a_st or a_et:
        frag += f" Actual {a_st or '—'}-{a_et or '—'}."
    return frag + " "


def _duties_mongo_filter(
    date: str = "",
    driver_license: str = "",
    bus_id: str = "",
    depot: str = "",
    q: str = "",
) -> dict:
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
    sq = _norm_q(q)
    if sq:
        search_clause = _duty_text_search_filter(sq)
        query = {"$and": [query, search_clause]} if query else search_clause
    return query


def _duty_trip_cancel_reason_export(t: dict) -> str:
    st = (t.get("trip_status") or "").strip().lower()
    if st not in ("cancelled", "not_operated"):
        return ""
    code = (t.get("cancel_reason_code") or "none").strip().lower()
    custom = (t.get("cancel_reason_custom") or "").strip()
    if code == "other":
        return custom or "Other"
    if code == "no_driver":
        return "No driver"
    if code == "no_conductor":
        return "No conductor"
    if code in ("", "none"):
        return ""
    return code.replace("_", " ")


@router.get("/duties")
async def list_duties(
    date: str = "",
    driver_license: str = "",
    bus_id: str = "",
    depot: str = "",
    q: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    query = _duties_mongo_filter(date, driver_license, bus_id, depot, q)
    p, lim = normalize_page_limit(page, limit)
    total = await db.duty_assignments.count_documents(query)
    cur = (
        db.duty_assignments.find(query, {"_id": 0}).sort([("date", -1), ("id", -1)]).skip((p - 1) * lim).limit(lim)
    )
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)


@router.get("/duties/summary-metrics")
async def duties_summary_metrics(
    date: str = "",
    bus_id: str = "",
    depot: str = "",
    q: str = "",
    user: dict = Depends(get_current_user),
):
    """Totals for duty summary (same filters as list/export; not limited by pagination)."""
    query = _duties_mongo_filter(date, "", bus_id, depot, q)
    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": None,
                "duty_count": {"$sum": 1},
                "sms_sent_count": {"$sum": {"$cond": [{"$eq": ["$sms_sent", True]}, 1, 0]}},
                "trip_legs": {"$sum": {"$size": {"$ifNull": ["$trips", []]}}},
            }
        },
    ]
    agg = await db.duty_assignments.aggregate(pipeline).to_list(1)
    row = agg[0] if agg else {}
    dc = int(row.get("duty_count", 0) or 0)
    sms_sent = int(row.get("sms_sent_count", 0) or 0)
    trips = int(row.get("trip_legs", 0) or 0)
    return {
        "duty_count": dc,
        "trip_legs": trips,
        "sms_sent": sms_sent,
        "sms_pending": max(0, dc - sms_sent),
    }


def _duty_summary_build_excel(
    items: list,
    filter_line: str,
    truncated: bool,
    max_rows: int,
    metrics: dict,
    generated_line: str,
) -> io.BytesIO:
    headers = [
        "Duty ID",
        "Date",
        "Depot",
        "Driver",
        "Phone",
        "Bus",
        "Route",
        "From",
        "To",
        "Duty SMS sent",
        "Trip #",
        "Direction",
        "Trip ID",
        "Sched dep",
        "Sched arr",
        "Actual dep",
        "Actual arr",
        "Trip status",
        "Cancellation / note",
    ]
    ncol = len(headers)
    thin = Side(style="thin", color="B8B8B8")
    grid = Border(left=thin, right=thin, top=thin, bottom=thin)
    title_font = Font(bold=True, size=16, color="000000")
    hdr_font = Font(bold=True, size=10, color="000000")
    body_font = Font(size=10, color="000000")
    small_font = Font(size=9, color="000000")
    wrap_lt = Alignment(wrap_text=True, vertical="top", horizontal="left")
    wrap_top = Alignment(wrap_text=True, vertical="top", horizontal="center")
    center_ac = Alignment(horizontal="center", vertical="center", wrap_text=True)

    wb = Workbook()
    ws = wb.active
    ws.title = "Duty summary"

    def merge_banner(row: int, text: str, *, font, fill=None, align=Alignment(vertical="center", horizontal="left", wrap_text=True)):
        rng = f"A{row}:{get_column_letter(ncol)}{row}"
        ws.merge_cells(rng)
        c = ws.cell(row, 1, _excel_cell_value(text))
        c.font = font
        if fill:
            c.fill = fill
        c.alignment = align

    r = 1
    merge_banner(r, "Duty assignment summary — TGSRTC", font=title_font, align=Alignment(vertical="center", horizontal="left"))
    ws.row_dimensions[r].height = 30
    r += 1
    merge_banner(r, filter_line, font=small_font)
    ws.row_dimensions[r].height = 22
    r += 1
    mline = (
        f"Duties: {metrics.get('duty_count', 0)} | Trip legs: {metrics.get('trip_legs', 0)} | "
        f"SMS sent: {metrics.get('sms_sent', 0)} | SMS pending: {metrics.get('sms_pending', 0)}"
    )
    merge_banner(r, mline, font=Font(size=10, bold=True, color="000000"))
    ws.row_dimensions[r].height = 20
    r += 1
    merge_banner(r, generated_line, font=Font(size=9, italic=True, color="000000"))
    ws.row_dimensions[r].height = 18
    r += 1
    if truncated:
        merge_banner(
            r,
            f"Note: only the first {max_rows} duties are included. Narrow filters to export the rest.",
            font=Font(size=9, color="000000"),
        )
        ws.row_dimensions[r].height = 20
        r += 1

    header_row = r
    for ci, h in enumerate(headers, start=1):
        cell = ws.cell(header_row, ci, h)
        cell.font = hdr_font
        cell.alignment = center_ac
        cell.border = grid
    ws.row_dimensions[header_row].height = 22
    ws.freeze_panes = f"A{header_row + 1}"

    data_start = header_row + 1
    r = data_start
    wrap_cols = {4, 7, 8, 9, 13, 19}

    def append_row(vals: list):
        nonlocal r
        for ci, raw in enumerate(vals, start=1):
            cell = ws.cell(r, ci, raw)
            cell.font = body_font
            cell.border = grid
            if ci in wrap_cols:
                cell.alignment = wrap_lt
            elif ci in (11, 12, 14, 15, 16, 17, 18):
                cell.alignment = wrap_top
            else:
                cell.alignment = Alignment(vertical="top", horizontal="left", wrap_text=True)
        r += 1

    for duty in items:
        did = duty.get("id", "")
        ddate = duty.get("date", "")
        ddepot = duty.get("depot", "")
        drv = duty.get("driver_name", "")
        phone = duty.get("driver_phone", "")
        bus = duty.get("bus_id", "")
        rname = duty.get("route_name", "")
        sp = duty.get("start_point", "")
        ep = duty.get("end_point", "")
        sms_yes = "Yes" if duty.get("sms_sent") else "No"
        trips = duty.get("trips") or []
        if not trips:
            append_row(
                [
                    _excel_cell_value(did),
                    _excel_cell_value(ddate),
                    _excel_cell_value(ddepot),
                    _excel_cell_value(drv),
                    _excel_cell_value(phone),
                    _excel_cell_value(bus),
                    _excel_cell_value(rname),
                    _excel_cell_value(sp),
                    _excel_cell_value(ep),
                    sms_yes,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                ],
            )
            continue
        for t in trips:
            if not isinstance(t, dict):
                continue
            append_row(
                [
                    _excel_cell_value(did),
                    _excel_cell_value(ddate),
                    _excel_cell_value(ddepot),
                    _excel_cell_value(drv),
                    _excel_cell_value(phone),
                    _excel_cell_value(bus),
                    _excel_cell_value(rname),
                    _excel_cell_value(sp),
                    _excel_cell_value(ep),
                    sms_yes,
                    _excel_cell_value(t.get("trip_number", "")),
                    _excel_cell_value(t.get("direction", "")),
                    _excel_cell_value(t.get("trip_id", "")),
                    _excel_cell_value(t.get("start_time", "")),
                    _excel_cell_value(t.get("end_time", "")),
                    _excel_cell_value(t.get("actual_start_time", "")),
                    _excel_cell_value(t.get("actual_end_time", "")),
                    _excel_cell_value(t.get("trip_status", "")),
                    _excel_cell_value(_duty_trip_cancel_reason_export(t)),
                ],
            )

    for c in range(1, ncol + 1):
        letter = get_column_letter(c)
        maxlen = len(str(ws.cell(header_row, c).value or ""))
        for row in ws.iter_rows(min_row=data_start, max_row=ws.max_row, min_col=c, max_col=c):
            for cell in row:
                if cell.value is not None:
                    for part in str(cell.value).splitlines():
                        maxlen = max(maxlen, len(part))
        if c in (4, 7, 8, 9):
            wch = min(max(maxlen * 1.12 + 2.5, 14), 48)
        elif c == 13:
            wch = min(max(maxlen * 1.1 + 2, 12), 36)
        elif c == 19:
            wch = min(max(maxlen * 1.08 + 2, 16), 52)
        elif c in (1, 2, 6, 11, 12, 14, 15, 16, 17, 18):
            wch = min(max(maxlen * 1.05 + 1.8, 10), 22)
        else:
            wch = min(max(maxlen * 1.08 + 2, 11), 28)
        ws.column_dimensions[letter].width = wch

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _duty_summary_build_pdf(
    items: list,
    filter_line: str,
    truncated: bool,
    max_rows: int,
    metrics: dict,
    generated_line: str,
) -> io.BytesIO:
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_margins(10, 10, 10)
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    epw = pdf.epw

    def draw_table_header():
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(0, 0, 0)
        weights = [0.05, 0.07, 0.12, 0.055, 0.055, 0.055, 0.055, 0.075, 0.415]
        labs = ["Trip", "Dir", "Trip ID", "Sch dep", "Sch arr", "Act dep", "Act arr", "Status", "Cancellation / note"]
        col_w = [epw * w for w in weights]
        for i, w in enumerate(col_w):
            pdf.cell(w, 6.5, _fpdf_cell_text(labs[i], 22), border=1, align="C", fill=False)
        pdf.ln()
        pdf.set_font("Helvetica", "", 7)
        return col_w

    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(epw, 11, _fpdf_cell_text("  Duty assignment summary", 80), ln=True, fill=False)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(epw, 5.5, _fpdf_cell_text(f"  {filter_line}", 200), ln=True)
    mtxt = (
        f"  Duties: {metrics.get('duty_count', 0)} | Trip legs: {metrics.get('trip_legs', 0)} | "
        f"SMS sent: {metrics.get('sms_sent', 0)} | SMS pending: {metrics.get('sms_pending', 0)}"
    )
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(epw, 5.5, _fpdf_cell_text(mtxt, 200), ln=True)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(epw, 4.5, _fpdf_cell_text(f"  {generated_line}", 200), ln=True)
    if truncated:
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(epw, 5, _fpdf_cell_text(f"  Export limited to the first {max_rows} duties.", 200), ln=True)
    pdf.ln(3)

    col_w = draw_table_header()

    for duty in items:
        if pdf.get_y() > 175:
            pdf.add_page()
            col_w = draw_table_header()
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(0, 0, 0)
        b1 = f"  {duty.get('id', '')}  |  {duty.get('date', '')}  |  Bus {duty.get('bus_id', '')}  |  {duty.get('driver_name', '')}"
        pdf.cell(epw, 5.5, _fpdf_cell_text(b1, 200), ln=True, fill=False)
        pdf.set_font("Helvetica", "", 8)
        b2 = (
            f"  {duty.get('route_name', '')}  |  {duty.get('start_point', '')} - {duty.get('end_point', '')}  |  "
            f"Duty SMS: {'Yes' if duty.get('sms_sent') else 'No'}"
        )
        pdf.cell(epw, 5, _fpdf_cell_text(b2, 220), ln=True, fill=False)
        pdf.ln(1)
        trips = duty.get("trips") or []
        if not trips:
            pdf.set_font("Helvetica", "I", 8)
            pdf.cell(epw, 5, _fpdf_cell_text("  No trips on this duty.", 120), ln=True)
            pdf.ln(2)
            continue
        ri = 0
        for t in trips:
            if not isinstance(t, dict):
                continue
            note = _duty_trip_cancel_reason_export(t)
            row = [
                t.get("trip_number", ""),
                t.get("direction", ""),
                t.get("trip_id", ""),
                t.get("start_time", ""),
                t.get("end_time", ""),
                t.get("actual_start_time", ""),
                t.get("actual_end_time", ""),
                (t.get("trip_status", "") or "").replace("_", " "),
                note,
            ]
            note_txt = _fpdf_cell_text(row[-1], 800)
            wrap_w = max(18, int(col_w[-1] / 1.55))
            note_lines = textwrap.wrap(note_txt, width=wrap_w) or [""]
            line_h = 3.5
            row_h = max(7.5, line_h * len(note_lines) + 2.0)
            if pdf.get_y() + row_h > 188:
                pdf.add_page()
                col_w = draw_table_header()
            y0 = pdf.get_y()
            x0 = pdf.l_margin
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(0, 0, 0)
            for i in range(8):
                pdf.cell(
                    col_w[i],
                    row_h,
                    _fpdf_cell_text(row[i], 22),
                    border=1,
                    align="C",
                    fill=False,
                )
            x_note = x0 + sum(col_w[:-1])
            pdf.rect(x_note, y0, col_w[-1], row_h, style="D")
            pdf.set_xy(x_note + 0.6, y0 + 1.0)
            pdf.set_font("Helvetica", "", 7)
            pdf.multi_cell(col_w[-1] - 1.2, line_h, "\n".join(note_lines), border=0)
            pdf.set_xy(pdf.l_margin, y0 + row_h)
            ri += 1
        pdf.ln(3)

    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return buf


@router.get("/duties/summary-export")
async def duties_summary_export(
    fmt: str = Query("excel", description="excel or pdf"),
    date: str = "",
    bus_id: str = "",
    depot: str = "",
    q: str = "",
    user: dict = Depends(get_current_user),
):
    """Download duty summary as Excel (flat trip rows) or PDF (per-duty blocks)."""
    f = (fmt or "excel").strip().lower()
    if f not in ("excel", "pdf"):
        raise HTTPException(status_code=400, detail="fmt must be excel or pdf")
    query = _duties_mongo_filter(date, "", bus_id, depot, q)
    max_rows = 2500
    items = await db.duty_assignments.find(query, {"_id": 0}).sort([("date", -1), ("id", -1)]).limit(max_rows).to_list(max_rows)
    truncated = False
    if len(items) >= max_rows:
        truncated = await db.duty_assignments.count_documents(query) > max_rows
    date_safe = re.sub(r"[^\d\-]", "_", date or "all")[:32]
    filter_line = f"Date: {date or 'All'} | Depot: {depot or 'All'} | Bus: {bus_id or 'All'} | Search: {q or '—'}"

    m_pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": None,
                "duty_count": {"$sum": 1},
                "sms_sent_count": {"$sum": {"$cond": [{"$eq": ["$sms_sent", True]}, 1, 0]}},
                "trip_legs": {"$sum": {"$size": {"$ifNull": ["$trips", []]}}},
            }
        },
    ]
    agg_m = await db.duty_assignments.aggregate(m_pipeline).to_list(1)
    row_m = agg_m[0] if agg_m else {}
    dc = int(row_m.get("duty_count", 0) or 0)
    sms_s = int(row_m.get("sms_sent_count", 0) or 0)
    trip_n = int(row_m.get("trip_legs", 0) or 0)
    metrics = {
        "duty_count": dc,
        "trip_legs": trip_n,
        "sms_sent": sms_s,
        "sms_pending": max(0, dc - sms_s),
    }
    generated_line = datetime.now(timezone.utc).strftime("Generated (UTC): %Y-%m-%d %H:%M")

    if f == "excel":
        buf = _duty_summary_build_excel(items, filter_line, truncated, max_rows, metrics, generated_line)
        fname = f"duty_summary_{date_safe}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )

    buf = _duty_summary_build_pdf(items, filter_line, truncated, max_rows, metrics, generated_line)
    fname = f"duty_summary_{date_safe}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.post("/duties")
async def create_duty(req: DutyReq, user: dict = Depends(require_permission("operations.duties.create"))):
    driver = await db.drivers.find_one({"license_number": req.driver_license}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    bus = await db.buses.find_one({"bus_id": req.bus_id}, {"_id": 0})
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    rid = (req.route_id or "").strip()
    route = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    doc = req.model_dump()
    duty_id_new = f"DTY-{str(uuid.uuid4())[:8].upper()}"
    doc["id"] = duty_id_new
    doc["trips"] = _apply_duty_trip_ids(duty_id_new, doc.get("trips", []))
    doc["route_id"] = rid
    doc["route_name"] = (route.get("name") or "").strip()
    doc["start_point"] = (route.get("origin") or "").strip()
    doc["end_point"] = (route.get("destination") or "").strip()
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
async def update_duty(duty_id: str, req: DutyReq, _: dict = Depends(require_permission("operations.duties.update"))):
    update = req.model_dump()
    update["trips"] = _apply_duty_trip_ids(duty_id, update.get("trips", []))
    rid = (req.route_id or "").strip()
    route = await db.routes.find_one({"route_id": rid}, {"_id": 0})
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    update["route_id"] = rid
    update["route_name"] = (route.get("name") or "").strip()
    update["start_point"] = (route.get("origin") or "").strip()
    update["end_point"] = (route.get("destination") or "").strip()
    driver = await db.drivers.find_one({"license_number": req.driver_license}, {"_id": 0})
    if driver:
        update["driver_name"] = driver.get("name", "")
        update["driver_phone"] = driver.get("phone", "")
    result = await db.duty_assignments.update_one({"id": duty_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Duty not found")
    return {"message": "Duty updated"}

@router.delete("/duties/{duty_id}")
async def delete_duty(duty_id: str, _: dict = Depends(require_permission("operations.duties.delete"))):
    result = await db.duty_assignments.delete_one({"id": duty_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Duty not found")
    return {"message": "Duty deleted"}

@router.post("/duties/{duty_id}/send-sms")
async def send_duty_sms(duty_id: str, _: dict = Depends(require_permission("operations.duties.update"))):
    duty = await db.duty_assignments.find_one({"id": duty_id}, {"_id": 0})
    if not duty:
        raise HTTPException(status_code=404, detail="Duty not found")
    trips_text = ""
    for t in duty.get("trips", []):
        trips_text += _duty_trip_sms_fragment(t if isinstance(t, dict) else {})
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
async def send_all_duty_sms(date: str = Query(...), _: dict = Depends(require_permission("operations.duties.update"))):
    duties = await db.duty_assignments.find({"date": date, "sms_sent": False}, {"_id": 0}).to_list(1000)
    sent_count = 0
    for duty in duties:
        trips_text = ""
        for t in duty.get("trips", []):
            trips_text += _duty_trip_sms_fragment(t if isinstance(t, dict) else {})
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
# TRIP-WISE KM APPROVAL (Tender §5 — TGSRTC approves daily trip KMs in portal;
# responsibility matrix: 1st sign-off after incoming, maintenance final after 24h.)
# ══════════════════════════════════════════════════════════

TRIP_KM_EXCEPTION_THRESHOLD_PCT = 5.0


def _trip_km_display_key(doc: dict) -> str:
    tid = doc.get("trip_id")
    if isinstance(tid, str) and tid.strip():
        return tid.strip()
    return f"{doc.get('bus_id', '')}|{doc.get('date', '')}"


def _trip_key_to_filter(key: str) -> dict | None:
    s = (key or "").strip()
    if not s:
        return None
    if "|" in s:
        bus_id, _, date = s.partition("|")
        bus_id, date = bus_id.strip(), date.strip()
        if not bus_id or not date:
            return None
        return {"bus_id": bus_id, "date": date}
    return {"trip_id": s}


def _actor_label(user: dict) -> str:
    return str(user.get("name") or user.get("email") or user.get("_id") or "user")


def _trip_km_variance_values(doc: dict) -> tuple[float, float]:
    scheduled = float(doc.get("scheduled_km", 0) or 0)
    actual = float(doc.get("actual_km", 0) or 0)
    variance = actual - scheduled
    variance_pct = (variance / scheduled * 100.0) if scheduled > 0 else 0.0
    return variance, variance_pct


def _enrich_trip_km_list_item(doc: dict, depot: str) -> dict:
    base = _normalize_operations_report_row(dict(doc))
    ta = bool(base.get("traffic_km_approved"))
    mf = bool(base.get("maintenance_km_finalized"))
    variance, variance_pct = _trip_km_variance_values(base)
    needs_exception = abs(variance_pct) > TRIP_KM_EXCEPTION_THRESHOLD_PCT
    return {
        "trip_key": _trip_km_display_key(base),
        "bus_id": base.get("bus_id", ""),
        "depot": depot,
        "date": base.get("date", ""),
        "driver_id": base.get("driver_id", ""),
        "scheduled_km": base.get("scheduled_km", 0),
        "actual_km": base.get("actual_km", 0),
        "scheduled_bus_out": base.get("scheduled_bus_out", ""),
        "actual_bus_out": base.get("actual_bus_out", ""),
        "scheduled_bus_in": base.get("scheduled_bus_in", ""),
        "actual_bus_in": base.get("actual_bus_in", ""),
        "start_time": base.get("start_time", ""),
        "end_time": base.get("end_time", ""),
        "km_variance": round(variance, 2),
        "km_variance_pct": round(variance_pct, 2),
        "needs_exception_action": needs_exception,
        "exception_action_status": base.get("exception_action_status") or "",
        "exception_action_note": base.get("exception_action_note") or "",
        "linked_incident_id": base.get("linked_incident_id") or "",
        "exception_action_at": base.get("exception_action_at") or "",
        "exception_action_by": base.get("exception_action_by") or "",
        "traffic_km_approved": ta,
        "traffic_km_approved_at": base.get("traffic_km_approved_at") or "",
        "traffic_km_approved_by": base.get("traffic_km_approved_by") or "",
        "maintenance_km_finalized": mf,
        "maintenance_km_finalized_at": base.get("maintenance_km_finalized_at") or "",
        "maintenance_km_finalized_by": base.get("maintenance_km_finalized_by") or "",
    }


@router.get("/trip-km-approvals")
async def list_trip_km_approvals(
    date_from: str = "",
    date_to: str = "",
    depot: str = "",
    bus_id: str = "",
    queue: str = Query("all", description="all | traffic_pending | maintenance_pending | complete"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _: dict = Depends(require_permission("operations.trip_km.read")),
):
    tq: dict = {}
    dm = _trip_energy_date_match(date_from, date_to)
    if dm:
        tq["date"] = dm
    bid = _norm_q(bus_id)
    if bid:
        tq["bus_id"] = bid
    elif _norm_q(depot):
        ids = await _bus_ids_in_depot(depot)
        if ids:
            tq["bus_id"] = {"$in": ids}
        else:
            return paged_payload([], total=0, page=page, limit=limit)

    qn = (queue or "all").strip().lower()
    if qn == "traffic_pending":
        tq["$or"] = [{"traffic_km_approved": {"$ne": True}}, {"traffic_km_approved": {"$exists": False}}]
    elif qn == "maintenance_pending":
        tq["traffic_km_approved"] = True
        tq["$or"] = [
            {"maintenance_km_finalized": {"$ne": True}},
            {"maintenance_km_finalized": {"$exists": False}},
        ]
    elif qn == "complete":
        tq["traffic_km_approved"] = True
        tq["maintenance_km_finalized"] = True

    p, lim = normalize_page_limit(page, limit)
    total = await db.trip_data.count_documents(tq)
    cur = db.trip_data.find(tq, {"_id": 0}).sort([("date", -1), ("bus_id", 1)]).skip((p - 1) * lim).limit(lim)
    raw = await cur.to_list(lim)
    buses = await db.buses.find({}, {"_id": 0, "bus_id": 1, "depot": 1}).to_list(2000)
    bus_depot = {b["bus_id"]: b.get("depot", "") for b in buses}
    items = [_enrich_trip_km_list_item(row, bus_depot.get(row.get("bus_id", ""), "")) for row in raw]
    return paged_payload(items, total=total, page=page, limit=limit)


@router.post("/trip-km-approvals/traffic")
async def approve_traffic_trip_km(
    req: TripKmKeysReq,
    user: dict = Depends(require_permission("operations.trip_km.traffic_approve")),
):
    actor = _actor_label(user)
    now = datetime.now(timezone.utc).isoformat()
    updated = 0
    failed: list[dict] = []
    for key in req.trip_keys:
        filt = _trip_key_to_filter(key)
        if not filt:
            failed.append({"trip_key": key, "detail": "Invalid trip key"})
            continue
        doc = await db.trip_data.find_one(
            filt,
            {
                "_id": 0,
                "traffic_km_approved": 1,
                "scheduled_km": 1,
                "actual_km": 1,
                "exception_action_status": 1,
            },
        )
        if not doc:
            failed.append({"trip_key": key, "detail": "Trip row not found"})
            continue
        if doc.get("traffic_km_approved") is True:
            failed.append({"trip_key": key, "detail": "First verification is already complete"})
            continue
        _, variance_pct = _trip_km_variance_values(doc)
        if (
            abs(variance_pct) > TRIP_KM_EXCEPTION_THRESHOLD_PCT
            and doc.get("exception_action_status") != "approved_with_exception"
        ):
            failed.append(
                {
                    "trip_key": key,
                    "detail": (
                        "Exception action is required before first verification "
                        f"(variance is {variance_pct:.2f}%)."
                    ),
                }
            )
            continue
        await db.trip_data.update_one(
            filt,
            {
                "$set": {
                    "traffic_km_approved": True,
                    "traffic_km_approved_at": now,
                    "traffic_km_approved_by": actor,
                }
            },
        )
        updated += 1
    return {"updated": updated, "failed": failed}


@router.post("/trip-km-approvals/exception-action")
async def set_trip_km_exception_action(
    req: TripKmExceptionReq,
    user: dict = Depends(require_permission("operations.trip_km.traffic_approve")),
):
    filt = _trip_key_to_filter(req.trip_key)
    if not filt:
        raise HTTPException(status_code=400, detail="Invalid trip key")
    doc = await db.trip_data.find_one(
        filt,
        {
            "_id": 0,
            "scheduled_km": 1,
            "actual_km": 1,
            "traffic_km_approved": 1,
        },
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Trip row not found")
    if doc.get("traffic_km_approved") is True:
        raise HTTPException(status_code=400, detail="Cannot change exception action after first verification")
    variance, variance_pct = _trip_km_variance_values(doc)
    if abs(variance_pct) <= TRIP_KM_EXCEPTION_THRESHOLD_PCT:
        raise HTTPException(status_code=400, detail="This row does not require exception action")
    action = (req.action or "").strip().lower()
    if action not in {"approved_with_exception", "rejected_for_review"}:
        raise HTTPException(status_code=400, detail="Action must be approved_with_exception or rejected_for_review")
    actor = _actor_label(user)
    now = datetime.now(timezone.utc).isoformat()
    await db.trip_data.update_one(
        filt,
        {
            "$set": {
                "exception_action_status": action,
                "exception_action_note": req.note.strip(),
                "linked_incident_id": req.linked_incident_id.strip(),
                "exception_action_at": now,
                "exception_action_by": actor,
            }
        },
    )
    return {
        "message": "Exception action recorded",
        "action": action,
        "km_variance": round(variance, 2),
        "km_variance_pct": round(variance_pct, 2),
    }


@router.post("/trip-km-approvals/maintenance")
async def finalize_maintenance_trip_km(
    req: TripKmKeysReq,
    user: dict = Depends(require_permission("operations.trip_km.maintenance_finalize")),
):
    actor = _actor_label(user)
    now = datetime.now(timezone.utc).isoformat()
    updated = 0
    failed: list[dict] = []
    for key in req.trip_keys:
        filt = _trip_key_to_filter(key)
        if not filt:
            failed.append({"trip_key": key, "detail": "Invalid trip key"})
            continue
        doc = await db.trip_data.find_one(
            filt,
            {"_id": 0, "traffic_km_approved": 1, "maintenance_km_finalized": 1},
        )
        if not doc:
            failed.append({"trip_key": key, "detail": "Trip row not found"})
            continue
        if doc.get("traffic_km_approved") is not True:
            failed.append({"trip_key": key, "detail": "First verification must be completed before final verification"})
            continue
        if doc.get("maintenance_km_finalized") is True:
            failed.append({"trip_key": key, "detail": "Final verification is already complete"})
            continue
        await db.trip_data.update_one(
            filt,
            {
                "$set": {
                    "maintenance_km_finalized": True,
                    "maintenance_km_finalized_at": now,
                    "maintenance_km_finalized_by": actor,
                }
            },
        )
        updated += 1
    return {"updated": updated, "failed": failed}


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


@router.get("/kpi/gcc-engine/download")
async def gcc_kpi_engine_download(
    period_start: str = "",
    period_end: str = "",
    depot: str = "",
    bus_id: str = "",
    fmt: str = "excel",
    user: dict = Depends(get_current_user),
):
    kpi = await gcc_kpi_engine(
        period_start=period_start,
        period_end=period_end,
        depot=depot,
        bus_id=bus_id,
        user=user,
    )
    cats = kpi.get("categories") or {}
    period_label = f"{_to_indian_date_text(period_start or '-')} to {_to_indian_date_text(period_end or '-')}"

    if fmt == "excel":
        wb = Workbook()
        ws = wb.active
        ws.title = "GCC KPI"
        ws.append(["Metric", "Value"])
        ws.append(["Period", period_label])
        ws.append(["Depot", depot or "All"])
        ws.append(["Bus", bus_id or "All"])
        ws.append(["Bus count", kpi.get("bus_count", 0)])
        ws.append(["Bus KM", kpi.get("bus_km", 0)])
        ws.append(["Monthly fee base", kpi.get("monthly_fee_base", 0)])
        ws.append(["Total damages raw", kpi.get("total_damages_raw", 0)])
        ws.append(["KPI cap", kpi.get("kpi_cap", 0)])
        ws.append(["Total damages capped", kpi.get("total_damages_capped", 0)])
        ws.append(["Total incentive raw", kpi.get("total_incentive_raw", 0)])
        ws.append(["Incentive cap", kpi.get("incentive_cap", 0)])
        ws.append(["Total incentive capped", kpi.get("total_incentive_capped", 0)])
        ws.append([])
        ws.append(["Category", "Value", "Target", "Damages", "Incentive"])
        for key, cat in cats.items():
            value = cat.get("value")
            if value is None:
                if key == "availability":
                    value = cat.get("pct")
                elif key == "frequency":
                    value = cat.get("trip_freq_pct")
                elif key == "punctuality":
                    value = f"start {cat.get('start_pct', '-')}, arrival {cat.get('arrival_pct', '-')}"
                elif key == "reliability":
                    value = cat.get("bf")
                elif key == "safety":
                    value = cat.get("maf")
            target = cat.get("target")
            if key == "punctuality":
                target = f"start>={cat.get('start_target_pct', 90)} arrival>={cat.get('arrival_target_pct', 80)}"
            ws.append([key, _excel_cell_value(value), _excel_cell_value(target), cat.get("damages", 0), cat.get("incentive", 0)])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=gcc_kpi_report.xlsx"},
        )

    if fmt != "pdf":
        raise HTTPException(status_code=400, detail="fmt must be excel or pdf")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(190, 8, _fpdf_cell_text("TGSRTC GCC KPI Report"), ln=True, align="C")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(190, 6, _fpdf_cell_text(f"Period: {period_label}"), ln=True)
    pdf.cell(190, 6, _fpdf_cell_text(f"Depot: {depot or 'All'} | Bus: {bus_id or 'All'}"), ln=True)
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 10)
    for label, value in [
        ("Bus count", kpi.get("bus_count", 0)),
        ("Bus KM", kpi.get("bus_km", 0)),
        ("Monthly fee base", kpi.get("monthly_fee_base", 0)),
        ("Damages capped", kpi.get("total_damages_capped", 0)),
        ("Incentive capped", kpi.get("total_incentive_capped", 0)),
    ]:
        pdf.cell(70, 6, _fpdf_cell_text(label), border=1)
        pdf.cell(35, 6, _fpdf_cell_text(value), border=1, ln=True)
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(40, 6, "Category", border=1)
    pdf.cell(58, 6, "Value", border=1)
    pdf.cell(32, 6, "Target", border=1)
    pdf.cell(30, 6, "Damages", border=1)
    pdf.cell(30, 6, "Incentive", border=1, ln=True)
    pdf.set_font("Helvetica", "", 8)
    for key, cat in cats.items():
        value = cat.get("value")
        if value is None:
            if key == "availability":
                value = cat.get("pct")
            elif key == "frequency":
                value = cat.get("trip_freq_pct")
            elif key == "punctuality":
                value = f"S {cat.get('start_pct', '-')}/A {cat.get('arrival_pct', '-')}"
            elif key == "reliability":
                value = cat.get("bf")
            elif key == "safety":
                value = cat.get("maf")
        target = cat.get("target")
        if key == "punctuality":
            target = f"S>={cat.get('start_target_pct', 90)} A>={cat.get('arrival_target_pct', 80)}"
        pdf.cell(40, 6, _fpdf_cell_text(key, 26), border=1)
        pdf.cell(58, 6, _fpdf_cell_text(value, 32), border=1)
        pdf.cell(32, 6, _fpdf_cell_text(target, 16), border=1)
        pdf.cell(30, 6, _fpdf_cell_text(cat.get("damages", 0), 14), border=1)
        pdf.cell(30, 6, _fpdf_cell_text(cat.get("incentive", 0), 14), border=1, ln=True)
    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=gcc_kpi_report.pdf"},
    )

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
    search: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    # Keep DB-backed catalogue aligned with tender-frozen master codes.
    now_iso = datetime.now(timezone.utc).isoformat()
    for inf in build_master_rows():
        payload = dict(inf)
        payload["created_at"] = payload.get("created_at", now_iso)
        await db.infraction_catalogue.update_one(
            {"code": payload["code"]},
            {"$set": payload},
            upsert=True,
        )
    p, lim = normalize_page_limit(page, limit)
    allowed_codes = sorted(MASTER_BY_CODE.keys())
    q = {"code": {"$in": allowed_codes}}
    st = (search or "").strip()
    if st:
        esc = re.escape(st)
        q["$and"] = [
            {"code": {"$in": allowed_codes}},
            {
                "$or": [
                    {"code": {"$regex": esc, "$options": "i"}},
                    {"category": {"$regex": esc, "$options": "i"}},
                    {"description": {"$regex": esc, "$options": "i"}},
                ]
            },
        ]
    total = await db.infraction_catalogue.count_documents(q)
    cur = db.infraction_catalogue.find(q, {"_id": 0}).sort("code", 1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)


@router.get("/infractions/master")
async def get_infraction_master(user: dict = Depends(get_current_user)):
    return {
        "tables": ["A", "B", "C", "D", "E", "F", "G"],
        "report_heads": TENDER_REPORT_HEADS,
        "items": build_master_rows(),
        "cap_rules": {
            "non_safety_ad_cap_pct": 5,
            "repeat_non_rectification_ceiling_rs": ESCALATION_CEILING_RS,
        },
    }

@router.post("/infractions/catalogue")
async def add_infraction_item(req: InfractionReq, _: dict = Depends(require_permission("operations.infractions.create"))):
    code = (req.code or "").strip().upper()
    master = MASTER_BY_CODE.get(code)
    if not master:
        raise HTTPException(status_code=400, detail="Catalogue is tender-frozen; only Schedule-S master codes are allowed")
    if (req.description or "").strip() != (master.get("description") or "").strip():
        raise HTTPException(status_code=400, detail="Description must match tender wording exactly")
    raise HTTPException(status_code=400, detail="Catalogue is read-only (tender-frozen)")

@router.put("/infractions/catalogue/{inf_id}")
async def update_infraction_item(inf_id: str, req: InfractionReq, _: dict = Depends(require_permission("operations.infractions.update"))):
    raise HTTPException(status_code=400, detail="Catalogue is read-only (tender-frozen)")

@router.delete("/infractions/catalogue/{inf_id}")
async def delete_infraction_item(inf_id: str, _: dict = Depends(require_permission("operations.infractions.delete"))):
    raise HTTPException(status_code=400, detail="Catalogue is read-only (tender-frozen)")

@router.get("/infractions/logged/stats")
async def get_infraction_log_stats(
    period_start: str = "",
    period_end: str = "",
    bus_id: str = "",
    depot: str = "",
    user: dict = Depends(get_current_user),
):
    """Aggregated stats from unified incidents."""
    if not period_end:
        period_end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not period_start:
        period_start = _add_days_ymd(period_end, -30)

    rows = await _get_flattened_infractions(period_start, period_end, [bus_id] if bus_id else None)
    
    total_amount = sum(float(r.get("amount", 0)) for r in rows)
    safety_count = sum(1 for r in rows if r.get("safety_flag"))
    
    return {
        "total_count": len(rows),
        "total_amount": round(total_amount, 2),
        "safety_infractions": safety_count,
        "open_count": sum(1 for r in rows if r.get("status") != "closed"),
        "closed_count": sum(1 for r in rows if r.get("status") == "closed"),
    }

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
    status: str = "",
    search: str = "",
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
    st = _norm_q(status)
    if st:
        q["status"] = st
    stext = (search or "").strip()
    if stext:
        esc = re.escape(stext)
        q["$or"] = [
            {"id": {"$regex": esc, "$options": "i"}},
            {"infraction_code": {"$regex": esc, "$options": "i"}},
            {"bus_id": {"$regex": esc, "$options": "i"}},
            {"depot": {"$regex": esc, "$options": "i"}},
            {"description": {"$regex": esc, "$options": "i"}},
            {"status": {"$regex": esc, "$options": "i"}},
            {"logged_by": {"$regex": esc, "$options": "i"}},
            {"driver_id": {"$regex": esc, "$options": "i"}},
            {"route_name": {"$regex": esc, "$options": "i"}},
            {"related_incident_id": {"$regex": esc, "$options": "i"}},
        ]
    p, lim = normalize_page_limit(page, limit)
    total = await db.infractions_logged.count_documents(q)
    cur = db.infractions_logged.find(q, {"_id": 0}).sort("created_at", -1).skip((p - 1) * lim).limit(lim)
    items = await cur.to_list(lim)
    return paged_payload(items, total=total, page=page, limit=limit)


@router.post("/infractions/log")
async def log_infraction(req: InfractionLogReq, user: dict = Depends(require_permission("operations.infractions.create"))):
    infraction_code = req.infraction_code.strip()
    master = MASTER_BY_CODE.get(infraction_code)
    if not master:
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
        "category": master["category"],
        "description": master["description"],
        "amount": master["amount"],
        "amount_snapshot": master["amount"],
        "safety_flag": master.get("safety_flag", False),
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
    category = str(master.get("category") or "")
    resolve_days = int(master.get("resolve_days", INFRACTION_SLABS.get(category, INFRACTION_SLABS["A"]).resolve_days))
    doc["status"] = "open"
    doc["opened_at"] = datetime.now(timezone.utc).isoformat()
    doc["opened_by"] = user.get("name", "") or user.get("email", "")
    doc["resolve_by"] = _add_days_ymd(doc["date"], resolve_days)
    doc["close_remarks"] = ""
    doc["closed_at"] = ""
    doc["closed_by"] = ""
    if req.deductible is not None:
        doc["deductible"] = req.deductible
    await db.infractions_logged.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/infractions/{log_id}/close")
async def close_infraction(log_id: str, req: InfractionCloseReq, user: dict = Depends(require_permission("operations.infractions.update"))):
    row = await db.infractions_logged.find_one({"id": log_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Logged infraction not found")
    if row.get("status") == "closed":
        return {"message": "Already closed", "id": log_id}
    new_status = (req.status or "closed").strip().lower()
    if new_status not in {"under_review", "closed"}:
        raise HTTPException(status_code=400, detail="status must be under_review or closed")
    patch = {"status": new_status}
    if new_status == "closed":
        patch.update(
            {
                "closed_at": datetime.now(timezone.utc).isoformat(),
                "closed_by": user.get("name", "") or user.get("email", ""),
                "close_remarks": (req.close_remarks or "").strip(),
            }
        )
    await db.infractions_logged.update_one({"id": log_id}, {"$set": patch})
    return {"message": f"Updated to {new_status}", "id": log_id}

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
WORKFLOW_TIMESTAMP_KEYS = {
    "submitted": "submitted_at",
    "regional_approved": "approved_at",
    "paid": "paid_at",
}

@router.post("/billing/workflow")
async def advance_billing_workflow(req: BillingWorkflowReq, user: dict = Depends(require_permission("finance.billing.update"))):
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
    set_patch = {"workflow_state": new_state, "status": new_state}
    ts_key = WORKFLOW_TIMESTAMP_KEYS.get(new_state)
    if ts_key:
        set_patch[f"approval_dates.{ts_key}"] = datetime.now(timezone.utc).isoformat()
    await db.billing.update_one(
        {"invoice_id": req.invoice_id},
        {"$set": set_patch,
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
async def upsert_business_rule(
    req: BusinessRuleReq,
    user: dict = Depends(require_any_permission("finance.business_rules.create", "finance.business_rules.update")),
):
    await db.business_rules.update_one(
        {"rule_key": req.rule_key},
        {"$set": {"rule_value": req.rule_value, "category": req.category,
                  "description": req.description, "updated_at": datetime.now(timezone.utc).isoformat(),
                  "updated_by": user.get("name", "")}},
        upsert=True
    )
    return {"message": f"Rule '{req.rule_key}' saved"}

@router.delete("/business-rules/{rule_key}")
async def delete_business_rule(rule_key: str, _: dict = Depends(require_permission("finance.business_rules.delete"))):
    result = await db.business_rules.delete_one({"rule_key": rule_key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"message": "Rule deleted"}


# ══════════════════════════════════════════════════════════
# UNIFIED INFRACTIONS HELPERS
# ══════════════════════════════════════════════════════════

async def _resolve_infractions_list(inf_reqs: list[InfractionEntryReq], occurred_at: str) -> list[dict]:
    """Take infraction requests (codes) and resolve them against the master catalogue."""
    if not inf_reqs:
        return []
        
    resolved = []
    occ_date = occurred_at[:10]
    
    for req in inf_reqs:
        master = await db.infraction_catalogue.find_one({"code": req.code}, {"_id": 0})
        if not master:
            continue # or raise error? usually we validate in request
            
        category = str(master.get("category") or "A").upper()
        # Default resolve days from slabs if not set in master
        resolve_days = int(master.get("resolve_days") or INFRACTION_SLABS.get(category, INFRACTION_SLABS["A"]).resolve_days)
        
        entry = {
            "infraction_code": master["code"],
            "category": category,
            "description": master["description"],
            "amount": float(master["amount"]),
            "amount_current": float(master["amount"]), # current as of resolution
            "amount_snapshot": float(master["amount"]), # amount stuck since closure
            "safety_flag": bool(master.get("safety_flag", False)),
            "deductible": bool(req.deductible),
            "status": "open",
            "resolve_by": _add_days_ymd(occ_date, resolve_days),
            "resolve_days": resolve_days,
            "opened_at": datetime.now(timezone.utc).isoformat(),
            "closed_at": "",
            "close_remarks": ""
        }
        resolved.append(entry)
        
    return resolved


@router.put("/incidents/{incident_id}/infractions/{idx}/close")
async def close_incident_infraction(
    incident_id: str,
    idx: int,
    req: InfractionCloseReq,
    user: dict = Depends(require_permission("operations.incidents.update")),
):
    existing = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    infractions = list(existing.get("infractions") or [])
    if idx < 0 or idx >= len(infractions):
        raise HTTPException(status_code=400, detail="Invalid infraction index")
    
    inf = infractions[idx]
    if inf.get("status") == "closed":
        return {"message": "Already closed", "id": incident_id, "idx": idx}
        
    inf["status"] = "closed"
    inf["close_remarks"] = (req.close_remarks or "").strip()
    inf["closed_at"] = _incident_now_iso()
    inf["closed_by"] = user.get("name", "") or user.get("email", "")
    
    log = existing.get("activity_log") or []
    log = _append_incident_activity(
        log,
        action="infractions_close",
        user_name=user.get("name", ""),
        detail=f"Infraction {inf.get('infraction_code')} verified & resolved",
    )
    
    await db.incidents.update_one(
        {"id": incident_id}, 
        {"$set": {"infractions": infractions, "activity_log": log, "updated_at": _incident_now_iso()}}
    )
    return {"message": "Infraction resolved", "id": incident_id, "idx": idx}
