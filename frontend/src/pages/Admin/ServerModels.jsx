import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Input, Button, Space, Typography, App, Popconfirm,
  Row, Col, Table, Tag,
} from 'antd';
import {
  ArrowLeftOutlined, ReloadOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined,
  HddOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Text, Title } = Typography;

function StatCard({ icon, value, label, color = '#1677ff' }) {
  return (
    <Card size="small" style={{ borderRadius: 8 }}>
      <Space size={16} align="center">
        <div style={{
          width: 44, height: 44, borderRadius: 8, background: `${color}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, color,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
        </div>
      </Space>
    </Card>
  );
}

export default function ServerModels() {
  const nav = useNavigate();
  const { message } = App.useApp();
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [models, setModels]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [editingId, setEditingId] = useState(null);

  // new / edit form state
  const [fManufacturer, setFManufacturer] = useState('');
  const [fModelName, setFModelName]       = useState('');
  const [fNotes, setFNotes]               = useState('');
  const [saving, setSaving]               = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/server-models');
      setModels(data);
    } catch { message.error('Failed to load server models'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const resetForm = () => {
    setFManufacturer(''); setFModelName(''); setFNotes('');
    setEditingId(null); setShowForm(false);
  };

  const startEdit = (row) => {
    setFManufacturer(row.manufacturer || '');
    setFModelName(row.model_name);
    setFNotes(row.notes || '');
    setEditingId(row.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!fModelName.trim()) { message.warning('Model name is required'); return; }
    setSaving(true);
    try {
      const body = { manufacturer: fManufacturer, model_name: fModelName, notes: fNotes };
      if (editingId) {
        await api.put(`/server-models/${editingId}`, body);
        message.success('Model updated');
      } else {
        await api.post('/server-models', body);
        message.success('Model added');
      }
      resetForm();
      await load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/server-models/${id}`);
      message.success('Model deleted');
      await load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to delete');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m =>
      (m.manufacturer || '').toLowerCase().includes(q) ||
      m.model_name.toLowerCase().includes(q)
    );
  }, [models, search]);

  const totalUsed   = models.filter(m => m.servers_using > 0).length;
  const totalUnused = models.length - totalUsed;

  const columns = [
    {
      title: 'MANUFACTURER',
      dataIndex: 'manufacturer',
      width: 160,
      render: (v) => v ? <Text style={{ color: '#1677ff' }}>{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'MODEL NAME',
      dataIndex: 'model_name',
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: 'DESCRIPTION / NOTES',
      dataIndex: 'notes',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'SERVERS USING',
      dataIndex: 'servers_using',
      width: 160,
      align: 'center',
      render: (n) => n > 0
        ? <Tag color="green" icon={<DatabaseOutlined />}>{n} {n === 1 ? 'server' : 'servers'}</Tag>
        : <Text type="secondary" italic>unused</Text>,
    },
    {
      title: 'ACTIONS',
      width: 140,
      align: 'right',
      render: (_, row) => isAdmin ? (
        <Space>
          <Button
            type="link" size="small" icon={<EditOutlined />}
            onClick={() => startEdit(row)}
          >Edit</Button>
          <Popconfirm
            title="Delete this model?"
            description={row.servers_using > 0
              ? `${row.servers_using} server(s) still use this model.`
              : 'This action cannot be undone.'}
            onConfirm={() => handleDelete(row.id)}
            okText="Delete" okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>Delete</Button>
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', marginBottom: 16,
      }}>
        <Space align="start">
          <Button
            icon={<ArrowLeftOutlined />}
            style={{ marginTop: 4 }}
            onClick={() => nav(-1)}
          />
          <div>
            <Title level={4} style={{ margin: 0 }}>Server Models</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Manage the list of physical server models used in registration
            </Text>
          </div>
        </Space>
        <Space>
          {isAdmin && !showForm && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowForm(true)}>
              New Server Model
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
        </Space>
      </div>

      {/* ── Add / Edit form ── */}
      {showForm && isAdmin && (
        <Card
          style={{
            marginBottom: 16, borderRadius: 8,
            border: '1.5px solid #1677ff33',
            background: 'linear-gradient(135deg, #f0f7ff 0%, #f6ffed 100%)',
          }}
        >
          <Space style={{ marginBottom: 12 }}>
            <HddOutlined style={{ color: '#1677ff' }} />
            <Text strong style={{ color: '#1677ff' }}>
              {editingId ? 'Edit Server Model' : '+ New Server Model'}
            </Text>
          </Space>
          <Row gutter={12} align="bottom">
            <Col xs={24} md={7}>
              <div style={{ marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Manufacturer</Text>
              </div>
              <Input
                placeholder="Dell, HP, Lenovo, Supermicro..."
                value={fManufacturer}
                onChange={e => setFManufacturer(e.target.value)}
                onPressEnter={handleSave}
              />
            </Col>
            <Col xs={24} md={7}>
              <div style={{ marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Model Name <span style={{ color: '#ff4d4f' }}>*</span>
                </Text>
              </div>
              <Input
                placeholder="PowerEdge R750, ProLiant DL380..."
                value={fModelName}
                onChange={e => setFModelName(e.target.value)}
                onPressEnter={handleSave}
                status={!fModelName.trim() && saving ? 'error' : undefined}
              />
            </Col>
            <Col xs={24} md={7}>
              <div style={{ marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Description / Notes</Text>
              </div>
              <Input
                placeholder="Optional notes about this model"
                value={fNotes}
                onChange={e => setFNotes(e.target.value)}
                onPressEnter={handleSave}
              />
            </Col>
            <Col xs={24} md={3}>
              <Space>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={saving}
                  onClick={handleSave}
                  style={{ background: '#389e0d', borderColor: '#389e0d' }}
                >
                  {editingId ? 'Save' : 'Add Model'}
                </Button>
                <Button icon={<CloseOutlined />} onClick={resetForm}>Cancel</Button>
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {/* ── Summary cards ── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <StatCard
            icon={<HddOutlined />}
            value={models.length}
            label="Total Models"
            color="#1677ff"
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            icon={<DatabaseOutlined />}
            value={totalUsed}
            label="Models In Use"
            color="#52c41a"
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            icon={<HddOutlined />}
            value={totalUnused}
            label="Unused Models"
            color="#8c8c8c"
          />
        </Col>
      </Row>

      {/* ── Search + table ── */}
      <Card style={{ borderRadius: 8 }}>
        <Input
          prefix={<span style={{ color: '#bfbfbf' }}>&#128269;</span>}
          placeholder="Search by manufacturer or model name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          allowClear
          style={{ marginBottom: 16, maxWidth: 420 }}
        />
        <Table
          rowKey="id"
          dataSource={filtered}
          columns={columns}
          loading={loading}
          size="middle"
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: search ? 'No models match your search' : 'No server models added yet' }}
        />
      </Card>
    </div>
  );
}
