import { BaseEdge, getBezierPath } from '@xyflow/react';

// The default connection style for every edge drawn on the Custom Topology
// canvas — a moving dot along the connector, same CSS offset-path technique
// as TopologySites/components/TopologyDiagram.jsx's auto-generated
// diagrams, so hand-built and auto-discovered topologies read as one
// visual language. getBezierPath's "d" string works directly as an
// offset-path target since CSS offset-path parses the same SVG path syntax.
export default function ConnectivityFlowEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd,
}) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />
      <circle r="4" className="ctb-flow-dot" style={{ offsetPath: `path('${edgePath}')` }} />
    </>
  );
}
