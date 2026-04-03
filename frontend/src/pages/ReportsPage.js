import { useState } from "react";
import API from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { FileBarChart, Download } from "lucide-react";
import { toast } from "sonner";

export default function ReportsPage() {
  const [reportType, setReportType] = useState("operations");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const params = { report_type: reportType };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await API.get("/reports", { params });
      setReport(data); toast.success(`${data.count} records found`);
    } catch {} finally { setLoading(false); }
  };

  const download = (fmt) => {
    const params = new URLSearchParams({ report_type: reportType, fmt });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/download?${params}`, "_blank");
  };

  const cols = {
    operations: ["bus_id", "driver_id", "date", "scheduled_km", "actual_km"],
    energy: ["bus_id", "date", "units_charged", "tariff_rate"],
    incidents: ["id", "incident_type", "bus_id", "severity", "status"],
    billing: ["invoice_id", "period_start", "period_end", "base_payment", "final_payable"],
  };

  return (
    <div data-testid="reports-page">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
      </div>

      <Card className="border-gray-200 shadow-sm mb-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase text-gray-500">Report Type</label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger className="w-48" data-testid="report-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="energy">Energy</SelectItem>
                  <SelectItem value="incidents">Incidents</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="report-date-from" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="report-date-to" />
            </div>
            <Button onClick={generate} disabled={loading} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="generate-report-btn">
              <FileBarChart size={14} className="mr-1.5" /> {loading ? "Loading..." : "Generate"}
            </Button>
            <Button onClick={() => download("excel")} variant="outline" data-testid="download-excel-btn">
              <Download size={14} className="mr-1.5 text-green-600" /> Excel
            </Button>
            <Button onClick={() => download("pdf")} variant="outline" data-testid="download-pdf-btn">
              <Download size={14} className="mr-1.5 text-red-500" /> PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {report && (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{report.type?.charAt(0).toUpperCase() + report.type?.slice(1)} Report</span>
              <span className="text-sm font-normal text-gray-500">{report.count} records</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="table-header">
                  {(cols[reportType] || []).map((c) => <TableHead key={c} className="capitalize">{c.replace(/_/g, " ")}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {report.data?.slice(0, 100).map((row, i) => (
                    <TableRow key={i} className="hover:bg-gray-50">
                      {(cols[reportType] || []).map((c) => (
                        <TableCell key={c} className="font-mono text-sm">{typeof row[c] === "number" ? row[c].toLocaleString() : (row[c] || "-")}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {report.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-8">No data</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
