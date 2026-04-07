# Infractions scope — implementation checklist

**Tracked against this repository** (not the external tender PDF or PM E-Drive).  
**Last reviewed:** 2026-04-07

Use this file to tick items after you cross-check the **actual tender / PM E-Drive** wording.

| Status | Meaning |
|--------|--------|
| **Met** | Implemented in codebase |
| **Partial** | Implemented with limits (see notes) |
| **Gap** | Not found in codebase — confirm if tender requires it |
| **N/A** | Confirm tender relevance |

---

## Core Schedule-S register & master

| # | Item | Status | Where / notes |
|---|------|--------|----------------|
| 1 | Tender-frozen infraction codes A–G (descriptions aligned to PM E-Drive wording in repo) | **Met** | `backend/app/domain/infractions_master.py` (`INFRACTION_MASTER`, slabs, escalation cap) |
| 2 | Catalogue persisted & listed (paginated) | **Met** | `GET /infractions/catalogue`, seed `seed.py` |
| 3 | Catalogue not editable via API (read-only) | **Met** | `POST/PUT/DELETE /infractions/catalogue/*` → 400 in `routes.py` |
| 4 | Master + report heads exposed | **Met** | `GET /infractions/master`, `TENDER_REPORT_HEADS` |

## Logging & traceability

| # | Item | Status | Where / notes |
|---|------|--------|----------------|
| 5 | Log instance with code → amount/category/description from master | **Met** | `POST /infractions/log`, `InfractionLogReq` |
| 6 | Optional context: depot, bus, driver, route/trip/duty, location, cause, deductible, related incident | **Met** | Same + `infractions_logged` document shape in `routes.py` |
| 7 | **Detected** date (`date`, YYYY-MM-DD) vs **logged** timestamp (`created_at`) | **Partial** | UI shows both; **no time-of-day for detection** in API (date only) |
| 8 | UI requires bus; API allows empty `bus_id` | **Partial** | `InfractionsPage.js` vs `InfractionLogReq` — align if tender mandates always vehicle-linked |
| 9 | Amend / delete logged row | **Gap** | Only `close` / `under_review`; no edit/delete endpoint |

## Lifecycle & billing linkage

| # | Item | Status | Where / notes |
|---|------|--------|----------------|
| 10 | Status: open, under_review, closed | **Met** | `close_infraction`, UI actions |
| 11 | Close remarks + closed_by / closed_at | **Met** | `close_infraction` |
| 12 | `resolve_by` from master resolve days | **Met** | `log_infraction` + slabs |
| 13 | Deductions: non-safety A–D cap %, escalation when not closed past resolve_by, closed freezes base amount | **Met** | `_resolve_infraction_amount`, `_infraction_deduction_rollup` in `routes.py` |
| 14 | `deductible: false` excluded from rollup | **Met** | `_infraction_deduction_rollup` |

## Reports & cross-modules

| # | Item | Status | Where / notes |
|---|------|--------|----------------|
| 15 | Service wise / driver / vehicle / conductor infraction report types | **Met** | Report registry + builders `routes.py` (~2294+) |
| 16 | Incidents ↔ infraction cross-link | **Met** | `related_incident_id` on log; `related_infraction_id` on incident create |
| 17 | UI: Infractions page (catalogue + logged + log dialog + filters) | **Met** | `frontend/src/pages/InfractionsPage.js` |
| 18 | Links to Deductions, GCC KPI, Incidents | **Met** | Page lead + app routes |

## Common tender “extras” (verify in PM doc)

| # | Item | Status | Where / notes |
|---|------|--------|----------------|
| 19 | Auto-create infractions from EBMS/GPS/incidents | **Gap** | Manual log + API; no auto-pipeline in this slice |
| 20 | Evidence (photos/docs) on log | **Gap** | No attachment field/API seen |
| 21 | Notifications / SLA alerts for `resolve_by` | **Gap** | Field present; no alert worker in repo grep |
| 22 | Signed PDF register export from Infractions UI | **N/A** | Use **Reports** export if tender allows; confirm format |

---

## Quick verification commands (optional)

### API (infractions only, local backend)

Requires backend running (e.g. `http://127.0.0.1:8000`) and seeded user `admin@tgsrtc.com` / `admin123`.

**Windows (avoid emoji Unicode errors in the console):**

```powershell
$env:PYTHONIOENCODING='utf-8'
cd Busmanagementsoftware
python -c "import sys; from backend_test import BusManagementTester; t=BusManagementTester('http://127.0.0.1:8000'); t.test_login('admin@tgsrtc.com', 'admin123') and sys.exit(0 if t.test_infractions_management() else 1)"
```

**Remote / other base URL:** pass your URL into `BusManagementTester('https://...')` (default in `backend_test.py` is a preview host).

**Full suite:** `python backend_test.py` (runs all modules after login).

### Frontend

- **Compile:** `cd frontend && npm run build`
- **Manual:** open **Infractions** → Catalogue, Logged, Log infraction, Close / Under review

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-07 | Initial checklist; verified API smoke locally. **backend_test.py:** `POST infractions/log` now sends **JSON body** (was query params → 422); catalogue GET uses `limit=100` (API max). Checklist documents Windows `PYTHONIOENCODING` for emoji output. |

When tender clauses change, add a row under **Changelog** and update statuses above.
