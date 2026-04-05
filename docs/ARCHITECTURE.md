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
- `/api/energy`, `/api/incidents`, `/api/settings` — Operations
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
