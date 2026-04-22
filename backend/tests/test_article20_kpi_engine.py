from app.services.gcc_engine import compute_kpi_damages


def _base_rules() -> dict[str, str]:
    return {
        "reliability_target": "0.5",
        "availability_target": "95",
        "punctuality_start_target": "90",
        "punctuality_arrival_target": "80",
        "frequency_target": "94",
        "frequency_trip_target": "94",
        "frequency_bus_km_target": "94",
        "safety_maf_target": "0.01",
        "kpi_damages_cap_pct": "10",
        "incentive_cap_pct": "5",
    }


def test_reliability_formula_and_step_penalty():
    rules = _base_rules()
    monthly_fee = 100000.0
    incidents = [{"incident_type": "BREAKDOWN"}]
    out = compute_kpi_damages(
        monthly_fee,
        trips=[],
        buses=[],
        incidents_list=incidents,
        bus_km=10000.0,
        rules=rules,
    )
    rel = out["categories"]["reliability"]
    assert rel["bf"] == 1.0
    # (1.0-0.5)/0.1 = 5 steps => 5 * 0.1% of monthly_fee = 500
    assert rel["damages"] == 500.0


def test_punctuality_incentive_counts_start_and_arrival_excess():
    rules = _base_rules()
    monthly_fee = 100000.0
    trips = [{"punctuality_start_on_time": True, "punctuality_arrival_on_time": True} for _ in range(10)]
    out = compute_kpi_damages(
        monthly_fee,
        trips=trips,
        buses=[],
        incidents_list=[],
        bus_km=1.0,
        rules=rules,
    )
    punct = out["categories"]["punctuality"]
    # Start excess 10 + arrival excess 20 = 30 percentage points.
    assert punct["incentive"] == 1500.0


def test_frequency_uses_trip_and_bus_km_with_anti_double_count():
    rules = _base_rules()
    monthly_fee = 100000.0
    # 10 trips x 100 scheduled km.
    # 9 trips completed (explicit status); 1 short on km — not completed at 100% threshold.
    # trip_freq = 90% (shortfall 4), bus_km_freq = 76% (shortfall 18)
    trips = [{"scheduled_km": 100, "actual_km": 80, "trip_status": "completed"} for _ in range(9)] + [
        {"scheduled_km": 100, "actual_km": 40}
    ]
    out = compute_kpi_damages(
        monthly_fee,
        trips=trips,
        buses=[],
        incidents_list=[],
        bus_km=sum(t["actual_km"] for t in trips),
        rules=rules,
    )
    freq = out["categories"]["frequency"]
    assert freq["trip_freq_pct"] == 90.0
    assert freq["bus_km_freq_pct"] == 76.0
    # anti-double-count: 4% + (18%-4%) = 18% of monthly fee
    assert freq["damages"] == 18000.0


def test_first_30_day_relaxation_applies_to_non_safety_only():
    rules = _base_rules()
    rules["first_30_day_active"] = "1"
    rules["first_30_day_kpi_relaxation_pct"] = "25"
    out = compute_kpi_damages(
        monthly_fee=100000.0,
        trips=[],
        buses=[],
        incidents_list=[{"incident_type": "BREAKDOWN"}],
        bus_km=16666.67,  # BF ~= 0.6
        rules=rules,
    )
    rel = out["categories"]["reliability"]
    safety = out["categories"]["safety"]
    assert rel["target"] == 0.625
    # Safety target should stay fixed per article 20.12.
    assert safety["maf_target"] == 0.01
