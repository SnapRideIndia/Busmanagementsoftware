import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const ruleKeys = {
  all: ["business-rules"],
  list: (filters) => [...ruleKeys.all, "list", filters],
};

export function useBusinessRules(filters) {
  return useQuery({
    queryKey: ruleKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.businessRules.root(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useBusinessRuleMutations() {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.businessRules.root(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.all });
      toast.success("Rule updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to save rule"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key) => API.delete(Endpoints.masters.businessRules.remove(key)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ruleKeys.all });
      toast.success("Rule deleted");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to delete rule"));
    },
  });

  return {
    saveRule: saveMutation.mutateAsync,
    deleteRule: deleteMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
