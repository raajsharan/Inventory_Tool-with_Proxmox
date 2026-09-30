import { useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { PlusOutlined, MinusOutlined, LoadingOutlined } from '@ant-design/icons';

// One distinct, consistent color per node "type" the toolbar offers.
export const TONE_COLORS = {
  blue:   '#1677ff',
  purple: '#722ed1',
  orange: '#fa8c16',
  teal:   '#13a8a8',
  gray:   '#8c8c8c',
};

// Shared by the editable Custom Topology Builder and the read-only
// Topology of Sites viewer — both render this node type, so the canvas
// theming lives here rather than being duplicated (or missing) in one of
// them. Graph-paper backdrop: pale lavender in light mode so white node
// cards pop against it, ink-navy-tinted in dark mode to stay on this app's
// palette (see --ink-900 in styles.css).
export const CUSTOM_TOPOLOGY_CSS = `
.ctb-canvas { --ctb-node-bg: #ffffff; --ctb-node-title: #262626; --ctb-node-subtitle: #8c8c8c; }
body[data-theme="dark"] .ctb-canvas { --ctb-node-bg: #1c1c1c; --ctb-node-title: #f0f0f0; --ctb-node-subtitle: #a6a6a6; }
.ctb-canvas .react-flow { background: #f6f8fd; }
body[data-theme="dark"] .ctb-canvas .react-flow { background: #0f1428; }
@keyframes ctb-flowdot { to { offset-distance: 100%; } }
@media (prefers-reduced-motion: no-preference) {
  .ctb-flow-dot { animation: ctb-flowdot 1.8s linear infinite; }
}
.ctb-flow-dot { fill: #1677ff; }
`;

// One handle per side, all acting as both source and target (the canvas
// runs in React Flow's "loose" connection mode) — lets the user drag a
// connection from or to any side of any node, in any direction.
const SIDES = [
  { id: 'top',    position: Position.Top },
  { id: 'right',  position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left',   position: Position.Left },
];

// data.onRename(id, newLabel), when provided, enables double-click-to-rename
// — quick-added nodes get a generic default name ("vCenter 1"), so this is
// how the user actually labels them without a modal getting in the way.
// data.sourceKind === 'physical' marks a node backed by a real Physical &
// ESXi Servers record (an ESXi host or Proxmox node) — only these can have
// VMs to show. data.onToggleVMs, when provided, renders the +/- toggle;
// omitted entirely (e.g. vCenter/Cluster/generic nodes, or wherever the
// caller doesn't wire it up) it's just not shown.
export default function CustomTopologyNode({ id, data, selected }) {
  const color = TONE_COLORS[data.tone] || TONE_COLORS.gray;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(data.label);
  const canExpandVMs = data.sourceKind === 'physical' && typeof data.onToggleVMs === 'function';

  useEffect(() => { if (!editing) setValue(data.label); }, [data.label, editing]);

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== data.label) data.onRename?.(id, trimmed);
    else setValue(data.label);
  }

  return (
    <div
      onDoubleClick={() => data.onRename && setEditing(true)}
      style={{
        position: 'relative',
        minWidth: 150, padding: '10px 16px', borderRadius: 10,
        border: `1.5px solid ${color}`,
        background: 'var(--ctb-node-bg, #ffffff)',
        boxShadow: selected ? `0 0 0 2px ${color}66` : '0 1px 3px rgba(0,0,0,0.08)',
        textAlign: 'center',
      }}
    >
      {SIDES.map(s => (
        <Handle key={s.id} id={s.id} type="source" position={s.position} style={{ background: color }} />
      ))}
      {editing ? (
        <input
          className="nodrag nopan"
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setValue(data.label); setEditing(false); }
          }}
          style={{
            width: '100%', textAlign: 'center', border: 'none', outline: 'none',
            background: 'transparent', fontWeight: 600, fontSize: 13,
            color: 'var(--ctb-node-title, #262626)',
          }}
        />
      ) : (
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ctb-node-title, #262626)' }}>{data.label}</div>
      )}
      {data.sublabel && (
        <div style={{ fontSize: 11, color: 'var(--ctb-node-subtitle, #8c8c8c)' }}>{data.sublabel}</div>
      )}
      {canExpandVMs && (
        <button
          type="button"
          className="nodrag nopan"
          title={data.vmsExpanded ? 'Hide VMs' : 'Show VMs'}
          onClick={(e) => { e.stopPropagation(); data.onToggleVMs(id); }}
          style={{
            position: 'absolute', right: -11, bottom: -11, zIndex: 10,
            width: 22, height: 22, borderRadius: '50%', padding: 0,
            border: `1.5px solid ${color}`, background: 'var(--ctb-node-bg, #ffffff)',
            color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, cursor: 'pointer', pointerEvents: 'auto',
          }}
        >
          {data.vmsLoading ? <LoadingOutlined spin /> : data.vmsExpanded ? <MinusOutlined /> : <PlusOutlined />}
        </button>
      )}
    </div>
  );
}
