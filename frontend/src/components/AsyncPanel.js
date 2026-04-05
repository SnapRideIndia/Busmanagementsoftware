import { Button } from "./ui/button";
import RingLoader from "./RingLoader";

/** Full-width loading / error / empty wrapper for dashboards and non-table views. */
export default function AsyncPanel({
  loading,
  error,
  onRetry,
  empty,
  emptyMessage = "No data to display",
  minHeight = "min-h-[200px]",
  children,
}) {
  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 py-16 ${minHeight}`}>
        <RingLoader />
        <p className="text-xs text-gray-500">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`rounded-lg border border-red-100 bg-red-50/90 px-6 py-8 text-center ${minHeight} flex flex-col items-center justify-center`}>
        <p className="text-sm text-red-800 mb-4 max-w-md">{error}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  if (empty) {
    return (
      <div className={`text-center text-gray-500 py-12 ${minHeight} flex items-center justify-center`}>
        {emptyMessage}
      </div>
    );
  }
  return children;
}
