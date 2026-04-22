import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const kmKeys = {
  all: ["km"],
  details: (filters) => [...kmKeys.all, "details", filters],
  summary: (filters) => [...kmKeys.all, "summary", filters],
  approvals: (filters) => [...kmKeys.all, "approvals", filters],
};

export function useKmDetails(filters) {
  return useQuery({
    queryKey: kmKeys.details(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.km.details(), {
        params: buildQuery(filters),
      });
      return data;
    },
  });
}

export function useKmSummary(filters) {
  return useQuery({
    queryKey: kmKeys.summary(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.km.summary(), {
        params: buildQuery(filters),
      });
      return data;
    },
  });
}

export function useKmApprovals(filters) {
  return useQuery({
    queryKey: kmKeys.approvals(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.tripKmApprovals.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useKmMutations() {
  const queryClient = useQueryClient();

  const updateTripKm = useMutation({
    mutationFn: (payload) => API.patch(Endpoints.km.tripRowPatch(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kmKeys.all });
      toast.success("Trip KM updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to update trip KM"));
    },
  });

  const approveKm = useMutation({
    mutationFn: (payload) => API.post(Endpoints.tripKmApprovals.approve(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kmKeys.all });
      toast.success("KM records approved");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to approve KM"));
    },
  });

  return {
    updateTripKm: updateTripKm.mutateAsync,
    approveKm: approveKm.mutateAsync,
    isSubmitting: updateTripKm.isPending || approveKm.isPending,
  };
}
