import { formatDateIN, formatDateTimeIN } from "./dates";

export const SIMPLE_REPORT_NAMES = {
  operations: "Operations",
  km_gps: "KM Operated",
  trip_km_verification: "Trip KM Verification",
  energy: "Energy",
  energy_efficiency: "Energy Efficiency",
  ticket_revenue: "Revenue & Passengers",
  incidents: "Incidents",
  infractions_logged: "Service Infractions",
  infractions_driver_wise: "Driver Infractions",
  infractions_vehicle_wise: "Vehicle Infractions",
  infractions_conductor_wise: "Conductor Infractions",
  incident_penalty_report: "Incident Penalties",
  trip_not_started_from_origin: "Trip Not Started From Origin",
  early_late_trip_started_from_origin: "Early/Late Trip Started From Origin",
  no_driver_no_conductor: "No Driver / No Conductor",
  breakdown_unattended_over_2h: "Breakdown >2h Unattended",
  breakdown_0_2_pct: "Breakdown 0.2%",
  incident_details: "Incident Details",
  authorized_curtailment: "Authorized Curtailment",
  unauthorized_curtailment: "Unauthorized Curtailment",
  unauthorized_route_deviation: "Unauthorized Route Deviation",
  over_speed: "Over Speed",
  accident_instances: "Accident Instances",
  monthly_sla_non_conformance: "Monthly SLA / Non-Conformance",
  double_duty_driver_report: "Double Duty Driver Report",
  daily_earning_report: "Daily Earning Report",
  kpi_report: "KPI Report",
  daily_cancelled_kms_total: "Daily Cancelled KMs (Total)",
  head_wise_cancelled_kms: "Head Wise Cancelled KMs",
  daily_cancelled_kms_type_wise: "Daily Cancelled KMs Type Wise",
  soh_soc_batteries_report: "SOH & SOC of Batteries",
  charger_availability_report: "Charger Availability",
  income_tax_gst_incentive_report: "Income Tax / GST / Incentive",
  daily_ridership_summary_report: "Daily Ridership Summary",
  current_month_gps_km_report: "Current Month GPS KM",
  tracking_consolidated_report: "Tracking Consolidated",
  non_journey_report: "Non-Journey Report",
  weekly_backup_restore_log_report: "Weekly Backup/Restore Log",
  weekly_resource_utilization_report: "Weekly Resource Utilization",
  weekly_operations_pack_report: "Weekly Operations Pack",
  monthly_asset_modification_report: "Monthly Asset Modification",
  monthly_dc_uptime_report: "Monthly DC Uptime",
  monthly_dc_resource_utilization_report: "Monthly DC Resource Utilization",
  monthly_preventive_breakfix_log_report: "Monthly Preventive/Break-fix Log",
  monthly_change_log_report: "Monthly Change Log",
  quarterly_security_vulnerability_report: "Quarterly Security Vulnerability",
  quarterly_dc_hazards_events_report: "Quarterly DC Hazards/Events",
  quarterly_sla_report: "Quarterly SLA Report",
  billing: "Billing Summary",
  billing_trip_wise_km: "Trip KM",
  billing_day_wise_km: "Day-wise KM",
  billing_bus_wise_km: "Bus-wise KM",
  assured_km_reconciliation: "Assured KM Reconciliation",
  service_wise_infractions: "Service Infractions (Billing)",
};

const OPERATIONS_COLUMN_LABELS = {
  bus_id: "Bus ID",
  driver_id: "Driver ID",
  date: "Date",
  scheduled_bus_out: "Scheduled bus out",
  actual_bus_out: "Actual bus out",
  scheduled_bus_in: "Scheduled bus in",
  actual_bus_in: "Actual bus in",
  scheduled_km: "Scheduled KM",
  actual_km: "Actual KM",
};

const TRIP_KM_LABELS = {
  trip_key: "Trip key",
  km_variance: "KM variance",
  km_variance_pct: "Variance %",
  needs_exception_action: "Exception review",
  exception_action_status: "Exception status",
  traffic_km_approved: "First verification",
  maintenance_km_finalized: "Final verification",
  traffic_km_approved_by: "First by",
  maintenance_km_finalized_by: "Final by",
};

function toAmPm(hhmm) {
  if (typeof hhmm !== "string") return hhmm;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let h = Number(m[1]);
  const mm = m[2];
  if (Number.isNaN(h) || h < 0 || h > 23) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${mm} ${suffix}`;
}

export function formatReportCellValue(col, val, options = {}) {
  if (val == null || val === "") return "-";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return val.toLocaleString("en-IN");
  if (typeof val !== "string") return String(val);

  const c = String(col || "").toLowerCase();
  const trimVal = val.trim();
  const isTimeCol = [
    "scheduled_bus_out",
    "actual_bus_out",
    "scheduled_bus_in",
    "actual_bus_in",
    "start_time",
    "end_time",
    "plan_start_time",
    "plan_end_time",
    "scheduled_departure",
    "actual_departure",
  ].includes(c);

  if (options.time12h && isTimeCol) return toAmPm(trimVal);
  if (c.endsWith("_at")) return formatDateTimeIN(trimVal);
  if (c.includes("date") || c.startsWith("period_") || c.endsWith("_on") || c.endsWith("_from") || c.endsWith("_to")) {
    return formatDateIN(trimVal);
  }
  return trimVal.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ");
}

export function columnsForPreview(reportType, revenuePeriod) {
  const map = {
    operations: ["bus_id", "driver_id", "date", "scheduled_bus_out", "actual_bus_out", "scheduled_bus_in", "actual_bus_in", "scheduled_km", "actual_km"],
    energy: ["bus_id", "date", "units_charged", "tariff_rate"],
    incidents: ["id", "incident_type", "channel", "bus_id", "depot", "assigned_team", "severity", "status", "occurred_at", "vehicles_affected_count", "damage_summary", "engineer_action", "attachments_summary", "created_at"],
    billing: ["invoice_id", "period_start", "period_end", "depot", "bus_id", "base_payment", "energy_adjustment", "km_incentive", "total_deduction", "final_payable", "status", "workflow_state"],
    billing_trip_wise_km: ["date", "bus_id", "route_name", "trip_id", "duty_id", "scheduled_km", "actual_km", "variance_km"],
    billing_day_wise_km: ["date", "scheduled_km", "actual_km", "variance_km", "achievement_pct"],
    billing_bus_wise_km: ["bus_id", "trip_count", "scheduled_km", "actual_km", "variance_km", "achievement_pct"],
    assured_km_reconciliation: ["bus_id", "trip_count", "scheduled_km", "actual_km", "variance_km", "achievement_pct"],
    service_wise_infractions: ["service", "category", "count", "total_amount"],
    ticket_revenue:
      revenuePeriod === "daily"
        ? ["date", "bus_id", "depot", "route", "passengers", "revenue_amount"]
        : revenuePeriod === "monthly"
          ? ["bus_id", "depot", "period", "route", "passengers", "revenue_amount", "days"]
          : ["bus_id", "depot", "period", "passengers", "revenue_amount", "days"],
    km_gps: ["bus_id", "date", "depot", "driver_id", "scheduled_km", "actual_km"],
    energy_efficiency: ["bus_id", "bus_type", "km_operated", "kwh_per_km", "allowed_kwh", "actual_kwh", "efficiency", "allowed_cost", "actual_cost", "adjustment"],
    infractions_logged: ["id", "date", "bus_id", "driver_id", "depot", "infraction_code", "category", "amount", "route_name", "related_incident_id", "status", "created_at"],
    infractions_driver_wise: ["driver_id", "category", "count", "total_amount"],
    infractions_vehicle_wise: ["bus_id", "category", "count", "total_amount"],
    infractions_conductor_wise: ["conductor_id", "count", "total_amount"],
    incident_penalty_report: ["related_incident_id", "id", "date", "bus_id", "driver_id", "infraction_code", "category", "amount", "status", "close_remarks"],
    trip_not_started_from_origin: ["date", "trip_id", "duty_id", "bus_id", "route_name", "route_origin", "actual_start_point", "plan_start_time", "actual_start_time"],
    early_late_trip_started_from_origin: ["date", "trip_id", "duty_id", "bus_id", "route_name", "route_origin", "actual_start_point", "scheduled_departure", "actual_departure", "variance_minutes", "variance_type", "threshold_minutes"],
    no_driver_no_conductor: ["date", "duty_id", "depot", "bus_id", "route_name", "driver_id", "driver_name", "conductor_id", "conductor_name", "missing_driver", "missing_conductor"],
    breakdown_unattended_over_2h: ["id", "occurred_at", "bus_id", "depot", "status", "assigned_team", "engineer_action", "unattended_hours", "sla_hours_limit"],
    breakdown_0_2_pct: ["period_start", "period_end", "trip_count", "breakdown_count", "breakdown_pct", "threshold_pct", "non_conformance"],
    incident_details: ["id", "incident_type", "occurred_at", "bus_id", "depot", "route_name", "trip_id", "severity", "status", "assigned_team", "description", "engineer_action"],
    authorized_curtailment: ["id", "occurred_at", "bus_id", "depot", "trip_id", "status", "description"],
    unauthorized_curtailment: ["id", "occurred_at", "bus_id", "depot", "trip_id", "status", "description"],
    unauthorized_route_deviation: ["id", "occurred_at", "bus_id", "depot", "route_name", "trip_id", "severity", "status", "description"],
    over_speed: ["id", "occurred_at", "bus_id", "depot", "route_name", "trip_id", "severity", "status", "description"],
    accident_instances: ["id", "occurred_at", "bus_id", "depot", "route_name", "trip_id", "severity", "status", "description"],
    monthly_sla_non_conformance: ["month", "metric", "total_events", "non_conformance_events", "non_conformance_pct", "threshold_pct", "sla_compliant"],
    double_duty_driver_report: ["date", "driver_id", "driver_name", "duty_count", "duty_ids"],
    daily_earning_report: ["date", "trip_rows", "passengers", "revenue_amount"],
    kpi_report: ["period", "period_type", "trip_count", "scheduled_km", "actual_km", "km_achievement_pct", "punctual_trips", "punctuality_pct", "incident_count", "open_incidents"],
    daily_cancelled_kms_total: ["date", "cancelled_trip_count", "cancelled_km"],
    head_wise_cancelled_kms: ["cancel_head", "cancelled_trip_count", "cancelled_km"],
    daily_cancelled_kms_type_wise: ["date", "cancel_reason_code", "cancel_head", "cancelled_trip_count", "cancelled_km"],
    soh_soc_batteries_report: ["bus_id", "depot", "bus_type", "last_charge_date", "last_charge_units", "avg_daily_charge_units", "soh_pct", "soc_pct"],
    charger_availability_report: ["depot", "buses_seen", "days_observed", "estimated_chargers", "avg_charging_buses_per_day", "charger_availability_pct"],
    income_tax_gst_incentive_report: ["invoice_id", "period_start", "period_end", "depot", "status", "workflow_state", "base_payment", "incentive_amount", "gst_pct", "gst_amount", "tds_pct", "income_tax_tds", "final_payable", "net_after_taxes"],
    daily_ridership_summary_report: ["date", "routes_served", "buses_operated", "passengers", "revenue_amount"],
    current_month_gps_km_report: ["period_start", "period_end", "bus_id", "trip_count", "scheduled_km", "actual_km", "variance_km", "achievement_pct"],
    tracking_consolidated_report: ["month", "bus_count", "trip_count", "scheduled_km", "actual_km", "variance_km", "achievement_pct"],
    non_journey_report: ["date", "trip_id", "duty_id", "bus_id", "route_name", "scheduled_km", "actual_km", "variance_km", "start_time", "end_time", "reason"],
    weekly_backup_restore_log_report: ["week", "backup_jobs", "restore_tests", "backup_success_pct"],
    weekly_resource_utilization_report: ["week", "trip_count", "cpu_utilization_pct", "memory_utilization_pct", "storage_utilization_pct"],
    weekly_operations_pack_report: ["week", "service_count", "route_count", "duty_count", "trip_count", "crew_assignments"],
    monthly_asset_modification_report: ["month", "bus_assets_added", "asset_updates"],
    monthly_dc_uptime_report: ["month", "trip_count", "incident_count", "dc_uptime_pct"],
    monthly_dc_resource_utilization_report: ["month", "cpu_utilization_pct", "memory_utilization_pct", "storage_utilization_pct", "network_utilization_pct"],
    monthly_preventive_breakfix_log_report: ["month", "preventive_actions", "breakfix_actions", "open_actions"],
    monthly_change_log_report: ["month", "duty_changes", "trip_changes", "crew_changes"],
    quarterly_security_vulnerability_report: ["quarter", "vulnerability_count", "critical_count", "open_count"],
    quarterly_dc_hazards_events_report: ["quarter", "hazard_events", "major_events", "breakdown_events"],
    quarterly_sla_report: ["quarter", "trip_count", "scheduled_km", "actual_km", "km_achievement_pct", "punctuality_pct", "incident_count"],
    trip_km_verification: ["trip_key", "bus_id", "depot", "date", "scheduled_km", "actual_km", "km_variance_pct", "traffic_km_approved", "maintenance_km_finalized", "exception_action_status"],
  };
  return map[reportType] || [];
}

export function headerLabel(reportType, col) {
  if (reportType === "operations" && OPERATIONS_COLUMN_LABELS[col]) return OPERATIONS_COLUMN_LABELS[col];
  if (reportType === "trip_km_verification" && TRIP_KM_LABELS[col]) return TRIP_KM_LABELS[col];
  return col.replace(/_/g, " ");
}
