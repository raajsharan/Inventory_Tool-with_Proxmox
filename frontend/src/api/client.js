import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      const hadSession = !!localStorage.getItem('token');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.pathname.startsWith('/login')) {
        // Tell the login page why we're here and where to return after sign-in.
        const from = encodeURIComponent(location.pathname + location.search);
        location.href = `/login?${hadSession ? 'expired=1&' : ''}from=${from}`;
      }
    }
    return Promise.reject(err);
  }
);

export default api;
