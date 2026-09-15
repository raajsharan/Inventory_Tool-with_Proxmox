import { useRef } from 'react';
import { Empty } from 'antd';

// Shared CSS for every TopologyDiagram on the page — inject once via
// <style>{TOPOLOGY_CSS}</style> at the page/tab level, not per-diagram
// (keyframes/selectors are the same regardless of how many diagrams render).
export const TOPOLOGY_CSS = `
@keyframes topo-flowdot { to { offset-distance: 100%; } }
@keyframes topo-pulseglow { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: no-preference) {
  .topo-dot  { animation: topo-flowdot var(--dur,1.8s) linear infinite; }
  .topo-glow { animation: topo-pulseglow 2.6s ease-in-out infinite; }
}
.topo-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.topo-card { fill: #ffffff; stroke: var(--topo-stroke, #1677ff); stroke-width: 1.5;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.08)); }
body[data-theme="dark"] .topo-card { fill: #1c1c1c; filter: none; }
.topo-title { fill: #262626; font-size: 13px; font-weight: 600; }
.topo-subtitle { fill: #8c8c8c; font-size: 11px; }
.topo-badges { fill: #595959; font-size: 11px; font-family: var(--font-mono, monospace); }
body[data-theme="dark"] .topo-title    { fill: #f0f0f0; }
body[data-theme="dark"] .topo-subtitle { fill: #a6a6a6; }
body[data-theme="dark"] .topo-badges   { fill: #bfbfbf; }
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

// root: { label, sublabel? }
// children: [{ key?, label, sublabel?, badgeText? }]
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

  return (
    <div style={{ overflowX: 'auto' }}>
      <h3 className="topo-sr-only">
        {`Animated flow diagram: ${root.label} manages ${items.length} host${items.length === 1 ? '' : 's'}, with moving dots showing the direction of management traffic.`}
      </h3>
      <svg width="100%" viewBox={`0 0 ${CONTAINER_W} ${height}`} style={{ minWidth: 560 }} aria-hidden="true">
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

        <g>
          <rect x={rootX - ROOT_W / 2} y={PAD} width={ROOT_W} height={ROOT_H} rx={10}
            className="topo-card" style={{ '--topo-stroke': palette.root }} />
          <text x={rootX} y={PAD + ROOT_H / 2 - (root.sublabel ? 8 : 0)} textAnchor="middle" dominantBaseline="central" className="topo-title">
            {root.label}
          </text>
          {root.sublabel && (
            <text x={rootX} y={PAD + ROOT_H / 2 + 12} textAnchor="middle" dominantBaseline="central" className="topo-subtitle">
              {root.sublabel}
            </text>
          )}
        </g>

        {items.map((child, i) => {
          const p = positions[i];
          const x = p.x - CARD_W / 2, y = p.y - CARD_H / 2;
          return (
            <g key={child.key || i}>
              <rect x={x} y={y} width={CARD_W} height={CARD_H} rx={10}
                className="topo-card topo-glow" style={{ '--topo-stroke': palette.child }} />
              <text x={p.x} y={y + 22} textAnchor="middle" dominantBaseline="central" className="topo-title">
                {child.label}
              </text>
              {child.sublabel && (
                <text x={p.x} y={y + 40} textAnchor="middle" dominantBaseline="central" className="topo-subtitle">
                  {child.sublabel}
                </text>
              )}
              {child.badgeText && (
                <text x={p.x} y={y + CARD_H - 14} textAnchor="middle" dominantBaseline="central" className="topo-badges">
                  {child.badgeText}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
