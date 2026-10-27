import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api/client.js';

const AuthContext = createContext(null);

// Accept both { user: {...} } and a bare user object from the API.
const unwrapUser = (data) => data?.user ?? data ?? null;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => api.getStoredToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(api.getStoredToken()));

  // Hydrate the user from a stored token on first mount.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (!cancelled) setUser(unwrapUser(data));
      })
      .catch((err) => {
        if (cancelled) return;
        // Only drop the session when the server rejects the token.
        // A network error keeps the token so a reload can try again.
        if (err?.response?.status === 401) {
          api.setStoredToken(null);
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Runs once on mount by design; later sessions are set by login/register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((nextToken, nextUser) => {
    api.setStoredToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (credentials) => {
      const data = await api.login(credentials);
      const nextUser = unwrapUser(data);
      persist(data.token ?? null, nextUser);
      return nextUser;
    },
    [persist]
  );

  const register = useCallback(
    async (details) => {
      const data = await api.register(details);
      const nextUser = unwrapUser(data);
      persist(data.token ?? null, nextUser);
      return nextUser;
    },
    [persist]
  );

  const logout = useCallback(() => persist(null, null), [persist]);

  // Apply a session from any flow that returns { token, user } (e.g. OTP verify).
  const setSession = useCallback(
    (data) => {
      const nextUser = unwrapUser(data);
      persist(data?.token ?? null, nextUser);
      return nextUser;
    },
    [persist]
  );

  // Refresh the user after profile edits.
  const updateUser = useCallback((next) => setUser(unwrapUser(next)), []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, setSession, updateUser }),
    [user, token, loading, login, register, logout, setSession, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
