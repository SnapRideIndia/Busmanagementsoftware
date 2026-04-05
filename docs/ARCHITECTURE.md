# TGSRTC EBMS — Architecture Document

## 1. System Overview
The Electric Bus Management System (EBMS) is a full-stack web application for TGSRTC to manage electric bus operations under the GCC concession model. It handles concessionaire telemetry, billing, KPI monitoring, and operational workflows.

## 2. Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS, Shadcn/UI, Recharts, React-Leaflet |
| Backend | FastAPI (Python), Motor (async MongoDB driver) |
| Database | MongoDB |
| Auth | JWT (httpOnly cookies + Bearer), bcrypt, brute-force protection |

### 2.1 Backend layout (industry-style)
| Path | Role |
|------|------|
| `backend/server.py` | Thin entry: loads `.env`, re-exports `app` (`uvicorn server:app`) |
| `backend/app/main.py` | `FastAPI` factory, CORS, lifespan (indexes + seed + Mongo close) |
| `backend/app/core/` | `config.py`, `database.py` (Motor + certifi TLS), `security.py`, `seed.py` |
| `backend/app/schemas/` | Pydantic request models (`requests.py`) |
| `backend/app/domain/` | Domain constants (e.g. `incident_types.py`) |
| `backend/app/services/` | Stateless engines (e.g. `gcc_engine.py`) |
| `backend/app/api/deps.py` | `get_current_user` |
| `backend/app/api/v1/routes.py` | All HTTP routes (split into `endpoints/*.py` incrementally) |

## 3. Data Flow
```
Concessionaire (GPS/CAN/CMS) ──> EBMS Ingestion ──> MongoDB
TGSRTC (Masters/Ops Entry) ──> EBMS CRUD APIs ──> MongoDB
MongoDB ──> KPI Engine ──> Dashboard / Reports
MongoDB ──> Billing Engine (§18-20) ──> Workflow (a)-(j) ──> Payment
```

## 4. RBAC Model (§3)
| Role | Scope |
|------|-------|
| admin | Full system access, user management, masters, vendor SLA |
| senior_management | MIS, dashboards, approvals |
| regional_manager | Regional data, route/duty updates, billing approvals |
| depot_manager | Depot-scoped operations, maintenance, crew |
| vendor | Operator-scoped view of billing and performance |

## 5. Core Engines

### 5.1 GCC KPI Engine (§18)
Computes monthly: Reliability (BF), Availability (shift), Punctuality (start/arrival), Frequency, Safety (MAF).
- Damages capped at 10% Monthly Fees
- Incentives capped at 5% Monthly Fees
- First 30 days: 25% relaxation except safety

**Punctuality vs planned time (concessionaire data)**  
`trip_data` rows may carry deployment-plan style times; see `app/services/punctuality.py`. When present, GCC uses them instead of random placeholders:
- Start on-time: `actual_start_time` not later than `plan_start_time` + `punctuality_start_relax_min` (default 5 minutes; EBMS business rules / operator contract style).
- Arrival on-time: `actual_end_time` not later than (`plan_start_time` + `planned_trip_duration_min`) + slack, where slack = min(`punctuality_arrival_relax_max_min`, `punctuality_arrival_relax_pct` × scheduled trip minutes) — default cap 15 minutes (operator PM E–style cap on % of scheduled trip time).
- Alternatively, each trip may set boolean `punctuality_start_on_time` and `punctuality_arrival_on_time` if the concessionaire pre-computes flags.  
If no trip in range has punctuality fields, the engine keeps the previous synthetic punctuality % for demo purposes.

### 5.2 Fee/PK Engine (§20)
```
if actual >= assured:
    Fee = PK × assured + PK × 0.50 × (actual - assured)
if actual < assured:
    Fee = PK × actual + PK × 0.75 × (assured - actual)
```

### 5.3 Schedule-S Infractions (§19)
Categories A–G (₹100 to ₹2,00,000+). Safety-flagged infractions are uncapped. Non-safety A–D capped at 5% monthly due. Repeat escalation with ₹3,000 cap then bus stop.

### 5.4 Billing Workflow (§12)
State machine: draft → submitted → processing → proposed → depot_approved → regional_approved → rm_sanctioned → voucher_raised → hq_approved → paid

### 5.5 IRMS / Incidents (§14, §5.7)
Canonical incident **codes** live in `backend/domain/incident_types.py` (single source of truth). API exposes metadata at `GET /api/incidents/meta` (types, channels, severities, statuses, default assignment teams).

- **Channels:** `web`, `telephonic`, `other` (control-room / telephonic intake).
- **Workflow statuses:** `open` → `investigating` → `assigned` → `in_progress` → `resolved` → `closed`.
- **Activity log:** append-only audit trail on create, status/assignment changes, and `POST /api/incidents/{id}/notes`.
- **GCC linkage:** reliability **breakdown count** uses types flagged `counts_for_reliability_breakdown` (e.g. `BREAKDOWN`, `FIRE_ON_BUS`, `CHARGING_INFRA_FAULT`). Safety **MAF / major** uses `safety_kpi_counts()` (accident severities, on-bus fire, high-severity panic/security).

## 6. API Structure
All routes prefixed with `/api`. Auth via JWT cookie or Bearer header.
- `/api/auth/*` — Authentication
- `/api/dashboard` — KPI summary
- `/api/tenders`, `/api/buses`, `/api/drivers` — Masters CRUD
- `/api/duties` — Duty assignment with SMS
- `/api/kpi/gcc-engine` — GCC KPI calculation
- `/api/billing/*` — Invoice generation, workflow, Fee/PK, export
- `/api/infractions/*` — Schedule-S catalogue and logging
- `/api/business-rules` — Configurable parameters
- `/api/incidents/meta`, `GET/POST /api/incidents`, `GET /api/incidents/{id}`, `PUT /api/incidents/{id}`, `POST /api/incidents/{id}/notes` — IRMS
- `/api/energy`, `/api/settings` — Operations
- `/api/revenue/details`, `/api/km/details`, `/api/passengers/details` — Drill-downs
- `/api/reports`, `/api/live-operations` — Reporting and tracking

## 7. MongoDB Collections
users, tenders, buses, drivers, trip_data, energy_data, revenue_data, duty_assignments, deduction_rules, billing, incidents, settings, business_rules, infraction_catalogue, infractions_logged, login_attempts, password_reset_tokens

## 8. Seed Module
Demo data is seeded on startup via `seed_data()`. Includes: 4 users, 3 tenders, 10 buses, 8 drivers, 30-90 days of trip/energy/revenue data, deduction rules, infraction catalogue, business rules, duty assignments, incidents.

## 9. Date Format
- Internal: ISO 8601 (YYYY-MM-DD)
- UI Display: DD-MM-YYYY as per TGSRTC standard
- Exports (PDF/Excel): DD-MM-YYYY

## 10. Deferred Items
- Production hosting/cloud/DR topology
- Real GPS/CAN/CMS/AFCS integrations (currently simulated)
- Real SMS gateway (currently logged to console)
- Map licence procurement
- CPI/MW-based PK escalation automation
