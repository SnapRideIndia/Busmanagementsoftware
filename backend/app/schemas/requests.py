"""Pydantic request/entity models for API validation."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.domain.incident_evidence import normalize_occurred_at_iso
from app.domain.incident_types import IncidentChannel, IncidentSeverity, IncidentStatus
from app.domain.infractions_master import normalize_catalog_infraction_code
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
    total_trips: int = 0


class ForgotPasswordReq(BaseModel):
    email: str


class ResetPasswordReq(BaseModel):
    token: str
    new_password: str


class TenderReq(BaseModel):
    tender_id: str
    concessionaire: str = ""
    pk_rate: float
    energy_rate: float
    description: str = ""
    status: str = "active"
    # Article 22.3.1 — minimum average scheduled bus-km per bus per contract year for the lot ([●] in agreement).
    annual_assured_bus_km: float = Field(default=0, ge=0, le=1_000_000)


class DepotReq(BaseModel):
    """Depot master record; `name` is the value stored on buses and operational data."""

    name: str = Field(..., min_length=1, max_length=128)
    code: str = Field(default="", max_length=32)
    address: str = Field(default="", max_length=512)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
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


class TerminalMasterCreateReq(BaseModel):
    """Major bus stand / terminal; links to existing stop_master rows for route mapping."""

    terminal_id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=160)
    locality: str = Field(default="", max_length=160)
    landmark: str = Field(default="", max_length=256)
    region: str = Field(default="Hyderabad", max_length=128)
    linked_stop_ids: list[str] = Field(..., min_length=1)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    active: bool = True
    notes: str = Field(default="", max_length=500)


class TerminalMasterUpdateReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    locality: str = Field(default="", max_length=160)
    landmark: str = Field(default="", max_length=256)
    region: str = Field(default="Hyderabad", max_length=128)
    linked_stop_ids: list[str] = Field(..., min_length=1)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    active: bool = True
    notes: str = Field(default="", max_length=500)


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
    encoded_polyline: str = Field(
        default="",
        max_length=200000,
        description="Google-encoded polyline for map display (optional).",
    )
    alternate_charging_stop_id: str = Field(
        default="",
        max_length=64,
        description="Stop ID from this route's sequence used as alternate EV charging point.",
    )
    charging_point_status: str = Field(
        default="unknown",
        max_length=32,
        description="Operational status of that charging point for list/analytics.",
    )


class RouteCreateReq(RouteUpdateReq):
    route_id: str = Field(..., min_length=1, max_length=64)


class GeofencePathPointReq(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class GeofenceUpsertReq(BaseModel):
    geofence_id: str = Field(default="", max_length=80)
    type: str = Field(default="stop", pattern="^(stop|terminal|depot|route)$")
    entity_ref: str = Field(default="", max_length=128)
    geometry_type: str = Field(default="circle", pattern="^(circle|polygon|polyline_buffer)$")
    center_lat: float | None = Field(default=None, ge=-90, le=90)
    center_lng: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float | None = Field(default=None, ge=1, le=10000)
    buffer_m: float | None = Field(default=None, ge=1, le=10000)
    path_points: list[GeofencePathPointReq] = Field(default_factory=list)
    source: str = Field(default="manual", max_length=40)
    active: bool = True
    version: int = Field(default=1, ge=1, le=999999)
    effective_from: str = Field(default="")
    notes: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_shape(self):
        if self.geometry_type == "circle":
            if self.center_lat is None or self.center_lng is None:
                raise ValueError("center_lat and center_lng are required for circle geofences")
            if self.radius_m is None:
                raise ValueError("radius_m is required for circle geofences")
        elif self.geometry_type == "polygon":
            if len(self.path_points) < 3:
                raise ValueError("polygon geofence requires at least 3 path points")
        elif self.geometry_type == "polyline_buffer":
            if len(self.path_points) < 2:
                raise ValueError("polyline_buffer geofence requires at least 2 path points")
            if self.buffer_m is None:
                raise ValueError("buffer_m is required for polyline_buffer geofences")
        return self


class GeofenceBootstrapReq(BaseModel):
    include_stops: bool = True
    include_depots: bool = True
    include_routes: bool = True
    include_terminals: bool = True
    source: str = Field(default="auto_seeded", max_length=40)
    overwrite_existing: bool = False


class BusReq(BaseModel):
    bus_id: str
    bus_type: str = "12m_ac"
    capacity: int = 40
    tender_id: str = ""
    depot: str = ""
    status: str = "active"
    # Optional display override (km/year) when tender has no Annual Assured yet — demo / manual assignment.
    annual_assured_km_override: float = Field(default=0, ge=0, le=1_000_000)


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
    tariff_rate: float

    @field_validator("bus_id")
    @classmethod
    def bus_id_non_empty(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("Bus is required")
        return s

    @field_validator("date")
    @classmethod
    def date_non_empty(cls, v: str) -> str:
        s = (v or "").strip()
        if len(s) < 10:
            raise ValueError("Date is required (YYYY-MM-DD)")
        return s[:10]

    @field_validator("units_charged")
    @classmethod
    def units_positive(cls, v: float) -> float:
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise ValueError("Units (kWh) must be a number")
        if x <= 0:
            raise ValueError("Units (kWh) must be greater than 0")
        return x

    @field_validator("tariff_rate")
    @classmethod
    def tariff_non_negative(cls, v: float) -> float:
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise ValueError("Tariff must be a number")
        if x <= 0:
            raise ValueError("Tariff (Rs/kWh) must be greater than 0")
        return x


class InfractionEntryReq(BaseModel):
    """One infraction code to embed in an incident."""

    code: str = Field(default="O08", max_length=16)
    deductible: bool = True

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_infraction_key(cls, data: object) -> object:
        """Accept `infraction_code` from UI payloads as alias for `code`."""
        if isinstance(data, dict) and data.get("code") in (None, "") and data.get("infraction_code"):
            return {**data, "code": data["infraction_code"]}
        return data

    @field_validator("code", mode="before")
    @classmethod
    def code_normalize(cls, v: object) -> str:
        return normalize_catalog_infraction_code(v)


class IncidentCreateReq(BaseModel):
    incident_type: str = Field(default="", max_length=64)
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
    channel: str = Field(default=IncidentChannel.MANUAL.value)
    telephonic_reference: str = Field(default="", max_length=64)
    infractions: list[InfractionEntryReq] = Field(default_factory=list)

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

    @field_validator("channel", mode="before")
    @classmethod
    def channel_ok(cls, v: object) -> str:
        allowed = {e.value for e in IncidentChannel}
        s = str(v or "").strip().lower()
        legacy = {"web": "manual", "telephonic": "manual", "mobile": "manual", "other": "manual"}
        if s in legacy:
            s = legacy[s]
        if s not in allowed:
            s = IncidentChannel.MANUAL.value
        return s


class IncidentUpdateReq(BaseModel):
    status: Optional[str] = None
    assigned_team: Optional[str] = Field(default=None, max_length=128)
    assigned_to: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, min_length=1, max_length=8000)
    resolved_at: Optional[str] = None
    occurred_at: Optional[str] = None
    vehicles_affected: Optional[list[str]] = None
    vehicles_affected_count: Optional[int] = Field(default=None, ge=1, le=999)
    damage_summary: Optional[str] = Field(default=None, max_length=4000)
    engineer_action: Optional[str] = Field(default=None, max_length=4000)
    infractions: Optional[list[InfractionEntryReq]] = None

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

    @field_validator("resolved_at")
    @classmethod
    def resolved_at_update_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        s = (v or "").strip()
        if not s:
            return ""
        return normalize_occurred_at_iso(s)

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


# Non-deductible (authority/traffic-style) + deductible Staff 1a–c & Mechanical 2a–c (lost-km heads).
DUTY_TRIP_CANCEL_REASON_CODES = frozenset(
    {
        "force_majeure",
        "bus_safety_measure",
        "authority_default",
        "maintenance_depot_delay",
        "road_accident_not_operator_fault",
        "power_supply_failure",
        "operational_route_blockade",
        "authority_govt_instruction",
        "staff_insufficient_cover",
        "staff_sickness_on_duty",
        "staff_suspension_no_replacement",
        "mech_insufficient_buses",
        "mech_non_serviceable_bus",
        "mech_breakdown_en_route",
    }
)


class DutyTripReq(BaseModel):
    """One row on a duty: a **trip** leg or a **break** (e.g. lunch) between legs.

    For ``segment_type=\"trip\"``: ``start_time`` / ``end_time`` are scheduled departure / arrival.
    For ``segment_type=\"break\"``: same time fields are the break window; ``trip_id`` stays empty server-side.

    ``trip_id`` is not accepted from the client for trips; the API sets ``{duty_id}-T{n}`` on create/update.
    """

    segment_type: Literal["trip", "break"] = "trip"
    # When segment_type is break: short label for UI / SMS (e.g. lunch, rest).
    break_label: str = Field(default="lunch", max_length=64)
    trip_number: int
    trip_id: str = ""
    start_point: str = ""
    end_point: str = ""
    start_time: str = ""
    end_time: str = ""
    direction: str = "outward"
    actual_start_time: str = ""
    actual_end_time: str = ""
    trip_status: str = Field(default="scheduled", max_length=32)
    cancel_reason_code: str = Field(default="none", max_length=64)
    cancel_reason_custom: str = Field(default="", max_length=500)
    # Operator-entered 0–100% leg status (each trip is a full route leg, e.g. A→B / B→A; not combined across trips).
    manual_status_pct: float | None = None
    # Log cancelled trips to incidents (Schedule S O13/O14/O15 from manual %) only when duty attribution is operator_fault.
    add_to_incidents: bool = False

    @field_validator("trip_status", mode="before")
    @classmethod
    def coerce_legacy_trip_status(cls, v: object) -> object:
        s = str(v or "").strip().lower()
        if s == "not_operated":
            return "cancelled"
        return v

    @model_validator(mode="after")
    def validate_cancel_reason(self):
        if (self.segment_type or "trip") == "break":
            return self
        st = (self.trip_status or "").strip().lower()
        if st == "completed":
            raise ValueError("trip_status 'completed' is reserved for TIM/system updates and cannot be set manually")
        if st == "cancelled":
            code = (self.cancel_reason_code or "").strip().lower()
            if code in ("", "none"):
                raise ValueError("cancel_reason_code is required when trip_status is cancelled")
            if code not in DUTY_TRIP_CANCEL_REASON_CODES:
                raise ValueError("cancel_reason_code is invalid for cancelled trip")
        return self

    @field_validator("manual_status_pct", mode="before")
    @classmethod
    def validate_manual_status_pct(cls, v: object) -> object:
        if v is None or v == "":
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        if x < 0 or x > 100:
            raise ValueError("manual_status_pct must be between 0 and 100")
        return round(x, 1)


class DutyCancelFollowingReq(BaseModel):
    """Cancel all legs after ``after_trip_number`` that are not yet completed (round-trip cascade)."""

    after_trip_number: int = Field(..., ge=1)
    cancel_reason_code: str = Field(..., min_length=1, max_length=64)
    cancel_reason_custom: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_reason(self):
        code = (self.cancel_reason_code or "").strip().lower()
        if code not in DUTY_TRIP_CANCEL_REASON_CODES:
            raise ValueError("cancel_reason_code is invalid")
        return self


class DutyTemplateReq(BaseModel):
    template_name: str = Field(..., min_length=1, max_length=128)
    active: bool = True
    driver_license: str
    conductor_id: str = ""
    bus_id: str
    route_id: str = Field(..., min_length=1, max_length=64)
    # Snapshot fields (filled from route master on save).
    route_name: str = Field(default="", max_length=256)
    start_point: str = Field(default="", max_length=256)
    end_point: str = Field(default="", max_length=256)
    punctuality_scheduled_departure: str = ""
    punctuality_scheduled_arrival: str = ""
    trips: list[DutyTripReq] = Field(default_factory=list)
    notes: str = Field(default="", max_length=2000)


class DutyTemplateUpdateReq(BaseModel):
    template_name: str | None = None
    active: bool | None = None
    driver_license: str | None = None
    conductor_id: str | None = None
    bus_id: str | None = None
    route_id: str | None = None
    punctuality_scheduled_departure: str | None = None
    punctuality_scheduled_arrival: str | None = None
    trips: list[DutyTripReq] | None = None
    notes: str | None = None


class DutyReq(BaseModel):
    template_id: str = Field(default="", max_length=64)
    driver_license: str
    driver_name: str = ""
    driver_phone: str = ""
    conductor_id: str = ""
    conductor_name: str = ""
    conductor_phone: str = ""
    bus_id: str
    route_id: str = Field(..., min_length=1, max_length=64)
    # Snapshot fields (filled from route master on save).
    route_name: str = Field(default="", max_length=256)
    start_point: str = Field(default="", max_length=256)
    end_point: str = Field(default="", max_length=256)
    punctuality_scheduled_departure: str = ""
    punctuality_scheduled_arrival: str = ""
    punctuality_actual_departure: str = ""
    punctuality_actual_arrival: str = ""
    date: str = ""
    trips: list[DutyTripReq] = Field(default_factory=list)
    # One combined Schedule S / Article 20 infraction record for the duty (trips + cancellations in one row).
    schedule_s_single_infraction: bool = False
    attribution_context: str = Field(default="", max_length=64)
    duty_exception_reason: str = Field(default="", max_length=2000)
    punctuality_review: dict = Field(default_factory=dict)
    duty_dates: list[dict] = Field(default_factory=list)


class DutyUpdateReq(BaseModel):
    """Partial update for PUT /duties/{id}. Only fields present in the JSON body are applied."""

    template_id: str | None = None
    driver_license: str | None = None
    conductor_id: str | None = None
    bus_id: str | None = None
    route_id: str | None = None
    punctuality_scheduled_departure: str | None = None
    punctuality_scheduled_arrival: str | None = None
    punctuality_actual_departure: str | None = None
    punctuality_actual_arrival: str | None = None
    date: str | None = None
    trips: list[DutyTripReq] | None = None
    schedule_s_single_infraction: bool | None = None
    attribution_context: str | None = None
    duty_exception_reason: str | None = None
    punctuality_review: dict | None = None
    duty_dates: list[dict] | None = None


class TripKmKeysReq(BaseModel):
    """Keys are ``bus_id|YYYY-MM-DD`` (daily trip row) or optional ``trip_id`` if stored on the document."""

    trip_keys: list[str] = Field(..., min_length=1, max_length=500)


class TripKmExceptionReq(BaseModel):
    """Record administrator action for schedule/kilometre mismatch before first verification."""

    trip_key: str = Field(..., min_length=1, max_length=128)
    action: str = Field(..., min_length=1, max_length=64)
    note: str = Field(..., min_length=3, max_length=2000)
    linked_incident_id: str = Field(default="", max_length=64)


class TripKmTrackingEditReq(BaseModel):
    """KM Tracking: edit scheduled/actual on trip_data (trip_key = trip_id or bus_id|YYYY-MM-DD). Optional note."""

    trip_key: str = Field(..., min_length=1, max_length=128)
    scheduled_km: float = Field(ge=0, le=2000)
    actual_km: float = Field(ge=0, le=2000)
    reason: str = Field(default="", max_length=2000)
    # When omitted, existing trip_data.km_tracking_add_to_infractions is preserved for backward compatibility.
    add_to_infractions: bool | None = None


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


class BillingInvoicePatchReq(BaseModel):
    """Manual billing status and milestone dates (canonical workflow: draft → submitted → paid)."""

    status: str | None = None
    submitted_at: str | None = None  # YYYY-MM-DD or empty to clear
    paid_at: str | None = None


class BusinessRuleReq(BaseModel):
    rule_key: str
    rule_value: str
    category: str = "general"
    description: str = ""
