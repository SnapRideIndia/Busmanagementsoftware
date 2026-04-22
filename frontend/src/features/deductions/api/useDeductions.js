import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const deductionKeys = {
  all: ["deductions"],
  rules: () => [...deductionKeys.all, "rules"],
  history: (filters) => [...deductionKeys.all, "history", filters],
};

export function useDeductionRules() {
  return useQuery({
    queryKey: deductionKeys.rules(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.deductions.rules());
      return data?.rules || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeductionHistory(filters) {
  return useQuery({
    queryKey: deductionKeys.history(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.deductions.apply(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useDeductionMutations() {
  const queryClient = useQueryClient();

  const updateRuleMutation = useMutation({
    mutationFn: ({ key, payload }) => API.put(Endpoints.deductions.updateRule(key), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deductionKeys.rules() });
      toast.success("Deduction rule updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to update deduction rule"));
    },
  });

  const applyDeductionMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.deductions.apply(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deductionKeys.history() });
      toast.success("Deduction applied");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to apply deduction"));
    },
  });

  return {
    updateRule: updateRuleMutation.mutateAsync,
    applyDeduction: applyDeductionMutation.mutateAsync,
    isSubmitting: updateRuleMutation.isPending || applyDeductionMutation.isPending,
  };
}
