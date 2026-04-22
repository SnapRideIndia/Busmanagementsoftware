import { useQuery } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";

export const trackingKeys = {
  all: ["tracking"],
  livePositions: () => [...trackingKeys.all, "live-positions"],
  alerts: (filters) => [...trackingKeys.all, "alerts", filters],
};

export function useLivePositions() {
  return useQuery({
    queryKey: trackingKeys.livePositions(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.operations.live.telemetryPositions());
      // Expecting a list of positions
      return data?.positions || data || [];
    },
    refetchInterval: 10000, // Poll every 10 seconds for live updates
  });
}

export function useAlerts(filters) {
  return useQuery({
    queryKey: trackingKeys.alerts(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.alerts.center(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
    refetchInterval: 30000, // Poll every 30 seconds for new alerts
  });
}
