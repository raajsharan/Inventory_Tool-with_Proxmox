import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Button, Card, Col, Row, Space, Statistic, Table, Tabs, Tag, Typography,
} from 'antd';
import { ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import api from '../../../api/client';

const { Text } = Typography;

const SOURCE_META = {
  assets:                { label: 'MSL Assets',      base: '/assets',         color: 'blue' },
  beijing_assets:        { label: 'Beijing',         base: '/beijing-assets', color: 'purple' },
  ext_assets:            { label: 'Ext. Assets',     base: '/ext-assets',     color: 'cyan' },
  physical_esxi_servers: { label: 'Physical / ESXi', base: '/physical-esxi',  color: 'orange' },
};

const mono = { fontFamily: 'var(--font-mono)', fontSize: 12 };

/**
 * Reconcile — the closing of the loop between discovery and the inventory:
 * discovered VMs that no inventory record matches (by IP or MAC), and
 * inventory records that discovery has never seen.
 */
export default function VMReconcile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/vmware/reconcile');
      setData(d);
    } catch { setData(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const missing = data?.not_in_inventory || [];
  const stale   = data?.not_discovered   || [];

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Discovered VMs" value={data?.discovered_total ?? '—'} loading={loading} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Matched to inventory" value={data?.matched ?? '—'} loading={loading} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Missing from inventory" value={missing.length} loading={loading} valueStyle={missing.length ? { color: '#cf1322' } : undefined} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="In inventory, not discovered" value={data?.not_discovered_total ?? '—'} loading={loading} /></Card></Col>
      </Row>

      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="Matching is by IP address or MAC address against the latest discovery run of every vCenter/ESXi host."
      />

      <Card
        size="small"
        title={<Space><SwapOutlined />Reconciliation</Space>}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>}
      >
        <Tabs
          items={[
            {
              key: 'missing',
              label: `Discovered, missing from inventory (${missing.length})`,
              children: (
                <Table
                  size="small" loading={loading} rowKey="id"
                  dataSource={missing} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: 'VM Name', dataIndex: 'name', render: v => <Text strong>{v}</Text> },
                    { title: 'Hostname', dataIndex: 'hostname',
                      render: v => v && v !== 'Not Available' ? v : '—' },
                    { title: 'IPs', dataIndex: 'ips',
                      render: ips => (ips || []).length
                        ? <Text style={mono}>{ips.join(', ')}</Text> : '—' },
                    { title: 'OS', dataIndex: 'os_type', ellipsis: true },
                    { title: 'Power', dataIndex: 'power_state', width: 90,
                      render: v => <Tag color={v === 'poweredOn' ? 'green' : 'default'}>{v === 'poweredOn' ? 'On' : 'Off'}</Tag> },
                    { title: 'ESXi Host', dataIndex: 'esxi_host_name', ellipsis: true },
                    { title: 'vCenter', dataIndex: 'source_host', ellipsis: true },
                  ]}
                  locale={{ emptyText: 'Every discovered VM matches an inventory record.' }}
                />
              ),
            },
            {
              key: 'stale',
              label: `In inventory, not discovered (${data?.not_discovered_total ?? 0})`,
              children: (
                <>
                  <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                    message="These records match no discovered VM — possibly decommissioned, physical hardware, or on a network discovery does not reach." />
                  <Table
                    size="small" loading={loading} rowKey={(r) => `${r.source}-${r.id}`}
                    dataSource={stale} pagination={{ pageSize: 20 }}
                    columns={[
                      { title: 'Record', render: (_, r) => {
                        const m = SOURCE_META[r.source] || SOURCE_META.assets;
                        return <Link to={`${m.base}/${r.id}`}>{r.vm_name || r.ip_address}</Link>;
                      } },
                      { title: 'IP Address', dataIndex: 'ip_address',
                        render: v => v ? <Text style={mono}>{v}</Text> : '—' },
                      { title: 'MAC', dataIndex: 'mac_address',
                        render: v => v ? <Text style={mono}>{v}</Text> : '—' },
                      { title: 'OS', dataIndex: 'os_type', ellipsis: true },
                      { title: 'Inventory', dataIndex: 'source', width: 140,
                        render: s => {
                          const m = SOURCE_META[s] || SOURCE_META.assets;
                          return <Tag color={m.color} style={{ fontSize: 10 }}>{m.label}</Tag>;
                        } },
                    ]}
                    locale={{ emptyText: 'Every inventory record was seen by discovery.' }}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
