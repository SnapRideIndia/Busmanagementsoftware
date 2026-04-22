import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError, fetchAllPaginated } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const conductorKeys = {
  all: ["conductors"],
  list: (filters) => [...conductorKeys.all, "list", filters],
};

export function useConductors(filters) {
  return useQuery({
    queryKey: conductorKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.conductors.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useAllConductors(options = {}) {
  return useQuery({
    queryKey: [...conductorKeys.all, "all"],
    queryFn: () => fetchAllPaginated(Endpoints.masters.conductors.list(), {}),
    ...options,
  });
}

export function useConductorMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.conductors.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conductorKeys.all });
      toast.success("Conductor added");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to add conductor");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.put(Endpoints.masters.conductors.update(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conductorKeys.all });
      toast.success("Conductor updated");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to update conductor");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => API.delete(Endpoints.masters.conductors.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conductorKeys.all });
      toast.success("Deleted");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to delete conductor");
    },
  });

  return {
    createConductor: createMutation.mutateAsync,
    updateConductor: updateMutation.mutateAsync,
    deleteConductor: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
