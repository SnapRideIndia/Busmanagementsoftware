import { useQuery } from "@tanstack/react-query";
import API, { buildQuery } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";

export const dashboardKeys = {
  all: ["dashboard"],
  stats: (filters) => [...dashboardKeys.all, "stats", filters],
};

export function useDashboardStats(filters) {
  const params = buildQuery(filters);
  
  return useQuery({
    queryKey: dashboardKeys.stats(filters),
    queryFn: async () => {
      const [{ data: d }, { data: km }] = await Promise.all([
        API.get(Endpoints.dashboard.root(), { params }),
        API.get(Endpoints.km.summary(), { params }),
      ]);
      
      const kmTotals = km?.totals || {};
      const kmToday = km?.today || {};
      const kmDaySeries = Array.isArray(km?.series?.day_wise) ? km.series.day_wise : [];
      
      return {
        ...d,
        total_km: kmTotals.actual_km ?? d.total_km,
        scheduled_km: kmTotals.scheduled_km ?? d.scheduled_km,
        availability_pct:
          kmTotals.scheduled_km > 0
            ? Math.round((Number(kmTotals.actual_km || 0) / Number(kmTotals.scheduled_km || 0)) * 1000) / 10
            : d.availability_pct,
        total_km_today: kmToday.actual_km ?? d.total_km_today,
        scheduled_km_today: kmToday.scheduled_km ?? d.scheduled_km_today,
        km_chart: kmDaySeries.length ? kmDaySeries : d.km_chart,
      };
    },
    staleTime: 60 * 1000, // 1 minute
  });
}
