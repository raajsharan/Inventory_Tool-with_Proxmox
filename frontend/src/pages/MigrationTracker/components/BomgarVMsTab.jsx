import { useState, useEffect, useRef } from 'react';
import { Table, Button, Select, Typography, Space, message, Tooltip, Tag } from 'antd';
import { DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  useMigrTable, SummaryCards, MigrationStatusBadge, PowerstateBadge,
  DiskSize, downloadCSV, cell, useColumnVisibility, ColumnToggleButton,
} from './shared.jsx';
import FilterToolbar from './FilterToolbar.jsx';
import { useCustomFields } from './useCustomFields.js';
import FieldValueCell    from './FieldValueCell.jsx';

const { Text } = Typography;

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed', 'Deleted'];

function StatusSelect({ value, onChange }) {
  return (
    <Select
      size="small" value={value || 'Not Started'} onChange={onChange}
      style={{ width: 130 }}
      options={STATUS_OPTIONS.map(v => ({ value: v, label: v }))}
      labelRender={({ label }) => <span>{label}</span>}
      getPopupContainer={() => document.body}
    />
  );
}

function osFamily(osStr) {
  if (!osStr) return 'Other';
  const s = osStr.toLowerCase();
  if (s.includes('windows')) return 'Windows';
  if (s.includes('linux') || s.includes('ubuntu') || s.includes('centos')
      || s.includes('red hat') || s.includes('debian') || s.includes('suse'))
    return 'Linux';
  return 'Other';
}

function OsTag({ osConfig, osTools }) {
  const family = osFamily(osConfig || osTools);
  const color = family === 'Windows' ? 'blue' : family === 'Linux' ? 'green' : 'default';
  const display = osConfig || osTools;
  return (
    <Tooltip title={display}>
      <Tag color={color} style={{ margin: 0 }}>{family}</Tag>
    </Tooltip>
  );
}

// ── Summary hook ──────────────────────────────────────────────────────────────
function useSummary(total) {
  const [summary, setSummary] = useState(null);
  const [ran,     setRan]     = useState(false);
  if (!ran) {
    setRan(true);
    api.get('/migration/bomgar-vms/summary').then(r => setSummary(r.data)).catch(() => {});
  }
  return summary;
}

export default function BomgarVMsTab({ projectId, onJumpToHost, hiddenColumns = [] }) {
  const { user } = useAuth();
  const canEdit = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);

  const {
    data, loading, pagination, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts, reload,
  } = useMigrTable('/migration/bomgar-vms', projectId ? { project_id: projectId } : {});

  const recordIds = data.items.map(r => r.id);
  const { fieldDefs, getValue, saveValue } = useCustomFields(
    'bomgar_vms', 'bomgar_vm', projectId, recordIds, canEdit
  );

  const [summary2, setSummary2] = useState(null);
  useEffect(() => {
    api.get('/migration/bomgar-vms/summary', { params: projectId ? { project_id: projectId } : {} })
      .then(r => setSummary2(r.data)).catch(() => {});
  }, [data.total, projectId]);

  const patch = async (id, fields) => {
    try {
      await api.patch(`/migration/bomgar-vms/${id}`, fields);
      reload();
    } catch { message.error('Update failed'); }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/migration/bomgar-vms/${id}`);
      reload();
    } catch { message.error('Delete failed'); }
  };

  const FILTER_DEFS = [
    { key: 'host',             label: 'Host' },
    { key: 'datacenter',       label: 'Datacenter' },
    { key: 'powerstate',       label: 'Powerstate' },
    { key: 'migration_status', label: 'Migration Status' },
    { key: 'os_family',        label: 'OS Family', overrideOpts: ['Windows', 'Linux', 'Other'] },
  ];

  // OS family has static options, not from DB
  const augmentedFilterOpts = {
    ...filterOpts,
    os_family: ['Windows', 'Linux', 'Other'],
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
        ? <StatusSelect value={v} onChange={val => val === 'Deleted' ? remove(r.id) : patch(r.id, { migration_status: val })} />
        : <MigrationStatusBadge status={v} />,
    },
    {
      title: 'Power', dataIndex: 'powerstate', key: 'powerstate', width: 90,
      render: v => <PowerstateBadge state={v} />,
    },
    { title: 'DNS Name',   dataIndex: 'dns_name',    key: 'dns_name',    width: 180, ellipsis: true, render: cell },
    { title: 'Primary IP', dataIndex: 'primary_ip',  key: 'primary_ip',  width: 130, render: cell },
    { title: 'CPUs',       dataIndex: 'cpus',        key: 'cpus',        width: 60 },
    {
      title: 'Memory', dataIndex: 'memory_mib', key: 'memory_mib', width: 90,
      render: v => <DiskSize mib={v} />,
    },
    {
      title: 'Disk', dataIndex: 'total_disk_capacity_mib', key: 'total_disk_capacity_mib', width: 90,
      render: v => <DiskSize mib={v} />,
    },
    { title: 'NICs',  dataIndex: 'nics',  key: 'nics',  width: 55 },
    { title: 'Disks', dataIndex: 'disks', key: 'disks', width: 60 },
    {
      title: 'OS', key: 'os', width: 90,
      render: (_, r) => <OsTag osConfig={r.os_config} osTools={r.os_tools} />,
    },
    { title: 'OS (config)',  dataIndex: 'os_config', key: 'os_config', width: 180, ellipsis: true, render: cell },
    { title: 'OS (tools)',   dataIndex: 'os_tools',  key: 'os_tools',  width: 180, ellipsis: true, render: cell },
    { title: 'Datacenter',  dataIndex: 'datacenter',key: 'datacenter',width: 130, render: cell },
    { title: 'Cluster',     dataIndex: 'cluster',   key: 'cluster',   width: 130, ellipsis: true, render: cell },
    {
      title: 'Host', dataIndex: 'host', key: 'host', width: 160, ellipsis: true,
      render: (v) => onJumpToHost
        ? (
          <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => onJumpToHost(v)}
            style={{ padding: 0, height: 'auto' }}>
            {v || '—'}
          </Button>
        )
        : cell(v),
    },
    { title: 'Path',  dataIndex: 'path',  key: 'path',  width: 200, ellipsis: true, render: cell },
  ];

  const toggleableCols = allColumns.filter(c => c.key !== 'vm' && !hiddenColumns.includes(c.key));
  const { visible, toggle, reset, order, reorder } = useColumnVisibility('bomgar-vms', toggleableCols.map(c => c.key));

  const baseColumns = [
    allColumns[0], // vm — always visible, never reordered
    ...order
      .filter(k => visible.has(k))
      .map(k => allColumns.find(c => c.key === k))
      .filter(Boolean),
  ];

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

  const summaryCards = summary2 ? [
    { label: 'Total VMs',    value: summary2.total },
    { label: 'Migrated',     value: summary2.migrated,    color: '#52c41a' },
    { label: 'Pending',      value: summary2.pending,     color: '#fa8c16' },
    { label: 'In Progress',  value: summary2.in_progress, color: '#1677ff' },
    { label: 'Blocked',      value: summary2.blocked,     color: '#ff4d4f' },
    { label: 'Powered Off',  value: summary2.powered_off                   },
    { label: 'Total vCPUs',  value: summary2.total_vcpus                  },
  ] : [];

  return (
    <div>
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
            <ColumnToggleButton columns={toggleableCols} visible={visible} onToggle={toggle} onReset={reset} order={order} onReorder={reorder} />
            <Button icon={<DownloadOutlined />}
              onClick={() => downloadCSV('bomgar-vms', { ...filters, search })}>
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
        scroll={{ x: 'max-content' }}
        sticky
      />
    </div>
  );
}
