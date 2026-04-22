# Geofence Tender Traceability Matrix

This matrix maps tender geofencing clauses to implementation artifacts.

## Clause Mapping

- **Tender 9.18 - create geofence for stops/terminals/depots**
  - Data: `geofences` collection (`type`, `entity_ref`, `geometry_type`, `active`, `source`)
  - API: `/api/geofences` CRUD (deterministic IDs: `STOP-*`, `TERM-*`, `DEPOT-*`, `ROUTE-*` aligned with `POST /api/geofences/bootstrap`)
  - UI: **Geofences map console** on `GeofencesPage` — three-pane layout (asset list with filters and sync state, map with drawing tools, identity/geometry panel); circle, polygon, rectangle, and route corridor; `source=map_console`; status on Stops/Routes pages

- **Tender 9.18 - associate entry/exit alarms**
  - Data: `geofence_events` collection (`event_type` = `entry|exit`)
  - Engine: geofence evaluator on live telemetry generation
  - API: `/api/geofence-events`, `/api/live-operations/alerts`, `/api/alerts/center`
  - UI: Live Tracking overlay + Alerts Center geofence codes

- **Tender 9.18 - map routes on geofence for route deviation**
  - Data: route geofence (`geometry_type=polyline_buffer`, `buffer_m`)
  - Engine: point-to-polyline distance computation with `route_deviation` events
  - API: `/api/geofence-events`, existing route deviation alert feeds
  - Reports: unauthorized route deviation + geofence event reports

- **Business rules: stoppage/terminal/depot geofencing + route fencing**
  - Rules: `geofence_stoppage_radius_m`, `geofence_terminal_radius_m`,
    `geofence_depot_radius_m`, `route_fence_buffer_m`
  - UI: Business Rules page grouped as geofence settings
  - Runtime: evaluator reads rules each cycle and applies thresholds

- **Business rules: speed at geofencing**
  - Rule: `bus_stop_geofence_speed_kmh`
  - Engine: `inside_speed` event generated when speed exceeds threshold while inside stop geofence
  - Alerts/Reports: geofence speed breach surfaced in alerts + reports

## Acceptance Evidence Checklist

- Geofence master supports create/edit/activate/deactivate for stop, terminal, depot, and route types via the **map console** (preferred) with audit-friendly `source` values; depot master may store optional `lat`/`lng` for alignment with depot geofences.
- Live telemetry responses include latest geofence hit summary per bus.
- Alerts endpoints emit geofence-related alert codes.
- Reports include geofence event export and unauthorized route deviation coverage.
- Bootstrap API can seed geofences from existing stop/depot/route masters and mark provenance (`auto_seeded`); depot bootstrap uses depot `lat`/`lng` when present, otherwise approximate coordinates.
