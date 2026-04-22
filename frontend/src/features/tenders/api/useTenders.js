import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const tenderKeys = {
  all: ["tenders"],
  list: (filters) => [...tenderKeys.all, "list", filters],
};

export function useTenders(filters) {
  return useQuery({
    queryKey: tenderKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.tenders.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useAllTenders(options = {}) {
  return useQuery({
    queryKey: [...tenderKeys.all, "all"],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.tenders.list(), { params: { limit: 1000 } });
      const u = unwrapListResponse(data);
      return u.items;
    },
    ...options,
  });
}

export function useTenderMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.tenders.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
      toast.success("Tender added");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to add tender");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.put(Endpoints.masters.tenders.update(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
      toast.success("Tender updated");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to update tender");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => API.delete(Endpoints.masters.tenders.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.all });
      toast.success("Deleted");
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Failed to delete tender");
    },
  });

  return {
    createTender: createMutation.mutateAsync,
    updateTender: updateMutation.mutateAsync,
    deleteTender: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
