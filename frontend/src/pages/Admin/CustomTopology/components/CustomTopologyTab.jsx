import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode, MarkerType,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Card, Button, Space, Select, Modal, Form, Input, Empty, Spin, App, Tooltip, Divider, Typography,
} from 'antd';
import {
  PlusOutlined, SaveOutlined, EditOutlined, DeleteOutlined, ClusterOutlined,
} from '@ant-design/icons';
import api from '../../../../api/client';
import { useAuth } from '../../../../context/AuthContext.jsx';
import { useAppTheme } from '../../../../context/ThemeContext.jsx';
import CustomTopologyNode, { TONE_COLORS, CUSTOM_TOPOLOGY_CSS } from './CustomTopologyNode.jsx';
import ConnectivityFlowEdge from './ConnectivityFlowEdge.jsx';
import { EDGE_PALETTE, defaultEdgeOptions, newNodeId, toggleHostVMs, fetchVmCounts } from './vmExpansion.js';

const { Text } = Typography;

// Every tool's behavior:
//   'asset'    -> pick from MSL Assets (searchable)
//   'physical' -> pick from Physical & ESXi Servers (searchable) — its
//                 sourceKind marks it so CustomTopologyNode shows a "+" to
//                 load its real discovered VMs on demand (vmExpansion.js)
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

// Each platform's Custom sub-tab only offers the tools relevant to it —
// e.g. the Proxmox tab has no reason to offer a vCenter or ESXi tool.
// 'cluster' and 'generic' are useful everywhere. Hyper-V has no separate
// ESXi-equivalent tier (see hypervDbService.getHostTopology's comment —
// each host runs VMs directly), so it has no 'physical'-mode tool and,
// for now, no auto VM population in its Custom sub-tab.
const PLATFORM_TOOLS = {
  vmware:  ['vcenter', 'esxi', 'cluster', 'generic'],
  proxmox: ['proxmox_host', 'proxmox_node', 'cluster', 'generic'],
  hyperv:  ['hyperv_host', 'cluster', 'generic'],
};

const reactFlowNodeTypes = { custom: CustomTopologyNode };
const reactFlowEdgeTypes = { flow: ConnectivityFlowEdge };

export default function CustomTopologyTab({ platform }) {
  const { user } = useAuth();
  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const { message, modal } = App.useApp();
  const { mode: themeMode } = useAppTheme();
  const gridColor = themeMode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)';
  const toolTypes = PLATFORM_TOOLS[platform] || NODE_TYPES_OPTS.map(t => t.value);

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

  // Auto-build (VMware tab): pick one vCenter, build just its tree onto the
  // current canvas. Each vCenter gets its own diagram — build one, Save,
  // switch/create the next diagram, build again for a different vCenter.
  const [vcenterPickOpen, setVcenterPickOpen] = useState(false);
  const [vcenterOptions, setVcenterOptions]   = useState([]);
  const [vcenterPickValue, setVcenterPickValue] = useState(null);
  const [vcenterSkippedNote, setVcenterSkippedNote] = useState(null);
  const autoBuildDataRef = useRef({ hosts: [], vcLabelMap: new Map() });

  const loadList = useCallback(() => {
    setListLoading(true);
    return api.get('/custom-topology', { params: { platform } })
      .then(r => setDiagrams(r.data || []))
      .finally(() => setListLoading(false));
  }, [platform]);

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

  // Expand/collapse a host's VMs on demand (shared with the read-only
  // Topology of Sites viewer — see vmExpansion.js). VM child nodes/edges
  // this adds are never part of what Save below persists, so the diagram
  // in storage always stays the compact vCenter/Cluster/Host tree; VMs are
  // always fetched fresh, on demand, wherever the diagram is opened.
  const handleToggleVMs = useCallback((id) => {
    const hostNode = nodes.find(n => n.id === id);
    if (hostNode) toggleHostVMs({ hostNode, nodes, setNodes, setEdges, api, message });
  }, [nodes, setNodes, setEdges, message]);

  // Auto-populate each physical host's on/off VM counts as soon as the
  // diagram loads, without requiring the admin to click "+" — purely a
  // view concern (see fetchVmCounts in vmExpansion.js), so it's never part
  // of what Save persists. The ref tracks which host IDs a fetch has
  // already been attempted for, so this doesn't refire every render or
  // re-request for a host whose lookup failed/returned empty.
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
  }, [nodes, setNodes]);

  // Function props (onRename/onToggleVMs) aren't part of the persisted
  // node — they're attached only for the canvas render, never saved to the
  // backend (the raw `nodes` state PUT in handleSave stays plain JSON).
  const nodesForCanvas = useMemo(
    () => nodes.map(n => ({
      ...n,
      data: { ...n.data, onRename: canWrite ? handleRenameNode : undefined, onToggleVMs: handleToggleVMs },
    })),
    [nodes, handleRenameNode, handleToggleVMs, canWrite]
  );

  async function handleSave() {
    if (!activeId) return;
    setSaving(true);
    try {
      // Strip on-demand VM nodes/edges (tagged parentHostId) and the
      // vmsExpanded/vmsLoading view-state flags before persisting — a
      // saved diagram is always the compact tree, regardless of what's
      // currently expanded on screen.
      const cleanNodes = nodes
        .filter(n => n.data?.parentHostId === undefined)
        .map(n => {
          if (n.data?.vmsExpanded === undefined && n.data?.vmsLoading === undefined && n.data?.vmCounts === undefined) return n;
          const { vmsExpanded, vmsLoading, vmCounts, ...rest } = n.data;
          return { ...n, data: rest };
        });
      const cleanEdges = edges.filter(e => e.data?.parentHostId === undefined);
      await api.put(`/custom-topology/${activeId}`, { nodes: cleanNodes, edges: cleanEdges });
      message.success('Diagram saved');
      loadList();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleCreateDiagram() {
    const values = await diagramForm.validateFields();
    try {
      const { data } = await api.post('/custom-topology', { ...values, platform });
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

  // Appends one node and returns {id, position} so callers can position
  // related nodes relative to it.
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

  // Collects every Physical & ESXi Servers record across pages — the list
  // endpoint caps pageSize at 200, so real deployments need more than one
  // fetch to get the full set to group.
  async function fetchAllPhysicalEsxi() {
    const all = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await api.get('/physical-esxi', { params: { pageSize: 200, page } });
      all.push(...(data.items || []));
      if (!data.items?.length || all.length >= (data.total || 0) || page > 50) break;
      page += 1;
    }
    return all;
  }

  // Groups one vCenter's Physical & ESXi Servers records into
  // Cluster -> ESXi Host and lays the tree out left-to-right. VMs are never
  // fetched here — each host node gets a "+" (see vmExpansion.js) to load
  // its VMs on demand instead, in the builder and the read-only viewer
  // alike, so the diagram never has to carry every VM just to exist.
  // Replaces the current canvas — nothing is persisted until the admin
  // presses the existing Save button, so a bad auto-build is just a reload
  // away from undone. One vCenter per diagram by design: build this one,
  // Save, then switch to (or create) a different diagram for the next.
  function buildVcenterTree(vcenterIp, hosts, vcLabelMap) {
    const vcenterHosts = hosts.filter(h => h.vcenter === vcenterIp);
    const clusterMap = new Map(); // cluster name -> host[]
    for (const h of vcenterHosts) {
      const cl = (h.cluster || '').trim() || 'Unassigned';
      if (!clusterMap.has(cl)) clusterMap.set(cl, []);
      clusterMap.get(cl).push(h);
    }

    const X_VCENTER = 80, X_CLUSTER = 360, X_ESXI = 640, ROW_GAP = 110;
    const vcColor = EDGE_PALETTE[0];
    const newNodes = [];
    const newEdges = [];
    let rowCounter = 0;

    const vcId = newNodeId();
    const clusterEntries = [...clusterMap.entries()].sort((a, b) => {
      if (a[0] === 'Unassigned') return 1;
      if (b[0] === 'Unassigned') return -1;
      return a[0].localeCompare(b[0]);
    });
    const clusterYs = [];

    for (const [clusterName, clusterHosts] of clusterEntries) {
      const clId = newNodeId();
      const sortedHosts = [...clusterHosts].sort(
        (a, b) => (a.vm_name || a.ip_address || '').localeCompare(b.vm_name || b.ip_address || '')
      );
      const hostYs = [];

      for (const h of sortedHosts) {
        const y = rowCounter * ROW_GAP;
        rowCounter += 1;
        const hostId = newNodeId();
        newNodes.push({
          id: hostId, type: 'custom', position: { x: X_ESXI, y },
          data: {
            label: h.vm_name || h.ip_address || 'ESXi Host', sublabel: h.ip_address,
            tone: 'blue', sourceId: h.id, sourceKind: 'physical',
          },
        });
        newEdges.push({
          id: `e-${clId}-${hostId}`, source: clId, target: hostId,
          sourceHandle: 'right', targetHandle: 'left', ...defaultEdgeOptions,
          data: { color: vcColor }, style: { stroke: vcColor },
          markerEnd: { type: MarkerType.ArrowClosed, color: vcColor },
        });
        hostYs.push(y);
      }

      const clY = hostYs.reduce((a, b) => a + b, 0) / hostYs.length;
      newNodes.push({
        id: clId, type: 'custom', position: { x: X_CLUSTER, y: clY },
        data: { label: clusterName, tone: 'orange' },
      });
      newEdges.push({
        id: `e-${vcId}-${clId}`, source: vcId, target: clId,
        sourceHandle: 'right', targetHandle: 'left', ...defaultEdgeOptions,
        data: { color: vcColor }, style: { stroke: vcColor },
        markerEnd: { type: MarkerType.ArrowClosed, color: vcColor },
      });
      clusterYs.push(clY);
    }

    const vcY = clusterYs.reduce((a, b) => a + b, 0) / clusterYs.length;
    newNodes.push({
      id: vcId, type: 'custom', position: { x: X_VCENTER, y: vcY },
      data: { label: vcLabelMap.get(vcenterIp) || vcenterIp, sublabel: vcenterIp, tone: 'blue' },
    });

    setNodes(newNodes);
    setEdges(newEdges);
    message.success(
      `Built "${vcLabelMap.get(vcenterIp) || vcenterIp}": ${clusterEntries.length} cluster(s), ` +
      `${vcenterHosts.length} host(s). Expand a host's "+" to load its VMs. Review, then click Save to persist.`
    );
  }

  async function handleAutoBuildVMware() {
    if (!activeId) { message.warning('Select or create a diagram first'); return; }
    try {
      const [vcRes, hosts] = await Promise.all([
        api.get('/assets', { params: { osVersion: 'vcenter', pageSize: 200 } }),
        fetchAllPhysicalEsxi(),
      ]);
      const vcLabelMap = new Map(
        (vcRes.data.items || []).map(a => [a.ip_address, a.vm_name || a.ip_address])
      );
      // Only ESXi-type hosts with a vCenter assigned can be placed in this
      // tree — a bare-metal server or a host nobody's tagged with a vCenter
      // yet has nothing to hang under.
      const eligible = hosts.filter(h => /esxi/i.test(h.os_type || '') && h.vcenter);
      if (!eligible.length) {
        message.warning('No Physical & ESXi Servers records with both an ESXi OS type and a vCenter assigned were found.');
        return;
      }
      const counts = new Map();
      for (const h of eligible) counts.set(h.vcenter, (counts.get(h.vcenter) || 0) + 1);
      const options = [...counts.entries()]
        .sort((a, b) => (vcLabelMap.get(a[0]) || a[0]).localeCompare(vcLabelMap.get(b[0]) || b[0]))
        .map(([ip, count]) => ({
          value: ip,
          label: `${vcLabelMap.get(ip) || ip} (${ip}) — ${count} host${count === 1 ? '' : 's'}`,
        }));

      autoBuildDataRef.current = { hosts: eligible, vcLabelMap };
      setVcenterOptions(options);
      setVcenterPickValue(options[0]?.value ?? null);
      const skipped = hosts.length - eligible.length;
      setVcenterSkippedNote(
        skipped ? `${skipped} record(s) skipped — no vCenter assigned or not an ESXi OS type.` : null
      );
      setVcenterPickOpen(true);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load Physical & ESXi Servers');
    }
  }

  function confirmVcenterPick() {
    const vcenterIp = vcenterPickValue;
    if (!vcenterIp) return;
    setVcenterPickOpen(false);
    const { hosts, vcLabelMap } = autoBuildDataRef.current;
    const label = vcLabelMap.get(vcenterIp) || vcenterIp;
    modal.confirm({
      title: `Build "${label}" onto this canvas?`,
      content: 'This replaces everything currently on this canvas with a tree for this vCenter only, grouped by Cluster — each vCenter gets its own diagram, so build one, Save, then repeat for the next. Nothing is saved until you press Save.',
      okText: 'Build',
      onOk: () => buildVcenterTree(vcenterIp, hosts, vcLabelMap),
    });
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

  function confirmRecordPick() {
    const opt = pickerOptions.find(o => o.value === pickerValue);
    if (!opt) return;
    const r = opt.record;
    const label = r.vm_name || r.ip_address || 'Unnamed';
    // physical-mode nodes (ESXi Host / Proxmox Node) get sourceKind:
    // 'physical', which is what makes CustomTopologyNode show the "+" to
    // load this host's VMs on demand — see handleToggleVMs/vmExpansion.js.
    placeNode(pickerType, label, r.ip_address, { sourceId: r.id, sourceKind: pickerKind });
    setPickerOpen(false);
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
              {platform === 'vmware' && (
                <Tooltip title="Pick a vCenter, then group its Physical & ESXi Servers by Cluster and lay out the tree on this canvas. Replaces the current canvas — one vCenter per diagram.">
                  <Button icon={<ClusterOutlined />} onClick={handleAutoBuildVMware}>
                    Auto-build from Physical &amp; ESXi Servers
                  </Button>
                </Tooltip>
              )}
            </>
          )}
        </Space>

        {active && canWrite && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Space wrap align="center">
              <Text type="secondary" style={{ fontSize: 12 }}>Tools:</Text>
              {NODE_TYPES_OPTS.filter(t => toolTypes.includes(t.value)).map(t => (
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
              vCenter / Proxmox Host / Hyper-V Host pick from MSL Assets; ESXi / Proxmox Node pick from Physical &amp; ESXi Servers — click the "+" on a host node to load its VMs, click again to hide them.
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
              <Background variant={BackgroundVariant.Lines} gap={24} size={1} color={gridColor} />
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
        title="Auto-build VMware topology"
        open={vcenterPickOpen}
        onOk={confirmVcenterPick}
        onCancel={() => setVcenterPickOpen(false)}
        okText="Continue"
        okButtonProps={{ disabled: !vcenterPickValue }}
        destroyOnClose
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Each vCenter builds its own diagram. Pick which one to build onto the current canvas — build it, click Save, then run this again for the next vCenter (on its own diagram).
        </Text>
        <Select
          style={{ width: '100%' }}
          options={vcenterOptions}
          value={vcenterPickValue}
          onChange={setVcenterPickValue}
          autoFocus
        />
        {vcenterSkippedNote && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            {vcenterSkippedNote}
          </Text>
        )}
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
