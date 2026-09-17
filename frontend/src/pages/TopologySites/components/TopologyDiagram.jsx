import { useRef } from 'react';
import { Empty, Tooltip } from 'antd';

// Shared CSS for every TopologyDiagram on the page — inject once via
// <style>{TOPOLOGY_CSS}</style> at the page/tab level, not per-diagram
// (keyframes/selectors are the same regardless of how many diagrams render).
// Connectors + moving dots are drawn in an SVG layer; the root/child nodes
// themselves are plain HTML cards absolutely positioned on top of it (not
// SVG text) so a child card can be a real antd <Tooltip> — hovering an
// ESXi host / Proxmox node / Hyper-V host shows the VMs running on it.
export const TOPOLOGY_CSS = `
@keyframes topo-flowdot { to { offset-distance: 100%; } }
@keyframes topo-pulseglow { 0%,100% { box-shadow: 0 0 0 0 var(--topo-stroke, #1677ff); } 50% { box-shadow: 0 0 10px 1px var(--topo-stroke, #1677ff); } }
@media (prefers-reduced-motion: no-preference) {
  .topo-dot  { animation: topo-flowdot var(--dur,1.8s) linear infinite; }
  .topo-card-glow { animation: topo-pulseglow 2.6s ease-in-out infinite; }
}
.topo-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.topo-wrap { position: relative; width: 100%; min-width: 560px; }
.topo-card-html {
  position: absolute; box-sizing: border-box; border-radius: 10px;
  border: 1.5px solid var(--topo-stroke, #1677ff); background: #ffffff;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 4px 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  cursor: default;
}
body[data-theme="dark"] .topo-card-html { background: #1c1c1c; box-shadow: none; }
.topo-card-html .topo-title { font-size: 13px; font-weight: 600; line-height: 1.3; color: #262626; }
.topo-card-html .topo-subtitle { font-size: 11px; color: #8c8c8c; }
.topo-card-html .topo-badges { font-size: 11px; font-family: var(--font-mono, monospace); color: #595959; margin-top: 2px; }
body[data-theme="dark"] .topo-card-html .topo-title    { color: #f0f0f0; }
body[data-theme="dark"] .topo-card-html .topo-subtitle { color: #a6a6a6; }
body[data-theme="dark"] .topo-card-html .topo-badges   { color: #bfbfbf; }
.topo-vm-row { font-family: var(--font-mono, monospace); font-size: 12px; white-space: nowrap; }
.topo-vm-more { opacity: 0.7; margin-top: 4px; }
`;

let uidSeq = 0;
function useUid(prefix) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = `${prefix}${++uidSeq}`;
  return ref.current;
}

const TONES = {
  blue:   { root: '#1677ff', child: '#69b1ff' },
  purple: { root: '#722ed1', child: '#b37feb' },
  orange: { root: '#fa8c16', child: '#ffc069' },
};

const MAX_TOOLTIP_VMS = 12;

function vmTooltip(vms) {
  if (!vms || !vms.length) return null;
  const shown = vms.slice(0, MAX_TOOLTIP_VMS);
  return (
    <div>
      {shown.map((vm, i) => (
        <div key={i} className="topo-vm-row">
          {vm.hostname || vm.name || 'unnamed'}{vm.ips?.length ? ` — ${vm.ips[0]}` : ''}
        </div>
      ))}
      {vms.length > MAX_TOOLTIP_VMS && (
        <div className="topo-vm-more">+{vms.length - MAX_TOOLTIP_VMS} more</div>
      )}
    </div>
  );
}

// root: { label, sublabel? }
// children: [{ key?, label, sublabel?, badgeText?, vms?: [{name, hostname, ips}] }]
export default function TopologyDiagram({ root, children, tone = 'blue', emptyText = 'No hosts to show.' }) {
  const uid = useUid('topo-');
  const palette = TONES[tone] || TONES.blue;
  const items = children || [];

  if (!items.length) {
    return <Empty description={emptyText} style={{ margin: '32px 0' }} />;
  }

  const CARD_W = 190, CARD_H = 82;
  const ROOT_W = 220, ROOT_H = 56;
  const GAP_X = 20, GAP_Y = 48;
  const PAD = 24;
  const CONTAINER_W = 940;

  const perRow = Math.max(1, Math.min(items.length, Math.floor((CONTAINER_W - PAD * 2 + GAP_X) / (CARD_W + GAP_X))));
  const rows = Math.ceil(items.length / perRow);

  const rootX = CONTAINER_W / 2;
  const rootBottomY = PAD + ROOT_H;
  const rowsStartY = rootBottomY + GAP_Y + CARD_H / 2;
  const height = rowsStartY + (rows - 1) * (CARD_H + GAP_Y) + CARD_H / 2 + PAD;

  const positions = items.map((_, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const countInRow = Math.min(perRow, items.length - row * perRow);
    const rowWidth = countInRow * CARD_W + (countInRow - 1) * GAP_X;
    const rowStartX = (CONTAINER_W - rowWidth) / 2;
    return {
      x: rowStartX + col * (CARD_W + GAP_X) + CARD_W / 2,
      y: rowsStartY + row * (CARD_H + GAP_Y),
    };
  });

  const pct = (v, of) => `${(v / of) * 100}%`;

  return (
    <div className="topo-wrap" style={{ aspectRatio: `${CONTAINER_W} / ${height}` }}>
      <h3 className="topo-sr-only">
        {`Animated flow diagram: ${root.label} manages ${items.length} host${items.length === 1 ? '' : 's'}, with moving dots showing the direction of management traffic. Hover a host to see the VMs running on it.`}
      </h3>

      <svg viewBox={`0 0 ${CONTAINER_W} ${height}`} preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
        <defs>
          <marker id={`${uid}arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke={palette.root} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {positions.map((p, i) => {
          const x1 = rootX, y1 = rootBottomY;
          const x2 = p.x, y2 = p.y - CARD_H / 2;
          return (
            <g key={`edge-${i}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={palette.root} strokeWidth="1" opacity="0.45"
                markerEnd={`url(#${uid}arrow)`} />
              <circle r="3.5" fill={palette.child} className="topo-dot"
                style={{ offsetPath: `path('M ${x1} ${y1} L ${x2} ${y2}')`, '--dur': `${1.6 + (i % 3) * 0.3}s`, animationDelay: `${(i % 4) * 0.25}s` }} />
            </g>
          );
        })}
      </svg>

      <div className="topo-card-html" style={{
        left: pct(rootX - ROOT_W / 2, CONTAINER_W), top: pct(PAD, height),
        width: pct(ROOT_W, CONTAINER_W), height: pct(ROOT_H, height),
        '--topo-stroke': palette.root,
      }}>
        <div className="topo-title">{root.label}</div>
        {root.sublabel && <div className="topo-subtitle">{root.sublabel}</div>}
      </div>

      {items.map((child, i) => {
        const p = positions[i];
        const x = p.x - CARD_W / 2, y = p.y - CARD_H / 2;
        const card = (
          <div className={`topo-card-html${child.vms?.length ? ' topo-card-glow' : ''}`} style={{
            left: pct(x, CONTAINER_W), top: pct(y, height),
            width: pct(CARD_W, CONTAINER_W), height: pct(CARD_H, height),
            '--topo-stroke': palette.child,
          }}>
            <div className="topo-title">{child.label}</div>
            {child.sublabel && <div className="topo-subtitle">{child.sublabel}</div>}
            {child.badgeText && <div className="topo-badges">{child.badgeText}</div>}
          </div>
        );
        return child.vms?.length ? (
          <Tooltip key={child.key || i} title={vmTooltip(child.vms)} placement="top">
            {card}
          </Tooltip>
        ) : (
          <span key={child.key || i}>{card}</span>
        );
      })}
    </div>
  );
}
