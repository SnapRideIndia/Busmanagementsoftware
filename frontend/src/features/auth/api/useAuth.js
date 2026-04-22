import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import API, { storeAuthTokens, clearStoredAuthTokens } from "../../../lib/api";
import { Endpoints } from "../../../lib/endpoints";

export const authKeys = {
  session: ["auth", "session"],
};

/** Hook to get current user session */
export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: async () => {
      try {
        const { data } = await API.get(Endpoints.auth.me());
        return data;
      } catch (err) {
        // Fallback to null if not authenticated
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry auth checks
  });
}

/** Mutation for login */
export function useLogin() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ email, password }) => {
      const { data: loginData } = await API.post(Endpoints.auth.login(), { email, password });
      storeAuthTokens(loginData?.token || "", loginData?.refresh_token || "");
      
      const { data: userData } = await API.get(Endpoints.auth.me());
      return userData;
    },
    onSuccess: (userData) => {
      queryClient.setQueryData(authKeys.session, userData);
    },
  });
}

/** Mutation for logout */
export function useLogout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      try {
        await API.post(Endpoints.auth.logout());
      } finally {
        clearStoredAuthTokens();
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(authKeys.session, null);
      queryClient.clear(); // Clear all cache on logout
    },
  });
}
