import { useEffect, useState, useCallback } from 'react';
import { Table, Input, Select, Space, Tag, Tooltip, Card, Alert } from 'antd';
import { SearchOutlined, LaptopOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import { DASH_CSS } from '../../../components/DashboardStatCard.jsx';

const { Option } = Select;

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Off') return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  if (s === 'Saved')   return <Tag color="processing">Saved</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

const columns = [
  { title: 'Name',     dataIndex: 'name',         key: 'name',    width: 220,
    render: v => <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}><LaptopOutlined style={{ color: '#722ed1', marginRight: 6 }} />{v}</span> },
  { title: 'Hostname', dataIndex: 'hostname',     key: 'hostname', width: 160, ellipsis: true,
    render: v => v || '—' },
  { title: 'State',    dataIndex: 'state',         key: 'state',   width: 100, render: stateTag },
  { title: 'vCPUs',   dataIndex: 'cpu_count',     key: 'cpu',     width: 80 },
  { title: 'Mem (MB)', dataIndex: 'memory_mb',    key: 'memory',  width: 110 },
  { title: 'Disk (GB)', dataIndex: 'disk_gb',     key: 'disk',    width: 110, render: v => v != null ? v : '—' },
  { title: 'IPs',      dataIndex: 'ips',           key: 'ips',     ellipsis: true,
    render: v => Array.isArray(v) ? v.join(', ') || '—' : '—' },
  { title: 'MAC Address', dataIndex: 'mac_addresses', key: 'macs', ellipsis: true,
    render: v => Array.isArray(v) ? v.join(', ') || '—' : '—' },
  { title: 'OS',       dataIndex: 'os_type',       key: 'os',      ellipsis: true, render: v => v || '—' },
  { title: 'Snapshots', dataIndex: 'snapshot_count', key: 'snaps', width: 100,
    render: v => v ? <Tag color="orange">{v}</Tag> : '0' },
  { title: 'Generation', dataIndex: 'generation',  key: 'gen',     width: 100, render: v => v || '—' },
  { title: 'Host',     dataIndex: 'source_host',   key: 'host',    ellipsis: true },
  { title: 'Discovered', dataIndex: 'first_seen_at', key: 'seen', ellipsis: true,
    render: v => v ? new Date(v).toLocaleDateString() : '—' },
];

export default function HVList() {
  const [items,   setItems]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [state,   setState]   = useState('');
  const [page,    setPage]    = useState(1);
  const [error,   setError]   = useState(null);
  const pageSize = 50;

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (state)  params.state  = state;
    api.get('/hyperv/vms', { params })
      .then(r => { setItems(r.data.items); setTotal(r.data.total); setError(null); })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load VMs.'))
      .finally(() => setLoading(false));
  }, [search, state]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      {error && <Alert type="error" showIcon message="Couldn't load VMs" description={error} style={{ marginBottom: 12 }} />}
      <Card size="small" className="dashcard" title={`${total} VMs`}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search name or host…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            placeholder="State"
            value={state || undefined}
            onChange={v => { setState(v || ''); setPage(1); }}
            allowClear
            style={{ width: 130 }}
          >
            <Option value="Running">Running</Option>
            <Option value="Off">Stopped</Option>
            <Option value="Paused">Paused</Option>
            <Option value="Saved">Saved</Option>
          </Select>
        </Space>

        <Table
          size="small"
          loading={loading}
          rowKey="id"
          dataSource={items}
          columns={columns}
          scroll={{ x: 'max-content' }}
          sticky={{ offsetScroll: 0 }}
          rowClassName="dashcard-row"
          pagination={{
            current:   page,
            pageSize,
            total,
            showTotal: t => `${t} total`,
            onChange:  p => setPage(p),
          }}
        />
      </Card>
    </div>
  );
}
