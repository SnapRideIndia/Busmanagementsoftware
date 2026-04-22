import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const terminalKeys = {
  all: ["terminals"],
  list: (filters) => [...terminalKeys.all, "list", filters],
};

export function useTerminals(filters) {
  return useQuery({
    queryKey: terminalKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.terminals.list(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useTerminalMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.terminals.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalKeys.all });
      toast.success("Terminal created");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Could not create terminal"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => API.put(Endpoints.masters.terminals.update(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalKeys.all });
      toast.success("Terminal updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Could not update terminal"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => API.delete(Endpoints.masters.terminals.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalKeys.all });
      toast.success("Deleted");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Could not delete terminal"));
    },
  });

  return {
    createTerminal: createMutation.mutateAsync,
    updateTerminal: updateMutation.mutateAsync,
    deleteTerminal: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
