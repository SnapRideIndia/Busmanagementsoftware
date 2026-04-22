import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Detail / secondary page header: title, optional description, breadcrumbs below.
 * @param {Object} props
 * @param {string} props.title
 * @param {string} [props.description]
 * @param {{ label: string, to?: string }[]} [props.breadcrumbs] — last item is usually current (omit `to`)
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.actions] — right side (e.g. buttons)
 */
export default function HeaderSecondary({ title, description, breadcrumbs = [], className, actions }) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h1 className="page-title">{title}</h1>
          {description ? <p className="page-desc max-w-3xl text-gray-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {breadcrumbs.length > 0 ? (
        <nav className="mt-3 flex flex-wrap items-center gap-1 text-xs text-gray-500" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400 mx-0.5" aria-hidden /> : null}
                {crumb.to && !isLast ? (
                  <Link to={crumb.to} className="text-[#C8102E] font-medium hover:underline truncate max-w-[200px] sm:max-w-none">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className={cn("truncate max-w-[220px] sm:max-w-none", isLast ? "text-gray-800 font-medium" : "text-gray-600")}>{crumb.label}</span>
                )}
              </Fragment>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
