# Bus Management System - PRD

## Original Problem Statement
Build a fully functional Bus Management System dashboard with complete backend. Features include Login, Dashboard KPIs, Tender/Bus/Driver CRUD, Live Operations with map tracking, Energy Management, KPI Screen, Deduction Engine, Billing with invoice PDF/Excel export, Reports, Incident Management, and Settings. Billing engine implements: Final Payable = Base Payment + Energy Adjustment + Subsidy - Deductions.

## Architecture
- **Frontend**: React 19, Tailwind CSS, Shadcn UI, Recharts, React-Leaflet
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT with httpOnly cookies, bcrypt password hashing, brute force protection

## User Personas
1. **Admin (RTC)** - Full access, manages tenders, buses, drivers, billing
2. **Depot Manager** - Manages depot-level operations
3. **Finance Officer** - Billing and reports focus
4. **Vendor** - View billing and performance data

## Core Requirements
- Multi-role JWT authentication
- Dashboard with real-time KPIs and charts
- Tender Management (CRUD)
- Bus Master (CRUD + Assign Tender)
- Driver Management (CRUD + Assign Bus + Performance tracking)
- Live Operations (simulated map tracking)
- Energy Management (charging data + reports)
- Deduction Engine (configurable rules)
- Billing Engine (exact formula implementation)
- PDF/Excel export for invoices and reports
- Incident Management
- System Settings

## What's Been Implemented (March 28, 2026)
- [x] JWT Auth with role-based access (4 user roles)
- [x] Dashboard with 6 KPIs, charts (KM/Energy), filters
- [x] Tender Management - full CRUD with validation
- [x] Bus Master - full CRUD, assign tender, view details
- [x] Driver Management - full CRUD, assign bus, performance view
- [x] Live Operations - Leaflet map with simulated bus positions (Hyderabad)
- [x] Energy Management - data entry, reports with charts
- [x] KPI Screen - 10 metrics with date filters
- [x] Deduction Engine - rule CRUD, apply calculations
- [x] Billing Engine - generate invoices with full formula
- [x] PDF/Excel export for invoices
- [x] Reports - 4 report types with Excel/PDF download
- [x] Incident Management - report/update/resolve
- [x] Settings - configurable tariff rates and system params
- [x] Seed data (3 tenders, 10 buses, 8 drivers, 30 days data)
- [x] TGSRTC color theme (Night Green #134219, Goldenrod #BA9149)

## Test Results (Iteration 1)
- Backend: 100% (49/49 tests passed)
- Frontend: 95% (19/20 - minor selector fix applied)

## Iteration 2 - Revenue/KM Drill-Down + UI Overhaul (April 3, 2026)
- [x] Revenue KPI clickable - drill-down with day/month/quarter views
- [x] Revenue data from Ticket Issuing Machine API (90 days seeded)
- [x] KM KPI clickable - drill-down with day/month/quarter views
- [x] KM data from GPS API (30 days seeded)
- [x] Both pages: depot, bus, date filters + charts + tables
- [x] Complete UI: Primary #C8102E (Red), Sidebar #1F2937, Font Inter
- [x] Sidebar: Revenue and KM Tracking nav items added

## Test Results (Iteration 2)
- Backend: 100% (57 endpoints)
- Frontend: 95%

## Test Results (Iteration 1)
- Backend: 100% (49/49 tests passed)
- Frontend: 95% (19/20 - minor selector fix applied)

## Iteration 2 - Revenue/KM Drill-Down + UI Overhaul (April 3, 2026)
- [x] Revenue KPI clickable - drill-down with day/month/quarter views
- [x] Revenue data from Ticket Issuing Machine API (90 days seeded)
- [x] KM KPI clickable - drill-down with day/month/quarter views
- [x] KM data from GPS API (30 days seeded)
- [x] Both pages: depot, bus, date filters + charts + tables
- [x] Complete UI: Primary #C8102E (Red), Sidebar #1F2937, Font Inter
- [x] Sidebar: Revenue and KM Tracking nav items added

## Test Results (Iteration 2)
- Backend: 100% (57 endpoints)
- Frontend: 95%

## Iteration 3 - Duty Assignment + Passengers + Logo (April 3, 2026)
- [x] Duty Assignment module: assign routes to drivers with 2 trips (outward + return)
- [x] Start/end points, start/arrival times per trip, date selection
- [x] SMS notification (SIMULATED - logs to backend console, marks as sent)
- [x] Send individual SMS or bulk "Send All SMS" for a date
- [x] Passengers Traveled KPI on dashboard (clickable drill-down)
- [x] Passenger drill-down: daily/monthly/quarterly, depot/bus/route filters
- [x] Sidebar logo: Bus icon, added Duty Roster + Passengers nav items

## Test Results (Iteration 3)
- Backend: 100% (72 endpoints)
- Frontend: 98%

## Prioritized Backlog
### P0 (Critical)
- None remaining

### P1 (Important)
- Real GPS integration for live tracking (currently simulated)
- Daily billing accumulation → monthly aggregation
- Role-based page access restrictions (currently all roles see all pages)
- Password change functionality in settings

### P2 (Nice to have)
- Real-time WebSocket updates for live operations
- Email notifications for incidents and billing
- Audit trail for all CRUD operations
- Multi-language support (Hindi/Telugu)
- Dark mode toggle
- Dashboard customization per user role

## Next Tasks
1. Implement role-based access control (restrict pages per role)
2. Add daily trip data entry interface
3. Add monthly billing aggregation from daily calculations
4. Implement dashboard drill-down (click KPI → detailed view)
5. Add notification system for alerts and incidents
