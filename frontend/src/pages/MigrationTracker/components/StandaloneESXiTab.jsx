import { useState, useEffect, useRef } from 'react';
import { Table, Button, Select, Typography, Alert, Space, message } from 'antd';
import { DownloadOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  useMigrTable, SummaryCards, MigrationStatusBadge, PowerstateBadge,
  GuestStateBadge, DiskSize, downloadCSV, cell, useColumnVisibility, ColumnToggleButton,
} from './shared.jsx';
import FilterToolbar from './FilterToolbar.jsx';
import { useCustomFields } from './useCustomFields.js';
import FieldValueCell    from './FieldValueCell.jsx';

const { Text } = Typography;

const STATUS_OPTIONS = [
  'Not Started', 'Awaiting confirmation', 'In Progress',
  'Completed', 'Cleaned up', 'To be Deleted', 'Deleted',
];

function StatusSelect({ value, onChange }) {
  return (
    <Select size="small" value={value || 'Not Started'} onChange={onChange}
      style={{ width: 130 }}
      options={STATUS_OPTIONS.map(v => ({ value: v, label: v }))}
      labelRender={({ label }) => <span>{label}</span>}
      getPopupContainer={() => document.body} />
  );
}

export default function StandaloneESXiTab({ projectId, hiddenColumns = [] }) {
  const { user } = useAuth();
  const canEdit = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);

  const {
    data, loading, pagination, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts, reload,
    onTableChange, sortKey, sortDir,
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

  const remove = async (id) => {
    try {
      await api.delete(`/migration/standalone-esxi/${id}`);
      reload();
    } catch { message.error('Delete failed'); }
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
      sorter: true, sortOrder: sortKey === 'migration_status' ? sortDir : null,
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

  const staticToggleable = allColumns.filter(c => c.key !== 'vm' && !hiddenColumns.includes(c.key));
  const customFieldCols = fieldDefs.map(fd => ({
    key:   `cf_${fd.id}`,
    title: fd.label,
    width: fd.field_type === 'textarea' ? 160 : fd.field_type === 'date' ? 140 : 150,
    // Client-side only — sorts the current page. A true server-side sort
    // would need a per-field-definition join and isn't worth the complexity
    // for an ad-hoc, per-project custom field.
    sorter: (a, b) => String(getValue(a.id, fd.id) ?? '').localeCompare(String(getValue(b.id, fd.id) ?? '')),
    render: (_, r) => (
      <FieldValueCell
        fieldDef={fd}
        value={getValue(r.id, fd.id)}
        onSave={val => saveValue(fd.id, r.id, val)}
        readOnly={!canEdit}
      />
    ),
  }));
  const allToggleable = [...staticToggleable, ...customFieldCols];
  const { visible, toggle, reset, order, reorder } = useColumnVisibility('standalone-esxi', allToggleable.map(c => c.key));

  const columns = [
    allColumns[0], // vm — always visible, never reordered
    ...order
      .filter(k => visible.has(k))
      .map(k => allToggleable.find(c => c.key === k))
      .filter(Boolean),
  ];

  const summaryCards = summary ? [
    { label: 'Total VMs',     value: summary.total },
    { label: 'Not Started',   value: summary.not_started },
    { label: 'Awaiting',      value: summary.awaiting_confirmation, color: '#fa8c16' },
    { label: 'In Progress',   value: summary.in_progress,           color: '#1677ff' },
    { label: 'Completed',     value: summary.completed,             color: '#52c41a' },
    { label: 'Cleaned up',    value: summary.cleaned_up,            color: '#13c2c2' },
    { label: 'To be Deleted', value: summary.to_be_deleted,         color: '#fa541c' },
    { label: 'Blocked',       value: summary.blocked,               color: '#ff4d4f' },
    { label: 'Deleted',       value: summary.deleted_count },
    { label: 'Powered Off',   value: summary.powered_off },
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
          <Space>
            <ColumnToggleButton columns={allToggleable} visible={visible} onToggle={toggle} onReset={reset} order={order} onReorder={reorder} />
            <Button icon={<DownloadOutlined />}
              onClick={() => downloadCSV('standalone-esxi', { ...filters, search })}>
              Export CSV
            </Button>
          </Space>
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
        onChange={onTableChange}
        scroll={{ x: 'max-content' }}
        sticky
      />
    </div>
  );
}
