import { useMutation, useQueryClient } from "@tanstack/react-query";
import API from "@/lib/api";
import { Endpoints } from "@/lib/endpoints";
import { toast } from "sonner";

export const useDriverMutations = () => {
  const queryClient = useQueryClient();

  const createDriver = useMutation({
    mutationFn: (payload) => API.post(Endpoints.masters.drivers.create(), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast.success("Driver added successfully");
    },
  });

  const updateDriver = useMutation({
    mutationFn: ({ licenseNumber, payload }) =>
      API.put(Endpoints.masters.drivers.update(licenseNumber), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast.success("Driver updated successfully");
    },
  });

  const deleteDriver = useMutation({
    mutationFn: (licenseNumber) =>
      API.delete(Endpoints.masters.drivers.remove(licenseNumber)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast.success("Driver deleted successfully");
    },
  });

  const assignBus = useMutation({
    mutationFn: ({ licenseNumber, busId }) =>
      API.put(Endpoints.masters.drivers.assignBus(licenseNumber, busId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast.success("Bus assigned successfully");
    },
  });

  return {
    createDriver,
    updateDriver,
    deleteDriver,
    assignBus,
  };
};

export default useDriverMutations;
