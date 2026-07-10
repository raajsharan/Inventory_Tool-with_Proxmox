// Static mock records for all four inventory tables.
// Shape must match the columns rendered by each AssetList / AssetView page.

const d = (n) => new Date(Date.now() - n * 86400000).toISOString();

// ── Helpers ─────────────────────────────────────────────────────────────────
const asset = (id, overrides = {}) => ({
  id,
  vm_name:          overrides.vm_name          ?? `SRV-${id.toUpperCase()}`,
  ip_address:       overrides.ip_address        ?? '10.10.0.1',
  os_hostname:      overrides.os_hostname       ?? overrides.vm_name ?? `SRV-${id.toUpperCase()}`,
  asset_type:       overrides.asset_type        ?? 'VM',
  os_type:          overrides.os_type           ?? 'Windows Server 2019',
  os_version:       overrides.os_version        ?? '10.0.17763',
  assigned_user:    overrides.assigned_user     ?? 'admin',
  department:       overrides.department        ?? 'Infrastructure',
  asset_tag:        overrides.asset_tag         ?? null,
  server_status:    overrides.server_status     ?? 'Alive',
  server_patch_type:overrides.server_patch_type ?? null,
  patching_type:    overrides.patching_type     ?? 'Auto',
  patching_schedule:overrides.patching_schedule ?? 'Weekly',
  business_purpose: overrides.business_purpose  ?? 'Application Server',
  location:         overrides.location          ?? 'New York',
  serial_number:    overrides.serial_number     ?? null,
  idrac_enabled:    overrides.idrac_enabled     ?? false,
  idrac_ip:         overrides.idrac_ip          ?? null,
  ome_status:       overrides.ome_status        ?? null,
  eol_status:       overrides.eol_status        ?? 'InSupport',
  manage_engine_installed: overrides.manage_engine_installed ?? true,
  tenable_installed:       overrides.tenable_installed ?? true,
  hosted_ip:        overrides.hosted_ip         ?? null,
  asset_username:   overrides.asset_username    ?? 'administrator',
  hasPassword:      overrides.hasPassword       ?? true,
  created_by_name:  overrides.created_by_name   ?? 'System Admin',
  created_at:       overrides.created_at        ?? d(30),
  updated_by_name:  overrides.updated_by_name   ?? 'System Admin',
  updated_at:       overrides.updated_at        ?? d(5),
  ...overrides,
});

// ── MSL Assets (assets table) ────────────────────────────────────────────────
export const MOCK_ASSETS = [
  asset('a01', { vm_name:'WEB-NY-001',  ip_address:'10.10.1.101', os_type:'Windows Server 2022', location:'New York',  department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'192.168.1.10', created_at:d(2) }),
  asset('a02', { vm_name:'WEB-NY-002',  ip_address:'10.10.1.102', os_type:'Windows Server 2022', location:'New York',  department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'192.168.1.11', created_at:d(2) }),
  asset('a03', { vm_name:'DB-NY-001',   ip_address:'10.10.2.11',  os_type:'Windows Server 2019', location:'New York',  department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'192.168.2.10', created_at:d(7) }),
  asset('a04', { vm_name:'DB-NY-002',   ip_address:'10.10.2.12',  os_type:'Windows Server 2019', location:'New York',  department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:false, hosted_ip:'192.168.2.11', created_at:d(7) }),
  asset('a05', { vm_name:'APP-NY-003',  ip_address:'10.10.3.20',  os_type:'Ubuntu 22.04',        location:'New York',  department:'DevOps',         patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:false, tenable_installed:true,  hosted_ip:'192.168.3.10', created_at:d(10) }),
  asset('a06', { vm_name:'MON-NY-001',  ip_address:'10.10.4.5',   os_type:'Ubuntu 22.04',        location:'New York',  department:'Security',       patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'192.168.4.5',  created_at:d(14) }),
  asset('a07', { vm_name:'GW-NY-001',   ip_address:'10.10.5.1',   os_type:'Windows Server 2016', location:'New York',  department:'Infrastructure', patching_type:'Exception',eol_status:'EOL',           server_status:'Alive But Powered Off', manage_engine_installed:false, tenable_installed:false, hosted_ip:null,           created_at:d(20) }),
  asset('a08', { vm_name:'BAK-NY-001',  ip_address:'10.10.6.50',  os_type:'Windows Server 2019', location:'New York',  department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'On Hold',               manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'192.168.6.5',  created_at:d(25), hasPassword:false }),
  asset('a09', { vm_name:'SVC-NY-009',  ip_address:'10.10.7.99',  os_type:'Windows Server 2022', location:'New York',  department:'Operations',     patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'192.168.7.1',  created_at:d(3) }),
  asset('a10', { vm_name:'DECOM-NY-01', ip_address:'10.10.9.1',   os_type:'Windows Server 2012', location:'New York',  department:'Infrastructure', patching_type:'Auto',    eol_status:'Decom',         server_status:'Decommissioned',        manage_engine_installed:false, tenable_installed:false, hosted_ip:null,           created_at:d(180) }),

  asset('a11', { vm_name:'WEB-SG-001',  ip_address:'10.20.1.101', os_type:'Windows Server 2022', location:'Singapore', department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'172.20.1.10',  created_at:d(5) }),
  asset('a12', { vm_name:'WEB-SG-002',  ip_address:'10.20.1.102', os_type:'Windows Server 2022', location:'Singapore', department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'172.20.1.11',  created_at:d(5) }),
  asset('a13', { vm_name:'DB-SG-001',   ip_address:'10.20.2.10',  os_type:'Ubuntu 22.04',        location:'Singapore', department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'172.20.2.10',  created_at:d(8) }),
  asset('a14', { vm_name:'APP-SG-005',  ip_address:'10.20.3.55',  os_type:'CentOS 7',            location:'Singapore', department:'DevOps',         patching_type:'Auto',    eol_status:'EOL',           server_status:'Alive',                 manage_engine_installed:false, tenable_installed:true,  hosted_ip:'172.20.3.5',   created_at:d(90) }),
  asset('a15', { vm_name:'SEC-SG-001',  ip_address:'10.20.4.10',  os_type:'RHEL 8',              location:'Singapore', department:'Security',       patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'172.20.4.10',  created_at:d(15) }),
  asset('a16', { vm_name:'INF-SG-002',  ip_address:'10.20.5.20',  os_type:'Windows Server 2019', location:'Singapore', department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'Onboard Pending',       manage_engine_installed:false, tenable_installed:false, hosted_ip:null,           created_at:d(1), hasPassword:false }),

  asset('a17', { vm_name:'WEB-LDN-001', ip_address:'10.30.1.101', os_type:'Windows Server 2022', location:'London',    department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'10.130.1.10',  created_at:d(6) }),
  asset('a18', { vm_name:'DB-LDN-001',  ip_address:'10.30.2.10',  os_type:'Windows Server 2019', location:'London',    department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'10.130.2.10',  created_at:d(12) }),
  asset('a19', { vm_name:'APP-LDN-007', ip_address:'10.30.3.77',  os_type:'Ubuntu 22.04',        location:'London',    department:'DevOps',         patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:false, tenable_installed:true,  hosted_ip:'10.130.3.7',   created_at:d(3) }),
  asset('a20', { vm_name:'OLD-LDN-002', ip_address:'10.30.9.2',   os_type:'Windows Server 2012', location:'London',    department:'Infrastructure', patching_type:'Exception',eol_status:'EOL',           server_status:'Alive But Powered Off', manage_engine_installed:false, tenable_installed:false, hosted_ip:null,           created_at:d(365) }),

  asset('a21', { vm_name:'TOR-APP-001', ip_address:'10.40.1.21',  os_type:'Windows Server 2022', location:'Toronto',   department:'Operations',     patching_type:'Auto',    eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  hosted_ip:'10.40.1.100',  created_at:d(9) }),
  asset('a22', { vm_name:'TOR-DB-001',  ip_address:'10.40.2.10',  os_type:'Windows Server 2019', location:'Toronto',   department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport',     server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:false, hosted_ip:'10.40.2.100',  created_at:d(20) }),
  asset('a23', { vm_name:'TOR-SEC-001', ip_address:'10.40.3.5',   os_type:'RHEL 8',              location:'Toronto',   department:'Security',       patching_type:'Auto',    eol_status:'InSupport',     server_status:'Need to check',         manage_engine_installed:false, tenable_installed:false, hosted_ip:null,           created_at:d(45), hasPassword:false }),
];

// ── Beijing Assets (beijing_assets table) ────────────────────────────────────
export const MOCK_BEIJING_ASSETS = [
  asset('b01', { vm_name:'BJ-WEB-001',  ip_address:'172.16.1.101', os_type:'Windows Server 2019', location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'InSupport', server_status:'Alive',    manage_engine_installed:true,  tenable_installed:true,  asset_type:'VM',             created_at:d(10) }),
  asset('b02', { vm_name:'BJ-WEB-002',  ip_address:'172.16.1.102', os_type:'Windows Server 2019', location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'InSupport', server_status:'Alive',    manage_engine_installed:true,  tenable_installed:true,  asset_type:'VM',             created_at:d(10) }),
  asset('b03', { vm_name:'BJ-DB-001',   ip_address:'172.16.2.10',  os_type:'Windows Server 2022', location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'InSupport', server_status:'Alive',    manage_engine_installed:true,  tenable_installed:false, asset_type:'VM',             created_at:d(15) }),
  asset('b04', { vm_name:'BJ-APP-003',  ip_address:'172.16.3.30',  os_type:'CentOS 7',            location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'EOL',       server_status:'Alive',    manage_engine_installed:false, tenable_installed:true,  asset_type:'VM',             created_at:d(90) }),
  asset('b05', { vm_name:'BJ-SEC-001',  ip_address:'172.16.4.5',   os_type:'RHEL 8',              location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'InSupport', server_status:'Alive',    manage_engine_installed:true,  tenable_installed:true,  asset_type:'VM',             created_at:d(20) }),
  asset('b06', { vm_name:'BJ-INF-010',  ip_address:'172.16.5.10',  os_type:'Windows Server 2016', location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'EOL',       server_status:'Alive But Powered Off', manage_engine_installed:false, tenable_installed:false, asset_type:'Bare Metal Server', created_at:d(200) }),
  asset('b07', { vm_name:'BJ-MON-001',  ip_address:'172.16.6.1',   os_type:'Ubuntu 22.04',        location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'InSupport', server_status:'Alive',    manage_engine_installed:true,  tenable_installed:true,  asset_type:'VM',             created_at:d(30) }),
  asset('b08', { vm_name:'BJ-BAK-002',  ip_address:'172.16.7.2',   os_type:'Windows Server 2019', location:'Beijing', department:'Beijing IT', patching_type:'Beijing IT Team', eol_status:'InSupport', server_status:'Onboard Pending', manage_engine_installed:false, tenable_installed:false, asset_type:'VM', created_at:d(2), hasPassword:false }),
];

// ── Extended Inventory (ext_assets table) ────────────────────────────────────
const extAsset = (id, overrides = {}) => ({
  ...asset(id, { asset_type: 'Network Device', patching_type: 'Exception', eol_status: 'InSupport', manage_engine_installed: false, tenable_installed: false, hasPassword: false, ...overrides }),
  decommissioned_at: overrides.decommissioned_at ?? null,
  business_purpose:  overrides.business_purpose  ?? 'Extended endpoint',
});

export const MOCK_EXT_ASSETS = [
  extAsset('e01', { vm_name:'EXT-NY-SW-01',   ip_address:'10.10.100.1',  os_type:'Cisco IOS 15',        asset_type:'Switch',        location:'New York',  department:'Infrastructure', server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e02', { vm_name:'EXT-NY-FW-01',   ip_address:'10.10.100.2',  os_type:'Fortinet FortiOS 7',  asset_type:'Firewall',      location:'New York',  department:'Security',       server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:true  }),
  extAsset('e03', { vm_name:'EXT-NY-PRT-01',  ip_address:'10.10.100.3',  os_type:'HP LaserJet',         asset_type:'Printer',       location:'New York',  department:'Operations',     server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e04', { vm_name:'EXT-NY-UPS-01',  ip_address:'10.10.100.4',  os_type:'APC UPS FW 6.8',      asset_type:'UPS',           location:'New York',  department:'Infrastructure', server_status:'Alive', patching_type:'Not Applicable', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e05', { vm_name:'EXT-SG-SW-01',   ip_address:'10.20.100.1',  os_type:'Cisco IOS 16',        asset_type:'Switch',        location:'Singapore', department:'Infrastructure', server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e06', { vm_name:'EXT-SG-FW-01',   ip_address:'10.20.100.2',  os_type:'Palo Alto PAN-OS 10', asset_type:'Firewall',      location:'Singapore', department:'Security',       server_status:'Alive', patching_type:'Auto', manage_engine_installed:true, tenable_installed:true, hasPassword:true }),
  extAsset('e07', { vm_name:'EXT-SG-SRV-01',  ip_address:'10.20.100.5',  os_type:'Windows Server 2019', asset_type:'VM',            location:'Singapore', department:'Infrastructure', server_status:'Alive', patching_type:'Auto', manage_engine_installed:true, tenable_installed:true, hasPassword:true }),
  extAsset('e08', { vm_name:'EXT-LDN-RTR-01', ip_address:'10.30.100.1',  os_type:'Cisco IOS-XE 17',     asset_type:'Router',        location:'London',    department:'Infrastructure', server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e09', { vm_name:'EXT-LDN-FW-01',  ip_address:'10.30.100.2',  os_type:'Check Point R81',     asset_type:'Firewall',      location:'London',    department:'Security',       server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:true }),
  extAsset('e10', { vm_name:'EXT-LDN-SRV-02', ip_address:'10.30.100.10', os_type:'Ubuntu 22.04',        asset_type:'VM',            location:'London',    department:'DevOps',         server_status:'Alive', patching_type:'Manual', manage_engine_installed:true, tenable_installed:true, hasPassword:true }),
  extAsset('e11', { vm_name:'EXT-BJ-SW-01',   ip_address:'172.16.100.1', os_type:'Huawei VRP V200R003', asset_type:'Switch',        location:'Beijing',   department:'Beijing IT',     server_status:'Alive', patching_type:'Beijing IT Team', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e12', { vm_name:'EXT-BJ-SRV-01',  ip_address:'172.16.100.5', os_type:'Windows Server 2022', asset_type:'VM',            location:'Beijing',   department:'Beijing IT',     server_status:'Alive', patching_type:'Beijing IT Team', manage_engine_installed:true, tenable_installed:false, hasPassword:true }),
  extAsset('e13', { vm_name:'EXT-TOR-SW-01',  ip_address:'10.40.100.1',  os_type:'Cisco IOS 15',        asset_type:'Switch',        location:'Toronto',   department:'Infrastructure', server_status:'Alive', patching_type:'Exception', manage_engine_installed:false, tenable_installed:false }),
  extAsset('e14', { vm_name:'EXT-NY-DECOM',   ip_address:'10.10.200.1',  os_type:'Windows Server 2012', asset_type:'VM',            location:'New York',  department:'Infrastructure', server_status:'Decommissioned', patching_type:'Exception', decommissioned_at: d(30) }),
  extAsset('e15', { vm_name:'EXT-SG-UPS-02',  ip_address:'10.20.100.9',  os_type:'Eaton 9PX FW 2.1',   asset_type:'UPS',           location:'Singapore', department:'Infrastructure', server_status:'Alive', patching_type:'Not Applicable', manage_engine_installed:false, tenable_installed:false }),
];

// ── Physical / ESXi Servers (physical_esxi_servers table) ───────────────────
const physAsset = (id, overrides = {}) => ({
  ...asset(id, { asset_type: 'Physical Server', patching_type: 'Auto', idrac_enabled: true, ...overrides }),
  serial_number: overrides.serial_number ?? `SN-${id.toUpperCase()}-2024`,
  idrac_ip:      overrides.idrac_ip      ?? `10.99.${id.charCodeAt(1)}.${id.charCodeAt(2)}`,
  ome_status:    overrides.ome_status    ?? 'Managed',
});

export const MOCK_PHYSICAL_SERVERS = [
  physAsset('p01', { vm_name:'PHYS-NY-ESX-01', ip_address:'10.10.50.1',  os_type:'VMware ESXi 7',       location:'New York',  department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-DELL-NY-001', idrac_ip:'10.99.50.1',  ome_status:'Managed',     asset_type:'Physical Server' }),
  physAsset('p02', { vm_name:'PHYS-NY-ESX-02', ip_address:'10.10.50.2',  os_type:'VMware ESXi 7',       location:'New York',  department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-DELL-NY-002', idrac_ip:'10.99.50.2',  ome_status:'Managed',     asset_type:'Physical Server' }),
  physAsset('p03', { vm_name:'PHYS-NY-BARE-01',ip_address:'10.10.51.1',  os_type:'Windows Server 2022', location:'New York',  department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-HP-NY-001',   idrac_ip:'10.99.51.1',  ome_status:'Managed',     asset_type:'Bare Metal Server' }),
  physAsset('p04', { vm_name:'PHYS-NY-ESX-03', ip_address:'10.10.50.3',  os_type:'VMware ESXi 6.7',     location:'New York',  department:'Infrastructure', patching_type:'Exception',eol_status:'EOL',       server_status:'Alive But Powered Off', manage_engine_installed:false, tenable_installed:false, serial_number:'SN-DELL-NY-003', idrac_ip:'10.99.50.3',  ome_status:'Unmanaged',   asset_type:'Physical Server' }),
  physAsset('p05', { vm_name:'PHYS-SG-ESX-01', ip_address:'10.20.50.1',  os_type:'VMware ESXi 7',       location:'Singapore', department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-DELL-SG-001', idrac_ip:'10.99.60.1',  ome_status:'Managed',     asset_type:'Physical Server' }),
  physAsset('p06', { vm_name:'PHYS-SG-ESX-02', ip_address:'10.20.50.2',  os_type:'VMware ESXi 7',       location:'Singapore', department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-DELL-SG-002', idrac_ip:'10.99.60.2',  ome_status:'Managed',     asset_type:'Physical Server' }),
  physAsset('p07', { vm_name:'PHYS-LDN-ESX-01',ip_address:'10.30.50.1',  os_type:'VMware ESXi 7',       location:'London',    department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-HP-LDN-001',  idrac_ip:'10.99.70.1',  ome_status:'Managed',     asset_type:'Physical Server' }),
  physAsset('p08', { vm_name:'PHYS-LDN-BARE-01',ip_address:'10.30.51.1', os_type:'Windows Server 2019', location:'London',    department:'Infrastructure', patching_type:'Manual',  eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:false, serial_number:'SN-DELL-LDN-002',idrac_ip:'10.99.70.2',  ome_status:'Managed',     asset_type:'Bare Metal Server' }),
  physAsset('p09', { vm_name:'PHYS-BJ-ESX-01', ip_address:'172.16.50.1', os_type:'VMware ESXi 7',       location:'Beijing',   department:'Beijing IT',     patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-HUAWEI-BJ-01',idrac_ip:'172.99.50.1', ome_status:'Managed',     asset_type:'Physical Server' }),
  physAsset('p10', { vm_name:'PHYS-TOR-ESX-01', ip_address:'10.40.50.1', os_type:'VMware ESXi 7',       location:'Toronto',   department:'Infrastructure', patching_type:'Auto',    eol_status:'InSupport', server_status:'Alive',                 manage_engine_installed:true,  tenable_installed:true,  serial_number:'SN-DELL-TOR-001', idrac_ip:'10.99.80.1', ome_status:'Managed',     asset_type:'Physical Server' }),
];

// ── Dropdown values (used by filter selects) ─────────────────────────────────
export const MOCK_DROPDOWNS = {
  grouped: {
    server_status:  [
      { value: 'Alive' }, { value: 'Alive But Powered Off' }, { value: 'Decommissioned' },
      { value: 'Onboard Pending' }, { value: 'On Hold' }, { value: 'Need to check' },
      { value: 'Not Alive' }, { value: 'Inactive' }, { value: 'Maintenance' },
    ],
    eol_status: [
      { value: 'InSupport' }, { value: 'EOL' }, { value: 'Decom' }, { value: 'Not Applicable' },
    ],
    patching_type: [
      { value: 'Auto' }, { value: 'Manual' }, { value: 'Exception' },
      { value: 'Beijing IT Team' }, { value: 'Not Applicable' }, { value: 'EOL - No Patches' },
    ],
    location: [
      { value: 'New York' }, { value: 'Singapore' }, { value: 'London' },
      { value: 'Beijing' }, { value: 'Toronto' },
    ],
    asset_type: [
      { value: 'VM' }, { value: 'Bare Metal Server' }, { value: 'Physical Server' },
      { value: 'Switch' }, { value: 'Firewall' }, { value: 'Router' }, { value: 'Printer' }, { value: 'UPS' },
    ],
    os_type: [
      { value: 'Windows Server 2022' }, { value: 'Windows Server 2019' },
      { value: 'Windows Server 2016' }, { value: 'Ubuntu 22.04' },
      { value: 'CentOS 7' }, { value: 'RHEL 8' }, { value: 'VMware ESXi 7' },
    ],
    department: [
      { value: 'Infrastructure' }, { value: 'Security' }, { value: 'DevOps' },
      { value: 'Operations' }, { value: 'Beijing IT' },
    ],
  },
};
