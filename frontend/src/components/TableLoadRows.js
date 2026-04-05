import { Fragment } from "react";
import { TableRow, TableCell } from "./ui/table";
import { Button } from "./ui/button";
import RingLoader from "./RingLoader";

/**
 * Table body rows for loading / error / empty / data.
 * When not loading and no error and not empty, render `children` (e.g. mapped rows).
 */
export default function TableLoadRows({
  colSpan,
  loading,
  error,
  onRetry,
  isEmpty,
  emptyMessage = "No records found",
  children,
}) {
  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="h-44 align-middle">
          <div className="flex flex-col items-center justify-center gap-2 py-6">
            <RingLoader />
            <p className="text-xs text-gray-500">Loading…</p>
          </div>
        </TableCell>
      </TableRow>
    );
  }
  if (error) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-10 text-center">
          <p className="text-sm text-red-600 mb-3 max-w-lg mx-auto">{error}</p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </TableCell>
      </TableRow>
    );
  }
  if (isEmpty) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="text-center text-gray-500 py-10">
          {emptyMessage}
        </TableCell>
      </TableRow>
    );
  }
  return <Fragment>{children}</Fragment>;
}
