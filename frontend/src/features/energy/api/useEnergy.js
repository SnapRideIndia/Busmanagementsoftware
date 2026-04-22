import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const energyKeys = {
  all: ["energy"],
  logs: (filters) => [...energyKeys.all, "logs", filters],
  report: (filters) => [...energyKeys.all, "report", filters],
};

export function useEnergyLogs(filters) {
  return useQuery({
    queryKey: energyKeys.logs(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.energy.root(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useEnergyReport(filters) {
  return useQuery({
    queryKey: energyKeys.report(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.energy.report(), {
        params: buildQuery(filters),
      });
      return data;
    },
  });
}

export function useEnergyMutations() {
  const queryClient = useQueryClient();

  const addLogMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.energy.root(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: energyKeys.all });
      toast.success("Diesel log added");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to add diesel log"));
    },
  });

  const deleteLogMutation = useMutation({
    mutationFn: (id) => API.delete(`${Endpoints.energy.root()}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: energyKeys.all });
      toast.success("Log entry removed");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to remove log entry"));
    },
  });

  return {
    addLog: addLogMutation.mutateAsync,
    deleteLog: deleteLogMutation.mutateAsync,
    isSubmitting: addLogMutation.isPending,
  };
}
