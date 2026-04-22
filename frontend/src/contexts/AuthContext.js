import { createContext, useContext } from "react";
import { useSession, useLogin, useLogout } from "../features/auth/api/useAuth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { data: user, isLoading: loading, refetch: checkAuth } = useSession();
  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const login = async (email, password) => {
    return loginMutation.mutateAsync({ email, password });
  };

  const logout = async () => {
    return logoutMutation.mutateAsync();
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading: loading && user === undefined, // Consider loading only if we don't have a cached session yet
      userLoaded: !loading,
      login,
      logout,
      checkAuth,
      loginLoading: loginMutation.isPending,
      logoutLoading: logoutMutation.isPending
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
