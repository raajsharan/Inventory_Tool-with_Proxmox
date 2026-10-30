import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Input, Segmented, Space, Table, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ReloadOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Text } = Typography;

const dash = v => (v == null || v === '' ? <Text type="secondary">-</Text> : v);

export default function StagedTab({ onCount }) {
  const { message } = App.useApp();
  const [status, setStatus]   = useState(3);
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/endpoint-central/staged', { params: { status, ...(refresh ? { refresh: 1 } : {}) } });
      setRows(r.data.staged || []);
      if (status === 3) onCount?.(r.data.total);
    } catch (e) {
      const msg = e?.response?.data?.error;
      setRows([]);
      if (e?.response?.status === 400) setError(msg);
      else if (msg) setError(msg);
      else message.error('Failed to load staged computers');
    } finally { setLoading(false); }
  }, [status, message, onCount]);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = rows.filter(r => !q
    || [r.name, r.ip_address, r.mac_address, r.domain].some(v => v && String(v).toLowerCase().includes(q)));

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Segmented value={status} onChange={setStatus}
            options={[{ value: 3, label: 'Pending' }, { value: 1, label: 'Approved' }, { value: 2, label: 'Denied' }]} />
          <Input.Search placeholder="Search name / IP / MAC / domain…" allowClear style={{ width: 280 }}
            value={search} onChange={e => setSearch(e.target.value)} />
          <Button icon={<ReloadOutlined />} onClick={() => load(true)} loading={loading}>Refresh</Button>
        </Space>
      </Card>
      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}
      <Table
        size="small" rowKey={(r, i) => r.resource_id ?? `${r.name}-${i}`} loading={loading} dataSource={filtered}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} computers` }}
        columns={[
          { title: 'Computer', dataIndex: 'name', render: v => v ? <Text strong>{v}</Text> : dash(v) },
          { title: 'IP', dataIndex: 'ip_address', render: dash },
          { title: 'MAC', dataIndex: 'mac_address', render: dash },
          { title: 'Domain', dataIndex: 'domain', render: dash },
          { title: 'OS', dataIndex: 'os_name', render: (v, r) => dash(v ?? r.os_platform) },
          { title: 'Remote office', dataIndex: 'remote_office', render: dash },
          { title: 'Status', dataIndex: 'approval_status', render: dash },
          { title: 'Discovered', dataIndex: 'discovered_on',
            render: v => dash(v && !isNaN(new Date(v)) ? new Date(v).toLocaleString() : v) },
          { title: 'In your records', dataIndex: 'in_inventory',
            filters: [{ text: 'Found', value: true }, { text: 'Not found', value: false }],
            onFilter: (v, r) => r.in_inventory === v,
            render: v => v
              ? <span><CheckCircleFilled style={{ color: '#52c41a' }} /> Found</span>
              : <span><CloseCircleFilled style={{ color: '#faad14' }} /> Not found</span> },
        ]}
      />
    </>
  );
}
