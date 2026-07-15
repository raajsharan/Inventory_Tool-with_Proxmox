import AssetImport from '../Assets/AssetImport.jsx';

const HINT = (
  <span>
    Import compares incoming headers with template fields using flexible matching (spacing, casing, and common aliases).
    Columns accepted: <b>Device Name</b>, <b>Hosted IP</b>, <b>Server Status</b>, <b>Department</b>, <b>Location</b>,{' '}
    <b>Server Model</b>, <b>Serial Number</b>, <b>CPU Cores</b>, <b>RAM (GB)</b>, <b>Total Disks</b>,{' '}
    <b>OME Status</b>, <b>Rack Number</b>, <b>Server Position</b>, <b>Additional Remarks</b>,{' '}
    <b>iDRAC IP</b>, <b>iDRAC Enabled</b>.
  </span>
);

export default function PhysicalEsxiImport() {
  return (
    <AssetImport
      apiPrefix="/physical-esxi"
      title="Import Physical & ESXi Servers from Excel"
      templateFilename="physical-esxi-template.xlsx"
      importHint={HINT}
    />
  );
}
