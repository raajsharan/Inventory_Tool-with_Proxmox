import { Handle, Position } from '@xyflow/react';

// Tone palette extends TopologySites/components/TopologyDiagram.jsx's
// blue/purple/orange with a couple more so every node "type" the Add Node
// form offers has a distinct, consistent color.
export const TONE_COLORS = {
  blue:   '#1677ff',
  purple: '#722ed1',
  orange: '#fa8c16',
  teal:   '#13a8a8',
  gray:   '#8c8c8c',
};

// One handle per side, all acting as both source and target (the canvas
// runs in React Flow's "loose" connection mode) — lets the user drag a
// connection from or to any side of any node, in any direction.
const SIDES = [
  { id: 'top',    position: Position.Top },
  { id: 'right',  position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left',   position: Position.Left },
];

export default function CustomTopologyNode({ data, selected }) {
  const color = TONE_COLORS[data.tone] || TONE_COLORS.gray;
  return (
    <div style={{
      minWidth: 150, padding: '10px 16px', borderRadius: 10,
      border: `1.5px solid ${color}`,
      background: 'var(--ctb-node-bg, #ffffff)',
      boxShadow: selected ? `0 0 0 2px ${color}66` : '0 1px 3px rgba(0,0,0,0.08)',
      textAlign: 'center',
    }}>
      {SIDES.map(s => (
        <Handle key={s.id} id={s.id} type="source" position={s.position} style={{ background: color }} />
      ))}
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ctb-node-title, #262626)' }}>{data.label}</div>
      {data.sublabel && (
        <div style={{ fontSize: 11, color: 'var(--ctb-node-subtitle, #8c8c8c)' }}>{data.sublabel}</div>
      )}
    </div>
  );
}
