import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

const DEFAULT_LABELS = {
  assets:                'Asset Inventory',
  beijing_assets:        'Beijing Asset Inventory',
  ext_assets:            'Ext. Asset Inventory',
  physical_esxi_servers: 'Physical & ESXi Servers',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);
  const [pageAccess, setPageAccess] = useState({});
  const [userPageAccess, setUserPageAccess] = useState({});   // user-specific overrides
  const [canViewPasswords, setCanViewPasswords] = useState(false);
  const [builtinOverrides, setBuiltinOverrides] = useState({});
  const [branding, setBranding] = useState(() => {
    const raw = localStorage.getItem('branding');
    return raw ? JSON.parse(raw) : null;
  });

  const refreshBranding = useCallback(async () => {
    try {
      const { data } = await api.get('/branding');
      setBranding(data);
      localStorage.setItem('branding', JSON.stringify(data));
      if (data?.tool_name) document.title = data.tool_name;
    } catch { /* keep prior */ }
  }, []);

  const refreshPageAccess = useCallback(async () => {
    try {
      const { data } = await api.get('/page-access');
      setPageAccess(data.matrix || {});
    } catch {
      setPageAccess({});
    }
  }, []);

  const refreshUserPageAccess = useCallback(async () => {
    try {
      const { data } = await api.get('/user-page-control/my-access');
      setUserPageAccess(data.page_access || {});
      setCanViewPasswords(data.can_view_passwords || false);
    } catch {
      setUserPageAccess({});
    }
  }, []);

  const refreshBuiltinOverrides = useCallback(async () => {
    try {
      const { data } = await api.get('/builtin-pages');
      const map = {};
      for (const p of data.items || []) {
        map[p.page_key] = { name: p.name, description: p.description, icon: p.icon, is_overridden: p.is_overridden };
      }
      setBuiltinOverrides(map);
    } catch {
      setBuiltinOverrides({});
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && !user) {
      api.get('/auth/me').then((r) => setUser(r.data.user)).catch(() => {});
    }
    refreshBranding();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (user) {
      refreshPageAccess();
      refreshBuiltinOverrides();
      refreshUserPageAccess();
    } else {
      setPageAccess({});
      setUserPageAccess({});
      setBuiltinOverrides({});
      setCanViewPasswords(false);
    }
  }, [user, refreshPageAccess, refreshBuiltinOverrides, refreshUserPageAccess]);

  async function login(email, password) {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      // Consumed once by AppLayout to show the "your recurring tasks"
      // notification — set fresh on every real login (not on a page
      // refresh with an already-valid session), including logging back
      // in again within the same browser tab.
      sessionStorage.setItem('justLoggedIn', '1');
      setUser(data.user);
      return data.user;
    } finally { setLoading(false); }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }

  function canSee(pageKey) {
    const role = user?.role;
    if (!role) return false;
    if (role === 'superadmin') return true;
    // User-specific override takes precedence over role-based setting
    if (Object.prototype.hasOwnProperty.call(userPageAccess, pageKey)) {
      return !!userPageAccess[pageKey];
    }
    const v = pageAccess[`${pageKey}:${role}`];
    return v === undefined ? true : !!v;
  }

  function getPageLabel(pageKey, fallback) {
    return builtinOverrides[pageKey]?.name || DEFAULT_LABELS[pageKey] || fallback || pageKey;
  }

  async function refreshMe() {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      localStorage.setItem('user', JSON.stringify(data.user));
      return data.user;
    } catch { return null; }
  }

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading, refreshMe, setUser,
      canSee, pageAccess, refreshPageAccess,
      userPageAccess, refreshUserPageAccess, canViewPasswords,
      builtinOverrides, refreshBuiltinOverrides, getPageLabel,
      branding, refreshBranding,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
