import { Space, Typography } from 'antd';
import { ThunderboltOutlined, DatabaseOutlined, HddOutlined, FieldTimeOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Shared rack-style CPU/RAM/Disk/uptime display for every discovery
// integration's "Hosts & Credentials" tab (VMware, Proxmox, Hyper-V).

// Small pulsing LED, like a rack-mount status light — green/amber/red by
// health, plain grey when there's nothing to report yet. Inject this once
// per page via <style>{DOT_CSS}</style>.
export const DOT_CSS = `
@keyframes hoststat-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.hoststat-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  margin-right: 6px; animation: hoststat-pulse 1.8s ease-in-out infinite; }
`;

export function progressColor(pct) {
  if (pct == null) return '#8c8c8c';
  if (pct >= 90) return '#ff4d4f';
  if (pct >= 75) return '#faad14';
  return '#52c41a';
}

export function HealthDot({ color }) {
  return <span className="hoststat-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />;
}

// All three discovery integrations (VMware/Proxmox/Hyper-V) share the same
// last_status/last_discovery_at column names on their *_hosts table.
export function deriveHealthColor(host) {
  return host.last_status === 'error' ? '#ff4d4f'
    : host.last_discovery_at ? '#52c41a'
    : '#8c8c8c';
}

// Rack-style segmented usage indicator — a row of small blocks that light up
// (with a matching glow) instead of a single continuous bar.
export function SegmentedBar({ pct, segments = 6 }) {
  const clamped = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * segments);
  const color = progressColor(pct);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} style={{
          width: 12, height: 6, borderRadius: 1,
          background: i < filled ? color : 'rgba(140,140,140,0.25)',
          boxShadow: i < filled ? `0 0 4px ${color}` : 'none',
        }} />
      ))}
    </div>
  );
}

// Self-contained dark "chip" per stat — reads consistently in light or dark
// mode since it carries its own background, rather than inheriting the page.
export function StatChip({ icon, iconColor, label, value, pct }) {
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', gap: 3,
      background: 'linear-gradient(180deg, #101b2d, #0b1420)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8, padding: '5px 10px', minWidth: 118,
    }}>
      <Space size={5} align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space size={5}>
          <span style={{ color: iconColor, fontSize: 13, display: 'flex' }}>{icon}</span>
          <Text style={{ color: '#d6e4ff', fontSize: 11, fontWeight: 600 }}>{label}</Text>
        </Space>
        {pct != null && <Text style={{ color: progressColor(pct), fontSize: 11, fontWeight: 600 }}>{pct}%</Text>}
      </Space>
      {value && <Text style={{ color: 'rgba(214,228,255,0.55)', fontSize: 10 }}>{value}</Text>}
      <SegmentedBar pct={pct} />
    </div>
  );
}

export function cpuChip(r) {
  if (r.cpu_cores == null) return <Text type="secondary">—</Text>;
  return (
    <StatChip icon={<ThunderboltOutlined />} iconColor="#faad14"
      label={`${r.cpu_cores} cores`} pct={Number(r.cpu_usage_pct) || 0} />
  );
}

export function ramChip(r) {
  if (r.memory_mb == null && r.memory_total_mb == null) return <Text type="secondary">—</Text>;
  const total = Number(r.memory_total_mb ?? r.memory_mb);
  const used  = Number(r.memory_used_mb);
  const pct = total ? Math.round((used / total) * 1000) / 10 : 0;
  return (
    <StatChip icon={<DatabaseOutlined />} iconColor="#40a9ff" label="RAM"
      value={`${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} GB`}
      pct={pct} />
  );
}

export function diskChip(r) {
  if (r.disk_total_gb == null) return <Text type="secondary">—</Text>;
  const total = Number(r.disk_total_gb);
  const used  = Number(r.disk_used_gb);
  const pct = total ? Math.round((used / total) * 1000) / 10 : 0;
  return (
    <StatChip icon={<HddOutlined />} iconColor="#9254de" label="Disk"
      value={`${used.toFixed(1)} / ${total.toFixed(1)} GB`}
      pct={pct} />
  );
}

export function formatUptime(seconds) {
  const s = Number(seconds);
  if (!s) return <Text type="secondary">—</Text>;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return (
    <Space size={4}>
      <FieldTimeOutlined style={{ color: '#52c41a' }} />
      <Text style={{ fontSize: 12 }}>{d > 0 ? `${d}d ${h}h` : `${h}h`}</Text>
    </Space>
  );
}
