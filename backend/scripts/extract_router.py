"""
Legacy: regenerated `app/api/v1/routes.py` from the old monolithic `server.py`.
Requires a full `server.py` snapshot in git history — not the current slim shim.
Run from backend/:  python scripts/extract_router.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server.py"
OUT = ROOT / "app" / "api" / "v1" / "routes.py"

HEADER = r'''"""
API route handlers (v1). Split into domain routers over time.

Generated structure: single module for minimal breakage; prefer extracting
`endpoints/*.py` pieces behind `APIRouter` includes as the codebase grows.
"""

from __future__ import annotations

import io
import json
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
from app.core.database import client, db
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
    is_breakdown_for_reliability,
    normalize_incident_type,
    safety_kpi_counts,
)
from app.schemas.requests import (
    BillingGenerateReq,
    BillingWorkflowReq,
    BusinessRuleReq,
    BusReq,
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
    SettingsReq,
    TenderReq,
)
from app.services.gcc_engine import compute_kpi_damages

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

'''

FOOTER = ""


def main() -> None:
    text = SERVER.read_text(encoding="utf-8")
    if len(text) < 2000:
        raise SystemExit(
            "server.py is the slim entrypoint; restore monolith from git to re-run this script."
        )
    a = text.index("# ══════════════════════════════════════════════════════════\n# AUTH ROUTES")
    b = text.index("# ══════════════════════════════════════════════════════════\n# SEED DATA")
    body = text[a:b]
    body = body.replace("@api.", "@router.")
    g = body.find("# GCC KPI ENGINE")
    k = body.find('@router.get("/kpi/gcc-engine")')
    if g != -1 and k != -1:
        body = body[:g] + body[k:]
    body = body.replace("kpi = _compute_kpi_damages(", "kpi = compute_kpi_damages(")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(HEADER + body + FOOTER, encoding="utf-8")
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
