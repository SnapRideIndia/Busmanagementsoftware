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
    trip_km_verification: ["trip_key", "bus_id", "depot", "date", "scheduled_km", "actual_km", "km_variance_pct", "traffic_km_approved", "maintenance_km_finalized", "exception_action_status"],
  };
  return map[reportType] || [];
}

export function headerLabel(reportType, col) {
  if (reportType === "operations" && OPERATIONS_COLUMN_LABELS[col]) return OPERATIONS_COLUMN_LABELS[col];
  if (reportType === "trip_km_verification" && TRIP_KM_LABELS[col]) return TRIP_KM_LABELS[col];
  return col.replace(/_/g, " ");
}
