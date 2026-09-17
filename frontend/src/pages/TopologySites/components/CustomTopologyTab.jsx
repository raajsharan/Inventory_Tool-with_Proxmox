import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ConnectionMode, MarkerType,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Card, Button, Space, Select, Modal, Form, Input, Empty, Spin, App, Tooltip, Divider, Typography,
} from 'antd';
import {
  PlusOutlined, SaveOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import CustomTopologyNode, { TONE_COLORS } from './CustomTopologyNode.jsx';
import ConnectivityFlowEdge from './ConnectivityFlowEdge.jsx';

const { Text } = Typography;

// CSS-variable theming for the node component (dark-first app; see
// DASH_CSS in components/DashboardStatCard.jsx for the same body[data-theme]
// convention used everywhere else in this codebase), plus the moving-dot
// animation for the "Connectivity Flow" edge style.
const CUSTOM_TOPOLOGY_CSS = `
.ctb-canvas { --ctb-node-bg: #ffffff; --ctb-node-title: #262626; --ctb-node-subtitle: #8c8c8c; }
body[data-theme="dark"] .ctb-canvas { --ctb-node-bg: #1c1c1c; --ctb-node-title: #f0f0f0; --ctb-node-subtitle: #a6a6a6; }
@keyframes ctb-flowdot { to { offset-distance: 100%; } }
@media (prefers-reduced-motion: no-preference) {
  .ctb-flow-dot { animation: ctb-flowdot 1.8s linear infinite; }
}
.ctb-flow-dot { fill: #1677ff; }
`;

// Every tool's behavior:
//   'asset'    -> pick from MSL Assets (searchable)
//   'physical' -> pick from Physical & ESXi Servers (searchable), then
//                 auto-fetch + auto-connect its real discovered VMs
//   'name'     -> just prompt for a name, no linked record
const NODE_TYPES_OPTS = [
  { value: 'vcenter',      label: 'vCenter',       tone: 'blue',   mode: 'asset' },
  { value: 'proxmox_host', label: 'Proxmox Host',  tone: 'orange', mode: 'asset' },
  { value: 'hyperv_host',  label: 'Hyper-V Host',  tone: 'purple', mode: 'asset' },
  { value: 'esxi',         label: 'ESXi Host',     tone: 'blue',   mode: 'physical' },
  { value: 'proxmox_node', label: 'Proxmox Node',  tone: 'orange', mode: 'physical' },
  { value: 'cluster',      label: 'Cluster',       tone: 'orange', mode: 'name' },
  { value: 'generic',      label: 'Generic',       tone: 'gray',   mode: 'name' },
];

const reactFlowNodeTypes = { custom: CustomTopologyNode };
const reactFlowEdgeTypes = { flow: ConnectivityFlowEdge };
const defaultEdgeOptions = { type: 'flow', markerEnd: { type: MarkerType.ArrowClosed } };

function newNodeId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CustomTopologyTab() {
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

  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [diagramForm] = Form.useForm();
  const [renameForm]  = Form.useForm();

  // Record picker (vCenter/Proxmox Host/Hyper-V Host -> MSL Assets;
  // ESXi/Proxmox Node -> Physical & ESXi Servers).
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [pickerType, setPickerType]   = useState(null);
  const [pickerKind, setPickerKind]   = useState(null); // 'asset' | 'physical'
  const [pickerOptions, setPickerOptions] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerValue, setPickerValue] = useState(null);
  const pickerDebounce = useRef(null);

  // Name-only prompt (Cluster / Generic).
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [namePromptType, setNamePromptType] = useState(null);
  const [nameForm] = Form.useForm();

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
    (params) => setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions }, eds)),
    [setEdges]
  );

  const handleRenameNode = useCallback((id, label) => {
    setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, label } } : n)));
  }, [setNodes]);

  // Function props (onRename) aren't part of the persisted node — they're
  // attached only for the canvas render, never saved to the backend (the
  // raw `nodes` state PUT in handleSave stays plain JSON).
  const nodesForCanvas = useMemo(
    () => nodes.map(n => ({ ...n, data: { ...n.data, onRename: canWrite ? handleRenameNode : undefined } })),
    [nodes, handleRenameNode, canWrite]
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

  // Appends one node and returns {id, position} so callers (e.g. the auto
  // VM-node placement below) can position new nodes relative to it.
  function placeNode(type, label, sublabel, extraData = {}) {
    const meta = NODE_TYPES_OPTS.find(t => t.value === type) || { tone: 'gray' };
    const id = newNodeId();
    const position = { x: 120 + (nodes.length % 6) * 220, y: 120 + Math.floor(nodes.length / 6) * 140 };
    setNodes(nds => [...nds, {
      id, type: 'custom', position,
      data: { label, sublabel: sublabel || undefined, tone: meta.tone, ...extraData },
    }]);
    return { id, position };
  }

  function addAutoVMNodes(hostId, hostPos, vms) {
    const PER_ROW = 4, COL_GAP = 170, ROW_GAP = 140;
    const newNodes = [];
    const newEdges = [];
    vms.forEach((vm, i) => {
      const row = Math.floor(i / PER_ROW);
      const col = i % PER_ROW;
      const countInRow = Math.min(PER_ROW, vms.length - row * PER_ROW);
      const rowStartX = hostPos.x - ((countInRow - 1) * COL_GAP) / 2;
      const vmId = newNodeId();
      newNodes.push({
        id: vmId,
        type: 'custom',
        position: { x: rowStartX + col * COL_GAP, y: hostPos.y + 160 + row * ROW_GAP },
        data: { label: vm.hostname || vm.name || 'VM', sublabel: vm.ips?.[0], tone: 'teal' },
      });
      newEdges.push({ id: `e-${hostId}-${vmId}`, source: hostId, target: vmId, ...defaultEdgeOptions });
    });
    setNodes(nds => [...nds, ...newNodes]);
    setEdges(eds => [...eds, ...newEdges]);
  }

  function handleToolClick(type) {
    const meta = NODE_TYPES_OPTS.find(t => t.value === type);
    if (meta.mode === 'name') {
      setNamePromptType(type);
      nameForm.resetFields();
      setNamePromptOpen(true);
      return;
    }
    setPickerType(type);
    setPickerKind(meta.mode); // 'asset' | 'physical'
    setPickerValue(null);
    setPickerOptions([]);
    setPickerOpen(true);
  }

  function searchPickerRecords(q) {
    clearTimeout(pickerDebounce.current);
    pickerDebounce.current = setTimeout(async () => {
      setPickerLoading(true);
      try {
        const url = pickerKind === 'asset' ? '/assets' : '/physical-esxi';
        const { data } = await api.get(url, { params: { search: q, pageSize: 20 } });
        setPickerOptions((data.items || []).map(r => ({
          value: r.id,
          label: `${r.vm_name || '(unnamed)'}${r.ip_address ? ` — ${r.ip_address}` : ''}`,
          record: r,
        })));
      } catch {
        setPickerOptions([]);
      } finally {
        setPickerLoading(false);
      }
    }, 300);
  }

  async function confirmRecordPick() {
    const opt = pickerOptions.find(o => o.value === pickerValue);
    if (!opt) return;
    const r = opt.record;
    const label = r.vm_name || r.ip_address || 'Unnamed';
    const { id: hostId, position: hostPos } = placeNode(pickerType, label, r.ip_address, {
      sourceId: r.id, sourceKind: pickerKind,
    });
    setPickerOpen(false);

    if (pickerKind === 'physical') {
      try {
        const { data } = await api.get(`/physical-esxi/${r.id}/discovered-vms`);
        if (!data.vms?.length) {
          message.info('No discovered VMs found for this host');
        } else {
          addAutoVMNodes(hostId, hostPos, data.vms);
        }
      } catch {
        message.error('Failed to look up discovered VMs for this host');
      }
    }
  }

  function confirmNamePrompt() {
    nameForm.validateFields().then(values => {
      placeNode(namePromptType, values.label);
      setNamePromptOpen(false);
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <style>{CUSTOM_TOPOLOGY_CSS}</style>

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
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>Save</Button>
            </>
          )}
        </Space>

        {active && canWrite && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Space wrap align="center">
              <Text type="secondary" style={{ fontSize: 12 }}>Tools:</Text>
              {NODE_TYPES_OPTS.map(t => (
                <Button
                  key={t.value}
                  onClick={() => handleToolClick(t.value)}
                  style={{ borderColor: TONE_COLORS[t.tone], color: TONE_COLORS[t.tone] }}
                >
                  {t.label}
                </Button>
              ))}
            </Space>
          </>
        )}

        {active && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              vCenter / Proxmox Host / Hyper-V Host pick from MSL Assets; ESXi / Proxmox Node pick from Physical &amp; ESXi Servers and auto-add their discovered VMs.
              Drag from any edge of a node to another to connect them. Double-click a node to rename it. Select a node or connection and press Delete to remove it.
            </Text>
          </div>
        )}
      </Card>

      <Card bodyStyle={{ padding: 0 }} className="ctb-canvas">
        <div style={{ height: '68vh', minHeight: 440 }}>
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
              nodes={nodesForCanvas}
              edges={edges}
              onNodesChange={canWrite ? onNodesChange : undefined}
              onEdgesChange={canWrite ? onEdgesChange : undefined}
              onConnect={canWrite ? onConnect : undefined}
              nodesDraggable={canWrite}
              nodesConnectable={canWrite}
              elementsSelectable={canWrite}
              nodeTypes={reactFlowNodeTypes}
              edgeTypes={reactFlowEdgeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
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
        title={pickerKind === 'asset' ? 'Pick an MSL Asset' : 'Pick a Physical & ESXi Server'}
        open={pickerOpen}
        onOk={confirmRecordPick}
        onCancel={() => setPickerOpen(false)}
        okText="Add"
        okButtonProps={{ disabled: !pickerValue }}
        destroyOnClose
      >
        <Select
          style={{ width: '100%' }}
          showSearch
          filterOption={false}
          placeholder="Type to search by name or IP…"
          value={pickerValue}
          onSearch={searchPickerRecords}
          onChange={setPickerValue}
          loading={pickerLoading}
          notFoundContent={pickerLoading ? <Spin size="small" /> : 'Type to search…'}
          options={pickerOptions}
          autoFocus
        />
      </Modal>

      <Modal
        title={namePromptType === 'cluster' ? 'Add Cluster' : 'Add Node'}
        open={namePromptOpen}
        onOk={confirmNamePrompt}
        onCancel={() => setNamePromptOpen(false)}
        okText="Add"
        destroyOnClose
      >
        <Form form={nameForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="label" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder={namePromptType === 'cluster' ? 'e.g. Production Cluster' : 'e.g. Router-01'} autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
