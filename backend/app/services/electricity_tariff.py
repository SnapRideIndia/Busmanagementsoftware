"""
Clause 22.5.2 — Electricity tariff variation (PM Agreement illustration, e.g. PM E drive §22.5.2 table).

A = Allowed Energy Consumption (kWh), B = Base Electricity Tariff (INR/unit), C = Actual Electricity Tariff (INR/unit),
D/G = metered / billed units by DISCOM.

Case 1 — Metered (D) > A: variation units E = A; Authority pays F = E × (C − B). (Illustration: A=7410, D=8000 → E=7410.)
Case 2 — Metered ≤ A: variation units H = metered; Authority pays I = H × (C − B). (Illustration: G=7000 → H=7000.)

If C ≤ B, no compensation for tariff increase (adjustment Rs = 0).

For billing, **B** and **C** are taken from **Business rules** (Billing). Each energy row must still carry **tariff_rate** (DISCOM billed Rs/kWh) for validation and audit; it does not replace **C** on the invoice.
"""

from __future__ import annotations


class EnergyRowTariffError(ValueError):
    """Charging row has kWh but no valid Actual Electricity Tariff (Rs/kWh)."""


def energy_row_actual_tariff_inr_per_kwh(units_charged: float, raw_tariff_rate: object, *, bus_id: str = "", date: str = "") -> float:
    """Clause 22.5.2 — when units are billed, Actual tariff must be present on the row (no silent default)."""
    u = float(units_charged or 0)
    if u <= 0:
        return 0.0
    if raw_tariff_rate is None or str(raw_tariff_rate).strip() == "":
        raise EnergyRowTariffError(
            f"Missing tariff_rate (Actual Electricity Tariff Rs/kWh) for charging row — bus={bus_id or '?'}, date={date or '?'}."
        )
    try:
        v = float(str(raw_tariff_rate).strip())
    except (TypeError, ValueError) as ex:
        raise EnergyRowTariffError(f"Invalid tariff_rate {raw_tariff_rate!r} (bus={bus_id}, date={date}).") from ex
    if v < 0:
        raise EnergyRowTariffError(f"tariff_rate must be >= 0 (bus={bus_id}, date={date}).")
    return v


def clause_22_5_2_variation_rs(
    allowed_kwh: float,
    metered_kwh: float,
    base_tariff_inr_per_kwh: float,
    actual_tariff_inr_per_kwh: float,
) -> tuple[float, float]:
    """Returns (variation_units_E, adjustment_rs)."""
    a = max(0.0, float(allowed_kwh or 0))
    d = max(0.0, float(metered_kwh or 0))
    b = max(0.0, float(base_tariff_inr_per_kwh or 0))
    c = max(0.0, float(actual_tariff_inr_per_kwh or 0))
    delta = max(0.0, c - b)
    e = a if d > a else d
    adj = round(e * delta, 2)
    return round(e, 4), adj
