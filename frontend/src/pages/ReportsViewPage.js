import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API, { formatApiError, getBackendOrigin } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import RingLoader from "../components/RingLoader";
import { formatDateIN, formatDateTimeIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

const SIMPLE_REPORT_NAMES = {
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

function columnsForPreview(reportType, revenuePeriod) {
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

function headerLabel(reportType, col) {
  if (reportType === "operations" && OPERATIONS_COLUMN_LABELS[col]) return OPERATIONS_COLUMN_LABELS[col];
  if (reportType === "trip_km_verification" && TRIP_KM_LABELS[col]) return TRIP_KM_LABELS[col];
  return col.replace(/_/g, " ");
}

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

export default function ReportsViewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reportType = searchParams.get("report_type") || "operations";
  const revenuePeriod = searchParams.get("period") || "daily";
  const rawReportName = searchParams.get("report_name") || "";
  const reportNameFromQuery =
    rawReportName && rawReportName !== "undefined" && rawReportName !== "null" ? rawReportName : "";
  const previewCols = useMemo(() => columnsForPreview(reportType, revenuePeriod), [reportType, revenuePeriod]);
  const title = reportNameFromQuery || SIMPLE_REPORT_NAMES[reportType] || reportType.replace(/_/g, " ");

  const baseParams = useMemo(() => {
    const out = {};
    for (const [k, v] of searchParams.entries()) {
      if (!v || k === "page" || k === "limit" || k === "fmt" || k === "report_name") continue;
      out[k] = v;
    }
    if (!out.report_type) out.report_type = reportType;
    return out;
  }, [searchParams, reportType]);

  const formatReportCell = useCallback((col, val) => {
    if (val == null || val === "") return "-";
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "number") return val.toLocaleString("en-IN");
    if (["scheduled_bus_out", "actual_bus_out", "scheduled_bus_in", "actual_bus_in", "start_time", "end_time", "plan_start_time", "plan_end_time"].includes(col) && typeof val === "string") {
      return toAmPm(val);
    }
    if (["date", "period_start", "period_end"].includes(col) && typeof val === "string") return formatDateIN(val);
    if (["created_at", "occurred_at", "updated_at"].includes(col) && typeof val === "string") return formatDateTimeIN(val);
    return String(val).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  }, []);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await API.get("/reports", { params: { ...baseParams, page, limit: 20 } });
      setReport(data);
    } catch (err) {
      const msg = formatApiError(err.response?.data?.detail) || err.message || "Failed to load report";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [baseParams]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const download = (fmt) => {
    const q = new URLSearchParams({ ...baseParams, page: 1, limit: 20, fmt });
    const o = getBackendOrigin();
    window.open(`${o || ""}/api/reports/download?${q}`, "_blank");
  };

  return (
    <div data-testid="reports-view-page" className="space-y-4">
      <div className="page-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/reports")} data-testid="reports-back-btn">
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="page-title text-2xl font-bold text-[#1A1A1A] tracking-tight">{title}</h1>
            <p className="text-sm text-gray-500 mt-1">Report preview and downloads</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => download("excel")} variant="outline" data-testid="reports-view-excel-btn">
            <Download size={14} className="mr-1.5 text-green-600" /> Excel
          </Button>
          <Button onClick={() => download("pdf")} variant="outline" data-testid="reports-view-pdf-btn">
            <Download size={14} className="mr-1.5 text-red-500" /> PDF
          </Button>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span>{title} — preview</span>
            <span className="text-sm font-normal text-gray-500">
              {report?.count ?? 0} records (page {report?.page ?? 1} of {report?.pages ?? 1})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && !loading ? (
            <div className="mx-4 mt-4 rounded-lg border border-red-100 bg-red-50/90 px-4 py-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          ) : null}
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2">
              <RingLoader />
              <p className="text-xs text-gray-500">Loading…</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow className="table-header">
                    {previewCols.map((c) => (
                      <TableHead key={c} className="whitespace-nowrap">{headerLabel(reportType, c)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report?.data?.map((row, i) => (
                    <TableRow key={i} className="hover:bg-gray-50">
                      {previewCols.map((c) => (
                        <TableCell key={c} className="font-mono text-sm align-top whitespace-normal break-words">
                          <span className="whitespace-pre-wrap break-words">
                            {formatReportCell(c, row[c])}
                          </span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {(report?.data?.length || 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={Math.max(1, previewCols.length)} className="text-center text-gray-400 py-8">No data</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          <TablePaginationBar
            page={report?.page ?? 1}
            pages={report?.pages ?? 1}
            total={report?.count ?? 0}
            limit={report?.limit ?? 20}
            onPageChange={(p) => load(p)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

