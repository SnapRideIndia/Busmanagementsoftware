import { useQuery } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, fetchAllPaginated } from "@/lib/api";
import { Endpoints } from "@/lib/endpoints";

/**
 * Hook to fetch paginated drivers with filtering.
 */
export const useDrivers = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["drivers", "list", filters],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.drivers.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
    ...options,
  });
};

/**
 * Hook to fetch all drivers (useful for dropdowns/assignments).
 */
export const useAllDrivers = (options = {}) => {
  return useQuery({
    queryKey: ["drivers", "all"],
    queryFn: () => fetchAllPaginated(Endpoints.masters.drivers.list(), {}),
    ...options,
  });
};

/**
 * Hook to fetch driver performance.
 */
export const useDriverPerformance = (licenseNumber, options = {}) => {
  return useQuery({
    queryKey: ["drivers", "performance", licenseNumber],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.drivers.performance(licenseNumber));
      return data;
    },
    enabled: !!licenseNumber,
    ...options,
  });
};

export default useDrivers;
