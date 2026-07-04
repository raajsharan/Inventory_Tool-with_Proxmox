import { useEffect, useState, useCallback } from 'react';
import {
  Card, Row, Col, Statistic, Table, Tag, Tooltip, Input, Button, Space,
  Drawer, Form, Typography, Popconfirm, message, Empty, Badge, Spin,
} from 'antd';
import {
  EditOutlined, UndoOutlined, DownloadOutlined, SearchOutlined,
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined,
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined, LinkOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Text } = Typography;

function powerTag(state) {
  if (state === 'poweredOn')  return <Tag icon={<PlayCircleOutlined  />} color="success">On</Tag>;
  if (state === 'poweredOff') return <Tag icon={<StopOutlined        />} color="default">Off</Tag>;
  if (state === 'suspended')  return <Tag icon={<PauseCircleOutlined />} color="warning">Suspended</Tag>;
  return <Tag>{state || '—'}</Tag>;
}

const FILTERS = [
  { key: 'all',       label: 'All',       statKey: 'total' },
  { key: 'matched',   label: 'Matched',   statKey: 'matched' },
  { key: 'unmatched', label: 'Unmatched', statKey: 'unmatched' },
  { key: 'edited',    label: 'Edited',    statKey: 'edited' },
];

export default function VMAssetEditor() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState('all');
  const [search,      setSearch]      = useState('');
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [editTarget,  setEditTarget]  = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [form]                        = Form.useForm();

  const load = useCallback((f = filter, q = search) => {
    setLoading(true);
    const params = {};
    if (f && f !== 'all') params.filter = f;
    if (q) params.search = q;
    api.get('/vmware/asset-editor', { params })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [filter, search]); // eslint-disable-line

  useEffect(() => { load(); }, []); // eslint-disable-line

  function onFilterChange(key) {
    setFilter(key);
    load(key, search);
  }

  function onSearch() { load(filter, search); }

  function openEdit(record) {
    setEditTarget(record);
    form.setFieldsValue({
      asset_name: record.edit.asset_name || record.name,
      ip_address: record.edit.ip_address || (record.display_ips?.[0]?.ip || ''),
      hostname:   record.edit.hostname   || record.hostname || '',
      os_type:    record.edit.os_type    || record.os_type  || '',
      os_version: record.edit.os_version || record.os_version || '',
      notes:      record.edit.notes      || '',
    });
    setDrawerOpen(true);
  }

  async function onSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.post('/vmware/asset-editor/save', {
        source_host: editTarget.source_host,
        vm_name:     editTarget.name,
        ...values,
      });
      message.success(`Edits saved for "${editTarget.name}"`);
      setDrawerOpen(false);
      load();
    } catch {
      message.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onReset(record) {
    try {
      await api.post('/vmware/asset-editor/reset', {
        source_host: record.source_host,
        vm_name:     record.name,
      });
      message.info(`Edits reverted for "${record.name}"`);
      load();
    } catch {
      message.error('Revert failed');
    }
  }

  async function onExport() {
    const token = localStorage.getItem('token');
    const resp  = await fetch('/api/vmware/asset-editor/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'asset_editor.csv';
    a.click();
  }

  const stats   = data?.stats   || {};
  const results = data?.results || [];

  const columns = [
    {
      title: 'VM Name', key: 'name', width: 200, ellipsis: true,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title={r.name}>
            <Text style={{ maxWidth: 170, display: 'inline-block' }} ellipsis>
              {r.edit.asset_name && r.edit.asset_name !== r.name
                ? <><span style={{ color: '#52c41a', fontWeight: 500 }}>{r.edit.asset_name}</span><br /><Text type="secondary" style={{ fontSize: 11 }}>{r.name}</Text></>
                : r.name
              }
            </Text>
          </Tooltip>
          {r.has_edit && <Badge dot color="#52c41a" title="Has local edits" />}
        </Space>
      ),
    },
    {
      title: 'IP Addresses', key: 'ips', width: 200,
      render: (_, r) => {
        const list = r.display_ips || [];
        if (!list.length) return <span style={{ color: '#bfbfbf' }}>—</span>;
        const edited = r.has_edit && r.edit.ip_address;
        if (edited) {
          return (
            <Tooltip title="Local edit">
              <Tag color="success" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {r.edit.ip_address}
              </Tag>
            </Tooltip>
          );
        }
        return (
          <Space direction="vertical" size={2}>
            {list.slice(0, 2).map(({ ip, src }) => (
              <Tag
                key={ip}
                color={src === 'mac' ? 'success' : undefined}
                style={{ fontFamily: 'monospace', fontSize: 11 }}
                title={src === 'mac' ? 'IP from MAC Lookup mapping' : 'IP from VMware'}
              >
                {ip}
              </Tag>
            ))}
            {list.length > 2 && <Text type="secondary" style={{ fontSize: 11 }}>+{list.length - 2} more</Text>}
          </Space>
        );
      },
    },
    {
      title: 'Mapped IP(s)', dataIndex: 'mapped_ips', key: 'mapped_ips', width: 160,
      render: v => v
        ? <span style={{ color: '#52c41a', fontWeight: 500, fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
        : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'Hostname', key: 'hostname', width: 170, ellipsis: true,
      render: (_, r) => {
        const val = r.has_edit && r.edit.hostname ? r.edit.hostname : (r.hostname !== 'Not Available' ? r.hostname : '');
        const isEdited = r.has_edit && r.edit.hostname;
        return val
          ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: isEdited ? '#52c41a' : undefined }}>{val}</span>
          : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    {
      title: 'OS Type', key: 'os_type', width: 150, ellipsis: true,
      render: (_, r) => {
        const val = r.has_edit && r.edit.os_type ? r.edit.os_type : (r.os_type !== 'Not Available' ? r.os_type : '');
        const isEdited = r.has_edit && r.edit.os_type;
        return val
          ? <Text style={{ fontSize: 12, color: isEdited ? '#52c41a' : undefined }}>{val}</Text>
          : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    {
      title: 'LAN / VLAN', key: 'lan', width: 150, ellipsis: true,
      render: (_, r) => {
        const parts = [r.lan_segment, r.vlan_group].filter(Boolean);
        return parts.length
          ? <Text type="secondary" style={{ fontSize: 12 }}>{parts.join(' / ')}</Text>
          : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    {
      title: 'Match', key: 'match', width: 75, align: 'center',
      render: (_, r) => r.is_matched
        ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
        : <CloseCircleOutlined style={{ color: '#d9d9d9', fontSize: 16 }} />,
    },
    {
      title: 'Power', dataIndex: 'power_state', key: 'power_state', width: 100,
      render: powerTag,
    },
    {
      title: 'Notes', key: 'notes', width: 180, ellipsis: true,
      render: (_, r) => r.edit.notes
        ? <Tooltip title={r.edit.notes}><Text type="secondary" style={{ fontSize: 12 }}>{r.edit.notes}</Text></Tooltip>
        : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'Source', dataIndex: 'source_host', key: 'source_host', width: 150, ellipsis: true,
      render: v => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Actions', key: 'actions', width: 110, fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>
          {r.has_edit && (
            <Popconfirm
              title={`Revert all edits for "${r.name}"?`}
              onConfirm={() => onReset(r)}
              okText="Revert"
              okType="danger"
            >
              <Tooltip title="Revert edits">
                <Button size="small" icon={<UndoOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      {/* Stat cards + filter bar */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {FILTERS.map(f => (
          <Col key={f.key} xs={12} sm={6}>
            <Card
              size="small"
              hoverable
              onClick={() => onFilterChange(f.key)}
              style={{
                cursor: 'pointer',
                borderColor: filter === f.key ? '#1677ff' : undefined,
                boxShadow: filter === f.key ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
              }}
            >
              <Statistic
                title={f.label}
                value={stats[f.statKey] ?? 0}
                valueStyle={
                  f.key === 'matched'   ? { color: '#52c41a' } :
                  f.key === 'edited'    ? { color: '#1677ff' } :
                  f.key === 'unmatched' ? { color: '#faad14' } : undefined
                }
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Toolbar */}
      <Card
        size="small"
        title={`${results.length} VMs`}
        extra={
          <Space wrap>
            <Input
              placeholder="Search name, IP, hostname, MAC…"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onPressEnter={onSearch}
              allowClear
              style={{ width: 250 }}
            />
            <Button icon={<SearchOutlined />} onClick={onSearch}>Search</Button>
            <Button icon={<ReloadOutlined />} onClick={() => load()} />
            <Button icon={<DownloadOutlined />} onClick={onExport}>Export CSV</Button>
          </Space>
        }
      >
        {loading
          ? <Spin style={{ display: 'block', margin: '60px auto' }} />
          : results.length === 0
            ? (
              <Empty
                description={
                  <span>
                    {filter !== 'all'
                      ? `No VMs in the "${filter}" filter`
                      : 'No VM data — run a discovery first'
                    }
                  </span>
                }
                style={{ margin: '40px 0' }}
              />
            )
            : (
              <Table
                size="small"
                rowKey="id"
                dataSource={results}
                columns={columns}
                scroll={{ x: 1700 }}
                rowClassName={r => r.has_edit ? 'asset-edited-row' : ''}
                pagination={{ pageSize: 50, showSizeChanger: false, showTotal: t => `${t} total` }}
              />
            )
        }
      </Card>

      {/* Edit drawer */}
      <Drawer
        title={
          <Space>
            <EditOutlined />
            <span>Edit Asset: <Text code>{editTarget?.name}</Text></span>
          </Space>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={onSave}>Save</Button>
          </Space>
        }
        destroyOnClose
      >
        {editTarget && (
          <>
            {/* Read-only discovery info */}
            <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Text type="secondary" style={{ width: 90, fontSize: 12 }}>VM IPs:</Text>
                  <span style={{ fontSize: 12 }}>
                    {(editTarget.ips || []).join(', ') || '—'}
                  </span>
                </div>
                {editTarget.mapped_ips && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Text type="secondary" style={{ width: 90, fontSize: 12 }}>Mapped IP:</Text>
                    <span style={{ color: '#52c41a', fontWeight: 500, fontSize: 12 }}>
                      <LinkOutlined style={{ marginRight: 4 }} />
                      {editTarget.mapped_ips}
                    </span>
                  </div>
                )}
                {editTarget.lan_segment && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Text type="secondary" style={{ width: 90, fontSize: 12 }}>LAN:</Text>
                    <Text style={{ fontSize: 12 }}>{editTarget.lan_segment}</Text>
                  </div>
                )}
                {editTarget.vlan_group && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Text type="secondary" style={{ width: 90, fontSize: 12 }}>VLAN:</Text>
                    <Text style={{ fontSize: 12 }}>{editTarget.vlan_group}</Text>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Text type="secondary" style={{ width: 90, fontSize: 12 }}>MACs:</Text>
                  <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {(editTarget.macs || []).join(', ') || '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Text type="secondary" style={{ width: 90, fontSize: 12 }}>Power:</Text>
                  {powerTag(editTarget.power_state)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Text type="secondary" style={{ width: 90, fontSize: 12 }}>Source:</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{editTarget.source_host || '—'}</Text>
                </div>
                {editTarget.has_edit && editTarget.edit.updated_at && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>
                    Last edited: {editTarget.edit.updated_at}
                  </div>
                )}
              </Space>
            </Card>

            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item name="asset_name" label="Asset Name">
                <Input placeholder={editTarget.name} allowClear />
              </Form.Item>
              <Form.Item name="ip_address" label="IP Address">
                <Input placeholder="e.g. 10.0.0.5" allowClear />
              </Form.Item>
              <Form.Item name="hostname" label="Hostname">
                <Input allowClear />
              </Form.Item>
              <Form.Item name="os_type" label="OS Type">
                <Input placeholder="e.g. Linux, Windows" allowClear />
              </Form.Item>
              <Form.Item name="os_version" label="OS Version">
                <Input allowClear />
              </Form.Item>
              <Form.Item name="notes" label="Notes">
                <Input.TextArea rows={3} allowClear placeholder="Optional notes…" />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>

      <style>{`
        .asset-edited-row td:first-child {
          border-left: 3px solid #52c41a;
        }
      `}</style>
    </div>
  );
}
