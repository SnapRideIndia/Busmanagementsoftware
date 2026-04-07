"""Pydantic request/entity models for API validation."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.domain.incident_evidence import normalize_occurred_at_iso
from app.domain.incident_types import IncidentChannel, IncidentSeverity, IncidentStatus
from app.domain.user_roles import ALLOWED_ROLE_IDS, PLATFORM_ADMIN_ROLES


class LoginReq(BaseModel):
    email: str
    password: str


class RegisterReq(BaseModel):
    email: str
    password: str
    name: str
    role: str = "vendor"

    @field_validator("role")
    @classmethod
    def register_role_allowed(cls, v: str) -> str:
        r = (v or "vendor").strip()
        if r not in ALLOWED_ROLE_IDS:
            raise ValueError("Invalid role")
        if r in PLATFORM_ADMIN_ROLES:
            raise ValueError("Administrator roles cannot be self-registered")
        return r


class UserRoleUpdateReq(BaseModel):
    role: str


class RolePermissionsUpdateReq(BaseModel):
    permission_ids: list[str]


class ConductorReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    badge_no: str = Field(..., min_length=1, max_length=64)
    phone: str = ""
    depot: str = ""
    status: str = "active"
    rating: float = Field(default=4.5, ge=0, le=5)
    total_trips: int = 0


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


class DepotReq(BaseModel):
    """Depot master record; `name` is the value stored on buses and operational data."""

    name: str = Field(..., min_length=1, max_length=128)
    code: str = Field(default="", max_length=32)
    address: str = Field(default="", max_length=512)
    active: bool = True


class StopMasterCreateReq(BaseModel):
    """Canonical stop (shared across routes)."""

    stop_id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=160)
    locality: str = Field(default="", max_length=160)
    landmark: str = Field(default="", max_length=256)
    region: str = Field(default="Hyderabad", max_length=128)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    active: bool = True


class StopMasterUpdateReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    locality: str = Field(default="", max_length=160)
    landmark: str = Field(default="", max_length=256)
    region: str = Field(default="Hyderabad", max_length=128)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    active: bool = True


class RouteStopRefReq(BaseModel):
    """Reference to a row in stop_master, with order along the route."""

    stop_id: str = Field(..., min_length=1, max_length=64)
    seq: int = Field(..., ge=1, le=500)


class RouteUpdateReq(BaseModel):
    """Operational route master; `name` is the label stored on revenue/TIM rows."""

    name: str = Field(..., min_length=1, max_length=256)
    origin: str = Field(default="", max_length=128)
    destination: str = Field(default="", max_length=128)
    distance_km: float = Field(default=0, ge=0, le=500000)
    depot: str = Field(default="", max_length=128)
    active: bool = True
    stop_sequence: list[RouteStopRefReq] = Field(default_factory=list)


class RouteCreateReq(RouteUpdateReq):
    route_id: str = Field(..., min_length=1, max_length=64)


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


class IncidentCreateReq(BaseModel):
    incident_type: str = Field(..., min_length=1, max_length=64)
    description: str = Field(..., min_length=1, max_length=8000)
    occurred_at: str = Field(..., min_length=1, max_length=48)
    vehicles_affected: list[str] = Field(default_factory=list)
    vehicles_affected_count: int = Field(default=1, ge=1, le=999)
    damage_summary: str = Field(default="", max_length=4000)
    engineer_action: str = Field(default="", max_length=4000)
    bus_id: str = Field(default="", max_length=64)
    driver_id: str = Field(default="", max_length=64)
    depot: str = Field(default="", max_length=128)
    route_name: str = Field(default="", max_length=256)
    route_id: str = Field(default="", max_length=64)
    trip_id: str = Field(default="", max_length=64)
    duty_id: str = Field(default="", max_length=64)
    location_text: str = Field(default="", max_length=512)
    related_infraction_id: str = Field(default="", max_length=64)
    severity: str = Field(default=IncidentSeverity.MEDIUM.value)
    channel: str = Field(default=IncidentChannel.WEB.value)
    telephonic_reference: str = Field(default="", max_length=64)

    @field_validator("vehicles_affected", mode="before")
    @classmethod
    def vehicles_affected_norm(cls, v: object) -> list[str]:
        if v is None or v == "":
            return []
        if isinstance(v, str):
            # allow comma-separated input from integrations
            items = [x.strip() for x in v.split(",")]
        elif isinstance(v, list):
            items = [str(x).strip() for x in v]
        else:
            raise ValueError("vehicles_affected must be a list of bus ids")
        out: list[str] = []
        seen: set[str] = set()
        for it in items:
            if not it:
                continue
            if it not in seen:
                out.append(it)
                seen.add(it)
        if len(out) > 50:
            raise ValueError("vehicles_affected max 50")
        return out

    @field_validator("occurred_at")
    @classmethod
    def occurred_at_ok(cls, v: str) -> str:
        return normalize_occurred_at_iso(v)

    @field_validator("severity")
    @classmethod
    def severity_ok(cls, v: str) -> str:
        allowed = {e.value for e in IncidentSeverity}
        if v not in allowed:
            raise ValueError(f"severity must be one of {sorted(allowed)}")
        return v

    @field_validator("channel")
    @classmethod
    def channel_ok(cls, v: str) -> str:
        allowed = {e.value for e in IncidentChannel}
        if v not in allowed:
            raise ValueError(f"channel must be one of {sorted(allowed)}")
        return v


class IncidentUpdateReq(BaseModel):
    status: Optional[str] = None
    assigned_team: Optional[str] = Field(default=None, max_length=128)
    assigned_to: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, min_length=1, max_length=8000)
    occurred_at: Optional[str] = None
    vehicles_affected: Optional[list[str]] = None
    vehicles_affected_count: Optional[int] = Field(default=None, ge=1, le=999)
    damage_summary: Optional[str] = Field(default=None, max_length=4000)
    engineer_action: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("vehicles_affected", mode="before")
    @classmethod
    def vehicles_affected_update_norm(cls, v: object) -> object:
        if v is None:
            return None
        return IncidentCreateReq.vehicles_affected_norm(v)  # reuse rules

    @field_validator("occurred_at")
    @classmethod
    def occurred_at_update_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return normalize_occurred_at_iso(v)

    @field_validator("status")
    @classmethod
    def status_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {e.value for e in IncidentStatus}
        if v not in allowed:
            raise ValueError(f"status must be one of {sorted(allowed)}")
        return v


class IncidentNoteReq(BaseModel):
    """Add a note; optional PM fields apply only when sent (model_dump exclude_unset) — overwrites DB."""

    note: str = Field(..., min_length=1, max_length=4000)
    occurred_at: Optional[str] = None
    vehicles_affected: Optional[list[str]] = None
    vehicles_affected_count: Optional[int] = Field(default=None, ge=1, le=999)
    damage_summary: Optional[str] = Field(default=None, max_length=4000)
    engineer_action: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("vehicles_affected", mode="before")
    @classmethod
    def note_vehicles_norm(cls, v: object) -> object:
        if v is None:
            return None
        return IncidentCreateReq.vehicles_affected_norm(v)

    @field_validator("occurred_at", mode="before")
    @classmethod
    def note_occurred_empty_to_none(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("occurred_at")
    @classmethod
    def note_occurred_normalize(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return normalize_occurred_at_iso(v)


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
    bus_id: str = ""
    trip_id: str = ""


class TripDetail(BaseModel):
    trip_number: int
    start_time: str
    end_time: str
    direction: str = "outward"


class DutyReq(BaseModel):
    driver_license: str
    driver_name: str = ""
    driver_phone: str = ""
    bus_id: str
    route_name: str
    start_point: str
    end_point: str
    date: str
    trips: list = []


class TripKmKeysReq(BaseModel):
    """Keys are ``bus_id|YYYY-MM-DD`` (daily trip row) or optional ``trip_id`` if stored on the document."""

    trip_keys: list[str] = Field(..., min_length=1, max_length=500)


class TripKmExceptionReq(BaseModel):
    """Record administrator action for schedule/kilometre mismatch before first verification."""

    trip_key: str = Field(..., min_length=1, max_length=128)
    action: str = Field(..., min_length=1, max_length=64)
    note: str = Field(..., min_length=3, max_length=2000)
    linked_incident_id: str = Field(default="", max_length=64)


class InfractionReq(BaseModel):
    code: str
    category: str
    description: str
    amount: float
    safety_flag: bool = False
    repeat_escalation: bool = True
    active: bool = True


class InfractionLogReq(BaseModel):
    """Log a Schedule-S infraction instance (billing / ops traceability)."""

    bus_id: str = Field(default="", max_length=64)
    driver_id: str = Field(default="", max_length=64)
    infraction_code: str = Field(..., min_length=1, max_length=64)
    date: str = Field(default="", max_length=32)
    remarks: str = Field(default="", max_length=4000)
    depot: str = Field(default="", max_length=128)
    route_name: str = Field(default="", max_length=256)
    route_id: str = Field(default="", max_length=64)
    trip_id: str = Field(default="", max_length=64)
    duty_id: str = Field(default="", max_length=64)
    location_text: str = Field(default="", max_length=512)
    cause_code: str = Field(default="", max_length=64)
    deductible: bool | None = None
    related_incident_id: str = Field(default="", max_length=64)


class InfractionCloseReq(BaseModel):
    status: str = Field(default="closed", max_length=32)
    close_remarks: str = Field(default="", max_length=4000)


class BillingWorkflowReq(BaseModel):
    invoice_id: str
    action: str
    remarks: str = ""


class BusinessRuleReq(BaseModel):
    rule_key: str
    rule_value: str
    category: str = "general"
    description: str = ""
