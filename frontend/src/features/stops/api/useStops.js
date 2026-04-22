import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const stopKeys = {
  all: ["stops"],
  list: (filters) => [...stopKeys.all, "list", filters],
  geofences: ["stops", "geofences"],
};

/** Hook for all stops (used in dropdowns/sequence pickers) */
export function useAllStops(options = {}) {
  return useQuery({
    queryKey: [...stopKeys.all, "all-sorted"],
    queryFn: async () => {
      const stops = await fetchAllPaginated(Endpoints.masters.stops.list(), {});
      return [...stops].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    staleTime: 10 * 60 * 1000, // 10 mins
    ...options,
  });
}

/** Hook for paginated stop list */
export function useStops(filters) {
  return useQuery({
    queryKey: stopKeys.list(filters),
    queryFn: async () => {
      const [stopsRes, geofences] = await Promise.all([
        API.get(Endpoints.masters.stops.list(), {
          params: buildQuery(filters),
        }),
        fetchAllPaginated(Endpoints.masters.geofences.list(), { type: "stop" }),
      ]);
      const u = unwrapListResponse(stopsRes.data);
      
      const gMap = {};
      (geofences || []).forEach((g) => {
        gMap[g.entity_ref] = { id: g.geofence_id, active: !!g.active };
      });
      
      return { ...u, geofenceMap: gMap };
    },
  });
}

export function useStopMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.stops.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stopKeys.all });
      toast.success("Stop created");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to create stop"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.put(Endpoints.masters.stops.update(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stopKeys.all });
      toast.success("Stop updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to update stop"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => API.delete(Endpoints.masters.stops.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stopKeys.all });
      toast.success("Deleted");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to delete stop"));
    },
  });

  return {
    createStop: createMutation.mutateAsync,
    updateStop: updateMutation.mutateAsync,
    deleteStop: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
