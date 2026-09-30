import { MarkerType } from '@xyflow/react';

// Cycled per VM so a host with many auto-connected VMs keeps each
// connection visually traceable instead of every line reading as one
// indistinguishable blue bundle.
export const EDGE_PALETTE = [
  '#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1',
  '#13a8a8', '#faad14', '#f5222d', '#2f54eb', '#a0d911',
];

export const defaultEdgeOptions = { type: 'flow', markerEnd: { type: MarkerType.ArrowClosed } };

export function newNodeId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Lays VM nodes out in a column to the right of their host (wrapping into
// further columns for large VM counts), tagged with parentHostId so the
// collapse side of toggleHostVMs below can remove exactly these and
// nothing else.
export function buildVmChildren(hostId, hostPos, vms) {
  const PER_COL = 6, COL_GAP = 260, ROW_GAP = 90;
  const nodes = [];
  const edges = [];
  vms.forEach((vm, i) => {
    const col = Math.floor(i / PER_COL);
    const row = i % PER_COL;
    const countInCol = Math.min(PER_COL, vms.length - col * PER_COL);
    const colStartY = hostPos.y - ((countInCol - 1) * ROW_GAP) / 2;
    const vmId = newNodeId();
    const color = EDGE_PALETTE[i % EDGE_PALETTE.length];
    nodes.push({
      id: vmId,
      type: 'custom',
      position: { x: hostPos.x + 280 + col * COL_GAP, y: colStartY + row * ROW_GAP },
      data: { label: vm.hostname || vm.name || 'VM', sublabel: vm.ips?.[0], tone: 'teal', parentHostId: hostId },
    });
    edges.push({
      id: `e-${hostId}-${vmId}`,
      source: hostId, target: vmId,
      sourceHandle: 'right', targetHandle: 'left',
      ...defaultEdgeOptions,
      data: { color, parentHostId: hostId },
      style: { stroke: color },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    });
  });
  return { nodes, edges };
}

// Shared "+ show VMs / collapse" behavior for any host-type node
// (data.sourceKind === 'physical') — used by both the editable Custom
// Topology Builder and the read-only Topology of Sites viewer. Expanding
// fetches this host's discovered VMs and appends nodes/edges tagged with
// parentHostId; collapsing removes exactly those. Purely a client-side view
// concern — nothing here talks to the backend beyond the one read-only GET,
// so it's exactly as safe to call from the read-only viewer as the builder.
// Callers decide separately whether an expanded state ever reaches storage
// (the builder's Save strips these before PUTting; the viewer never saves).
export async function toggleHostVMs({ hostNode, nodes, setNodes, setEdges, api, message }) {
  const hostId = hostNode.id;

  if (hostNode.data?.vmsExpanded) {
    setNodes(nds => nds
      .filter(n => n.data?.parentHostId !== hostId)
      .map(n => (n.id === hostId ? { ...n, data: { ...n.data, vmsExpanded: false } } : n)));
    setEdges(eds => eds.filter(e => e.data?.parentHostId !== hostId));
    return;
  }

  const sourceId = hostNode.data?.sourceId;
  if (!sourceId) return;

  setNodes(nds => nds.map(n => (n.id === hostId ? { ...n, data: { ...n.data, vmsLoading: true } } : n)));
  try {
    const { data } = await api.get(`/physical-esxi/${sourceId}/discovered-vms`);
    if (!data.vms?.length) {
      message.info('No discovered VMs found for this host');
      setNodes(nds => nds.map(n => (n.id === hostId ? { ...n, data: { ...n.data, vmsLoading: false } } : n)));
      return;
    }
    // Re-read the host's current position from the live array passed in —
    // it may have been dragged since the node was created.
    const live = nodes.find(n => n.id === hostId) || hostNode;
    const { nodes: vmNodes, edges: vmEdges } = buildVmChildren(hostId, live.position, data.vms);
    setNodes(nds => [
      ...nds.map(n => (n.id === hostId ? { ...n, data: { ...n.data, vmsLoading: false, vmsExpanded: true } } : n)),
      ...vmNodes,
    ]);
    setEdges(eds => [...eds, ...vmEdges]);
  } catch {
    message.error('Failed to look up discovered VMs for this host');
    setNodes(nds => nds.map(n => (n.id === hostId ? { ...n, data: { ...n.data, vmsLoading: false } } : n)));
  }
}
