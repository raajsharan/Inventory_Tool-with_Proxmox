import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Select, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  SummaryCards, MigrationStatusBadge, PowerstateBadge,
  GuestStateBadge, DiskSize, downloadCSV, cell,
} from './shared.jsx';
import FilterToolbar from './FilterToolbar.jsx';
import { CUSTOM_COLUMNS } from '../tabColumnRegistry.js';
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

const FILTER_DEFS = [
  { key: 'host',             label: 'Host' },
  { key: 'powerstate',       label: 'Powerstate' },
  { key: 'migration_status', label: 'Migration Status' },
  { key: 'guest_state',      label: 'Guest State' },
];

// ── useMigrTable-equivalent for custom VMs ────────────────────────────────────
function useCustomTable(tabId, projectId) {
  const [data,       setData]       = useState({ items: [], total: 0 });
  const [loading,    setLoading]    = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 50, total: 0 });
  const [density,    setDensity]    = useState('small');
  const [search,     setSearch]     = useState('');
  const [filters,    setFilters]    = useState({});
  const [filterOpts, setFilterOpts] = useState({});

  const load = useCallback((params = {}) => {
    if (!tabId) return;
    setLoading(true);
    api.get('/migration/custom-vms', {
      params: {
        tab_id:    tabId,
        project_id: projectId,
        page:      params.page     ?? pagination.current,
        pageSize:  params.pageSize ?? pagination.pageSize,
        search:    params.search   ?? search,
        ...filters,
        ...params.filters,
      },
    })
      .then(r => {
        setData({ items: r.data.items, total: r.data.total });
        setPagination(p => ({ ...p, total: r.data.total, current: r.data.page }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tabId, projectId, search, filters, pagination.current, pagination.pageSize]);

  useEffect(() => { load(); }, [tabId, projectId]);

  useEffect(() => {
    if (!tabId) return;
    api.get('/migration/custom-vms/filter-opts', { params: { tab_id: tabId } })
      .then(r => setFilterOpts(r.data))
      .catch(() => {});
  }, [tabId]);

  const reload = () => load();

  const onSearch = (val) => {
    setSearch(val);
    setPagination(p => ({ ...p, current: 1 }));
    load({ search: val, page: 1 });
  };

  const onFilter = (key, val) => {
    const f = { ...filters, [key]: val };
    if (!val) delete f[key];
    setFilters(f);
    load({ filters: f, page: 1 });
    setPagination(p => ({ ...p, current: 1 }));
  };

  const clearFilters = () => {
    setFilters({});
    setSearch('');
    load({ filters: {}, search: '', page: 1 });
    setPagination(p => ({ ...p, current: 1 }));
  };

  const handleTableChange = (pag) => {
    setPagination(p => ({ ...p, current: pag.current, pageSize: pag.pageSize }));
    load({ page: pag.current, pageSize: pag.pageSize });
  };

  return {
    data, loading, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts,
    pagination: { ...pagination, onChange: handleTableChange, showSizeChanger: true, showTotal: t => `${t} VMs` },
    reload,
  };
}

// ── Column builder ─────────────────────────────────────────────────────────────
function buildColumns(hiddenColumns, canEdit, patch) {
  const hidden = new Set(hiddenColumns);

  const all = [
    {
      title: 'VM', dataIndex: 'vm', key: 'vm', fixed: 'left', width: 200,
      ellipsis: true,
      render: v => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    !hidden.has('migration_status') && {
      title: 'Status', dataIndex: 'migration_status', key: 'migration_status', width: 140,
      render: (v, r) => canEdit
        ? <StatusSelect value={v} onChange={val => patch(r.id, { migration_status: val })} />
        : <MigrationStatusBadge status={v} />,
    },
    !hidden.has('powerstate') && {
      title: 'Power', dataIndex: 'powerstate', key: 'powerstate', width: 90,
      render: v => <PowerstateBadge state={v} />,
    },
    !hidden.has('guest_state') && {
      title: 'Guest State', dataIndex: 'guest_state', key: 'guest_state', width: 110,
      render: v => <GuestStateBadge state={v} />,
    },
    !hidden.has('primary_ip')  && { title: 'Primary IP',  dataIndex: 'primary_ip',  key: 'primary_ip',  width: 130, render: cell },
    !hidden.has('mac_address') && { title: 'MAC Address', dataIndex: 'mac_address', key: 'mac_address', width: 150, render: cell },
    !hidden.has('dns_name')    && { title: 'DNS Name',    dataIndex: 'dns_name',    key: 'dns_name',    width: 180, ellipsis: true, render: cell },
    !hidden.has('host')        && { title: 'Host',        dataIndex: 'host',        key: 'host',        width: 160, ellipsis: true, render: cell },
    !hidden.has('cpus')        && { title: 'CPUs',        dataIndex: 'cpus',        key: 'cpus',        width: 60 },
    !hidden.has('memory_mib')  && {
      title: 'Memory', dataIndex: 'memory_mib', key: 'memory_mib', width: 90,
      render: v => <DiskSize mib={v} />,
    },
    !hidden.has('total_disk_capacity_mib') && {
      title: 'Disk', dataIndex: 'total_disk_capacity_mib', key: 'total_disk_capacity_mib', width: 90,
      render: v => <DiskSize mib={v} />,
    },
    !hidden.has('nics')      && { title: 'NICs',        dataIndex: 'nics',       key: 'nics',        width: 55 },
    !hidden.has('disks')     && { title: 'Disks',       dataIndex: 'disks',      key: 'disks',       width: 60 },
    !hidden.has('os_config') && { title: 'OS (config)', dataIndex: 'os_config',  key: 'os_config',   width: 200, ellipsis: true, render: cell },
    !hidden.has('os_tools')  && { title: 'OS (tools)',  dataIndex: 'os_tools',   key: 'os_tools',    width: 200, ellipsis: true, render: cell },
    !hidden.has('datacenter')&& { title: 'Datacenter',  dataIndex: 'datacenter', key: 'datacenter',  width: 130, render: cell },
    !hidden.has('cluster')   && { title: 'Cluster',     dataIndex: 'cluster',    key: 'cluster',     width: 130, ellipsis: true, render: cell },
    !hidden.has('path')      && { title: 'Path',        dataIndex: 'path',       key: 'path',        width: 200, ellipsis: true, render: cell },
  ];

  return all.filter(Boolean);
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CustomVMsTab({ tabId, projectId, hiddenColumns = [] }) {
  const { user } = useAuth();
  const canEdit = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);

  const {
    data, loading, pagination, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts, reload,
  } = useCustomTable(tabId, projectId);

  const recordIds = data.items.map(r => r.id);
  const tabKey = tabId ? `custom_${tabId}` : null;
  const { fieldDefs, getValue, saveValue } = useCustomFields(
    tabKey, 'custom_vm', projectId, recordIds, canEdit
  );

  const [summary, setSummary] = useState(null);
  useEffect(() => {
    if (!tabId) return;
    api.get('/migration/custom-vms/summary', { params: { tab_id: tabId } })
      .then(r => setSummary(r.data)).catch(() => {});
  }, [data.total, tabId]);

  const patch = async (id, fields) => {
    try {
      await api.patch(`/migration/custom-vms/${id}`, fields);
      reload();
    } catch { message.error('Update failed'); }
  };

  const baseColumns = buildColumns(hiddenColumns, canEdit, patch);

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
    { label: 'Total VMs',   value: summary.total },
    { label: 'Migrated',    value: summary.migrated,    color: '#52c41a' },
    { label: 'Pending',     value: summary.pending,     color: '#fa8c16' },
    { label: 'In Progress', value: summary.in_progress, color: '#1677ff' },
    { label: 'Blocked',     value: summary.blocked,     color: '#ff4d4f' },
    { label: 'Powered Off', value: summary.powered_off },
  ] : [];

  return (
    <div>
      <SummaryCards cards={summaryCards} />

      <FilterToolbar
        search={search} onSearch={onSearch}
        filters={filters} onFilter={onFilter}
        filterOpts={filterOpts}
        filterDefs={FILTER_DEFS}
        density={density} setDensity={setDensity}
        onClear={clearFilters}
        extra={
          <Button icon={<DownloadOutlined />}
            onClick={() => downloadCSV('custom-vms', { ...filters, search, tab_id: tabId })}>
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
        onChange={pagination.onChange}
        scroll={{ x: 'max-content' }}
        sticky
      />
    </div>
  );
}
