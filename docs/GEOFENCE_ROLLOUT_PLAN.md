# Geofence Rollout Plan

## Phase 1 - Backend Hidden Readiness

- Deploy backend geofence APIs and evaluator with `geofence_feature_enabled=0`.
- Seed baseline geofences from masters (stops/depots) in non-production first.
- Validate index creation and report query performance.

## Phase 2 - Controlled Admin Enablement

- Enable route `/geofences` UI for admin and operations supervisors.
- Bootstrap route geofences and review geometry quality.
- Keep feature flag off while master data is being validated.

## Phase 3 - Live Event Activation

- Set `geofence_feature_enabled=1` for pilot depots.
- Monitor geofence event volume and alert quality.
- Tune operational thresholds (radius/buffer/speed) in Business Rules.

## Phase 4 - Reporting and SLA Integration

- Enable geofence reports in monthly review packs.
- Confirm incident/infraction linkage for route deviations and speed breaches.
- Move from `auto_seeded` records to `survey_verified` records depot-by-depot.

## Rollback Strategy

- Immediate rollback: set `geofence_feature_enabled=0`.
- Data rollback: keep persisted events for audit; disable alert exposure through filters if needed.
- UI rollback: hide `Geofences` menu item via release branch if emergency hotfix is required.
