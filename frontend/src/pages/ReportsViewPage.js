import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API, { formatApiError, getBackendOrigin } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { SIMPLE_REPORT_NAMES, columnsForPreview, formatReportCellValue, headerLabel } from "../lib/reportPreview";
import TablePaginationBar from "../components/TablePaginationBar";
import RingLoader from "../components/RingLoader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

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
    return formatReportCellValue(col, val, { time12h: true });
  }, []);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await API.get(Endpoints.reports.run(), { params: { ...baseParams, page, limit: 30 } });
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
    const q = new URLSearchParams({ ...baseParams, page: 1, limit: 30, fmt });
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
              <Table className="min-w-max text-[12px]">
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
                        <TableCell key={c} className="font-mono text-[12px] align-top whitespace-normal break-words">
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

