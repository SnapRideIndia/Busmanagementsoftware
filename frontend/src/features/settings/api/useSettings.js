import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { buildQuery, unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const settingKeys = {
  all: ["settings"],
  list: (filters) => [...settingKeys.all, "list", filters],
};

export function useSettings(filters) {
  return useQuery({
    queryKey: settingKeys.list(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.masters.settings.root(), {
        params: buildQuery(filters),
      });
      return unwrapListResponse(data);
    },
  });
}

export function useSettingMutations() {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.settings.root(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingKeys.all });
      toast.success("Setting saved");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to save setting"));
    },
  });

  return {
    saveSetting: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
