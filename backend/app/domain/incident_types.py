"""
Canonical incident taxonomy for IRMS (TGSRTC EBMS §9.28, §4 alerts, §5 rules, §7 reports).
Single source of truth for validation, UI dropdowns, and GCC KPI linkage.
See docs/TRACEBILITY_INCIDENT_TYPES.md for clause → code mapping.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Final


class IncidentChannel(str, Enum):
    """Source: system (ITS/automated) vs manual (staff / phone / ad-hoc)."""

    SYSTEM = "system"
    MANUAL = "manual"


class IncidentSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class IncidentStatus(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


# Default teams depot staff can assign to (SOP workflow); extend via settings later.
DEFAULT_ASSIGNMENT_TEAMS: Final[tuple[str, ...]] = (
    "Depot Maintenance",
    "Depot Traffic",
    "Regional Control",
    "HQ Safety",
    "ITS Vendor",
    "Charging O&M",
    "Legal / Claims",
)

# Tender TGSRTC EBMS: §4 "Type of Instances for Alerts" (a–g), then §5 rules, §7 reports, scope (g).
# Dropdown order follows §4 first, then breakdown/accident and other named reports, then extended IRMS.

def _row(
    code: str,
    label: str,
    category: str,
    *,
    reliability_bd: bool = False,
    safety_minor: bool = False,
    safety_major: bool = False,
) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "category": category,
        "counts_for_reliability_breakdown": reliability_bd,
        "counts_for_safety_maf_minor": safety_minor,
        "counts_for_safety_major": safety_major,
    }


# §4 alerts (email & dashboard) — exact tender list, order a–g
_SECTION_4_ALERT_TYPES: Final[tuple[dict[str, Any], ...]] = (
    _row("PANIC_OR_SECURITY", "Panic alert", "safety", safety_major=True),
    _row("OVERSPEED", "Over speed (threshold set in business rules)", "operations"),
    _row("ITS_GPS_FAILURE", "GPS breakage (ITS / AIS-140)", "asset"),
    _row("IDLE_EXCESS", "Idle report", "operations"),
    _row("ROUTE_DEVIATION", "Route deviation", "operations"),
    _row("BUNCHING_ALERT", "Bunching report (user-defined)", "operations"),
    _row("HARNESS_REMOVAL", "Harness removal (disconnection)", "asset"),
)

# §5 business rules (overspeed critical — distinct from §4 over speed)
_SECTION_5_RULE_TYPES: Final[tuple[dict[str, Any], ...]] = (
    _row("OVERSPEED_CRITICAL", "Over speed — critical (per business rules)", "operations"),
)

# Scope (g) breakdown / accident + §7 incident-style reports
_SCOPE_AND_SECTION_7_TYPES: Final[tuple[dict[str, Any], ...]] = (
    _row("BREAKDOWN", "Breakdown", "operations", reliability_bd=True),
    _row("ACCIDENT", "Accident", "safety", safety_minor=True, safety_major=True),
    _row("TRIP_NOT_STARTED_ORIGIN", "Trip not started from origin", "operations"),
    _row("TRIP_NOT_COMPLETED", "Trip not completed", "operations"),
    _row("EARLY_LATE_DEPOT_OR_TRIP", "Early / late trip start (or depot outgoing)", "operations"),
    _row("NO_DRIVER_OR_CONDUCTOR", "No driver / no conductor", "operations"),
    _row("DOUBLE_DUTY_DRIVER", "Double duty driver", "operations"),
    _row(
        "SCHEDULE_CURTAILMENT",
        "Schedule curtailment (authorized or unauthorized)",
        "operations",
    ),
)

# Other IRMS cases under scope "any other incidents" — not §4 alert list but valid tickets
_EXTENDED_IRMS_TYPES: Final[tuple[dict[str, Any], ...]] = (
    _row("FIRE_ON_BUS", "Fire on bus or battery thermal event", "safety", reliability_bd=True, safety_major=True),
    _row("CHARGING_INFRA_FAULT", "Charger / depot charging fault", "asset", reliability_bd=True),
    _row("CMS_OR_ENERGY_DATA_FAULT", "CMS / energy metering or data fault", "asset"),
    _row("PASSENGER_COMPLAINT", "Passenger complaint (service quality)", "passenger"),
    _row("PASSENGER_MEDICAL", "Passenger medical emergency", "passenger"),
    _row("DRIVER_CONDUCT", "Driver conduct / discipline", "operations"),
    _row("VANDALISM_OR_THEFT", "Vandalism or theft (vehicle / property)", "asset"),
    _row("ROAD_OR_EXTERNAL", "Road block, strike, external delay", "external"),
    _row("WEATHER_OR_NATURAL", "Weather / natural calamity", "external"),
)

_OTHER_ONLY: Final[tuple[dict[str, Any], ...]] = (
    _row("OTHER", "Other (legacy records only)", "general"),
)

_INCIDENT_TYPE_ROWS: Final[tuple[dict[str, Any], ...]] = (
    _SECTION_4_ALERT_TYPES
    + _SECTION_5_RULE_TYPES
    + _SCOPE_AND_SECTION_7_TYPES
    + _EXTENDED_IRMS_TYPES
    + _OTHER_ONLY
)

# UI grouping (matches tender EBMS §4 / §5 / scope & §7 / extended)
_UI_GROUP_ALERTS: Final[str] = "alerts"
_UI_GROUP_SPEED_RULES: Final[str] = "speed_rules"
_UI_GROUP_REPORTS: Final[str] = "reports"
_UI_GROUP_EXTENDED: Final[str] = "extended"
_UI_GROUP_OTHER: Final[str] = "other"

_CODES_SECTION_4: Final[frozenset[str]] = frozenset(r["code"] for r in _SECTION_4_ALERT_TYPES)
_CODES_SECTION_5: Final[frozenset[str]] = frozenset(r["code"] for r in _SECTION_5_RULE_TYPES)
_CODES_SCOPE_7: Final[frozenset[str]] = frozenset(r["code"] for r in _SCOPE_AND_SECTION_7_TYPES)
_CODES_EXTENDED: Final[frozenset[str]] = frozenset(r["code"] for r in _EXTENDED_IRMS_TYPES)


def _ui_group_for_code(code: str) -> str:
    if code in _CODES_SECTION_4:
        return _UI_GROUP_ALERTS
    if code in _CODES_SECTION_5:
        return _UI_GROUP_SPEED_RULES
    if code in _CODES_SCOPE_7:
        return _UI_GROUP_REPORTS
    if code in _CODES_EXTENDED:
        return _UI_GROUP_EXTENDED
    return _UI_GROUP_OTHER

# Not offered in POST /incidents (legacy / catch-all for unmigrated strings only).
_NON_CREATABLE_CODES: Final[frozenset[str]] = frozenset({"OTHER"})

LEGACY_TYPE_TO_CODE: Final[dict[str, str]] = {
    "accident": "ACCIDENT",
    "breakdown": "BREAKDOWN",
    "route deviation": "ROUTE_DEVIATION",
    "passenger complaint": "PASSENGER_COMPLAINT",
    "driver issue": "DRIVER_CONDUCT",
    "overspeed": "OVERSPEED",
    "over speed critical": "OVERSPEED_CRITICAL",
    "overspeed critical": "OVERSPEED_CRITICAL",
    "gps breakage": "ITS_GPS_FAILURE",
    "idle report": "IDLE_EXCESS",
    "other": "OTHER",
    # Title case legacy from seed
    "Accident": "ACCIDENT",
    "Breakdown": "BREAKDOWN",
    "Route Deviation": "ROUTE_DEVIATION",
    "Passenger Complaint": "PASSENGER_COMPLAINT",
    "Driver Issue": "DRIVER_CONDUCT",
}


def incident_type_codes() -> frozenset[str]:
    return frozenset(row["code"] for row in _INCIDENT_TYPE_ROWS)


def creatable_incident_type_codes() -> frozenset[str]:
    """Codes allowed on new incidents (excludes OTHER)."""
    return incident_type_codes() - _NON_CREATABLE_CODES


def incident_types_public() -> list[dict[str, Any]]:
    """Metadata for API consumers (UI, integrations)."""
    return [
        {
            "code": r["code"],
            "label": r["label"],
            "category": r["category"],
            "ui_group": _ui_group_for_code(r["code"]),
            "counts_for_reliability_breakdown": r["counts_for_reliability_breakdown"],
            "counts_for_safety_kpi": r["counts_for_safety_maf_minor"] or r["counts_for_safety_major"],
        }
        for r in _INCIDENT_TYPE_ROWS
    ]


def incident_types_public_creatable() -> list[dict[str, Any]]:
    """Dropdown list for new IRMS tickets — tender-aligned codes only."""
    return [x for x in incident_types_public() if x["code"] not in _NON_CREATABLE_CODES]


def normalize_incident_type(raw: str | None) -> str:
    """Map legacy free-text or label to canonical code; default OTHER."""
    if not raw:
        return "OTHER"
    s = str(raw).strip()
    if s in incident_type_codes():
        return s
    key = s.lower()
    if key in LEGACY_TYPE_TO_CODE:
        return LEGACY_TYPE_TO_CODE[key]
    if s in LEGACY_TYPE_TO_CODE:
        return LEGACY_TYPE_TO_CODE[s]
    return "OTHER"


def _type_row(code: str) -> dict[str, Any] | None:
    for r in _INCIDENT_TYPE_ROWS:
        if r["code"] == code:
            return r
    return None


def is_breakdown_for_reliability(incident: dict[str, Any]) -> bool:
    code = normalize_incident_type(incident.get("incident_type"))
    row = _type_row(code)
    return bool(row and row["counts_for_reliability_breakdown"])


def safety_kpi_counts(incidents_list: list[dict[str, Any]]) -> tuple[int, int]:
    """
    (minor_for_maf, major_count) per §18-style safety stack.
    Minor MAF: road accident logged as low severity only.
    Major: high-severity accident, any on-bus fire event, or high-severity panic/security.
    """
    minor = 0
    major = 0
    for inc in incidents_list:
        code = normalize_incident_type(inc.get("incident_type"))
        sev = str(inc.get("severity", "")).lower()
        if code == "ACCIDENT":
            if sev == IncidentSeverity.LOW.value:
                minor += 1
            elif sev == IncidentSeverity.HIGH.value:
                major += 1
        elif code == "FIRE_ON_BUS":
            major += 1
        elif code == "PANIC_OR_SECURITY" and sev == IncidentSeverity.HIGH.value:
            major += 1
    return minor, major
