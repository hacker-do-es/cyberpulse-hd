import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type Me, type Permission } from '@/services/hdApi';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: number | null) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await authApi.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* Any API call that comes back 401 (expired session, account disabled)
     drops the user to the login screen. */
  useEffect(() => {
    const onUnauthorized = () => setMe(null);
    window.addEventListener('cp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('cp:unauthorized', onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setMe(null);
    }
  }, []);

  const switchTenant = useCallback(async (tenantId: number | null) => {
    await authApi.setActiveTenant(tenantId);
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, logout, switchTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/* What the signed-in user may do (buttons and tabs only; the server checks
   every request again). */
// eslint-disable-next-line react-refresh/only-export-components
export function useCan(): (perm: Permission) => boolean {
  const { me } = useAuth();
  return useCallback((perm: Permission) => Boolean(me?.permissions?.includes(perm)), [me]);
}

/* Wraps window.fetch once so a 401 from any /api call (other than the login
   endpoints themselves) signals the session is gone. */
// eslint-disable-next-line react-refresh/only-export-components
export function installUnauthorizedInterceptor() {
  const w = window as unknown as { __cpFetchPatched?: boolean };
  if (w.__cpFetchPatched) return;
  w.__cpFetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
      window.dispatchEvent(new Event('cp:unauthorized'));
    }
    return res;
  };
}
