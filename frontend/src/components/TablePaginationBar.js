import { Button } from "./ui/button";

export default function TablePaginationBar({
  page = 1,
  pages = 1,
  total = 0,
  limit = 30,
  onPageChange,
  onLimitChange,
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
      <div className="flex items-center gap-6">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium text-gray-900">{from}</span>–
          <span className="font-medium text-gray-900">{to}</span> of{" "}
          <span className="font-medium text-gray-900">{total}</span>
        </p>
        
        {onLimitChange && (
          <div className="flex items-center gap-2 border-l pl-6 border-gray-200">
             <span className="text-[10px] uppercase font-black tracking-widest text-gray-400">Rows</span>
             <select 
               value={limit} 
               onChange={(e) => onLimitChange(Number(e.target.value))}
               className="bg-transparent border-none text-sm font-bold text-gray-700 focus:ring-0 cursor-pointer hover:text-[#C8102E] transition-colors"
             >
               <option value={30}>30</option>
               <option value={50}>50</option>
               <option value={100}>100</option>
             </select>
          </div>
        )}
      </div>
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
