# Article 20 Rule Coverage (Duty + Incidents + KPI)

This note tracks implementation status for Article 20 logic in the current codebase.

## Coverage Matrix

| Rule | Requirement | Status | Where |
|---|---|---|---|
| 20.4.3 Start punctuality relaxation | Allow up to 5 minutes | Implemented | `backend/app/api/v1/routes.py`, `backend/app/services/punctuality.py`, `frontend/src/pages/DutyPage.js` |
| 20.4.3 Arrival relaxation | Allow up to 10% trip duration, max 15 min | Implemented | `backend/app/api/v1/routes.py`, `backend/app/services/punctuality.py`, `frontend/src/pages/DutyPage.js` |
| 20.4.x warning flow | Surface late-start/late-arrival mismatches | Implemented | `frontend/src/pages/DutyPage.js` |
| Toggle to include infraction | Default OFF, save-time decision | Implemented | `frontend/src/pages/DutyPage.js`, `backend/app/api/v1/routes.py` |
| Reversible sync | Toggle OFF removes system rule incident | Implemented | `backend/app/api/v1/routes.py` |
| Per-duty attribution context | RTC fault / Operator fault | Implemented | `frontend/src/pages/DutyPage.js`, `backend/app/schemas/requests.py`, `backend/app/api/v1/routes.py` |
| Per-duty exception reason | Required when toggles enabled | Implemented | `frontend/src/pages/DutyPage.js`, `backend/app/api/v1/routes.py` |
| Cancellation reason validation | Required for cancelled/not_operated | Implemented | `backend/app/schemas/requests.py`, `frontend/src/pages/DutyPage.js` |
| KPI punctuality thresholds | Start >= 90%, Arrival >= 80% | Implemented | `backend/app/services/gcc_engine.py` |
| KPI caps | Damages and incentives caps | Implemented | `backend/app/services/gcc_engine.py` |

## Notes

- Conductor rating has been removed from the conductor domain API/UI contracts.
- Seed data has been updated in impacted mock collections (`conductors`, `duty_assignments`, `trip_data`, `incidents`) to match the new duty review structure.
