import { useEffect, useState, useCallback } from 'react';
import { Table, Input, Space, Tag, Tooltip } from 'antd';
import { SearchOutlined, ClusterOutlined } from '@ant-design/icons';
import api from '../../../api/client';

function statusTag(s) {
  if (s === 'online')  return <Tag color="success">Online</Tag>;
  if (s === 'offline') return <Tag color="error">Offline</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

const columns = [
  {
    title: 'Node', dataIndex: 'node', key: 'node', ellipsis: true,
    render: v => <span><ClusterOutlined style={{ color: '#1890ff', marginRight: 6 }} />{v}</span>,
  },
  { title: 'Status',      dataIndex: 'status',         key: 'status',      width: 100, render: statusTag },
  { title: 'IP Address',  dataIndex: 'ip_address',     key: 'ip',          ellipsis: true, render: v => v || '—' },
  { title: 'MAC Address', dataIndex: 'mac_address',    key: 'mac',         ellipsis: true, render: v => v || '—' },
  { title: 'OS Type',     dataIndex: 'os_type',        key: 'os_type',     ellipsis: true, render: v => v || '—' },
  {
    title: 'OS / PVE Version', dataIndex: 'os_version', key: 'os_version', ellipsis: true,
    render: v => v || '—',
  },
  {
    title: 'CPU', key: 'cpu', width: 220, ellipsis: true,
    render: (_, r) => r.cpu_model
      ? `${r.cpu_model}${r.cpu_sockets ? ` (${r.cpu_sockets}x${r.cpu_cores || '?'})` : ''}`
      : '—',
  },
  {
    title: 'RAM (GB)', dataIndex: 'memory_mb', key: 'memory_mb', width: 100,
    render: v => v ? (v / 1024).toFixed(1) : '—',
  },
  {
    title: 'Uptime', dataIndex: 'uptime_seconds', key: 'uptime', width: 100,
    render: v => {
      if (!v) return '—';
      const d = Math.floor(v / 86400), h = Math.floor((v % 86400) / 3600);
      return d > 0 ? `${d}d ${h}h` : `${h}h`;
    },
  },
  { title: 'VMs/CTs', dataIndex: 'vm_count', key: 'vm_count', width: 90 },
  {
    title: 'Snapshots', dataIndex: 'snapshot_count', key: 'snapshot_count', width: 100,
    render: v => v ? <Tag color="orange">{v}</Tag> : '0',
  },
  { title: 'Source Host', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
  {
    title: 'Discovered', dataIndex: 'created_at', key: 'created_at', ellipsis: true,
    render: v => v ? new Date(v).toLocaleString() : '—',
  },
];

export default function PVENodesList() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/proxmox/nodes')
      .then(r => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? items.filter(n => {
        const s = search.toLowerCase();
        return (n.node || '').toLowerCase().includes(s) ||
               (n.ip_address || '').toLowerCase().includes(s) ||
               (n.source_host || '').toLowerCase().includes(s);
      })
    : items;

  return (
    <div style={{ padding: 16 }}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search node, IP or source host…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
      </Space>

      <Table
        size="small"
        loading={loading}
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        scroll={{ x: 1500 }}
        pagination={{
          pageSize: 50,
          showTotal: t => `${t} total`,
        }}
      />
    </div>
  );
}
