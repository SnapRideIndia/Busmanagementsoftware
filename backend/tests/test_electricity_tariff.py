"""Clause 22.5.2 electricity tariff variation (illustration alignment)."""

import pytest

from app.services.electricity_tariff import (
    EnergyRowTariffError,
    clause_22_5_2_variation_rs,
    energy_row_actual_tariff_inr_per_kwh,
)


def test_case_1_metered_exceeds_allowed():
    a = 7410.0
    d = 8000.0
    b = 5.0
    c = 7.0
    e, f = clause_22_5_2_variation_rs(a, d, b, c)
    assert e == 7410.0
    assert f == 14820.0


def test_case_2_metered_at_or_below_allowed():
    a = 7410.0
    g = 7000.0
    b = 5.0
    c = 7.0
    h, i = clause_22_5_2_variation_rs(a, g, b, c)
    assert h == 7000.0
    assert i == 14000.0


def test_no_compensation_when_actual_tariff_not_above_base():
    e, adj = clause_22_5_2_variation_rs(1000, 1200, 7.0, 6.0)
    assert adj == 0.0


def test_energy_row_requires_tariff_when_units_positive():
    assert energy_row_actual_tariff_inr_per_kwh(0, None) == 0.0
    assert energy_row_actual_tariff_inr_per_kwh(10, 7.0) == 7.0
    with pytest.raises(EnergyRowTariffError):
        energy_row_actual_tariff_inr_per_kwh(100, None, bus_id="TS-001", date="2026-01-01")
