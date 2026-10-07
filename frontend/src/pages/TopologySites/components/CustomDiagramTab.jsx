import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { App, Card, Select, Space, Empty, Spin, Typography, Alert } from 'antd';
import api from '../../../api/client';
import CustomTopologyNode from '../../Admin/CustomTopology/components/CustomTopologyNode.jsx';
import ConnectivityFlowEdge from '../../Admin/CustomTopology/components/ConnectivityFlowEdge.jsx';
import { toggleHostVMs, fetchVmCounts } from '../../Admin/CustomTopology/components/vmExpansion.js';
import { useAppTheme } from '../../../context/ThemeContext.jsx';

const { Text } = Typography;

// Same registrations the builder uses, so a diagram renders here exactly as it
// was drawn there — nodes and edges are stored as plain React Flow JSON.
const reactFlowNodeTypes = { custom: CustomTopologyNode };
const reactFlowEdgeTypes = { flow: ConnectivityFlowEdge };

/**
 * Read-only view of the diagrams built on the Custom Topology Builder page.
 * Editing stays there (that page is admin-gated); this one only displays, so
 * every interaction that would mutate the diagram is switched off below.
 */
export default function CustomDiagramTab({ platform }) {
  const { message } = App.useApp();
  const { mode: themeMode } = useAppTheme();
  const gridColor = themeMode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)';
  const [diagrams, setDiagrams]         = useState([]);
  const [activeId, setActiveId]         = useState(null);
  const [listLoading, setListLoading]   = useState(true);
  const [canvasLoading, setCanvasLoad]  = useState(false);
  const [nodes, setNodes]               = useState([]);
  const [edges, setEdges]               = useState([]);
  const [error, setError]               = useState(null);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setError(null);
    api.get('/custom-topology', { params: { platform } })
      .then(r => {
        if (cancelled) return;
        const rows = r.data || [];
        setDiagrams(rows);
        setActiveId(rows[0]?.id || null);
      })
      .catch(e => { if (!cancelled) setError(e.response?.data?.error || 'Failed to load diagrams'); })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [platform]);

  useEffect(() => {
    if (!activeId) { setNodes([]); setEdges([]); return undefined; }
    let cancelled = false;
    setCanvasLoad(true);
    api.get(`/custom-topology/${activeId}`)
      .then(r => {
        if (cancelled) return;
        setNodes(r.data.nodes || []);
        setEdges(r.data.edges || []);
      })
      .catch(e => { if (!cancelled) setError(e.response?.data?.error || 'Failed to load diagram'); })
      .finally(() => { if (!cancelled) setCanvasLoad(false); });
    return () => { cancelled = true; };
  }, [activeId]);

  const active = diagrams.find(d => d.id === activeId);

  // Same on-demand "+ show VMs" toggle as the builder (see vmExpansion.js)
  // — this page is read-only for everything else, but VMs were never
  // baked into the saved diagram, so this is the only way to see them here.
  // Purely client-side: nothing this does is ever written back.
  const handleToggleVMs = useCallback((id) => {
    const hostNode = nodes.find(n => n.id === id);
    if (hostNode) toggleHostVMs({ hostNode, nodes, setNodes, setEdges, api, message });
  }, [nodes, message]);

  // Same auto-populate-on-load behavior as the builder (see
  // CustomTopologyTab.jsx) — nothing here is ever written back, this page
  // has no Save at all, so there's no stripping to do on this side.
  const countsAttempted = useRef(new Set());
  useEffect(() => {
    const pending = nodes.filter(n => (
      n.data?.sourceKind === 'physical' && n.data?.vmCounts === undefined && !countsAttempted.current.has(n.id)
    ));
    pending.forEach(n => {
      countsAttempted.current.add(n.id);
      fetchVmCounts(n.data.sourceId, api)
        .then(vmCounts => setNodes(nds => nds.map(x => (x.id === n.id ? { ...x, data: { ...x.data, vmCounts } } : x))))
        .catch(() => {});
    });
  }, [nodes]);

  const nodesForCanvas = useMemo(
    () => nodes.map(n => ({ ...n, data: { ...n.data, onToggleVMs: handleToggleVMs } })),
    [nodes, handleToggleVMs]
  );

  if (listLoading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;

  if (error) {
    return <Alert type="error" showIcon message={error} style={{ margin: 16 }} />;
  }

  if (!diagrams.length) {
    return (
      <Empty
        style={{ margin: '80px auto' }}
        description={
          <Space direction="vertical" size={2}>
            <Text>No diagrams for this platform yet.</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Build them on the Custom Topology Builder page — they appear here once saved.
            </Text>
          </Space>
        }
      />
    );
  }

  return (
    <div>
      <Space wrap style={{ padding: '12px 16px' }} size={12}>
        <Select
          value={activeId}
          onChange={setActiveId}
          style={{ minWidth: 280 }}
          options={diagrams.map(d => ({ value: d.id, label: d.name }))}
          placeholder="Select a diagram"
        />
        {active?.description && <Text type="secondary">{active.description}</Text>}
        {active?.updated_by_name && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            last updated by {active.updated_by_name}
          </Text>
        )}
      </Space>

      <Card bodyStyle={{ padding: 0 }} className="ctb-canvas">
        <div style={{ height: '68vh', minHeight: 440 }}>
          {canvasLoading ? (
            <Spin style={{ display: 'block', margin: '80px auto' }} />
          ) : (
            <ReactFlow
              nodes={nodesForCanvas}
              edges={edges}
              nodeTypes={reactFlowNodeTypes}
              edgeTypes={reactFlowEdgeTypes}
              connectionMode={ConnectionMode.Loose}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              fitView
            >
              <Background variant={BackgroundVariant.Lines} gap={24} size={1} color={gridColor} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          )}
        </div>
      </Card>
    </div>
  );
}
