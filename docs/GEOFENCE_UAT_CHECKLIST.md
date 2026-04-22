# Geofence UAT Checklist

## Master Setup

- [ ] On **Geofences**, use the **map console**: select a stop with coordinates, adjust radius, save; confirm register shows `STOP-{stop_id}` and stored `source` is `map_console`.
- [ ] Repeat for a **terminal** (`TERM-*`), **depot** (`DEPOT-*`, marker placement; optional lat/lng on Depots master), and **route** (`ROUTE-*`, corridor width, **Rebuild path** from route stop sequence).
- [ ] Verify each record appears in the register with correct type, linked record, and size (radius or corridor width).
- [ ] Open **Live Tracking** and confirm overlays match the saved boundaries (refresh if needed).
- [ ] Optional: call `POST /api/geofences/bootstrap` (or equivalent bulk seed) and verify created/updated/skipped counts; with depot lat/lng set, confirm bootstrap uses those coordinates.
- [ ] Optional: `POST /geofences` with a full upsert body and a custom `source` (e.g. integration or support tooling) and confirm the value persists; primary authoring remains the map console.

## Runtime Events

- [ ] Open Live Tracking and confirm geofence overlays render on map.
- [ ] Confirm telemetry rows include `latest_geofence_event` and `active_geofence_ids`.
- [ ] Trigger entry/exit transition and validate `geofence_events` persistence.
- [ ] Trigger route deviation and verify event type is `route_deviation`.
- [ ] Trigger stop-speed rule and verify `inside_speed` event.

## Alerts and Incidents

- [ ] Confirm geofence alerts appear in `Alerts Center` with new alert codes.
- [ ] Confirm `live-operations/alerts` includes geofence-derived alerts.
- [ ] Confirm incident mapping uses expected incident and infraction defaults.

## Reporting

- [ ] Run `geofence_events` report from Reports.
- [ ] Verify columns: event id, bus, geofence, event type, distance, threshold, speed.
- [ ] Verify unauthorized route deviation report still includes route deviations.

## Feature Toggle / Rollback

- [ ] Set business rule `geofence_feature_enabled=0` and verify engine stops generating events.
- [ ] Restore to `1` and verify events resume without API errors.
