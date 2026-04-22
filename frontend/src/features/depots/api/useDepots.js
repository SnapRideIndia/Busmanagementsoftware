import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const depotKeys = {
  all: ["depots"],
  list: (filters) => [...depotKeys.all, "list", filters],
};

/** Hook for sorted depot names (used in filters) */
export function useAllDepotNames(options = {}) {
  return useQuery({
    queryKey: [...depotKeys.all, "names"],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.depots.list(), { params: { limit: 1000 } });
      const u = unwrapListResponse(data);
      return u.items.map((d) => d.name).filter(Boolean).sort();
    },
    staleTime: 30 * 60 * 1000, // 30 mins
    ...options,
  });
}

/** Hook for paginated depot list */
export function useDepots(filters) {
  return useQuery({
    queryKey: depotKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.depots.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useDepotMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.depots.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: depotKeys.all });
      toast.success("Depot added");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to add depot");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ name, payload }) => API.put(Endpoints.masters.depots.update(name), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: depotKeys.all });
      toast.success("Depot updated");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to update depot");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name) => API.delete(Endpoints.masters.depots.remove(name)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: depotKeys.all });
      toast.success("Deleted");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to delete depot");
    },
  });

  return {
    createDepot: createMutation.mutateAsync,
    updateDepot: updateMutation.mutateAsync,
    deleteDepot: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
