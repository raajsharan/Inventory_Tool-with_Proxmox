/**
 * Generates Migration-Tracker-Template.xlsx with 4 sheets + sample rows.
 * Run: node scripts/generateMigrationTemplate.js
 * Output: ../frontend/dist/Migration-Tracker-Template.xlsx  (served as a static file)
 */
const ExcelJS = require('exceljs');
const path    = require('path');

const OUT_PATH = path.join(__dirname, '../../frontend/dist/Migration-Tracker-Template.xlsx');

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Inventory IT';
  wb.created  = new Date();

  // ── Colour palette ──────────────────────────────────────────────────────────
  const HDR_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const HDR_FONT   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const SAMPLE_FILL= { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
  const NOTE_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  const BORDER     = {
    top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
  };

  function addSheet(name, columns, rows, notes = []) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] });

    // Row 1: notes / instructions
    ws.mergeCells(1, 1, 1, columns.length);
    const noteCell = ws.getCell('A1');
    noteCell.value = notes.join('   |   ');
    noteCell.fill  = NOTE_FILL;
    noteCell.font  = { italic: true, size: 10, color: { argb: 'FF856404' } };
    noteCell.alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(1).height = 28;

    // Row 2: headers
    const hdrRow = ws.getRow(2);
    columns.forEach((col, i) => {
      const cell  = hdrRow.getCell(i + 1);
      cell.value  = col.header;
      cell.fill   = HDR_FILL;
      cell.font   = HDR_FONT;
      cell.border = BORDER;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = col.width || 20;
    });
    hdrRow.height = 36;

    // Sample rows
    rows.forEach((row, ri) => {
      const wsRow = ws.getRow(ri + 3);
      row.forEach((val, ci) => {
        const cell  = wsRow.getCell(ci + 1);
        cell.value  = val ?? '';
        cell.fill   = SAMPLE_FILL;
        cell.border = BORDER;
        cell.font   = { size: 10 };
        cell.alignment = { vertical: 'middle' };
      });
      wsRow.height = 20;
    });

    // Add 10 blank styled rows for user data entry
    for (let r = rows.length + 3; r < rows.length + 13; r++) {
      const wsRow = ws.getRow(r);
      columns.forEach((_, ci) => {
        const cell  = wsRow.getCell(ci + 1);
        cell.border = BORDER;
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      });
      wsRow.height = 20;
    }

    // Auto-filter on header row
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };

    return ws;
  }

  // ── Sheet 1: Hosts ──────────────────────────────────────────────────────────
  addSheet('Hosts', [
    { header: 'vCenter',                            width: 22 },
    { header: 'Host',                               width: 22 },
    { header: 'Datacenter',                         width: 18 },
    { header: 'iDRAC',                              width: 18 },
    { header: 'iDRAC username',                     width: 18 },
    { header: 'iDRAC password',                     width: 18 },
    { header: 'iDRAC Virtual Console',              width: 22 },
    { header: 'Assigned License(s)',                width: 22 },
    { header: 'ESX Version',                        width: 16 },
    { header: 'Model',                              width: 22 },
    { header: 'Serial Number',                      width: 18 },
    { header: 'BIOS Vendor',                        width: 16 },
    { header: '# Min Cores',                        width: 12 },
    { header: 'License Expiry Date',                width: 20 },
    { header: 'Assigned To',                        width: 18 },
    { header: 'No. of VMs to Migrate',              width: 20 },
    { header: 'Powered Off VMs',                    width: 16 },
    { header: 'Host Owner',                         width: 18 },
    { header: 'VMs Vacate',                         width: 16 },
    { header: 'Proxmox Install',                    width: 18 },
    { header: 'VM Migration Back to New Proxmox Host', width: 30 },
  ], [
    ['vcenter01.corp.local','esxi-host-01.corp.local','Bomgar-DC','192.168.1.10','idrac_user','idrac_pass','https://192.168.1.10/console','vSphere Standard','ESXi 7.0.3','Dell PowerEdge R740','SN-001122','Dell Inc.',16,'2026-12-31','John Smith',12,3,'Jane Doe','Completed','In Progress','Pending'],
    ['vcenter01.corp.local','esxi-host-02.corp.local','Bomgar-DC','192.168.1.11','idrac_user','idrac_pass','https://192.168.1.11/console','vSphere Standard','ESXi 7.0.3','Dell PowerEdge R740','SN-001123','Dell Inc.',16,'2026-12-31','John Smith',8,1,'Jane Doe','Pending','Pending','Pending'],
    ['vcenter02.corp.local','esxi-sec-01.corp.local','Security-DC','192.168.2.10','idrac_user','idrac_pass','https://192.168.2.10/console','vSphere Enterprise','ESXi 6.7.0','HPE ProLiant DL380','SN-002201','HPE',24,'2025-06-30','Alice Wong',20,5,'Bob Lee','In Progress','Pending','Pending'],
  ], [
    'Sheet name must be exactly "Hosts"',
    'iDRAC username & password are encrypted — never exported to CSV',
    'License Expiry Date: use YYYY-MM-DD format',
    'VMs Vacate / Proxmox Install / VM Migration Back: Pending | In Progress | Completed',
  ]);

  // ── Sheet 2: Bomgar VMs ─────────────────────────────────────────────────────
  addSheet('Bomgar VMs', [
    { header: 'VM',                        width: 28 },
    { header: 'Powerstate',                width: 14 },
    { header: 'DNS Name',                  width: 28 },
    { header: 'CPUs',                      width: 8  },
    { header: 'Memory',                    width: 12 },
    { header: 'Active Memory',             width: 14 },
    { header: 'NICs',                      width: 8  },
    { header: 'Disks',                     width: 8  },
    { header: 'Total Disk Capacity (MiB)', width: 22 },
    { header: 'Primary IP Address',        width: 18 },
    { header: 'Path',                      width: 36 },
    { header: 'Datacenter',                width: 18 },
    { header: 'Cluster',                   width: 18 },
    { header: 'Host',                      width: 26 },
    { header: 'OS (config file)',           width: 28 },
    { header: 'OS (VMware Tools)',          width: 28 },
    { header: 'MIGRATION STATUS',          width: 18 },
  ], [
    ['BOMGAR-WIN-001','poweredOn','bomgar-win-001.corp.local',4,8192,6144,1,1,51200,'10.0.1.50','/Bomgar-DC/vm/BOMGAR-WIN-001','Bomgar-DC','Bomgar-Cluster','esxi-host-01.corp.local','Microsoft Windows Server 2019 (64-bit)','Microsoft Windows Server 2019 (64-bit)','Not Started'],
    ['BOMGAR-LIN-002','poweredOn','bomgar-lin-002.corp.local',2,4096,3072,1,1,102400,'10.0.1.51','/Bomgar-DC/vm/BOMGAR-LIN-002','Bomgar-DC','Bomgar-Cluster','esxi-host-01.corp.local','Ubuntu Linux (64-bit)','Ubuntu Linux (64-bit)','Completed'],
    ['BOMGAR-WIN-003','poweredOff','bomgar-win-003.corp.local',8,16384,0,2,2,204800,'10.0.1.52','/Bomgar-DC/vm/BOMGAR-WIN-003','Bomgar-DC','Bomgar-Cluster','esxi-host-02.corp.local','Microsoft Windows Server 2016 (64-bit)','Microsoft Windows Server 2016 (64-bit)','In Progress'],
  ], [
    'Sheet name must be exactly "Bomgar VMs"',
    'Powerstate: poweredOn | poweredOff | suspended',
    'Memory & Active Memory in MiB (e.g. 8192 = 8 GiB)',
    'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked',
  ]);

  // ── Sheet 3: Security VMs ───────────────────────────────────────────────────
  addSheet('Security VMs', [
    { header: 'VM',                        width: 28 },
    { header: 'Primary IP Address',        width: 18 },
    { header: 'Mac Address',               width: 20 },
    { header: 'Host',                      width: 26 },
    { header: 'Powerstate',                width: 14 },
    { header: 'Guest State',               width: 14 },
    { header: 'CPUs',                      width: 8  },
    { header: 'Memory',                    width: 12 },
    { header: 'NICs',                      width: 8  },
    { header: 'Disks',                     width: 8  },
    { header: 'Total Disk Capacity (MiB)', width: 22 },
    { header: 'OS (config file)',           width: 28 },
    { header: 'OS (VMware Tools)',          width: 28 },
    { header: 'MIGRATION STATUS',          width: 18 },
  ], [
    ['SEC-FIREWALL-01','10.0.2.10','00:50:56:aa:bb:01','esxi-sec-01.corp.local','poweredOn','running',2,4096,2,1,51200,'Other (32-bit)','Other (32-bit)','Not Started'],
    ['SEC-IDS-02','10.0.2.11','00:50:56:aa:bb:02','esxi-sec-01.corp.local','poweredOn','running',4,8192,1,1,102400,'Ubuntu Linux (64-bit)','Ubuntu Linux (64-bit)','Not Started'],
    ['SEC-PROXY-03','','00:50:56:aa:bb:03','esxi-sec-01.corp.local','poweredOff','notRunning',2,4096,1,1,51200,'Microsoft Windows Server 2019 (64-bit)','','Blocked'],
  ], [
    'Sheet name must be exactly "Security VMs"',
    'Guest State: running | notRunning | shuttingDown | resetting | standby | unknown',
    'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked',
  ]);

  // ── Sheet 4: Standalone ESXi ────────────────────────────────────────────────
  addSheet('Standalone ESXi', [
    { header: 'VM',                        width: 28 },
    { header: 'Primary IP Address',        width: 18 },
    { header: 'Mac Address',               width: 20 },
    { header: 'Host',                      width: 26 },
    { header: 'Powerstate',                width: 14 },
    { header: 'Guest State',               width: 14 },
    { header: 'CPUs',                      width: 8  },
    { header: 'Memory',                    width: 12 },
    { header: 'NICs',                      width: 8  },
    { header: 'Disks',                     width: 8  },
    { header: 'Total Disk Capacity (MiB)', width: 22 },
    { header: 'OS (config file)',           width: 28 },
    { header: 'OS (VMware Tools)',          width: 28 },
    { header: 'MIGRATION STATUS',          width: 18 },
  ], [
    ['STANDALONE-VM-01','192.168.10.50','00:50:56:cc:dd:01','192.168.10.1','poweredOn','running',4,8192,1,1,102400,'Microsoft Windows Server 2012 R2 (64-bit)','Microsoft Windows Server 2012 R2 (64-bit)','Not Started'],
    ['STANDALONE-VM-02','','00:50:56:cc:dd:02','192.168.10.1','poweredOn','running',2,4096,1,1,51200,'Ubuntu Linux (64-bit)','Ubuntu Linux (64-bit)','Not Started'],
    ['STANDALONE-VM-03','192.168.10.52','00:50:56:cc:dd:03','192.168.10.2','poweredOff','notRunning',1,2048,1,1,25600,'Microsoft Windows 10 (64-bit)','','Blocked'],
  ], [
    'Sheet name must be exactly "Standalone ESXi"',
    'These VMs are NOT managed by vCenter — verify migration manually',
    'Primary IP Address may be blank — use the "Missing IP" filter in the tracker to find them',
    'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked',
  ]);

  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`Template written to: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
