import { useEffect, useRef, useState } from 'react';
import { Row, Col, Card, Table, Tag, Spin, Empty, Typography } from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  ApartmentOutlined, AppstoreOutlined, WindowsOutlined, LinuxOutlined, DesktopOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Text } = Typography;

const DASH_CSS = `
@keyframes vmdash-fadein { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.vmdash-card { animation: vmdash-fadein 0.45s cubic-bezier(0.22,1,0.36,1) both;
  transition: transform 0.2s ease, box-shadow 0.2s ease; }
.vmdash-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.09); }
.vmdash-row { transition: background 0.15s ease; }
.vmdash-minibar-fill { transition: width 0.6s cubic-bezier(0.22,1,0.36,1); }
`;

// Counts up from 0 to the target value with an ease-out curve — small bit of
// life on load instead of numbers just appearing.
function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const to = Number(target) || 0;
    function step(ts) {
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
}

function StatCard({ icon, color, bg, title, value, index }) {
  const animated = useCountUp(value);
  return (
    <Card size="small" className="vmdash-card" style={{ animationDelay: `${index * 70}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: bg, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color, fontSize: 18, display: 'flex' }}>{icon}</span>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
          <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.3 }}>
            {animated.toLocaleString()}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Small colored square proportional to `count`/`max` — a lightweight visual
// cue in the OS Breakdown table alongside the raw number.
function MiniBar({ count, max, color }) {
  const pct = max ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div style={{ width: 80, height: 6, borderRadius: 3, background: 'rgba(140,140,140,0.18)' }}>
      <div className="vmdash-minibar-fill" style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
    </div>
  );
}

// A single-row stacked bar showing powered-on/off/suspended proportion for
// a host, so the "By vCenter / ESXi Host" table reads at a glance without
// having to compare three separate numbers per row.
function HostSplitBar({ on, off, susp, total }) {
  if (!total) return null;
  const seg = (n, color) => (
    n > 0 ? <div key={color} style={{ width: `${(n / total) * 100}%`, background: color }} /> : null
  );
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', width: 100 }}>
      {seg(on, '#52c41a')}
      {seg(off, '#bfbfbf')}
      {seg(susp, '#faad14')}
    </div>
  );
}

function osIcon(os) {
  const s = (os || '').toLowerCase();
  if (s.includes('win')) return { icon: <WindowsOutlined />, color: '#40a9ff' };
  if (s.includes('linux') || s.includes('centos') || s.includes('ubuntu') || s.includes('rhel') || s.includes('debian'))
    return { icon: <LinuxOutlined />, color: '#faad14' };
  return { icon: <DesktopOutlined />, color: '#8c8c8c' };
}

export default function VMDashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/vmware/dashboard')
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { stats, byHost, byOS } = data;
  const maxOSCount = Math.max(1, ...byOS.map(o => o.count));

  const hostCols = [
    { title: 'vCenter / ESXi', dataIndex: 'host',       key: 'host',       ellipsis: true },
    { title: 'Total',          dataIndex: 'total',      key: 'total',      width: 80,
      sorter: (a, b) => b.total - a.total },
    {
      title: 'Split', key: 'split', width: 110,
      render: (_, r) => <HostSplitBar on={r.poweredOn} off={r.poweredOff} susp={r.suspended} total={r.total} />,
    },
    { title: 'Powered On',     dataIndex: 'poweredOn',  key: 'poweredOn',  width: 110,
      render: n => <Tag icon={<PlayCircleOutlined />} color="success">{n}</Tag> },
    { title: 'Powered Off',    dataIndex: 'poweredOff', key: 'poweredOff', width: 110,
      render: n => <Tag icon={<StopOutlined />} color="default">{n}</Tag> },
    { title: 'Suspended',      dataIndex: 'suspended',  key: 'suspended',  width: 100,
      render: n => <Tag icon={<PauseCircleOutlined />} color="warning">{n ?? 0}</Tag> },
  ];

  const osCols = [
    {
      title: 'OS Type', dataIndex: 'os', key: 'os', ellipsis: true,
      render: (v) => {
        const meta = osIcon(v);
        return (
          <span>
            <span style={{ color: meta.color, marginRight: 8 }}>{meta.icon}</span>
            {v}
          </span>
        );
      },
    },
    {
      title: 'Count', dataIndex: 'count', key: 'count', width: 150,
      sorter: (a, b) => b.count - a.count,
      render: (v, r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text strong style={{ width: 32 }}>{v}</Text>
          <MiniBar count={v} max={maxOSCount} color={osIcon(r.os).color} />
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={0} title="Total" value={stats.total}
            icon={<AppstoreOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={1} title="Powered On" value={stats.poweredOn}
            icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={2} title="Powered Off" value={stats.poweredOff}
            icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={3} title="Suspended" value={stats.suspended}
            icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={4} title="vCenter / ESXi Hosts" value={byHost.length}
            icon={<ApartmentOutlined />} color="#9254de" bg="rgba(146,84,222,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={5} title="OS Types" value={byOS.length}
            icon={<DesktopOutlined />} color="#13c2c2" bg="rgba(19,194,194,0.12)" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card size="small" title="By vCenter / ESXi Host" className="vmdash-card" style={{ animationDelay: '120ms' }}>
            <Table
              size="small"
              rowKey="host"
              dataSource={byHost}
              columns={hostCols}
              pagination={false}
              rowClassName="vmdash-row"
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="OS Breakdown" className="vmdash-card" style={{ animationDelay: '160ms' }}>
            <Table
              size="small"
              rowKey="os"
              dataSource={byOS}
              columns={osCols}
              pagination={false}
              rowClassName="vmdash-row"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
