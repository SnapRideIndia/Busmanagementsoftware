"""Regression tests for strict infraction -> incident type mapping."""

from app.domain.infractions_master import build_master_rows
from app.domain.incident_infraction_bridge import (
    INFRACTION_CODE_TO_INCIDENT_TYPE,
    infer_incident_type_from_infraction_code,
)


def test_a01_not_passenger_complaint():
    assert infer_incident_type_from_infraction_code("A01") == "BREAKDOWN"


def test_c13_passenger_complaint():
    assert infer_incident_type_from_infraction_code("C13") == "PASSENGER_COMPLAINT"


def test_b09_dirty_vehicle_is_passenger_complaint():
    assert infer_incident_type_from_infraction_code("B09") == "PASSENGER_COMPLAINT"


def test_o08_is_schedule_curtailment():
    assert infer_incident_type_from_infraction_code("O08") == "SCHEDULE_CURTAILMENT"


def test_bridge_mapping_covers_all_master_codes():
    master_codes = {row["code"] for row in build_master_rows() if row.get("code")}
    assert set(INFRACTION_CODE_TO_INCIDENT_TYPE.keys()) == master_codes
