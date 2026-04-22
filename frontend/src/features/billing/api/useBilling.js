import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const billingKeys = {
  all: ["billing"],
  list: (filters) => [...billingKeys.all, "list", filters],
  detail: (id) => [...billingKeys.all, "detail", id],
  tripIds: (filters) => [...billingKeys.all, "trip-ids", filters],
};

export function useBillingList(filters) {
  return useQuery({
    queryKey: billingKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.billing.root(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useBillingDetail(id) {
  return useQuery({
    queryKey: billingKeys.detail(id),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.billing.get(id));
      return data;
    },
    enabled: !!id,
  });
}

export function useBillingTripIds(filters) {
  return useQuery({
    queryKey: billingKeys.tripIds(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.billing.tripIds(), {
        params: buildQuery(filters),
      });
      return data?.items || [];
    },
    enabled: !!filters.bus_id && !!filters.date,
  });
}

export function useBillingMutations() {
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.billing.generate(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
      toast.success("Bill generated successfully");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to generate bill"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.patch(Endpoints.billing.patch(id), payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
      toast.success("Bill updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to update bill"));
    },
  });

  return {
    generateBill: generateMutation.mutateAsync,
    updateBill: updateMutation.mutateAsync,
    isSubmitting: generateMutation.isPending || updateMutation.isPending,
  };
}
