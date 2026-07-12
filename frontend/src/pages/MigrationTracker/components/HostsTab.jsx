import { useState, useEffect } from 'react';
import { Table, Button, Tag, Tooltip, Typography, Space, theme, message, Select, Input } from 'antd';
import { DownloadOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  useMigrTable, SummaryCards, MigrationStatusBadge, MaskedField,
  downloadCSV, cell,
} from './shared.jsx';
import FilterToolbar from './FilterToolbar.jsx';

const { Text } = Typography;

// ── License expiry helpers ────────────────────────────────────────────────────
function expiryStyle(dateStr, token) {
  if (!dateStr) return {};
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = (d - now) / 86400000;
  if (diffDays < 0)  return { background: token.colorErrorBg, borderLeft: `3px solid ${token.colorError}` };
  if (diffDays < 30) return { background: token.colorWarningBg, borderLeft: `3px solid ${token.colorWarning}` };
  return {};
}

function ExpiryDate({ value }) {
  if (!value) return <Text type="secondary">—</Text>;
  const d = new Date(value);
  const now = new Date();
  const diffDays = (d - now) / 86400000;
  const fmt = d.toLocaleDateString();
  if (diffDays < 0)  return <Tag color="error" icon={<WarningOutlined />}>{fmt} (expired)</Tag>;
  if (diffDays < 30) return <Tag color="warning" icon={<WarningOutlined />}>{fmt}</Tag>;
  return <span>{fmt}</span>;
}

// ── Status select (inline edit) ───────────────────────────────────────────────
const DEFAULT_STAGE_VALUES = ['Pending', 'In Progress', 'Completed'];

function StageSelect({ value, onChange, disabled = false, options }) {
  const opts = (options?.length ? options : DEFAULT_STAGE_VALUES);
  const safeValue = opts.includes(value) ? value : opts[0];
  return (
    <Select
      size="small"
      value={safeValue}
      onChange={onChange}
      disabled={disabled}
      style={{ width: 140 }}
      options={opts.map(v => ({ value: v, label: v }))}
    />
  );
}

// ── Summary loader ────────────────────────────────────────────────────────────
function useHostsSummary(refreshKey, projectId) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    api.get('/migration/hosts/summary', { params: projectId ? { project_id: projectId } : {} })
      .then(r => setSummary(r.data)).catch(() => {});
  }, [refreshKey, projectId]);
  return summary;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HostsTab({ projectId, refreshToken = 0, stageOptions, assignedToOptions }) {
  const { user, canViewPasswords } = useAuth();
  const canEdit = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const { token } = theme.useToken();

  const {
    data, loading, pagination, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts, reload,
  } = useMigrTable('/migration/hosts', projectId ? { project_id: projectId } : {});

  const [patchTick, setPatchTick] = useState(0);
  const summary = useHostsSummary(refreshToken + data.total + patchTick, projectId);

  const patch = async (id, fields) => {
    try {
      await api.patch(`/migration/hosts/${id}`, fields);
      setPatchTick(t => t + 1);
      reload();
    } catch { message.error('Update failed'); }
  };

  const FILTER_DEFS = [
    { key: 'datacenter',  label: 'Datacenter' },
    { key: 'vcenter',     label: 'vCenter' },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'host_owner',  label: 'Host Owner' },
    { key: 'vms_vacate',  label: 'VMs Vacate' },
    { key: 'proxmox_install', label: 'Proxmox Install' },
    { key: 'vm_migration_back', label: 'Migration Back' },
  ];

  const columns = [
    {
      title: 'Host', dataIndex: 'host', key: 'host', fixed: 'left', width: 180,
      render: v => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    { title: 'vCenter',    dataIndex: 'vcenter',    key: 'vcenter',    width: 140, ellipsis: true, render: cell },
    { title: 'Datacenter', dataIndex: 'datacenter', key: 'datacenter', width: 130, ellipsis: true, render: cell },
    { title: 'iDRAC',      dataIndex: 'idrac',      key: 'idrac',      width: 150, ellipsis: true, render: cell },
    {
      title: 'iDRAC Username', key: 'idrac_username', width: 160,
      render: (_, r) => (
        <MaskedField
          hostId={r.id} fieldName="username"
          canReveal={!!canViewPasswords}
        />
      ),
    },
    {
      title: 'iDRAC Password', key: 'idrac_password', width: 160,
      render: (_, r) => (
        <MaskedField
          hostId={r.id} fieldName="password"
          canReveal={!!canViewPasswords}
        />
      ),
    },
    { title: 'Virtual Console', dataIndex: 'idrac_virtual_console', key: 'idrac_virtual_console', width: 160, ellipsis: true, render: cell },
    { title: 'ESX Version',     dataIndex: 'esx_version',          key: 'esx_version',           width: 120, render: cell },
    { title: 'Model',           dataIndex: 'model',                key: 'model',                  width: 160, ellipsis: true, render: cell },
    { title: 'Serial No.',      dataIndex: 'serial_number',        key: 'serial_number',          width: 130, render: cell },
    { title: 'BIOS Vendor',     dataIndex: 'bios_vendor',          key: 'bios_vendor',            width: 120, render: cell },
    { title: 'Min Cores',       dataIndex: 'min_cores',            key: 'min_cores',              width: 90,  render: cell },
    {
      title: 'License Expiry', dataIndex: 'license_expiry_date', key: 'license_expiry_date', width: 150,
      render: v => <ExpiryDate value={v} />,
    },
    { title: 'Assigned Licenses', dataIndex: 'assigned_licenses', key: 'assigned_licenses', width: 180, ellipsis: true, render: cell },
    {
      title: 'Assigned To', dataIndex: 'assigned_to', key: 'assigned_to', width: 160,
      render: (v, r) => {
        if (!canEdit) return cell(v);
        // If admin configured fixed options, use a fixed Select
        if (assignedToOptions?.length) {
          return (
            <StageSelect
              value={v}
              options={assignedToOptions}
              onChange={val => patch(r.id, { assigned_to: val })}
            />
          );
        }
        // No configured options — derive from existing values in table + allow free entry
        const autoOpts = [...new Set(data.items.map(i => i.assigned_to).filter(Boolean))];
        return (
          <Select
            size="small"
            mode="tags"
            value={v ? [v] : []}
            onChange={vals => {
              const latest = vals[vals.length - 1] ?? '';
              patch(r.id, { assigned_to: latest });
            }}
            style={{ width: 145 }}
            maxTagCount={1}
            options={autoOpts.map(o => ({ value: o, label: o }))}
            tokenSeparators={[',']}
            placeholder="Assign to…"
          />
        );
      },
    },
    { title: 'Host Owner',       dataIndex: 'host_owner',     key: 'host_owner',     width: 140, render: cell },
    { title: 'VMs to Migrate',   dataIndex: 'vms_to_migrate', key: 'vms_to_migrate', width: 110, render: cell },
    { title: 'Powered Off VMs',  dataIndex: 'powered_off_vms',key: 'powered_off_vms',width: 120, render: cell },
    {
      title: 'VMs Vacate',
      dataIndex: 'vms_vacate', key: 'vms_vacate', width: 155,
      render: (v, r) => canEdit
        ? <StageSelect value={v} options={stageOptions} onChange={val => patch(r.id, { vms_vacate: val })} />
        : <StageSelect value={v} options={stageOptions} disabled />,
    },
    {
      title: 'Proxmox Install',
      dataIndex: 'proxmox_install', key: 'proxmox_install', width: 155,
      render: (v, r) => canEdit
        ? <StageSelect value={v} options={stageOptions} onChange={val => patch(r.id, { proxmox_install: val })} />
        : <StageSelect value={v} options={stageOptions} disabled />,
    },
    {
      title: 'VM Migration Back',
      dataIndex: 'vm_migration_back', key: 'vm_migration_back', width: 155,
      render: (v, r) => canEdit
        ? <StageSelect value={v} options={stageOptions} onChange={val => patch(r.id, { vm_migration_back: val })} />
        : <StageSelect value={v} options={stageOptions} disabled />,
    },
  ];

  const summaryCards = summary ? [
    { label: 'Total Hosts',       value: summary.total_hosts },
    { label: 'Fully Migrated',    value: summary.fully_migrated,       color: '#52c41a' },
    { label: 'Pending Vacate',    value: summary.pending_vacate,       color: '#fa8c16' },
    { label: 'VMs to Migrate',    value: summary.total_vms_to_migrate  },
    { label: 'Powered Off VMs',   value: summary.total_powered_off     },
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
          <Button
            icon={<DownloadOutlined />}
            onClick={() => downloadCSV('hosts', { ...filters, search })}
          >
            Export CSV
          </Button>
        }
      />

      <div style={{ marginBottom: 6 }}>
        <Text type="secondary">
          Showing {data.items.length} of {data.total.toLocaleString()} hosts
          {!canViewPasswords && (
            <Tooltip title="Your account does not have password reveal access">
              <Tag color="warning" style={{ marginLeft: 8 }}>iDRAC credentials masked</Tag>
            </Tooltip>
          )}
        </Text>
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
        rowClassName={(r) => {
          const s = expiryStyle(r.license_expiry_date, token);
          return Object.keys(s).length ? 'expiry-warning-row' : '';
        }}
        onRow={(r) => ({ style: expiryStyle(r.license_expiry_date, token) })}
      />
    </div>
  );
}
