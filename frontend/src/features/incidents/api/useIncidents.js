import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const incidentKeys = {
  all: ["incidents"],
  list: (filters) => [...incidentKeys.all, "list", filters],
  detail: (id) => [...incidentKeys.all, "detail", id],
  meta: () => [...incidentKeys.all, "meta"],
  escalations: () => [...incidentKeys.all, "escalations"],
};

export function useIncidentMeta() {
  return useQuery({
    queryKey: incidentKeys.meta(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.incidents.meta());
      return data;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useEscalations() {
  return useQuery({
    queryKey: incidentKeys.escalations(),
    queryFn: async () => {
      const { data } = await API.get("/escalation-check");
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useIncidents(filters) {
  return useQuery({
    queryKey: incidentKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.incidents.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useIncident(id) {
  return useQuery({
    queryKey: incidentKeys.detail(id),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.incidents.get(id));
      return data;
    },
    enabled: !!id,
  });
}

export function useIncidentMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async ({ payload, files }) => {
      const { data: created } = await API.post(Endpoints.incidents.create(), payload);
      const incidentId = created?.id;
      if (incidentId && files?.length) {
        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file);
          await API.post(Endpoints.incidents.attachments(incidentId), fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentKeys.all });
      toast.success("Incident reported");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to report incident"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.put(Endpoints.incidents.update(id), payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: incidentKeys.all });
      toast.success("Incident updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to update incident"));
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, note }) => API.post(Endpoints.incidents.addNote(id), { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentKeys.all });
      toast.success("Note added");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to add note"));
    },
  });

  const closeInfractionMutation = useMutation({
    mutationFn: ({ id, index, remarks }) =>
      API.put(Endpoints.incidents.closeInfraction(id, index), { close_remarks: remarks }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentKeys.all });
      toast.success("Infraction closed");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to close infraction"));
    },
  });

  return {
    createIncident: createMutation.mutateAsync,
    updateIncident: updateMutation.mutateAsync,
    addNote: addNoteMutation.mutateAsync,
    closeInfraction: closeInfractionMutation.mutateAsync,
    isSubmitting: createMutation.isPending || updateMutation.isPending,
  };
}
