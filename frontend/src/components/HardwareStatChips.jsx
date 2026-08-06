import { Tooltip, Typography } from 'antd';
import { ThunderboltOutlined, DatabaseOutlined, HddOutlined, FieldTimeOutlined, CloudServerOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Shared compact CPU/RAM/Disk/uptime display for every discovery
// integration's "Hosts & Credentials" tab (VMware, Proxmox, Hyper-V): a slim
// inline bar with just the percentage showing, full detail (used/total,
// core count) on hover — keeps the column narrow and never truncates large
// values (multi-TB disks, etc.) the way a fixed-width chip with inline text
// used to.

// Small pulsing server icon, like a rack-mount status light — green/amber/red
// by health, plain grey when there's nothing to report yet. Inject this once
// per page via <style>{DOT_CSS}</style>.
export const DOT_CSS = `
@keyframes hoststat-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.hoststat-dot { display: inline-flex; align-items: center; justify-content: center;
  margin-right: 6px; font-size: 14px; vertical-align: -2px;
  animation: hoststat-pulse 1.6s ease-in-out infinite; }

/* Bar fill grows in with an ease-out curve (snappier start, soft landing)
   instead of a flat linear transition, and carries a diagonal shimmer sweep
   for a bit of life at a glance. */
@keyframes hoststat-shimmer { 0% { transform: translateX(-150%); } 100% { transform: translateX(150%); } }
@keyframes hoststat-glow    { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
.hoststat-bar-track { position: relative; overflow: hidden; }
.hoststat-bar-fill {
  height: 100%; border-radius: 3px;
  transition: width 0.7s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.4s ease;
  position: relative; overflow: hidden;
}
.hoststat-bar-fill::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.55) 48%, transparent 65%);
  animation: hoststat-shimmer 2.6s ease-in-out infinite;
}
/* Critical (>=90%) bars get an extra pulsing glow so they draw the eye
   without needing to read the number first. */
.hoststat-bar-fill.critical { animation: hoststat-glow 1.4s ease-in-out infinite; }
`;

export function progressColor(pct) {
  if (pct == null) return '#8c8c8c';
  if (pct >= 90) return '#ff4d4f';
  if (pct >= 75) return '#faad14';
  return '#52c41a';
}

export function HealthDot({ color }) {
  return (
    <CloudServerOutlined
      className="hoststat-dot"
      style={{ color, filter: `drop-shadow(0 0 3px ${color})` }}
    />
  );
}

// All three discovery integrations (VMware/Proxmox/Hyper-V) share the same
// last_status/last_discovery_at column names on their *_hosts table.
export function deriveHealthColor(host) {
  return host.last_status === 'error' ? '#ff4d4f'
    : host.last_discovery_at ? '#52c41a'
    : '#8c8c8c';
}

// Picks GB vs TB so a multi-terabyte disk shows "10.9 TB" instead of a long
// run of digits ("11109.4 GB") that gets clipped in a narrow column.
function formatCapacity(gb) {
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  return `${gb.toFixed(1)} GB`;
}

// Slim inline bar + percentage; hover for the full used/total or core-count
// detail. `pct === null` renders a flat, colorless bar (no data yet) rather
// than implying 0% usage.
function CompactBar({ icon, iconColor, label, pct, tooltip }) {
  const color = progressColor(pct);
  const width = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const critical = pct != null && pct >= 90;
  return (
    <Tooltip title={tooltip}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 100, cursor: 'help' }}>
        <span style={{ color: iconColor, fontSize: 13, display: 'flex', flexShrink: 0 }}>{icon}</span>
        <Text style={{ fontSize: 11, color: '#8c8c8c', width: 28, flexShrink: 0 }}>{label}</Text>
        <div className="hoststat-bar-track" style={{ flex: 1, minWidth: 36, height: 6, borderRadius: 3, background: 'rgba(140,140,140,0.25)' }}>
          <div
            className={`hoststat-bar-fill${critical ? ' critical' : ''}`}
            style={{ width: `${width}%`, backgroundColor: color }}
          />
        </div>
        <Text style={{ fontSize: 11, fontWeight: 600, color, width: 32, textAlign: 'right', flexShrink: 0, transition: 'color 0.4s ease' }}>
          {pct != null ? `${pct}%` : '—'}
        </Text>
      </div>
    </Tooltip>
  );
}

export function cpuChip(r) {
  if (r.cpu_cores == null) return <Text type="secondary">—</Text>;
  const pct = Number(r.cpu_usage_pct) || 0;
  return (
    <CompactBar icon={<ThunderboltOutlined />} iconColor="#faad14" label="CPU" pct={pct}
      tooltip={`${r.cpu_cores} cores · ${pct}% utilized`} />
  );
}

export function ramChip(r) {
  if (r.memory_mb == null && r.memory_total_mb == null) return <Text type="secondary">—</Text>;
  const totalMb = Number(r.memory_total_mb ?? r.memory_mb);
  const usedMb  = Number(r.memory_used_mb);
  const pct = totalMb ? Math.round((usedMb / totalMb) * 1000) / 10 : 0;
  return (
    <CompactBar icon={<DatabaseOutlined />} iconColor="#40a9ff" label="RAM" pct={pct}
      tooltip={`${formatCapacity(usedMb / 1024)} / ${formatCapacity(totalMb / 1024)}`} />
  );
}

export function diskChip(r) {
  if (r.disk_total_gb == null) return <Text type="secondary">—</Text>;
  const total = Number(r.disk_total_gb);
  const used  = Number(r.disk_used_gb);
  const pct = total ? Math.round((used / total) * 1000) / 10 : 0;
  return (
    <CompactBar icon={<HddOutlined />} iconColor="#9254de" label="Disk" pct={pct}
      tooltip={`${formatCapacity(used)} / ${formatCapacity(total)}`} />
  );
}

export function formatUptime(seconds) {
  const s = Number(seconds);
  if (!s) return <Text type="secondary">—</Text>;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return (
    <Tooltip title={`${d} day${d !== 1 ? 's' : ''}, ${h} hour${h !== 1 ? 's' : ''}`}>
      <span style={{ cursor: 'help' }}>
        <FieldTimeOutlined style={{ color: '#52c41a', marginRight: 4 }} />
        <Text style={{ fontSize: 12 }}>{d > 0 ? `${d}d ${h}h` : `${h}h`}</Text>
      </span>
    </Tooltip>
  );
}
