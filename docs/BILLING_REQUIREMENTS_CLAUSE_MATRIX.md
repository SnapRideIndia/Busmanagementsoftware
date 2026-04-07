# Billing Requirements Clause Matrix

## Scope

This matrix maps Tender + PM E-Drive billing/dashboard requirements to implementation in:
- `backend/app/api/v1/routes.py`
- `frontend/src/pages/BillingPage.js`
- `frontend/src/pages/DashboardPage.js`

## Clause Mapping

| Requirement | Source | Implementation | Status |
|---|---|---|---|
| Invoice processing with deductions/penalties/taxes | TGSRTC Tender Section-3 | Billing generate logic computes base payment, energy adjustment, and deduction buckets | Compliant |
| Subsidy in payable formula only if contractually mandated | Tender review + PM E-Drive context | Subsidy removed from final payable formula by default; stored as zero and flagged in invoice components | Compliant |
| Billing lifecycle states through depot/regional/HQ chain | Tender auto-processing flow | Workflow states + transitions in backend; UI status/workflow filters aligned to full enum | Compliant |
| Invoice filters by period/depot/status | Tender billing operations | Existing filters kept; added invoice ID and workflow-state filters | Compliant |
| Billing artifacts for processing note/proposal note/show-cause/GST/tax refs | Tender notes and process expectations | Added `artifact_refs` structure on invoice and surfaced in invoice detail dialog | Partially Compliant |
| Incentive when KM exceeds target | User-approved billing requirement | Added `km_incentive` using configurable business rule `fee_excess_km_factor` for excess KM over scheduled KM | Compliant |
| Payment release process visibility | PM E-Drive fee/payment structure | Added workflow timestamps in `approval_dates` for submitted/approved/paid visibility | Partially Compliant |
| Dashboard should include billing-facing MIS visibility | Tender MIS/KPI expectations | Added billing pending count, invoice count, and total deductions to dashboard API/UI | Compliant |
| Export parity with current billing formula | Invoice format expectation | PDF/Excel now omit subsidy line item and reflect final formula | Compliant |

## Residual Gaps (Operational/Contract Integration)

- Automatic deemed approval timers (PM E-Drive SLA-based) are not yet automated.
- Escrow/PSM account-level ledger controls are not yet modeled in invoice records.
- Artifact fields are captured as references only; full document generation workflow is external.
