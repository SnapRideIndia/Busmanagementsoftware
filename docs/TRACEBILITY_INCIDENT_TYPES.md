# IRMS incident types — TGSRTC EBMS traceability (v1)

Canonical codes live in `app/domain/incident_types.py`. **New tickets** must use `creatable_incident_type_codes()` (excludes `OTHER`). `OTHER` remains only for legacy / unmigrated rows.

Dropdown order: **§4 alerts (a–g)** → **§5 over speed critical** → **scope (g) + §7-style reports** → **extended IRMS** (other incidents).

| TGSRTC EBMS reference | Incident type code(s) |
| --------------------- | --------------------- |
| §4 (a) Panic alerts | `PANIC_OR_SECURITY` |
| §4 (b) Over speed | `OVERSPEED` |
| §4 (c) GPS breakage | `ITS_GPS_FAILURE` |
| §4 (d) Idle report | `IDLE_EXCESS` |
| §4 (e) Route deviation | `ROUTE_DEVIATION` |
| §4 (f) Bunching report | `BUNCHING_ALERT` |
| §4 (g) Harness removal | `HARNESS_REMOVAL` |
| §5 (j) Over speed critical | `OVERSPEED_CRITICAL` |
| Scope (g) / §7 breakdown | `BREAKDOWN` |
| §7 accident instances | `ACCIDENT` |
| §5 (l) Trip not started from origin | `TRIP_NOT_STARTED_ORIGIN` |
| §5 (m) Trip not completed | `TRIP_NOT_COMPLETED` |
| §5 / §7 early–late trip / depot | `EARLY_LATE_DEPOT_OR_TRIP` |
| §7 No driver / no conductor | `NO_DRIVER_OR_CONDUCTOR` |
| §7 Double duty driver | `DOUBLE_DUTY_DRIVER` |
| §7 Authorized / unauthorized curtailment | `SCHEDULE_CURTAILMENT` |
| Charger / CMS / energy | `CHARGING_INFRA_FAULT`, `CMS_OR_ENERGY_DATA_FAULT` |
| Passenger / driver / external | `PASSENGER_*`, `DRIVER_CONDUCT`, `VANDALISM_OR_THEFT`, `ROAD_OR_EXTERNAL`, `WEATHER_OR_NATURAL` |
| Fire / thermal | `FIRE_ON_BUS` |
| Unclassified (legacy only) | `OTHER` (not creatable) |

Formal business-rule thresholds (§5) are configured separately in **Business rules** / geofence settings; this table maps **report lines** to **IRMS type codes** only.
