import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App, Button, Card, DatePicker, Input, Modal, Select, Space,
  Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import {
  DownloadOutlined, PoweroffOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined,
  DatabaseOutlined, HistoryOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { DASH_CSS, StatCard, StatGrid } from '../components/DashboardStatCard.jsx';

const { Text } = Typography;

const SOURCE_META = {
  assets:                { label: 'MSL Assets',      base: '/assets',         color: 'blue' },
  beijing_assets:        { label: 'Beijing',         base: '/beijing-assets', color: 'purple' },
  ext_assets:            { label: 'Ext. Assets',     base: '/ext-assets',     color: 'cyan' },
  physical_esxi_servers: { label: 'Physical / ESXi', base: '/physical-esxi',  color: 'orange' },
};
const srcTag = (s) => {
  const m = SOURCE_META[s] || SOURCE_META.assets;
  return <Tag color={m.color} style={{ fontSize: 10 }}>{m.label}</Tag>;
};
const mono = { fontFamily: 'var(--font-mono)', fontSize: 12 };
const fmt = (v) => (v ? new Date(v).toLocaleString() : '—');

export default function Decommissioned() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);

  const [current, setCurrent] = useState([]);
  const [log, setLog]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [logFilters, setLogFilters] = useState({ source: undefined, person: '', range: null });
  const [reactivating, setReactivating] = useState(null); // record pending confirm

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (logFilters.source) params.source = logFilters.source;
      if (logFilters.person) params.person = logFilters.person;
      if (logFilters.range?.[0]) params.from = logFilters.range[0].format('YYYY-MM-DD');
      if (logFilters.range?.[1]) params.to   = logFilters.range[1].format('YYYY-MM-DD');
      const [cur, lg] = await Promise.all([
        api.get('/decommissioned'),
        api.get('/decommissioned/log', { params }),
      ]);
      setCurrent(cur.data.items || []);
      setLog(lg.data.items || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load decommissioned records');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function onExport() {
    try {
      const res = await api.get('/decommissioned/log/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'decommission-report.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { message.error('Export failed'); }
  }

  async function onReactivate() {
    const r = reactivating;
    if (!r) return;
    try {
      await api.post(`/decommissioned/${r.source}/${r.id}/reactivate`, { serverStatus: 'Active' });
      message.success(`${r.vm_name || r.ip_address} reactivated — status set to Active`);
      setReactivating(null);
      load();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details ? Object.values(details)[0] : (e.response?.data?.error || 'Reactivation failed'));
    }
  }

  const currentColumns = [
    { title: 'VM Name', render: (_, r) => {
      const m = SOURCE_META[r.source] || SOURCE_META.assets;
      return <Link className="vm-name-link" to={`${m.base}/${r.id}`}>{r.vm_name || '(unnamed)'}</Link>;
    } },
    { title: 'IP Address', dataIndex: 'ip_address', render: v => v ? <Text style={mono}>{v}</Text> : '—' },
    { title: 'Asset Tag', dataIndex: 'asset_tag', width: 110,
      render: v => v ? <Tag style={mono}>{v}</Tag> : '—' },
    { title: 'OS', dataIndex: 'os_type', ellipsis: true },
    { title: 'Location', dataIndex: 'location', width: 120, render: v => v || '—' },
    { title: 'Source', dataIndex: 'source', width: 130, render: srcTag },
    { title: 'Decommissioned by', dataIndex: 'decommissioned_by_name', width: 160, render: v => v || '—' },
    { title: 'On', dataIndex: 'decommissioned_at', width: 170, render: fmt },
    ...(canWrite ? [{
      title: '', width: 130,
      render: (_, r) => (
        <Tooltip title="Set status back to Active — the record returns to its inventory">
          <Button size="small" icon={<RollbackOutlined />} onClick={() => setReactivating(r)}>
            Reactivate
          </Button>
        </Tooltip>
      ),
    }] : []),
  ];

  const logColumns = [
    { title: 'VM Name', dataIndex: 'vm_name', render: v => <Text strong>{v || '(unnamed)'}</Text> },
    { title: 'IP Address', dataIndex: 'ip_address', render: v => v ? <Text style={mono}>{v}</Text> : '—' },
    { title: 'Tag', dataIndex: 'asset_tag', width: 90, render: v => v || '—' },
    { title: 'Source', dataIndex: 'source', width: 130, render: srcTag },
    { title: 'Host', dataIndex: 'hosted_ip', width: 130,
      render: v => v ? <Text style={mono}>{v}</Text> : '—' },
    { title: 'Decommissioned by', dataIndex: 'decommissioned_by_name', width: 160, render: v => v || '—' },
    { title: 'On', dataIndex: 'decommissioned_at', width: 165, render: fmt },
    { title: 'Reason', dataIndex: 'reason', ellipsis: true, render: v => v || '—' },
    { title: 'Reactivated', width: 170,
      render: (_, r) => r.reactivated_at
        ? <Tooltip title={`by ${r.reactivated_by_name || '—'}`}><Tag color="green">{fmt(r.reactivated_at)}</Tag></Tooltip>
        : <Text type="secondary">—</Text> },
  ];

  return (
    <div>
      <style>{DASH_CSS}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <Space align="start">
          <PoweroffOutlined style={{ fontSize: 24, color: '#cf1322', marginTop: 3 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Decommissioned</Typography.Title>
            <Text type="secondary">
              Decommissioned servers by source — their asset tags and IPs are released for reuse.
            </Text>
          </div>
        </Space>
        <Space>
          <Tooltip title="Reload current and historical decommission records">
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          </Tooltip>
          <Tooltip title="Download the decommission log as an Excel report">
            <Button icon={<DownloadOutlined />} onClick={onExport}>Export report</Button>
          </Tooltip>
        </Space>
      </div>

      <StatGrid minWidth={220} style={{ marginBottom: 16 }}>
        <StatCard index={0} title="Currently decommissioned" value={current.length}
          icon={<PoweroffOutlined />} color="#cf1322" bg="rgba(207,19,34,0.10)" />
        <StatCard index={1} title="Total decommission events" value={log.length}
          icon={<HistoryOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
      </StatGrid>

      <Card size="small" className="dashcard" style={{ animationDelay: '80ms' }}>
        <Tabs
          items={[
            {
              key: 'current',
              label: `Current (${current.length})`,
              children: (
                <Table
                  size="small" rowKey={(r) => `${r.source}-${r.id}`} loading={loading}
                  dataSource={current} columns={currentColumns}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'No decommissioned servers right now.' }}
                />
              ),
            },
            {
              key: 'report',
              label: `Report (${log.length})`,
              children: (
                <>
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Select allowClear placeholder="Source inventory" style={{ minWidth: 170 }}
                      value={logFilters.source}
                      onChange={(v) => setLogFilters(f => ({ ...f, source: v }))}
                      options={Object.entries(SOURCE_META).map(([k, m]) => ({ value: k, label: m.label }))} />
                    <Input allowClear placeholder="Decommissioned by…" prefix={<SearchOutlined />}
                      style={{ width: 190 }} value={logFilters.person}
                      onChange={(e) => setLogFilters(f => ({ ...f, person: e.target.value }))}
                      onPressEnter={load} />
                    <DatePicker.RangePicker value={logFilters.range}
                      onChange={(v) => setLogFilters(f => ({ ...f, range: v }))} />
                    <Button size="small" type="primary" onClick={load}>Apply</Button>
                  </Space>
                  <Table
                    size="small" rowKey="id" loading={loading}
                    dataSource={log} columns={logColumns}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 'max-content' }}
                    locale={{ emptyText: 'No decommission events recorded yet.' }}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!reactivating}
        title={`Reactivate "${reactivating?.vm_name || reactivating?.ip_address}"?`}
        okText="Reactivate"
        onOk={onReactivate}
        onCancel={() => setReactivating(null)}
      >
        <Text>
          The record returns to <strong>{(SOURCE_META[reactivating?.source] || {}).label}</strong> with
          status <Tag color="green" style={{ margin: '0 2px' }}>Active</Tag>.
          If its IP or asset tag has been reused by another record, reactivation is blocked and
          you'll be told which value conflicts.
        </Text>
      </Modal>
    </div>
  );
}
