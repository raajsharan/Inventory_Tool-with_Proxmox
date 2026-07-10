// Demo-mode request interception.
// Import resolveMockData and set it as config.adapter in the axios request interceptor.
// This avoids the "save/restore defaults.adapter" pattern which breaks in Axios ≥1.x
// where the default adapter is a string token ('xhr'), not a function.

import {
  MOCK_ASSETS,
  MOCK_BEIJING_ASSETS,
  MOCK_EXT_ASSETS,
  MOCK_PHYSICAL_SERVERS,
  MOCK_DROPDOWNS,
} from './assetData.js';

const DEFAULT_COMPLIANCE_CONFIG = {
  config: {
    msl: {
      include_asset_types:       ['VM', 'Bare Metal Server', 'Physical Server', 'Other'],
      include_server_statuses:   ['Alive', 'Alive But Powered Off', 'Need to check', 'Decommissioned'],
      exclude_eol_statuses:      ['Decom', 'Not Applicable'],
      include_password_statuses: ['Known'],
      pivot:                     'location',
    },
    ext: {
      exclude_item_statuses:        [],
      exclude_eol_statuses:         [],
      auto_patching_types:          ['Auto'],
      manual_patching_types:        ['Manual'],
      name_conflict_fields:         ['vm_name', 'os_hostname'],
      me_na_patching_types:         ['Exception', 'Beijing IT Team'],
      me_na_server_statuses:        ['Not Alive'],
      me_na_eol_statuses:           ['Decom', 'Not Applicable'],
      me_na_requires_not_installed: true,
      hidden_ext_chips: [],
      ext_chip_labels:  {},
    },
    weekly: {
      me_msl_exclude_buckets:     ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches'],
      me_ext_exclude_buckets:     ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches', 'Exception'],
      me_msl_footnote:            '',
      me_ext_footnote:            '',
      breakdown_hidden_columns:   [],
      breakdown_pct_exclude:      ['alive_powered_off', 'eol'],
      breakdown_excluded_locations:   [],
      breakdown_excluded_departments: [],
      report_title:    '',
      report_subtitle: '',
    },
  },
  updated_at: new Date(Date.now() - 7 * 86400000).toISOString(),
};

const TABLE_MAP = {
  '/assets':         MOCK_ASSETS,
  '/beijing-assets': MOCK_BEIJING_ASSETS,
  '/ext-assets':     MOCK_EXT_ASSETS,
  '/physical-esxi':  MOCK_PHYSICAL_SERVERS,
};

function paginate(items, params = {}) {
  const page     = Number(params.page     ?? 1);
  const pageSize = Number(params.pageSize ?? 20);
  const q        = (params.search ?? '').toLowerCase();

  let out = items;
  if (q) {
    out = out.filter(a =>
      (a.vm_name     || '').toLowerCase().includes(q) ||
      (a.ip_address  || '').includes(q)               ||
      (a.os_hostname || '').toLowerCase().includes(q)  ||
      (a.department  || '').toLowerCase().includes(q)
    );
  }
  if (params.serverStatus) out = out.filter(a => a.server_status === params.serverStatus);
  if (params.location)     out = out.filter(a => a.location      === params.location);
  if (params.osType)       out = out.filter(a => a.os_type       === params.osType);
  if (params.eolStatus)    out = out.filter(a => a.eol_status    === params.eolStatus);
  if (params.department)   out = out.filter(a => a.department    === params.department);
  if (params.assetType)    out = out.filter(a => a.asset_type    === params.assetType);
  if (params.patchingType) out = out.filter(a => a.patching_type === params.patchingType);

  const total = out.length;
  const start = (page - 1) * pageSize;
  return { items: out.slice(start, start + pageSize), total };
}

// Returns parsed response data, or null to let the request pass through to the real backend.
export function resolveMockData(url = '', params = {}) {
  const path = url.split('?')[0];

  // Always let auth + user-management through
  if (path.startsWith('/auth/') || path.startsWith('/users')) return null;

  // Inventory list tables
  for (const [prefix, dataset] of Object.entries(TABLE_MAP)) {
    if (path === prefix) return paginate(dataset, params);

    // Password reveal: /assets/:id/password
    if (path.match(new RegExp(`^${prefix}/[^/]+/password$`))) {
      return { password: '••••••••' };
    }

    // Single record: /assets/:id
    const single = path.match(new RegExp(`^${prefix}/([^/]+)$`));
    if (single) {
      const rec = dataset.find(a => a.id === single[1]);
      return rec ?? {};
    }

    // Export stub: /assets/export
    if (path === `${prefix}/export`) return null; // let browser handle blob naturally
  }

  if (path === '/dropdowns')                  return MOCK_DROPDOWNS;
  if (path.startsWith('/field-visibility/'))  return { hidden: [] };
  if (path.startsWith('/inventory-fields/'))  return [];
  if (path === '/compliance-config')          return DEFAULT_COMPLIANCE_CONFIG;

  // Dashboard routes are handled directly in Dashboard.jsx (no API call needed)
  // but guard them here anyway so a stale interceptor doesn't cause a loop.
  if (path === '/dashboard/summary') return null;
  if (path === '/dashboard/config')  return null;

  return null; // unknown → passthrough
}
