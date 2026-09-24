import { BaseEdge, getBezierPath } from '@xyflow/react';

// The default connection style for every edge drawn on the Custom Topology
// canvas — a moving dot along the connector, via CSS offset-path.
// getBezierPath's "d" string works directly as an
// offset-path target since CSS offset-path parses the same SVG path syntax.
// data.color, when set (e.g. one distinct color per auto-connected VM —
// see addAutoVMNodes in CustomTopologyTab.jsx), overrides both the line and
// the moving dot so overlapping connections stay visually traceable.
// Falls back to the shared default (style.stroke / the .ctb-flow-dot CSS
// class's color) when absent, e.g. for manually hand-drawn connections.
export default function ConnectivityFlowEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data,
}) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const color = data?.color;
  return (
    <>
      <BaseEdge path={edgePath} style={color ? { ...style, stroke: color } : style} markerEnd={markerEnd} />
      <circle r="4" className="ctb-flow-dot" style={{ offsetPath: `path('${edgePath}')`, fill: color }} />
    </>
  );
}
