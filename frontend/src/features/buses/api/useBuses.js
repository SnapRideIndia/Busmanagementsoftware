import { useQuery } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, fetchAllPaginated } from "@/lib/api";
import { Endpoints } from "@/lib/endpoints";

/**
 * Hook to fetch paginated buses with filtering.
 */
export const useBuses = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["buses", "list", filters],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.buses.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
    ...options,
  });
};

/**
 * Hook to fetch all buses (useful for dropdowns/assignments).
 */
export const useAllBuses = (options = {}) => {
  return useQuery({
    queryKey: ["buses", "all"],
    queryFn: () => fetchAllPaginated(Endpoints.masters.buses.list(), {}),
    ...options,
  });
};

/**
 * Hook to fetch a single bus detail.
 */
export const useBusDetail = (busId, options = {}) => {
  return useQuery({
    queryKey: ["buses", "detail", busId],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.buses.get(busId));
      return data;
    },
    enabled: !!busId,
    ...options,
  });
};

export default useBuses;
