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
  const [builtinOverrides, setBuiltinOverrides] = useState({}); // page_key -> { name, description, icon }

  const refreshPageAccess = useCallback(async () => {
    try {
      const { data } = await api.get('/page-access');
      setPageAccess(data.matrix || {});
    } catch {
      setPageAccess({});
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
  }, []); // eslint-disable-line

  useEffect(() => {
    if (user) {
      refreshPageAccess();
      refreshBuiltinOverrides();
    } else {
      setPageAccess({});
      setBuiltinOverrides({});
    }
  }, [user, refreshPageAccess, refreshBuiltinOverrides]);

  async function login(email, password) {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
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
    const v = pageAccess[`${pageKey}:${role}`];
    return v === undefined ? true : !!v;
  }

  // Resolve the display name for a built-in page, falling back to defaults.
  function getPageLabel(pageKey, fallback) {
    return builtinOverrides[pageKey]?.name || DEFAULT_LABELS[pageKey] || fallback || pageKey;
  }

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading,
      canSee, pageAccess, refreshPageAccess,
      builtinOverrides, refreshBuiltinOverrides, getPageLabel,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
