# Idle Time and Missed Stop Implementation Plan

## Purpose
This document captures the implementation blueprint for adding tender-aligned idle-time and missed-stop capabilities to EBMS, assuming concessionaire telemetry/geofence data is available.

It is intended as a future reference for product, backend, frontend, and QA teams.

---

## 1) Scope Clarification (Tender Alignment)

Based on tender extracts in `docs/requirements_&_tender/Tender doc TGSRTC_extracted.txt`, the system should support:

- Bus idle reporting
- Total idle time for selected vehicle
- Idle start (`from`) and end timestamps
- Idle duration
- Idle location
- Missed bus stop visibility
- Dashboard + MIS style reporting and alerts

Interpretation for implementation:

1. **Stop dwell tracking**: how long a bus stops at an authorized stop.
2. **Missed stop detection**: expected stop not served in planned sequence/window.
3. **Idle analytics**: total and detailed idle sessions (at stop / off stop).

---

## 2) Assumptions

- Concessionaire provides telemetry and geofence data feeds.
- Route-stop sequence data exists (or can be mapped) in EBMS.
- Trip/run context can be attached using schedule, duty, or inferred route windows.

---

## 3) Target Data Model

Introduce derived event-level models (collections/tables):

## 3.1 `stop_events`
- `event_id`
- `bus_id`
- `route_id`
- `trip_id` (nullable if unresolved)
- `stop_id`, `stop_name`, `seq`
- `arrived_at`, `departed_at`
- `dwell_seconds`
- `lat`, `lng`
- `geofence_id`
- `source_packet_ids` / `source_ref`
- `quality_flag`, `confidence_score`

## 3.2 `idle_sessions`
- `session_id`
- `bus_id`
- `route_id`
- `trip_id` (nullable)
- `idle_type` (`at_stop`, `off_stop`)
- `started_at`, `ended_at`
- `idle_seconds`
- `start_lat`, `start_lng`, `end_lat`, `end_lng`
- `nearest_stop_id` (nullable)
- `reason_code` (optional derived reason)
- `quality_flag`, `confidence_score`

## 3.3 `missed_stop_events`
- `id`
- `bus_id`
- `route_id`
- `trip_id`
- `stop_id`, `stop_name`, `seq`
- `expected_window_start`, `expected_window_end`
- `detected_at`
- `reason_code` (`no_geofence_hit`, `trip_ended_early`, `telemetry_gap`, etc.)
- `confidence_score`

---

## 4) Derivation Logic

## 4.1 Stop arrival/departure and dwell
- Arrival when bus enters stop geofence and speed <= threshold.
- Departure when bus leaves geofence or speed > threshold for configured duration.
- Dwell = `departed_at - arrived_at`.

## 4.2 Idle session detection
- Idle starts when speed == 0 (or <= epsilon) continuously for configured threshold.
- Idle ends when speed exceeds threshold continuously for configured threshold.
- Tag session as:
  - `at_stop` if majority of idle interval overlaps stop geofence.
  - `off_stop` otherwise.

## 4.3 Missed stop detection
- For each planned stop sequence in a trip/run:
  - Check if corresponding `stop_event` exists in tolerated time window.
  - If absent, create `missed_stop_event`.

## 4.4 Data quality handling
- Deduplicate repeated packets.
- Smooth jitter near geofence edge.
- Mark low-confidence events when packet gaps exceed threshold.

---

## 5) Configurable Business Rules

Store in business rules/config:

- `stop_geofence_radius_m`
- `arrival_speed_max_kmph`
- `departure_speed_min_kmph`
- `min_dwell_seconds`
- `idle_start_threshold_seconds`
- `idle_end_threshold_seconds`
- `missed_stop_window_tolerance_seconds`
- `telemetry_gap_max_seconds`

These should be admin-editable and auditable.

---

## 6) Backend API Plan

## 6.1 Dashboard extension (`GET /api/dashboard`)
Add fields:

- `fleet_idle_minutes_today`
- `avg_dwell_seconds_today`
- `buses_with_excess_idle`
- `missed_stops_today`
- `top_idle_buses` (top N with idle minutes)
- `idle_trend_daily` (for chart)

## 6.2 Detail APIs

- `GET /api/idle/details`
  - Filters: `date_from`, `date_to`, `depot`, `bus_id`, `route_id`, `idle_type`, `page`, `limit`
  - Returns session-level details.

- `GET /api/stops/dwell`
  - Filters: `date_from`, `date_to`, `depot`, `bus_id`, `route_id`, `stop_id`, `page`, `limit`
  - Returns stop dwell records.

- `GET /api/stops/missed`
  - Filters: `date_from`, `date_to`, `depot`, `bus_id`, `route_id`, `trip_id`, `page`, `limit`
  - Returns missed stop events.

## 6.3 Reports integration
Extend existing report catalog and exports with:

- `idle_report`
- `stop_dwell_report`
- `missed_stop_report`

For `/api/reports` and `/api/reports/download` (Excel/PDF), include tender-aligned columns.

---

## 7) Dashboard UX Plan

## Phase 1 (quick visibility)
- Add KPI cards:
  - Idle Time Today (Fleet)
  - Missed Stops Today
- Add "Top Idle Buses" compact list/table.

## Phase 2 (detail section)
- Add dashboard section with tabs:
  - Idle Sessions
  - Stop Dwell
  - Missed Stops
- Support depot/bus/date filtering consistent with existing dashboard filters.

## Phase 3 (drill-through)
- From KPI cards -> open dedicated detail pages or report views with preserved filters.

---

## 8) Alerts Center Integration

Create/align alert types:

- `idle_excess`
- `missed_stop`

Alert Center should show near-real-time notification state.
Detailed idle/missed-stop pages should show persisted analytical events.

---

## 9) Reporting and Downloads

## 9.1 Idle Report (vehicle-level)
Recommended columns:

- `bus_id`
- `date`
- `idle_start_time`
- `idle_end_time`
- `idle_duration_seconds` (and HH:MM:SS)
- `idle_location`
- `idle_type`
- `route_id`
- `trip_id`

## 9.2 Stop Dwell Report
- `bus_id`, `route_id`, `trip_id`
- `stop_id`, `stop_name`, `seq`
- `arrived_at`, `departed_at`
- `dwell_seconds`
- `depot`

## 9.3 Missed Stop Report
- `bus_id`, `route_id`, `trip_id`
- `stop_id`, `stop_name`, `seq`
- `expected_window_start`, `expected_window_end`
- `reason_code`
- `detected_at`

---

## 10) Testing Strategy

## 10.1 Unit tests
- Geofence arrival/departure transitions
- Idle segmentation logic
- Missed-stop rule evaluation
- Threshold boundary checks

## 10.2 Integration tests
- Ingest synthetic telemetry streams for multiple buses/routes
- Verify generated event counts and durations
- Verify API pagination/filter correctness

## 10.3 Acceptance tests (tender alignment)
- Idle report includes start/end/duration/location for selected vehicle.
- Dashboard shows idle and missed-stop KPIs.
- Missed-stop list is filterable and downloadable.

---

## 11) Rollout Plan

1. Backend event derivation + storage
2. New APIs (`idle/details`, `stops/dwell`, `stops/missed`)
3. Dashboard KPI + detail widgets
4. Report types + downloads
5. Alerts Center integration
6. Hardening: data quality metrics + monitoring

---

## 12) Risks and Mitigations

- **Telemetry gaps/noise** -> confidence scoring + gap flags.
- **Trip mapping ambiguity** -> fallback route-day mapping and explicit unknown tags.
- **Geofence mismatch** -> versioned geofence source and validation reports.
- **Performance with scale** -> indexed time-series queries + pre-aggregation jobs.

---

## 13) Open Decisions (Before Build)

- Source of truth for trip assignment if concessionaire payload lacks `trip_id`.
- SLA thresholds for "excess idle" and "missed stop" escalation.
- Whether missed-stop detection should be strict by sequence or tolerant by route window.
- Required archival/retention policy for telemetry-derived events.

---

## 14) Suggested File Touchpoints (Codebase)

- Backend:
  - `backend/app/api/v1/routes.py` (API contracts)
  - New service module(s), e.g. `backend/app/services/idle_analytics.py`
  - Seed/test data updates in `backend/app/core/seed.py`
- Frontend:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/ReportsPage.js`
  - New detail pages for idle and missed stops (if separated)
- Tests:
  - `backend_test.py`
  - frontend page/API integration tests as applicable

