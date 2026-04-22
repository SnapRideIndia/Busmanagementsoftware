import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { unwrapListResponse, messageFromAxiosError } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";
import { toast } from "sonner";

export const adminKeys = {
  all: ["admin"],
  users: (filters) => [...adminKeys.all, "users", filters],
  roles: () => [...adminKeys.all, "roles"],
  catalog: () => [...adminKeys.all, "catalog"],
  matrix: () => [...adminKeys.all, "matrix"],
};

export function useAdminUsers(filters) {
  return useQuery({
    queryKey: adminKeys.users(filters),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.admin.users(), {
        params: { ...filters, limit: 100 },
      });
      return unwrapListResponse(data);
    },
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: adminKeys.roles(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.admin.roles());
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePermissionsCatalog() {
  return useQuery({
    queryKey: adminKeys.catalog(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.admin.permissionsCatalog());
      return Array.isArray(data) ? data : [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function usePermissionsMatrix() {
  return useQuery({
    queryKey: adminKeys.matrix(),
    queryFn: async () => {
      const { data } = await API.get(Endpoints.admin.permissionsMatrix());
      return data?.matrix || {};
    },
  });
}

export function useAdminMutations() {
  const queryClient = useQueryClient();

  const setRoleMutation = useMutation({
    mutationFn: ({ userId, role }) => API.put(Endpoints.admin.setUserRole(userId), { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.all });
      toast.success("User role updated");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to update role"));
    },
  });

  const savePermsMutation = useMutation({
    mutationFn: ({ roleId, permissions }) =>
      API.put(Endpoints.admin.setRolePermissions(roleId), { permission_ids: permissions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.matrix() });
      toast.success("Permissions saved");
    },
    onError: (err) => {
      toast.error(messageFromAxiosError(err, "Failed to save permissions"));
    },
  });

  return {
    setUserRole: setRoleMutation.mutateAsync,
    savePermissions: savePermsMutation.mutateAsync,
    isSaving: setRoleMutation.isPending || savePermsMutation.isPending,
  };
}
