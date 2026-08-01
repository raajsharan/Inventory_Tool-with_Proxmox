import { useEffect, useState, useCallback } from 'react';
import { Table, Input, Select, Space, Button, Tag, Tooltip, Card } from 'antd';
import { SearchOutlined, ReloadOutlined, DownloadOutlined, AppstoreAddOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import AddToInventoryModal, { vmwareToInventory } from '../../../components/AddToInventoryModal.jsx';
import { DASH_CSS } from '../../../components/DashboardStatCard.jsx';

const { Option } = Select;

function powerTag(state) {
  if (state === 'poweredOn')  return <Tag color="success">On</Tag>;
  if (state === 'poweredOff') return <Tag color="default">Off</Tag>;
  if (state === 'suspended')  return <Tag color="warning">Suspended</Tag>;
  return <Tag>{state || '—'}</Tag>;
}

export default function VMList({ hostId }) {
  const [data, setData]         = useState({ items: [], total: 0 });
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [powerFilter, setPower] = useState(undefined);
  const [page, setPage]         = useState(1);
  const pageSize = 50;

  // Add-to-inventory modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill,   setPrefill]   = useState(null);

  const load = useCallback((overrides = {}) => {
    setLoading(true);
    const effective = { page, search, powerFilter, hostId, ...overrides };
    const params = { page: effective.page, pageSize };
    if (effective.search)      params.search     = effective.search;
    if (effective.powerFilter) params.powerState = effective.powerFilter;
    if (effective.hostId)      params.hostId     = effective.hostId;
    api.get('/vmware/vms', { params })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [page, search, powerFilter, hostId]); // eslint-disable-line

  useEffect(() => { load(); }, [page, powerFilter]); // eslint-disable-line

  function onSearch() { setPage(1); load({ page: 1 }); }

  async function onExport() {
    const params = new URLSearchParams();
    if (hostId) params.set('hostId', hostId);
    const url = `/api/vmware/vms/export?${params}`;
    const token = localStorage.getItem('token');
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vmware_vms.csv';
    a.click();
  }

  function openAddToInventory(vm) {
    setPrefill(vmwareToInventory(vm));
    setModalOpen(true);
  }

  const columns = [
    {
      title: 'VM Name', dataIndex: 'name', key: 'name', ellipsis: true,
      render: v => <Tooltip title={v}>{v}</Tooltip>,
    },
    { title: 'Hostname',    dataIndex: 'hostname',       key: 'hostname', ellipsis: true },
    {
      title: 'IP Addresses', dataIndex: 'ips', key: 'ips', width: 200,
      render: ips => {
        const list = Array.isArray(ips) ? ips.filter(ip => ip && ip !== 'Not Available') : [];
        if (!list.length) return <span style={{ color: '#bfbfbf' }}>—</span>;
        const primary = list.filter(ip => /^192\.168\./.test(ip));
        const rest    = list.filter(ip => !/^192\.168\./.test(ip));
        const shown   = primary.length ? primary : list.slice(0, 1);
        const more    = primary.length ? rest    : list.slice(1);
        return (
          <Space direction="vertical" size={2}>
            {shown.map(ip => (
              <Tag key={ip} style={{ fontFamily: 'monospace', fontSize: 11, margin: 0 }}>{ip}</Tag>
            ))}
            {more.length > 0 && (
              <Tooltip title={<span style={{ whiteSpace: 'pre' }}>{more.join('\n')}</span>}>
                <Tag style={{ cursor: 'pointer', margin: 0 }}>+{more.length} more</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'MAC Address(es)', dataIndex: 'macs', key: 'macs', width: 200,
      render: macs => {
        const list = Array.isArray(macs) ? macs.filter(m => m && m !== 'Not Available') : [];
        if (!list.length) return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <Tooltip title={list.join('\n')}>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {list[0]}
              {list.length > 1 && <Tag style={{ marginLeft: 4 }}>+{list.length - 1}</Tag>}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: 'ESXi Host', dataIndex: 'esxi_host_name', key: 'esxi_host_name', ellipsis: true,
      render: (name, r) => {
        const ip = r.esxi_host_ip;
        if (!name || name === 'Not Available') return name || '—';
        // Show the IP alongside the name when it adds information.
        const showIp = ip && ip !== 'Not Available' && ip !== name;
        return (
          <span>
            {name}
            {showIp && (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8c8c8c' }}>{ip}</div>
            )}
          </span>
        );
      },
    },
    {
      title: 'Power',       dataIndex: 'power_state',    key: 'power_state',
      render: powerTag,
    },
    { title: 'OS Type',     dataIndex: 'os_type',        key: 'os_type',       ellipsis: true },
    { title: 'OS Version',  dataIndex: 'os_version',     key: 'os_version',    ellipsis: true },
    {
      title: 'CPU', dataIndex: 'num_cpu', key: 'num_cpu', width: 60,
      render: v => v ?? '—',
    },
    {
      title: 'RAM (MB)', dataIndex: 'memory_mb', key: 'memory_mb', width: 90,
      render: v => v ?? '—',
    },
    {
      title: 'Snapshots', dataIndex: 'snapshot_count', key: 'snapshot_count', width: 90,
      render: v => v > 0 ? <Tag color="orange">{v}</Tag> : '—',
    },
    { title: 'Source', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
    {
      title: '', key: 'actions', width: 52, fixed: 'right',
      render: (_, record) => (
        <Tooltip title="Add to Ext. Asset Inventory">
          <Button
            size="small"
            type="primary"
            ghost
            icon={<AppstoreAddOutlined />}
            onClick={() => openAddToInventory(record)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      <style>{DASH_CSS}</style>
      <Card
        size="small"
        className="dashcard"
        title={`${data.total} VMs`}
        extra={
          <Space>
            <Input
              placeholder="Search name, hostname, IP…"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => {
                const v = e.target.value;
                setSearch(v);
                if (!v) { setPage(1); load({ page: 1, search: '' }); }
              }}
              onPressEnter={onSearch}
              style={{ width: 260 }}
              allowClear
            />
            <Select
              placeholder="Power state"
              allowClear
              value={powerFilter}
              onChange={v => { setPower(v); setPage(1); }}
              style={{ width: 140 }}
            >
              <Option value="poweredOn">Powered On</Option>
              <Option value="poweredOff">Powered Off</Option>
              <Option value="suspended">Suspended</Option>
            </Select>
            <Button icon={<SearchOutlined />} onClick={onSearch}>Search</Button>
            <Tooltip title="Reload the VM list">
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
            <Tooltip title="Download the current VMware inventory as CSV">
              <Button icon={<DownloadOutlined />} onClick={onExport}>Export CSV</Button>
            </Tooltip>
          </Space>
        }
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={data.items}
          rowClassName="dashcard-row"
          columns={columns}
          scroll={{ x: 1700 }}
          pagination={{
            current: page,
            pageSize,
            total: data.total,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: t => `${t} total`,
          }}
        />
      </Card>

      <AddToInventoryModal
        open={modalOpen}
        prefill={prefill}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
