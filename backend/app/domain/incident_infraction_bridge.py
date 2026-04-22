"""
Maps Schedule-S infraction codes to canonical IRMS incident_type codes and alert centre rows.

No fallback inference is allowed: every infraction code must be explicitly mapped.
"""

from __future__ import annotations

from typing import Final

from app.domain.infractions_master import MASTER_BY_CODE, normalize_catalog_infraction_code

# Primary infraction code -> canonical incident_type (creatable codes only).
# Reviewed explicitly per code to avoid broad prefix fallbacks.
INFRACTION_CODE_TO_INCIDENT_TYPE: Final[dict[str, str]] = {
    # Table A
    "A01": "BREAKDOWN",
    "A02": "BREAKDOWN",
    "A03": "BREAKDOWN",
    "A04": "BREAKDOWN",
    "A05": "BREAKDOWN",
    "A06": "BREAKDOWN",
    "A07": "BREAKDOWN",
    "A08": "BREAKDOWN",
    "A09": "DRIVER_CONDUCT",
    "A10": "DRIVER_CONDUCT",
    "A11": "ROUTE_DEVIATION",
    "A12": "IDLE_EXCESS",
    "A13": "EARLY_LATE_DEPOT_OR_TRIP",
    "A14": "DRIVER_CONDUCT",
    "A15": "PASSENGER_COMPLAINT",
    "A16": "EARLY_LATE_DEPOT_OR_TRIP",
    "A17": "PASSENGER_COMPLAINT",
    "A18": "PASSENGER_COMPLAINT",
    "A19": "PASSENGER_COMPLAINT",
    "A20": "PASSENGER_COMPLAINT",
    # Table B
    "B01": "BREAKDOWN",
    "B02": "BREAKDOWN",
    "B03": "BREAKDOWN",
    "B04": "BREAKDOWN",
    "B05": "BUNCHING_ALERT",
    "B06": "ROUTE_DEVIATION",
    "B07": "BREAKDOWN",
    "B08": "ITS_GPS_FAILURE",
    "B09": "PASSENGER_COMPLAINT",
    "B10": "PASSENGER_COMPLAINT",
    "B11": "PASSENGER_COMPLAINT",
    "B12": "PASSENGER_COMPLAINT",
    "B13": "PASSENGER_COMPLAINT",
    # Table C
    "C01": "BREAKDOWN",
    "C02": "DRIVER_CONDUCT",
    "C03": "DRIVER_CONDUCT",
    "C04": "ACCIDENT",
    "C05": "DRIVER_CONDUCT",
    "C06": "DRIVER_CONDUCT",
    "C07": "BREAKDOWN",
    "C08": "ROUTE_DEVIATION",
    "C09": "HARNESS_REMOVAL",
    "C10": "DRIVER_CONDUCT",
    "C11": "DOUBLE_DUTY_DRIVER",
    "C12": "BREAKDOWN",
    "C13": "PASSENGER_COMPLAINT",
    "C14": "PASSENGER_COMPLAINT",
    "C15": "PASSENGER_COMPLAINT",
    "C16": "PASSENGER_COMPLAINT",
    "C17": "BREAKDOWN",
    # Table D
    "D01": "BREAKDOWN",
    "D02": "ACCIDENT",
    "D03": "DRIVER_CONDUCT",
    "D04": "DRIVER_CONDUCT",
    "D05": "DRIVER_CONDUCT",
    "D06": "PANIC_OR_SECURITY",
    "D07": "PANIC_OR_SECURITY",
    # Table E/F/G
    "E01": "OVERSPEED",
    "E02": "DRIVER_CONDUCT",
    "E03": "OVERSPEED",
    "E04": "OVERSPEED",
    "F01": "BREAKDOWN",
    "G01": "ACCIDENT",
    # O-series / 16.6 / Table H
    "O01": "BREAKDOWN",
    "O02": "ITS_GPS_FAILURE",
    "O03": "PANIC_OR_SECURITY",
    "O04": "PASSENGER_MEDICAL",
    "O05": "ROAD_OR_EXTERNAL",
    "O08": "SCHEDULE_CURTAILMENT",
    "O09": "TRIP_NOT_STARTED_ORIGIN",
    "O10": "TRIP_NOT_COMPLETED",
    "O11": "ITS_GPS_FAILURE",
    "O12": "ROAD_OR_EXTERNAL",
    "O13": "BREAKDOWN",
    "O14": "TRIP_NOT_STARTED_ORIGIN",
    "O15": "EARLY_LATE_DEPOT_OR_TRIP",
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
    "geofence_entry": ("ROUTE_DEVIATION", "O08"),
    "geofence_exit": ("ROUTE_DEVIATION", "O08"),
    "stop_geofence_speed": ("OVERSPEED", "E01"),
}


def _validate_complete_mapping() -> None:
    known_codes = set(MASTER_BY_CODE.keys())
    mapped_codes = set(INFRACTION_CODE_TO_INCIDENT_TYPE.keys())
    missing = sorted(known_codes - mapped_codes)
    extra = sorted(mapped_codes - known_codes)
    if missing or extra:
        raise RuntimeError(
            "INFRACTION_CODE_TO_INCIDENT_TYPE must be exhaustive and exact. "
            f"missing={missing} extra={extra}"
        )


def infer_incident_type_from_infraction_code(code: str | None) -> str:
    """Return incident_type from strict explicit mapping (no fallback inference)."""
    c = normalize_catalog_infraction_code(code)
    if c in INFRACTION_CODE_TO_INCIDENT_TYPE:
        return INFRACTION_CODE_TO_INCIDENT_TYPE[c]
    raise ValueError(f"Infraction code has no explicit incident mapping: {c}")


_validate_complete_mapping()
