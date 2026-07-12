import { useState, useEffect } from 'react';
import { Table, Button, Select, Typography, Alert, Space, message } from 'antd';
import { DownloadOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  useMigrTable, SummaryCards, MigrationStatusBadge, PowerstateBadge,
  GuestStateBadge, DiskSize, downloadCSV, cell,
} from './shared.jsx';
import FilterToolbar from './FilterToolbar.jsx';
import { useCustomFields } from './useCustomFields.js';
import FieldValueCell    from './FieldValueCell.jsx';

const { Text } = Typography;

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed', 'Blocked'];

function StatusSelect({ value, onChange }) {
  return (
    <Select size="small" value={value || 'Not Started'} onChange={onChange}
      style={{ width: 130 }}
      options={STATUS_OPTIONS.map(v => ({ value: v, label: v }))}
      labelRender={({ label }) => <span>{label}</span>}
      getPopupContainer={t => t.parentElement} />
  );
}

export default function StandaloneESXiTab({ projectId, hiddenColumns = [] }) {
  const { user } = useAuth();
  const canEdit = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);

  const {
    data, loading, pagination, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts, reload,
  } = useMigrTable('/migration/standalone-esxi', projectId ? { project_id: projectId } : {});

  const recordIds = data.items.map(r => r.id);
  const { fieldDefs, getValue, saveValue } = useCustomFields(
    'standalone_esxi', 'standalone_esxi', projectId, recordIds, canEdit
  );

  const [summary, setSummary] = useState(null);
  useEffect(() => {
    api.get('/migration/standalone-esxi/summary', { params: projectId ? { project_id: projectId } : {} })
      .then(r => setSummary(r.data)).catch(() => {});
  }, [data.total, projectId]);

  const patch = async (id, fields) => {
    try {
      await api.patch(`/migration/standalone-esxi/${id}`, fields);
      reload();
    } catch { message.error('Update failed'); }
  };

  const FILTER_DEFS = [
    { key: 'host',             label: 'Host' },
    { key: 'vi_sdk_server',    label: 'VI SDK Server' },
    { key: 'powerstate',       label: 'Powerstate' },
    { key: 'migration_status', label: 'Migration Status' },
    { key: 'missing_ip',       label: 'Missing IP',
      overrideOpts: [{ value: '1', label: 'VMs missing IP' }] },
  ];

  // missing_ip is a boolean flag, not a DB select
  const augmentedFilterOpts = {
    ...filterOpts,
    missing_ip: ['1'],
  };

  const allColumns = [
    {
      title: 'VM', dataIndex: 'vm', key: 'vm', fixed: 'left', width: 200,
      ellipsis: true,
      render: v => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'Status', dataIndex: 'migration_status', key: 'migration_status', width: 140,
      render: (v, r) => canEdit
        ? <StatusSelect value={v} onChange={val => patch(r.id, { migration_status: val })} />
        : <MigrationStatusBadge status={v} />,
    },
    {
      title: 'Power', dataIndex: 'powerstate', key: 'powerstate', width: 90,
      render: v => <PowerstateBadge state={v} />,
    },
    {
      title: 'Guest State', dataIndex: 'guest_state', key: 'guest_state', width: 110,
      render: v => <GuestStateBadge state={v} />,
    },
    {
      title: 'Primary IP', dataIndex: 'primary_ip', key: 'primary_ip', width: 130,
      render: v => v
        ? <span>{v}</span>
        : <Text type="danger" style={{ fontSize: 11 }}>No IP</Text>,
    },
    { title: 'MAC Address',  dataIndex: 'mac_address', key: 'mac_address', width: 150, render: cell },
    {
      title: 'Host', dataIndex: 'host', key: 'host', width: 160, ellipsis: true, render: cell,
    },
    { title: 'CPUs',         dataIndex: 'cpus',        key: 'cpus',        width: 60 },
    {
      title: 'Memory', dataIndex: 'memory_mib', key: 'memory_mib', width: 90,
      render: v => <DiskSize mib={v} />,
    },
    {
      title: 'Disk', dataIndex: 'total_disk_capacity_mib', key: 'total_disk_capacity_mib', width: 90,
      render: v => <DiskSize mib={v} />,
    },
    { title: 'NICs',         dataIndex: 'nics',          key: 'nics',         width: 55 },
    { title: 'Disks',        dataIndex: 'disks',         key: 'disks',        width: 60 },
    { title: 'OS (config)',  dataIndex: 'os_config',     key: 'os_config',    width: 200, ellipsis: true, render: cell },
    { title: 'OS (tools)',   dataIndex: 'os_tools',      key: 'os_tools',     width: 200, ellipsis: true, render: cell },
  ];

  const baseColumns = hiddenColumns.length
    ? allColumns.filter(c => c.key === 'vm' || !hiddenColumns.includes(c.key))
    : allColumns;

  const customFieldCols = fieldDefs.map(fd => ({
    key:   `cf_${fd.id}`,
    title: fd.label,
    width: fd.field_type === 'textarea' ? 160 : fd.field_type === 'date' ? 140 : 150,
    render: (_, r) => (
      <FieldValueCell
        fieldDef={fd}
        value={getValue(r.id, fd.id)}
        onSave={val => saveValue(fd.id, r.id, val)}
        readOnly={!canEdit}
      />
    ),
  }));

  const columns = [...baseColumns, ...customFieldCols];

  const summaryCards = summary ? [
    { label: 'Total VMs',    value: summary.total },
    { label: 'Migrated',     value: summary.migrated,    color: '#52c41a' },
    { label: 'Pending',      value: summary.pending,     color: '#fa8c16' },
    { label: 'In Progress',  value: summary.in_progress, color: '#1677ff' },
    { label: 'Blocked',      value: summary.blocked,     color: '#ff4d4f' },
    { label: 'Powered Off',  value: summary.powered_off  },
  ] : [];

  return (
    <div>
      {/* Standalone callout banner */}
      <Alert
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        message="Standalone hosts — not centrally managed"
        description="These VMs run on ESXi hosts outside vCenter. Verify migration steps manually; vCenter-driven automation does not apply here."
        style={{ marginBottom: 16 }}
        closable
      />

      <SummaryCards cards={summaryCards} />

      <FilterToolbar
        search={search} onSearch={onSearch}
        filters={filters} onFilter={onFilter}
        filterOpts={augmentedFilterOpts}
        filterDefs={FILTER_DEFS}
        density={density} setDensity={setDensity}
        onClear={clearFilters}
        extra={
          <Button icon={<DownloadOutlined />}
            onClick={() => downloadCSV('standalone-esxi', { ...filters, search })}>
            Export CSV
          </Button>
        }
      />

      <div style={{ marginBottom: 6 }}>
        <Text type="secondary">Showing {data.items.length} of {data.total.toLocaleString()} VMs</Text>
      </div>

      <Table
        rowKey="id"
        size={density}
        loading={loading}
        dataSource={data.items}
        columns={columns}
        pagination={pagination}
        scroll={{ x: 'max-content' }}
        sticky
      />
    </div>
  );
}
