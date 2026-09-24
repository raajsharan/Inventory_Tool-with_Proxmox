import { useEffect, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, Select, Space, Empty, Spin, Typography, Alert } from 'antd';
import api from '../../../api/client';
import CustomTopologyNode from '../../Admin/CustomTopology/components/CustomTopologyNode.jsx';
import ConnectivityFlowEdge from '../../Admin/CustomTopology/components/ConnectivityFlowEdge.jsx';

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
              nodes={nodes}
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
              <Background gap={16} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          )}
        </div>
      </Card>
    </div>
  );
}
