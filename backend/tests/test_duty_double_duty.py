"""Duty double-duty (hours) classification."""

from app.services.duty_double_duty import compute_duty_load_fields, merge_driver_day_load_fields


def test_scheduled_span_exceeds_max():
    doc = {
        "trips": [
            {
                "trip_number": 1,
                "segment_type": "trip",
                "start_time": "05:00",
                "end_time": "09:00",
                "actual_start_time": "05:05",
                "actual_end_time": "09:05",
            },
            {
                "trip_number": 2,
                "segment_type": "trip",
                "start_time": "11:00",
                "end_time": "18:30",
                "actual_start_time": "11:02",
                "actual_end_time": "18:32",
            },
        ]
    }
    r = compute_duty_load_fields(doc, max_duty_hours=10.0)
    assert r["double_duty"] is True
    assert r["scheduled_duty_hours"] == 13.5
    assert "driver_day_scheduled_total_exceeds" in r["double_duty_triggers"]


def test_actual_span_exceeds_while_scheduled_under_max():
    doc = {
        "trips": [
            {
                "trip_number": 1,
                "segment_type": "trip",
                "start_time": "09:00",
                "end_time": "12:00",
                "actual_start_time": "09:00",
                "actual_end_time": "12:00",
            },
            {
                "trip_number": 2,
                "segment_type": "trip",
                "start_time": "14:00",
                "end_time": "18:00",
                "actual_start_time": "14:05",
                "actual_end_time": "21:10",
            },
        ]
    }
    r = compute_duty_load_fields(doc, max_duty_hours=10.0)
    assert r["scheduled_duty_hours"] == 9.0
    assert r["actual_duty_hours"] > 10.0
    assert r["double_duty"] is True
    assert "driver_day_actual_total_exceeds" in r["double_duty_triggers"]


def test_break_segments_excluded_from_span():
    doc = {
        "trips": [
            {
                "trip_number": 1,
                "segment_type": "trip",
                "start_time": "09:00",
                "end_time": "11:00",
            },
            {"trip_number": 2, "segment_type": "break", "start_time": "11:00", "end_time": "12:00"},
            {
                "trip_number": 3,
                "segment_type": "trip",
                "start_time": "12:00",
                "end_time": "17:00",
            },
        ]
    }
    r = compute_duty_load_fields(doc, max_duty_hours=10.0)
    assert r["scheduled_duty_hours"] == 8.0
    assert r["double_duty"] is False


def test_two_duties_same_day_combined_scheduled_exceeds_max():
    """Two roster blocks: double duty only when combined hours exceed the cap."""
    duty_a = {
        "trips": [
            {
                "trip_number": 1,
                "segment_type": "trip",
                "start_time": "06:00",
                "end_time": "11:00",
            },
        ]
    }
    duty_b = {
        "trips": [
            {
                "trip_number": 1,
                "segment_type": "trip",
                "start_time": "14:00",
                "end_time": "16:00",
            },
        ]
    }
    group = [duty_a, duty_b]
    ra = merge_driver_day_load_fields(duty_a, group, max_duty_hours=10.0)
    assert ra["scheduled_duty_hours"] == 5.0
    assert ra["driver_day_scheduled_hours_total"] == 7.0
    assert ra["double_duty"] is False

    duty_b["trips"][0]["end_time"] = "20:00"
    group = [duty_a, duty_b]
    rb = merge_driver_day_load_fields(duty_b, group, max_duty_hours=10.0)
    assert rb["driver_day_scheduled_hours_total"] == 11.0
    assert rb["double_duty"] is True
    assert "driver_day_scheduled_total_exceeds" in rb["double_duty_triggers"]
