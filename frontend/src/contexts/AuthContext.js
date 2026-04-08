import { createContext, useContext, useState, useEffect, useCallback } from "react";
import API from "../lib/api";
import { Endpoints } from "../lib/endpoints";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await API.get(Endpoints.auth.me());
      setUser(data);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    await API.post(Endpoints.auth.login(), { email, password });
    const { data } = await API.get(Endpoints.auth.me());
    setUser(data);
    return data;
  };

  const logout = async () => {
    await API.post(Endpoints.auth.logout());
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
