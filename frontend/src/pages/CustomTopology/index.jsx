import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ConnectionMode,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Typography, Card, Button, Space, Select, Modal, Form, Input, Empty, Spin, App, Tooltip,
} from 'antd';
import {
  PlusOutlined, SaveOutlined, EditOutlined, DeleteOutlined, NodeIndexOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import CustomTopologyNode from './components/CustomTopologyNode.jsx';

const { Title, Text } = Typography;

// CSS-variable theming for the node component (dark-first app; see
// DASH_CSS in components/DashboardStatCard.jsx for the same body[data-theme]
// convention used everywhere else in this codebase).
const CUSTOM_TOPOLOGY_CSS = `
.ctb-canvas { --ctb-node-bg: #ffffff; --ctb-node-title: #262626; --ctb-node-subtitle: #8c8c8c; }
body[data-theme="dark"] .ctb-canvas { --ctb-node-bg: #1c1c1c; --ctb-node-title: #f0f0f0; --ctb-node-subtitle: #a6a6a6; }
`;

const NODE_TYPES_OPTS = [
  { value: 'vcenter',      label: 'vCenter',       tone: 'blue' },
  { value: 'cluster',      label: 'Cluster',       tone: 'orange' },
  { value: 'esxi',         label: 'ESXi Host',     tone: 'blue' },
  { value: 'proxmox_host', label: 'Proxmox Host',  tone: 'orange' },
  { value: 'proxmox_node', label: 'Proxmox Node',  tone: 'orange' },
  { value: 'hyperv_host',  label: 'Hyper-V Host',  tone: 'purple' },
  { value: 'vm',           label: 'VM',            tone: 'teal' },
  { value: 'generic',      label: 'Generic',       tone: 'gray' },
];

const reactFlowNodeTypes = { custom: CustomTopologyNode };

function newNodeId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CustomTopology() {
  const { user } = useAuth();
  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const { message, modal } = App.useApp();

  const [diagrams, setDiagrams]   = useState([]);
  const [activeId, setActiveId]   = useState(null);
  const [active, setActive]       = useState(null); // {id, name, description}
  const [listLoading, setListLoading] = useState(true);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [saving, setSaving]       = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nodeForm]    = Form.useForm();
  const [diagramForm] = Form.useForm();
  const [renameForm]  = Form.useForm();

  const loadList = useCallback(() => {
    setListLoading(true);
    return api.get('/custom-topology')
      .then(r => setDiagrams(r.data || []))
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Default to the most recently updated diagram once the list arrives.
  useEffect(() => {
    if (!diagrams.length) { setActiveId(null); return; }
    if (!activeId || !diagrams.some(d => d.id === activeId)) setActiveId(diagrams[0].id);
  }, [diagrams]); // eslint-disable-line

  useEffect(() => {
    if (!activeId) { setActive(null); setNodes([]); setEdges([]); return; }
    setCanvasLoading(true);
    api.get(`/custom-topology/${activeId}`)
      .then(r => {
        setActive(r.data);
        setNodes(r.data.nodes || []);
        setEdges(r.data.edges || []);
      })
      .catch(() => message.error('Failed to load diagram'))
      .finally(() => setCanvasLoading(false));
  }, [activeId]); // eslint-disable-line

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  async function handleSave() {
    if (!activeId) return;
    setSaving(true);
    try {
      await api.put(`/custom-topology/${activeId}`, { nodes, edges });
      message.success('Diagram saved');
      loadList();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleCreateDiagram() {
    const values = await diagramForm.validateFields();
    try {
      const { data } = await api.post('/custom-topology', values);
      message.success('Diagram created');
      setNewDiagramOpen(false);
      diagramForm.resetFields();
      await loadList();
      setActiveId(data.id);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to create diagram');
    }
  }

  async function handleRename() {
    const values = await renameForm.validateFields();
    try {
      await api.put(`/custom-topology/${activeId}`, values);
      message.success('Renamed');
      setRenameOpen(false);
      loadList();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to rename');
    }
  }

  function handleDelete() {
    modal.confirm({
      title: `Delete "${active?.name}"?`,
      content: 'This cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await api.delete(`/custom-topology/${activeId}`);
          message.success('Diagram deleted');
          setActiveId(null);
          loadList();
        } catch (e) {
          message.error(e.response?.data?.error || 'Failed to delete');
        }
      },
    });
  }

  function handleAddNode() {
    nodeForm.validateFields().then(values => {
      const tone = NODE_TYPES_OPTS.find(t => t.value === values.type)?.tone || 'gray';
      setNodes(nds => [...nds, {
        id: newNodeId(),
        type: 'custom',
        position: { x: 120 + (nds.length % 6) * 220, y: 120 + Math.floor(nds.length / 6) * 140 },
        data: { label: values.label, sublabel: values.sublabel || undefined, tone },
      }]);
      setAddNodeOpen(false);
      nodeForm.resetFields();
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <style>{CUSTOM_TOPOLOGY_CSS}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <Space align="start">
          <NodeIndexOutlined style={{ fontSize: 24, marginTop: 3 }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>Custom Topology Builder</Title>
            <Text type="secondary">
              Design your own topology by hand — add nodes, drag them into place, and draw connections between any two nodes.
            </Text>
          </div>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            style={{ width: 260 }}
            placeholder="Select a diagram…"
            loading={listLoading}
            value={activeId || undefined}
            onChange={setActiveId}
            options={diagrams.map(d => ({ value: d.id, label: d.name }))}
            notFoundContent={listLoading ? <Spin size="small" /> : 'No diagrams yet'}
          />
          {canWrite && (
            <Button icon={<PlusOutlined />} onClick={() => setNewDiagramOpen(true)}>New Diagram</Button>
          )}
          {active && canWrite && (
            <>
              <Tooltip title="Rename this diagram">
                <Button icon={<EditOutlined />} onClick={() => { renameForm.setFieldsValue({ name: active.name, description: active.description }); setRenameOpen(true); }} />
              </Tooltip>
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>Delete</Button>
              <Button icon={<PlusOutlined />} onClick={() => setAddNodeOpen(true)}>Add Node</Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>Save</Button>
            </>
          )}
        </Space>
        {active && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Drag from any edge of a node to another node to connect them. Select a node or connection and press Delete to remove it.
            </Text>
          </div>
        )}
      </Card>

      <Card bodyStyle={{ padding: 0 }} className="ctb-canvas">
        <div style={{ height: '72vh', minHeight: 480 }}>
          {canvasLoading ? (
            <Spin style={{ display: 'block', margin: '80px auto' }} />
          ) : !activeId ? (
            <Empty
              description="No diagrams yet — create one to start designing."
              style={{ marginTop: 80 }}
            >
              {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewDiagramOpen(true)}>New Diagram</Button>}
            </Empty>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={canWrite ? onNodesChange : undefined}
              onEdgesChange={canWrite ? onEdgesChange : undefined}
              onConnect={canWrite ? onConnect : undefined}
              nodesDraggable={canWrite}
              nodesConnectable={canWrite}
              elementsSelectable={canWrite}
              nodeTypes={reactFlowNodeTypes}
              connectionMode={ConnectionMode.Loose}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
            >
              <Background gap={16} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          )}
        </div>
      </Card>

      <Modal
        title="New Diagram"
        open={newDiagramOpen}
        onOk={handleCreateDiagram}
        onCancel={() => setNewDiagramOpen(false)}
        okText="Create"
        destroyOnClose
      >
        <Form form={diagramForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. Data Center 1 Layout" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Description (optional)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Rename Diagram"
        open={renameOpen}
        onOk={handleRename}
        onCancel={() => setRenameOpen(false)}
        okText="Save"
        destroyOnClose
      >
        <Form form={renameForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Description (optional)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Add Node"
        open={addNodeOpen}
        onOk={handleAddNode}
        onCancel={() => setAddNodeOpen(false)}
        okText="Add"
        destroyOnClose
      >
        <Form form={nodeForm} layout="vertical" style={{ marginTop: 8 }} initialValues={{ type: 'generic' }}>
          <Form.Item name="label" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. ESXi-Prod-01" autoFocus />
          </Form.Item>
          <Form.Item name="sublabel" label="Sublabel (optional)">
            <Input placeholder="e.g. 10.10.1.5" />
          </Form.Item>
          <Form.Item name="type" label="Type">
            <Select options={NODE_TYPES_OPTS.map(({ value, label }) => ({ value, label }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
