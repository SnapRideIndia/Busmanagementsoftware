import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const geofenceKeys = {
  all: ["geofences"],
  list: (filters) => [...geofenceKeys.all, "list", filters],
  events: (filters) => [...geofenceKeys.all, "events", filters],
  stats: () => [...geofenceKeys.all, "stats"],
};

export function useGeofences(filters) {
  return useQuery({
    queryKey: geofenceKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.geofences.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useGeofenceEvents(filters) {
  return useQuery({
    queryKey: geofenceKeys.events(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.geofences.events(), {
        params: buildQuery({ ...filters, limit: filters.limit || 20 }),
      });
      return data?.items || [];
    },
  });
}

export function useGeofenceStats() {
  return useQuery({
    queryKey: geofenceKeys.stats(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.geofences.stats());
      return data;
    },
  });
}

export function useGeofenceMutations() {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id) => API.delete(Endpoints.masters.geofences.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: geofenceKeys.all });
      toast.success("Geofence removed");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to remove geofence"));
    },
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.geofences.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: geofenceKeys.all });
      toast.success("Geofence saved");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to save geofence"));
    },
  });

  return {
    deleteGeofence: deleteMutation.mutateAsync,
    saveGeofence: saveMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    isSaving: saveMutation.isPending,
  };
}
