import { Button } from "./ui/button";

export default function TablePaginationBar({
  page = 1,
  pages = 1,
  total = 0,
  limit = 20,
  onPageChange,
  className = "",
}) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  if (pages <= 1 && total <= limit) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 py-3 px-2 border-t border-gray-100 bg-gray-50/80 ${className}`}
      data-testid="table-pagination"
    >
      <p className="text-sm text-gray-600">
        Showing <span className="font-medium text-gray-900">{from}</span>–
        <span className="font-medium text-gray-900">{to}</span> of{" "}
        <span className="font-medium text-gray-900">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="text-sm text-gray-500 tabular-nums">
          Page {page} / {pages}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
