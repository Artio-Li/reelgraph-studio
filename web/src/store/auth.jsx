import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../lib/api.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { user: u } = await api.me();
      setUser(u);
      return u;
    } catch {
      setToken('');
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const out = await api.login({ email, password });
    setToken(out.token);
    setUser(out.user);
    return out.user;
  }, []);

  const register = useCallback(async (email, password, name, ref) => {
    const out = await api.register({ email, password, name, ref });
    setToken(out.token);
    setUser(out.user);
    return out.user;
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setUser(null);
  }, []);

  // 积分变动后局部更新，避免整页闪烁
  const patchUser = useCallback((patch) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, patchUser }),
    [user, loading, login, register, logout, refresh, patchUser]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
