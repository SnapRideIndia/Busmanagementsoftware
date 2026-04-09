"""
Maps Schedule-S infraction codes to canonical IRMS incident_type codes and alert centre rows.

Used when incident_type is omitted and penalties define the case, and to keep alerts ↔ incidents aligned.
"""

from __future__ import annotations

from typing import Final

# Primary infraction code -> canonical incident_type (creatable codes only).
INFRACTION_CODE_TO_INCIDENT_TYPE: Final[dict[str, str]] = {
    # Speed / discipline (E)
    "E01": "OVERSPEED",
    "E02": "DRIVER_CONDUCT",
    "E03": "OVERSPEED",
    "E04": "OVERSPEED",
    # Route / ITS / quality (B)
    "B05": "BUNCHING_ALERT",
    "B06": "ROUTE_DEVIATION",
    "B07": "ITS_GPS_FAILURE",
    "B08": "ITS_GPS_FAILURE",
    # Operations / delays (A, C)
    "A12": "IDLE_EXCESS",
    "C08": "ROUTE_DEVIATION",
    "C09": "HARNESS_REMOVAL",
    "C04": "ACCIDENT",
    "C10": "PASSENGER_COMPLAINT",
    "C12": "BREAKDOWN",
    "C13": "PASSENGER_COMPLAINT",
    "O01": "BREAKDOWN",
    "O02": "PASSENGER_COMPLAINT",
    "O03": "PANIC_OR_SECURITY",
    "O04": "PASSENGER_COMPLAINT",
    "O05": "PASSENGER_COMPLAINT",
    # Safety / major
    "D02": "ACCIDENT",
    "D06": "PANIC_OR_SECURITY",
    "D07": "PANIC_OR_SECURITY",
    "F01": "BREAKDOWN",
    "G01": "ACCIDENT",
    "O08": "PASSENGER_COMPLAINT",
    "O09": "BREAKDOWN",
    "O10": "BREAKDOWN",
    "O11": "ITS_GPS_FAILURE",
    "O12": "PASSENGER_COMPLAINT",
}

# Tender §4 alert_code (synthetic feed) -> (incident_type, default_infraction_code)
ALERT_CODE_TO_INCIDENT_AND_INFRACTION: Final[dict[str, tuple[str, str]]] = {
    "panic": ("PANIC_OR_SECURITY", "O03"),
    "overspeed_user": ("OVERSPEED", "E01"),
    "gps_breakage": ("ITS_GPS_FAILURE", "B08"),
    "idle": ("IDLE_EXCESS", "A12"),
    "route_deviation": ("ROUTE_DEVIATION", "B06"),
    "bunching_user": ("BUNCHING_ALERT", "B05"),
    "harness_removal": ("HARNESS_REMOVAL", "C09"),
}


def infer_incident_type_from_infraction_code(code: str | None) -> str:
    """Return a creatable incident_type; defaults to PASSENGER_COMPLAINT when unknown."""
    c = str(code or "").strip().upper()
    if not c:
        return "PASSENGER_COMPLAINT"
    return INFRACTION_CODE_TO_INCIDENT_TYPE.get(c, "PASSENGER_COMPLAINT")
