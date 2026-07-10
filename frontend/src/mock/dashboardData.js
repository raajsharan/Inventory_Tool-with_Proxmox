// Static demo data — mirrors the exact shape of GET /api/dashboard/summary.
// Activate via Dashboard → "Demo Mode" toggle (stores in localStorage).

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

export const MOCK_SUMMARY = {
  // ── Headline KPI cards ──────────────────────────────────────────
  headline: {
    totalInventory:             1247,
    patchingCompliancePct:      78.3,
    operationalReadinessPct:    91.52,
    infrastructureHealthScore:  83,
    pendingActions:             23,
  },

  // ── Asset Inventory Summary stat-grid ───────────────────────────
  assetInventory: {
    totalAssets:    892,
    virtualMachines:634,
    physicalServers:258,
    manageEngine:   745,
    tenable:        701,
    autoPatching:   523,
    manualPatching: 178,
    exception:       45,
    beijingItTeam:   89,
    eolNoPatches:    34,
    onboardPending:  12,
    onHold:          11,
    alive:          678,
    poweredOff:     145,
    notAlive:        69,
  },

  // ── Extended Inventory Summary stat-grid ────────────────────────
  extendedInventory: {
    total:       355,
    active:      312,
    inactive:     43,
    meInstalled: 287,
    tenable:     251,
  },

  // ── Charts (Asset Inventory tab) ────────────────────────────────
  charts: {
    byOsType: [
      { key: 'Windows Server 2019', value: 312 },
      { key: 'Windows Server 2022', value: 198 },
      { key: 'Windows Server 2016', value: 145 },
      { key: 'Ubuntu 22.04',        value: 134 },
      { key: 'CentOS 7',            value:  56 },
      { key: 'RHEL 8',              value:  34 },
      { key: 'VMware ESXi 7',       value:  13 },
    ],
    byServerStatus: [
      { key: 'Alive',                  value: 678 },
      { key: 'Alive But Powered Off',  value: 145 },
      { key: 'Decommissioned',         value:  34 },
      { key: 'Onboard Pending',        value:  12 },
      { key: 'On Hold',                value:  11 },
      { key: 'Need to check',          value:   8 },
      { key: 'Inactive',               value:   4 },
    ],
    byLocation: [
      { key: 'New York',   value: 312 },
      { key: 'Singapore',  value: 234 },
      { key: 'London',     value: 189 },
      { key: 'Beijing',    value:  89 },
      { key: 'Toronto',    value:  68 },
    ],
    byEolStatus: [
      { key: 'InSupport',      value: 634 },
      { key: 'Not Applicable', value: 145 },
      { key: 'Decom',          value:  79 },
      { key: 'EOL',            value:  34 },
    ],
  },

  // ── Recent Assets (Asset Inventory tab) ─────────────────────────
  recentAssets: [
    { id: 'r1', vm_name: 'WEB-NY-001',   ip_address: '10.10.1.101', os_type: 'Windows Server 2022', server_status: 'Alive',                 location: 'New York',  created_at: daysAgo(0) },
    { id: 'r2', vm_name: 'DB-SG-004',    ip_address: '10.20.4.12',  os_type: 'Ubuntu 22.04',        server_status: 'Alive',                 location: 'Singapore', created_at: daysAgo(1) },
    { id: 'r3', vm_name: 'APP-LDN-007',  ip_address: '10.30.7.88',  os_type: 'Windows Server 2019', server_status: 'Onboard Pending',       location: 'London',    created_at: daysAgo(1) },
    { id: 'r4', vm_name: 'BJ-SRV-022',   ip_address: '172.16.22.5', os_type: 'CentOS 7',            server_status: 'Alive',                 location: 'Beijing',   created_at: daysAgo(2) },
    { id: 'r5', vm_name: 'PHYS-NY-003',  ip_address: '10.10.3.45',  os_type: 'VMware ESXi 7',       server_status: 'Alive But Powered Off', location: 'New York',  created_at: daysAgo(2) },
    { id: 'r6', vm_name: 'INFRA-TOR-01', ip_address: '10.40.1.9',   os_type: 'RHEL 8',              server_status: 'Need to check',         location: 'Toronto',   created_at: daysAgo(3) },
    { id: 'r7', vm_name: 'SVC-SG-011',   ip_address: '10.20.11.33', os_type: 'Windows Server 2016', server_status: 'On Hold',               location: 'Singapore', created_at: daysAgo(3) },
    { id: 'r8', vm_name: 'MON-LDN-002',  ip_address: '10.30.2.67',  os_type: 'Ubuntu 22.04',        server_status: 'Alive',                 location: 'London',    created_at: daysAgo(4) },
    { id: 'r9', vm_name: 'BAK-NY-005',   ip_address: '10.10.5.120', os_type: 'Windows Server 2019', server_status: 'Decommissioned',        location: 'New York',  created_at: daysAgo(5) },
    { id:'r10', vm_name: 'GW-BJ-008',    ip_address: '172.16.8.2',  os_type: 'CentOS 7',            server_status: 'Alive',                 location: 'Beijing',   created_at: daysAgo(6) },
  ],

  // ── Weekly counters ─────────────────────────────────────────────
  weekly: {
    addedThisWeek:        14,
    addedLastWeek:         9,
    compliantNow:        523,
    totalNow:            892,
    currentCompliancePct: 78.3,
  },

  // ── MSL Compliance card (Executive Overview) ────────────────────
  mslCompliance: {
    mslNumerator:         892,
    mslDenominator:       892,
    extNumerator:         287,
    extDenominator:       355,
    combinedNumerator:   1179,
    combinedDenominator: 1247,
    locations: [
      { location: 'New York',  count: 312 },
      { location: 'Singapore', count: 234 },
      { location: 'London',    count: 189 },
      { location: 'Beijing',   count:  89 },
      { location: 'Toronto',   count:  68 },
    ],
  },

  // ── Ext. Endpoint Compliance card ───────────────────────────────
  extEndpointCompliance: {
    total:           355,
    decommissioned:   18,
    withPassword:    287,
    meInstalled:     287,
    meNotApplicable:  45,
    nameConflicts:     7,
    autoPatching:    198,
    manualPatching:   89,
    locationCount: [
      { location: 'New York',   count: 145 },
      { location: 'Singapore',  count: 102 },
      { location: 'London',     count:  67 },
      { location: 'Beijing',    count:  28 },
      { location: 'Toronto',    count:  13 },
    ],
  },

  // ── Asset Inventory Active Status (Asset tab) ───────────────────
  assetInventoryActiveStatus: {
    total:        822,
    active:       678,
    non_active:    69,
    pending:       23,
    on_hold:       11,
    uncategorized:  41,
  },

  // ── Asset Inventory Patching Status (Asset tab + Weekly) ────────
  assetInventoryPatchingStatus: {
    total:            892,
    auto_patching:    523,
    manual_patching:  178,
    exception:         45,
    beijing_it:        89,
    eol:               34,
    pending:           12,
    on_hold:           11,
    alive_powered_off:145,
    total_excl_na:    747,
  },

  // ── Ext Inventory Patching Status (Weekly report) ───────────────
  extInventoryPatchingStatus: {
    total:            355,
    auto_patching:    198,
    manual_patching:   89,
    exception:         23,
    beijing_it:        12,
    eol:               11,
    pending:            8,
    on_hold:            5,
    alive_powered_off: 31,
    total_excl_na:    310,
  },

  // ── VM Count by Location (Asset tab chart) ──────────────────────
  vmCountByLocation: [
    { location: 'New York',  count: 231 },
    { location: 'Singapore', count: 178 },
    { location: 'London',    count: 134 },
    { location: 'Beijing',    count:  91 },
  ],

  // ── Ext Dept Distribution (Extended tab table) ──────────────────
  extDeptDistribution: [
    { department:'Infrastructure', total:112, active:98, inactive:14, decommissioned:5,  maintenance:3, auto_patching:72, manual_patching:26, exception:8,  beijing_it:0,  eol:4,  not_applicable:6,  pending:3, on_hold:1, alive:98,  powered_off:12, not_alive:2, me:87, tenable:79 },
    { department:'Security',       total: 67, active:61, inactive: 6, decommissioned:2,  maintenance:1, auto_patching:45, manual_patching:18, exception:2,  beijing_it:0,  eol:1,  not_applicable:4,  pending:1, on_hold:0, alive:61,  powered_off: 5, not_alive:1, me:54, tenable:49 },
    { department:'Beijing IT',     total: 89, active:79, inactive:10, decommissioned:4,  maintenance:2, auto_patching:31, manual_patching:34, exception:12, beijing_it:89, eol:6,  not_applicable:8,  pending:4, on_hold:2, alive:79,  powered_off:10, not_alive:0, me:62, tenable:55 },
    { department:'Operations',     total: 54, active:49, inactive: 5, decommissioned:2,  maintenance:1, auto_patching:36, manual_patching:12, exception:3,  beijing_it:0,  eol:2,  not_applicable:4,  pending:2, on_hold:1, alive:49,  powered_off: 4, not_alive:1, me:43, tenable:40 },
    { department:'DevOps',         total: 33, active:25, inactive: 8, decommissioned:5,  maintenance:2, auto_patching:14, manual_patching: 8, exception:6,  beijing_it:0,  eol:3,  not_applicable:2,  pending:2, on_hold:1, alive:25,  powered_off: 7, not_alive:1, me:19, tenable:17 },
  ],

  // ── Weekly VM Gaps (Weekly report) ──────────────────────────────
  weeklyVmGaps: {
    total:          892,
    decommissioned:  34,
    no_password:     43,
    no_hosted_ip:    67,
    name_conflicts:   7,
  },

  // ── Weekly Location Patching breakdown ──────────────────────────
  weeklyLocationPatching: [
    { bucket:'New York',  alive_powered_off:45, auto_patching:178, beijing_it: 0,  eol:12, exception:18, manual_patching:67, on_hold:4,  onboard_pending:5,  total:312 },
    { bucket:'Singapore', alive_powered_off:38, auto_patching:134, beijing_it: 0,  eol: 8, exception:12, manual_patching:45, on_hold:3,  onboard_pending:4,  total:234 },
    { bucket:'London',    alive_powered_off:29, auto_patching:112, beijing_it: 0,  eol: 5, exception: 9, manual_patching:34, on_hold:3,  onboard_pending:3,  total:189 },
    { bucket:'Beijing',   alive_powered_off:18, auto_patching: 34, beijing_it:89,  eol: 4, exception: 6, manual_patching:21, on_hold:2,  onboard_pending:2,  total: 89 },
    { bucket:'Toronto',   alive_powered_off:15, auto_patching: 65, beijing_it: 0,  eol: 5, exception: 0, manual_patching:11, on_hold:2,  onboard_pending:2,  total: 68 },
  ],

  // ── Weekly Department Patching breakdown ────────────────────────
  weeklyDepartmentPatching: [
    { bucket:'Infrastructure', alive_powered_off:38, auto_patching:201, beijing_it: 0, eol:11, exception:14, manual_patching:67, on_hold:5,  onboard_pending:6,  total:312 },
    { bucket:'Security',       alive_powered_off:27, auto_patching:112, beijing_it: 0, eol: 7, exception: 9, manual_patching:45, on_hold:3,  onboard_pending:4,  total:189 },
    { bucket:'Beijing IT',     alive_powered_off:22, auto_patching: 45, beijing_it:89, eol: 4, exception: 8, manual_patching:34, on_hold:2,  onboard_pending:3,  total:134 },
    { bucket:'Operations',     alive_powered_off:16, auto_patching: 98, beijing_it: 0, eol: 6, exception: 7, manual_patching:23, on_hold:2,  onboard_pending:2,  total:112 },
    { bucket:'DevOps',         alive_powered_off:14, auto_patching: 67, beijing_it: 0, eol: 6, exception: 7, manual_patching: 9, on_hold:2,  onboard_pending:3,  total: 89 },
    { bucket:'Unassigned',     alive_powered_off:28, auto_patching: 0,  beijing_it: 0, eol: 0, exception: 0, manual_patching: 0, on_hold: 0, onboard_pending: 0, total: 57 },
  ],

  // ── ME Compliance breakdown — MSL side ─────────────────────────
  meMslBreakdown: [
    { bucket:'Alive But Powered Off', no_me: 89, yes_me: 56, total:145, sort_order:1 },
    { bucket:'Auto',                  no_me: 45, yes_me:478, total:523, sort_order:2 },
    { bucket:'Beijing IT Team',       no_me: 27, yes_me: 62, total: 89, sort_order:3 },
    { bucket:'EOL - No Patches',      no_me: 19, yes_me: 15, total: 34, sort_order:4 },
    { bucket:'Exception',             no_me: 12, yes_me: 33, total: 45, sort_order:5 },
    { bucket:'Manual',                no_me: 23, yes_me:155, total:178, sort_order:6 },
    { bucket:'Not Applicable',        no_me: 23, yes_me: 23, total: 46, sort_order:7 },
    { bucket:'On Hold',               no_me:  6, yes_me:  5, total: 11, sort_order:8 },
    { bucket:'Onboard Pending',       no_me:  8, yes_me:  4, total: 12, sort_order:9 },
  ],

  // ── ME Compliance breakdown — Ext side ──────────────────────────
  meExtBreakdown: [
    { bucket:'Auto',                  no_me: 21, yes_me:177, total:198, sort_order:2 },
    { bucket:'Manual',                no_me: 18, yes_me: 71, total: 89, sort_order:6 },
    { bucket:'Exception',             no_me:  9, yes_me: 14, total: 23, sort_order:5 },
    { bucket:'Not Applicable',        no_me: 34, yes_me: 11, total: 45, sort_order:7 },
    { bucket:'Alive But Powered Off', no_me: 18, yes_me: 13, total: 31, sort_order:1 },
    { bucket:'On Hold',               no_me:  3, yes_me:  2, total:  5, sort_order:8 },
    { bucket:'Onboard Pending',       no_me:  5, yes_me:  3, total:  8, sort_order:9 },
  ],

  // ── Legacy keys (kept for backwards-compat with older Dashboard code) ──
  total:               892,
  byOsType:            [],
  byServerStatus:      [],
  byLocation:          [],
  byEolStatus:         [],
  missingSecurityTools: 147,
};

export const MOCK_DASH_CONFIG = {};
