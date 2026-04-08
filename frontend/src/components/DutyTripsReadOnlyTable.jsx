import { formatTripReason, tripStatusBadgeClass, dutyDashTime } from "../lib/dutyTrips";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * Read-only timetable for trips on a duty (used on duty list expand + duty summary cards).
 */
export default function DutyTripsReadOnlyTable({ trips, className = "" }) {
  const list = trips?.length ? trips : [];
  return (
    <div className={`overflow-x-auto rounded-md border border-gray-200 bg-white ${className}`}>
      <Table>
        <TableHeader>
          <TableRow className="table-header">
            <TableHead className="whitespace-nowrap w-10">#</TableHead>
            <TableHead className="whitespace-nowrap">Direction</TableHead>
            <TableHead className="whitespace-nowrap">Trip ID</TableHead>
            <TableHead className="whitespace-nowrap">Sch. dep</TableHead>
            <TableHead className="whitespace-nowrap">Sch. arr</TableHead>
            <TableHead className="whitespace-nowrap">Act. dep</TableHead>
            <TableHead className="whitespace-nowrap">Act. arr</TableHead>
            <TableHead className="whitespace-nowrap">Status</TableHead>
            <TableHead className="whitespace-nowrap min-w-[120px]">Reason / note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((t) => {
            const reason = formatTripReason({
              trip_status: t.trip_status,
              cancel_reason_code: t.cancel_reason_code,
              cancel_reason_custom: t.cancel_reason_custom,
            });
            return (
              <TableRow key={t.trip_number} className="text-xs">
                <TableCell className="font-mono font-medium">{t.trip_number}</TableCell>
                <TableCell className="capitalize text-gray-700">{t.direction || "—"}</TableCell>
                <TableCell className="font-mono text-gray-600 min-w-0 break-all whitespace-normal" title={t.trip_id || ""}>
                  {t.trip_id && String(t.trip_id).trim() ? t.trip_id : "-"}
                </TableCell>
                <TableCell className="font-mono">{dutyDashTime(t.start_time)}</TableCell>
                <TableCell className="font-mono">{dutyDashTime(t.end_time)}</TableCell>
                <TableCell className="font-mono">{dutyDashTime(t.actual_start_time)}</TableCell>
                <TableCell className="font-mono">{dutyDashTime(t.actual_end_time)}</TableCell>
                <TableCell>
                  <Badge className={`${tripStatusBadgeClass(t.trip_status)} text-[10px] font-normal`}>
                    {(t.trip_status || "scheduled").replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-gray-700 max-w-[220px]">{reason || "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
