import { Button } from "./ui/button";
import { FileText, FileSpreadsheet } from "lucide-react";

/**
 * PDF and Excel download links for report exports (full URL to backend).
 */
export default function ReportDownloads({
  className = "",
  disabled = false,
  pdfHref,
  excelHref,
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className || ""}`} data-testid="report-downloads">
      {pdfHref ? (
        disabled ? (
          <Button type="button" variant="outline" size="sm" className="rounded-lg" disabled>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            PDF
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="rounded-lg" asChild>
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" data-testid="report-downloads-pdf">
              <FileText className="mr-1.5 h-3.5 w-3.5 inline-block align-middle" />
              PDF
            </a>
          </Button>
        )
      ) : null}
      {excelHref ? (
        disabled ? (
          <Button type="button" variant="outline" size="sm" className="rounded-lg" disabled>
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
            Excel
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="rounded-lg" asChild>
            <a href={excelHref} target="_blank" rel="noopener noreferrer" data-testid="report-downloads-excel">
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 inline-block align-middle" />
              Excel
            </a>
          </Button>
        )
      ) : null}
    </div>
  );
}
