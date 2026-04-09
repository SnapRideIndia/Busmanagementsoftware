# IRMS infractions and billing — end-to-end verification

Use this checklist after code changes to incidents, infraction closes, or deduction rollup logic.

## 1. Infraction slab escalation (Schedule-S style)

1. Create an incident with an infraction whose catalogue row uses escalable **category** (A–E chain) and a short **resolve_by** (or wait past `resolve_by` in test data).
2. Before closing, confirm **open** infractions pick up higher slab amounts in **`POST /api/deductions/apply`** / **`POST /api/billing/generate`** for an `as_of` date after the deadline (backend `_resolve_infraction_amount`).
3. **Close** the infraction via **Verify & Resolve** in the UI (or `PUT /api/incidents/{id}/infractions/{idx}/close`). Confirm response includes **`amount_current`** matching the escalated slab for the close date.
4. Close the whole incident (**status → closed**) and confirm embedded infractions that were still open get **`amount_current`** frozen consistently.

## 2. Monthly caps (Clause 20.10 style)

1. Run **`/deductions/apply`** for a period with several non-safety A–D category infractions.
2. Confirm **capped** infraction totals respect **5% of monthly due** (see `_infraction_deduction_rollup` / `capped_cap_limit`).
3. Confirm **safety-flag** infractions are treated as **uncapped** in that rollup.

## 3. Billing period alignment

1. Ensure test incidents have **`occurred_at`** within the billing period (flattened infractions use **`occurred_at`** range in `_get_flattened_infractions`).
2. Confirm **Reported** filters (`date_from` / `date_to` on `created_at`) vs **Occurred** filters (`occurred_from` / `occurred_to` on `occurred_at`) return different subsets as expected.

## 4. Regression smoke

- `GET /api/incidents/meta` returns **statuses**, **channels** (including `mobile`), **assignment_teams**, and **incident_types** with **`ui_group`**.
- Incident list filters: status, depot, bus, driver license, severity, type code, reported dates, occurred dates.
