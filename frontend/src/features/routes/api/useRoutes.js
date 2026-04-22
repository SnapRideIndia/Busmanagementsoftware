import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, fetchAllPaginated } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const routeKeys = {
  all: ["routes"],
  list: (filters) => [...routeKeys.all, "list", filters],
  geofences: ["routes", "geofences"],
};

export function useRoutes(filters) {
  return useQuery({
    queryKey: routeKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.routes.legacyList(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useAllRoutes(options = {}) {
  return useQuery({
    queryKey: [...routeKeys.all, "all"],
    queryFn: () => fetchAllPaginated(Endpoints.masters.routes.legacyList(), {}),
    ...options,
  });
}

/** Hook to fetch all route geofences for mapping status badges */
export function useRouteGeofences() {
  return useQuery({
    queryKey: routeKeys.geofences,
    queryFn: async () => {
      const geofences = await fetchAllPaginated(Endpoints.masters.geofences.list(), { type: "route" });
      const gMap = {};
      (geofences || []).forEach((g) => {
        gMap[g.entity_ref] = { id: g.geofence_id, active: !!g.active, buffer_m: g.buffer_m };
      });
      return gMap;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useRouteMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.routes.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routeKeys.all });
      toast.success("Route created");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to create route");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.put(Endpoints.masters.routes.update(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routeKeys.all });
      toast.success("Route updated");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to update route");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => API.delete(Endpoints.masters.routes.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routeKeys.all });
      toast.success("Deleted");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to delete route");
    },
  });

  return {
    createRoute: createMutation.mutateAsync,
    updateRoute: updateMutation.mutateAsync,
    deleteRoute: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
