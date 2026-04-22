import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse } from "@/lib/api";
import { Endpoints } from "@/lib/endpoints";
import { toast } from "sonner";

/**
 * Hook to fetch paginated duties with filtering.
 */
export const useDuties = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["duties", "list", filters],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.operations.duties.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
    ...options,
  });
};

/**
 * Hook to fetch a single duty detail.
 */
export const useDutyDetail = (dutyId, options = {}) => {
  return useQuery({
    queryKey: ["duties", "detail", dutyId],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.operations.duties.detail(dutyId));
      return data;
    },
    enabled: !!dutyId,
    ...options,
  });
};

/**
 * Hook to fetch aggregated summary metrics for duties.
 */
export const useDutySummaryMetrics = (filters = {}, options = {}) => {
  return useQuery({
    queryKey: ["duties", "metrics", filters],
    queryFn: async () => {
      const { data } = await API.get(Endpoints.operations.duties.summaryMetrics(), {
        params: buildQuery(filters),
      });
      return data;
    },
    ...options,
  });
};

/**
 * Mutation hooks for duty operations.
 */
export const useDutyMutations = () => {
  const queryClient = useQueryClient();

  const deleteDuty = useMutation({
    mutationFn: (id) => API.delete(Endpoints.operations.duties.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duties"] });
      toast.success("Duty assignment removed");
    },
  });

  const sendSms = useMutation({
    mutationFn: (id) => API.post(Endpoints.operations.duties.sendSms(id)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["duties"] });
      toast.success(`SMS sent to ${data.data.phone}`);
    },
  });

  const sendAllSms = useMutation({
    mutationFn: (date) => API.post(Endpoints.operations.duties.sendAllSms(date)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["duties"] });
      toast.success(data.data.message);
    },
  });

  const createDuty = useMutation({
    mutationFn: (payload) => API.post(Endpoints.operations.duties.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duties"] });
    },
  });

  const updateDuty = useMutation({
    mutationFn: ({ id, patch }) => API.put(Endpoints.operations.duties.update(id), patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duties"] });
    },
  });

  const cancelFollowingTrips = useMutation({
    mutationFn: ({ id, payload }) => API.post(Endpoints.operations.duties.cancelFollowingTrips(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duties"] });
    },
  });

  return {
    deleteDuty,
    sendSms,
    sendAllSms,
    createDuty,
    updateDuty,
    cancelFollowingTrips,
  };
};

export default useDuties;
