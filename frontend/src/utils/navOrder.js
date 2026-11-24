// Nav-order storage helpers. Kept out of pages/Admin/NavOrder.jsx so the layout
// (statically loaded) doesn't import that lazily-loaded page, which defeats the
// code-splitting in App.jsx.
export const NAV_STORAGE_KEY = 'inventoryNavOrder';

export function loadNavOrder() {
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY);
    if (!saved) return null;
    let keys = JSON.parse(saved);
    // Migrate old separate software-status / nessus-status keys → software-services group
    const hasGroup = keys.includes('software-services');
    if (!hasGroup) {
      const oldIdx = keys.findIndex(k => k === '/software-status' || k === '/nessus-status');
      keys = keys.filter(k => k !== '/software-status' && k !== '/nessus-status');
      if (oldIdx !== -1) keys.splice(oldIdx, 0, 'software-services');
      else keys.push('software-services');
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(keys));
    }
    return keys;
  } catch { return null; }
}
