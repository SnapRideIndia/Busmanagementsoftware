import { useMutation, useQueryClient } from "@tanstack/react-query";
import API from "@/lib/api";
import { Endpoints } from "@/lib/endpoints";
import { toast } from "sonner";

export const useBusMutations = () => {
  const queryClient = useQueryClient();

  const createBus = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.buses.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buses"] });
      toast.success("Bus added successfully");
    },
  });

  const updateBus = useMutation({
    mutationFn: ({ busId, payload }) =>
      API.put(Endpoints.masters.buses.update(busId), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buses"] });
      toast.success("Bus updated successfully");
    },
  });

  const deleteBus = useMutation({
    mutationFn: (busId) => API.delete(Endpoints.masters.buses.remove(busId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buses"] });
      toast.success("Bus deleted successfully");
    },
  });

  const assignTender = useMutation({
    mutationFn: ({ busId, tenderId }) =>
      API.put(Endpoints.masters.buses.assignTender(busId, tenderId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buses"] });
      toast.success("Tender assigned successfully");
    },
  });

  return {
    createBus,
    updateBus,
    deleteBus,
    assignTender,
  };
};

export default useBusMutations;
