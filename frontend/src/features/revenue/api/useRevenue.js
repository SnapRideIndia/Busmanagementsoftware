import { useQuery } from "@tanstack/react-query";
import API, { buildQuery } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";

export const revenueKeys = {
  all: ["revenue"],
  details: (filters) => [...revenueKeys.all, "details", filters],
  passengers: (filters) => [...revenueKeys.all, "passengers", filters],
};

export function useRevenueDetails(filters) {
  return useQuery({
    queryKey: revenueKeys.details(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.revenue.details(), {
        params: buildQuery(filters),
      });
      return data;
    },
  });
}

export function usePassengerDetails(filters) {
  return useQuery({
    queryKey: revenueKeys.passengers(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.passengers.details(), {
        params: buildQuery(filters),
      });
      return data;
    },
  });
}
