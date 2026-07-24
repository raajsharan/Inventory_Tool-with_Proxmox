import { useEffect, useState, useCallback } from 'react';
import { Table, Input, Select, Space, Button, Tag, Tooltip } from 'antd';
import {
  SearchOutlined, DownloadOutlined, ContainerOutlined, LaptopOutlined,
  AppstoreAddOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import AddToInventoryModal, { proxmoxToInventory } from '../../../components/AddToInventoryModal.jsx';

const { Option } = Select;

function statusTag(s) {
  if (s === 'running') return <Tag color="success">Running</Tag>;
  if (s === 'stopped') return <Tag color="default">Stopped</Tag>;
  if (s === 'paused')  return <Tag color="warning">Paused</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

function typeIcon(t) {
  return t === 'lxc'
    ? <Tooltip title="LXC Container"><ContainerOutlined style={{ color: '#1890ff' }} /> LXC</Tooltip>
    : <Tooltip title="QEMU VM"><LaptopOutlined style={{ color: '#722ed1' }} /> QEMU</Tooltip>;
}

export default function PVEList() {
  const [items,   setItems]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [vmType,  setVmType]  = useState('');
  const [page,    setPage]    = useState(1);
  const pageSize = 50;

  // Add-to-inventory modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill,   setPrefill]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, pageSize };
    if (search)  params.search  = search;
    if (status)  params.status  = status;
    if (vmType)  params.vmType  = vmType;
    api.get('/proxmox/vms', { params })
      .then(r => { setItems(r.data.items); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, [page, search, status, vmType]);

  useEffect(() => { load(); }, [load]);

  async function exportCSV() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/proxmox/vms/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'proxmox-inventory.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function openAddToInventory(vm) {
    setPrefill(proxmoxToInventory(vm));
    setModalOpen(true);
  }

  const columns = [
    { title: 'VMID',     dataIndex: 'vmid',        key: 'vmid',        width: 80 },
    { title: 'Name',     dataIndex: 'name',         key: 'name',        ellipsis: true },
    { title: 'Type',     dataIndex: 'vm_type',      key: 'vm_type',     width: 110, render: typeIcon },
    { title: 'Node',     dataIndex: 'node',         key: 'node',        ellipsis: true },
    { title: 'Status',   dataIndex: 'status',       key: 'status',      width: 100, render: statusTag },
    { title: 'CPUs',     dataIndex: 'cpu_count',    key: 'cpu_count',   width: 70 },
    { title: 'Mem (MB)', dataIndex: 'memory_mb',    key: 'memory_mb',   width: 100 },
    { title: 'Disk (GB)',dataIndex: 'disk_gb',      key: 'disk_gb',     width: 100, render: v => v ?? '—' },
    {
      title: 'IPs', dataIndex: 'ips', key: 'ips', ellipsis: true,
      render: v => Array.isArray(v) ? v.filter(i => i !== 'Not Available').join(', ') || '—' : '—',
    },
    {
      title: 'MAC Address', dataIndex: 'macs', key: 'macs', ellipsis: true,
      render: v => Array.isArray(v) ? v.join(', ') || '—' : '—',
    },
    { title: 'OS',       dataIndex: 'os_type',      key: 'os_type',     ellipsis: true, render: v => v || '—' },
    {
      title: 'Uptime', dataIndex: 'uptime_seconds', key: 'uptime', width: 100,
      render: v => {
        if (!v) return '—';
        const d = Math.floor(v / 86400), h = Math.floor((v % 86400) / 3600);
        return d > 0 ? `${d}d ${h}h` : `${h}h`;
      },
    },
    {
      title: 'Snapshots', dataIndex: 'snapshot_count', key: 'snapshot_count', width: 100,
      render: v => v ? <Tag color="orange">{v}</Tag> : '0',
    },
    {
      title: 'Template', dataIndex: 'is_template', key: 'is_template', width: 90,
      render: v => v ? <Tag color="purple">Template</Tag> : '—',
    },
    { title: 'Pool',     dataIndex: 'pool',         key: 'pool',        ellipsis: true, render: v => v || '—' },
    {
      title: 'Tags', dataIndex: 'tags', key: 'tags',
      render: v => Array.isArray(v) && v.length ? v.map(t => <Tag key={t}>{t}</Tag>) : '—',
    },
    { title: 'Source Host', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
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
      <div style={{ padding: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search name, node or IP…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            placeholder="Status"
            value={status || undefined}
            onChange={v => { setStatus(v || ''); setPage(1); }}
            allowClear
            style={{ width: 130 }}
          >
            <Option value="running">Running</Option>
            <Option value="stopped">Stopped</Option>
            <Option value="paused">Paused</Option>
          </Select>
          <Select
            placeholder="Type"
            value={vmType || undefined}
            onChange={v => { setVmType(v || ''); setPage(1); }}
            allowClear
            style={{ width: 140 }}
          >
            <Option value="qemu">QEMU VM</Option>
            <Option value="lxc">LXC Container</Option>
          </Select>
          <Button icon={<DownloadOutlined />} onClick={exportCSV}>Export CSV</Button>
        </Space>

        <Table
          size="small"
          loading={loading}
          rowKey="id"
          dataSource={items}
          columns={columns}
          scroll={{ x: 1300 }}
          pagination={{
            current:   page,
            pageSize,
            total,
            showTotal: t => `${t} total`,
            onChange:  p => setPage(p),
          }}
        />
      </div>

      <AddToInventoryModal
        open={modalOpen}
        prefill={prefill}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
