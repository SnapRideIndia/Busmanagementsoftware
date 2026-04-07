# Billing Final Audit Checklist

## Formula Integrity

- [x] `FinalPayable = BasePayment + EnergyAdjustment - TotalDeductions`
- [x] Subsidy excluded from payable by default
- [x] KM incentive included when actual KM exceeds scheduled KM (rule-driven by `fee_excess_km_factor`)
- [x] Deduction buckets include availability, performance, system, and infractions
- [x] PDF/Excel exports reflect same formula as API invoice object

## Workflow and Status

- [x] Full workflow enum exposed in backend (`draft` through `paid`)
- [x] Billing UI status filter includes all workflow states
- [x] Workflow state filter added separately for audit users
- [x] Transition log maintained in `workflow_log`
- [x] Submitted/approved/paid timestamps captured in `approval_dates`

## Billing Table and Filters

- [x] Table includes status and workflow visibility
- [x] Table includes submitted and paid date columns
- [x] Filters include period range, depot, status, workflow state, and invoice ID
- [x] Clear-filters action resets all billing query controls

## Artifacts and Compliance Traceability

- [x] Invoice has structured `artifact_refs` for:
  - payment processing note
  - proposal note
  - show-cause notice
  - GST proof reference
  - tax withholding reference
- [x] Artifact references shown in invoice detail UI

## Dashboard Coverage

- [x] Dashboard API returns billing pending count
- [x] Dashboard API returns billing invoice count
- [x] Dashboard API returns billing total deductions
- [x] Dashboard UI displays billing pending and deductions KPIs

## Post-Deploy Verification

- [ ] Run API regression for `/billing`, `/billing/generate`, `/billing/{id}`, exports
- [ ] Run UI regression on billing filters and invoice detail
- [ ] Validate old invoices render safely when new fields are missing
- [ ] Confirm finance team acceptance on status labels and artifact fields
