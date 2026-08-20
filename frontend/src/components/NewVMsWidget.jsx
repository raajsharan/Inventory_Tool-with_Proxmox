import { useEffect, useState } from 'react';
import { Card, Space, Badge, Table, Tag, Typography, Alert, Button } from 'antd';
import { CloudServerOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../api/client';

// New VMs — one row per VM added over the last 7 days across all three
// discovery integrations (VMware/Proxmox/Hyper-V), backed by each
// platform's getDriftActivity(7) — the same 7-day rolling activity feed
// used by the Change Detection tabs. A VM added earlier in the week stays
// visible here even after a later no-op poll, instead of only ever
// reflecting the single latest poll's diff.
const PLATFORM_META = {
  VMware:   { color: 'purple' },
  Proxmox:  { color: 'blue' },
  'Hyper-V': { color: 'magenta' },
};

export default function NewVMsWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  function load() {
    api.get('/dashboard/new-vms')
      .then(r => { setItems(r.data.items || []); setErr(''); })
      .catch(e => setErr(e.response?.data?.error || 'Failed to load newly discovered VMs.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60000); // re-check every minute for the next poll's results
    return () => clearInterval(id);
  }, []);

  const columns = [
    { title: 'VM Name', dataIndex: 'vm_name', ellipsis: true,
      render: v => <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v || '—'}</span> },
    { title: 'Hostname', dataIndex: 'hostname', ellipsis: true, render: v => v || '—' },
    { title: 'OS', dataIndex: 'os_type', width: 110, render: v => v || '—' },
    { title: 'OS Version', dataIndex: 'os_version', width: 140, ellipsis: true, render: v => v || '—' },
    { title: 'IP Address', dataIndex: 'ip_address', width: 150,
      render: v => v ? <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> : '—' },
    { title: 'ESXi Host IP', dataIndex: 'esxi_host_ip', width: 140,
      render: v => v ? <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> : '—' },
    { title: 'Source Host', dataIndex: 'source_host', width: 160, ellipsis: true, render: v => v || '—' },
    { title: 'MAC Address', dataIndex: 'mac_address', width: 160, ellipsis: true, render: v => v || '—' },
    {
      title: 'Platform', dataIndex: 'platform', width: 100,
      render: v => <Tag color={PLATFORM_META[v]?.color || 'default'}>{v}</Tag>,
    },
  ];

  return (
    <Card
      size="small"
      className="dashcard"
      title={
        <Space>
          <CloudServerOutlined style={{ color: '#1677ff' }} />
          <span>Newly Discovered VMs</span>
          <Badge count={items.length} color={items.length ? '#52c41a' : 'default'} />
        </Space>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Refresh</Button>}
    >
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      {!err && !items.length && !loading && (
        <Typography.Text type="secondary">No new VMs discovered in the last 7 days.</Typography.Text>
      )}
      {!err && items.length > 0 && (
        <Table
          size="small"
          rowKey={(r, i) => `${r.platform}-${r.host}-${r.vm_name}-${i}`}
          dataSource={items}
          columns={columns}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 10, showTotal: t => `${t} new VM${t !== 1 ? 's' : ''}` }}
        />
      )}
    </Card>
  );
}
