"""
Specific energy (kWh/km) by bus_type — single source for API, energy report, billing, and seed data.
Aligned with fleet master create/update (`kwh_per_km` on buses).
"""

from __future__ import annotations

# Keys must match BusReq.bus_type options in the UI/API.
KWH_PER_KM_BY_BUS_TYPE: dict[str, float] = {
    "12m_ac": 1.3,
    "9m_ac": 1.0,
    "12m_non_ac": 1.1,
    "9m_non_ac": 0.8,
}

DEFAULT_KWH_PER_KM = 1.0


def kwh_per_km_for_bus_type(bus_type: str | None) -> float:
    bt = (bus_type or "").strip()
    return float(KWH_PER_KM_BY_BUS_TYPE.get(bt, DEFAULT_KWH_PER_KM))
