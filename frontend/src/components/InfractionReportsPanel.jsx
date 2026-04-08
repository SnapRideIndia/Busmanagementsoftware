import { useMemo, useState } from "react";
import { buildQuery, getBackendOrigin } from "../lib/api";
import ReportDownloads from "./ReportDownloads";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const REPORT_OPTIONS = [
  { value: "infractions_catalogue", label: "All infractions (master catalogue)" },
  { value: "infractions_logged", label: "Service wise infractions" },
  { value: "infractions_driver_wise", label: "Driver wise infractions" },
  { value: "infractions_vehicle_wise", label: "Vehicle wise infractions" },
  { value: "infractions_conductor_wise", label: "Conductor wise infractions" },
  { value: "incident_penalty_report", label: "Incident and penalty report" },
];

export default function InfractionReportsPanel({ dateFrom = "", dateTo = "", depot = "", busId = "", category = "", infractionCode = "" }) {
  const [reportType, setReportType] = useState("infractions_logged");

  const baseParams = useMemo(
    () =>
      buildQuery({
        report_type: reportType,
        date_from: dateFrom,
        date_to: dateTo,
        depot,
        bus_id: busId,
        category,
        infraction_code: infractionCode,
      }),
    [reportType, dateFrom, dateTo, depot, busId, category, infractionCode],
  );

  const makeHref = (fmt) => {
    const q = new URLSearchParams({ ...baseParams, fmt });
    const origin = getBackendOrigin();
    return `${origin || ""}/api/reports/download?${q.toString()}`;
  };

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
        <div className="space-y-1 min-w-[220px]">
          <Label className="text-xs text-gray-600">Infraction report</Label>
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger className="w-full" data-testid="infractions-report-type">
              <SelectValue placeholder="Select report" />
            </SelectTrigger>
            <SelectContent>
              {REPORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ReportDownloads className="sm:ml-auto" pdfHref={makeHref("pdf")} excelHref={makeHref("excel")} />
      </CardContent>
    </Card>
  );
}
