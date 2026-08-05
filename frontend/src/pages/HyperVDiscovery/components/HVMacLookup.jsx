import { useEffect, useState, useCallback } from 'react';
import {
  Card, Row, Col, Statistic, Table, Tag, Tooltip, Input, Select, Button, Space, Empty, Spin, Alert,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, SearchOutlined,
  ReloadOutlined, DownloadOutlined, LinkOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Option } = Select;

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Off')     return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  if (s === 'Saved')   return <Tag color="processing">Saved</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

export default function HVMacLookup() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [search,      setSearch]      = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');

  const load = useCallback((q = search, mf = matchFilter, sf = stateFilter) => {
    setLoading(true);
    const params = {};
    if (q)  params.search      = q;
    if (mf) params.matchFilter = mf;
    if (sf) params.state       = sf;
    api.get('/hyperv/mac-lookup', { params })
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load MAC lookup data.'))
      .finally(() => setLoading(false));
  }, [search, matchFilter, stateFilter]); // eslint-disable-line

  useEffect(() => { load(); }, []); // eslint-disable-line

  function onSearch() { load(search, matchFilter, stateFilter); }

  async function onExport() {
    const token = localStorage.getItem('token');
    const resp  = await fetch('/api/hyperv/mac-lookup/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hyperv_mac_lookup.csv';
    a.click();
  }

  const columns = [
    {
      title: 'Name', dataIndex: 'name', key: 'name', width: 180,
      render: v => <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v}</span>,
    },
    { title: 'Hostname', dataIndex: 'hostname', key: 'hostname', ellipsis: true, width: 160 },
    { title: 'OS Type', dataIndex: 'os_type', key: 'os_type', ellipsis: true, width: 140 },
    {
      title: 'IPs', dataIndex: 'ips', key: 'ips', width: 160,
      render: ips => (Array.isArray(ips) ? ips.filter(ip => ip !== 'Not Available').join(', ') : '') || <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'MAC Address(es)', dataIndex: 'macs', key: 'macs', width: 200,
      render: (macs, row) => {
        const list = Array.isArray(macs) ? macs.filter(m => m && m !== 'Not Available') : [];
        if (!list.length) return <span style={{ color: '#bfbfbf' }}>—</span>;
        const matchedSet = new Set(row.matched_macs || []);
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {list.map(mac => (
              <Tag
                key={mac}
                style={{ fontFamily: 'monospace', fontSize: 11 }}
                color={matchedSet.has(mac) ? 'success' : undefined}
              >
                {mac}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Mapped IP(s)',
      dataIndex: 'mapped_ips',
      key: 'mapped_ips',
      width: 180,
      render: v => v
        ? <span style={{ color: '#52c41a', fontWeight: 500 }}>{v}</span>
        : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'LAN / VLAN', key: 'lan', width: 160,
      render: (_, row) => {
        const parts = [row.lan_segment, row.vlan_group].filter(Boolean);
        return parts.length ? parts.join(' / ') : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    {
      title: 'Data Retrieved', dataIndex: 'data_retrieved', key: 'data_retrieved', width: 140,
      render: v => v || <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'Match', dataIndex: 'is_matched', key: 'is_matched', width: 80, align: 'center',
      render: v => v
        ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
        : <CloseCircleOutlined style={{ color: '#d9d9d9', fontSize: 16 }} />,
    },
    {
      title: 'State', dataIndex: 'state', key: 'state', width: 90,
      render: stateTag,
    },
    { title: 'Source', dataIndex: 'source_host', key: 'source_host', ellipsis: true, width: 140 },
  ];

  const stats = data?.stats || {};
  const hasMapping = stats.has_mapping;

  return (
    <div style={{ padding: 16 }}>
      {error && <Alert type="error" showIcon message="Couldn't load MAC lookup data" description={error} style={{ marginBottom: 16 }} />}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          { title: 'Total VMs',       value: stats.total          ?? 0, color: undefined },
          { title: 'Matched',         value: stats.matched        ?? 0, color: '#52c41a' },
          { title: 'Unmatched',       value: stats.unmatched      ?? 0, color: '#faad14' },
          { title: 'Mapping Entries', value: stats.mapping_entries ?? 0, color: undefined },
        ].map(s => (
          <Col key={s.title} xs={12} sm={6}>
            <Card size="small">
              <Statistic
                title={s.title}
                value={s.value}
                valueStyle={s.color ? { color: s.color } : undefined}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {!error && !hasMapping && !loading && (
        <Empty
          description="No mapping file uploaded yet — go to VMware Discovery → Upload Mapping to add one (mapping applies across all hypervisors)."
          style={{ margin: '40px 0' }}
        >
          <LinkOutlined style={{ fontSize: 32, color: '#d9d9d9' }} />
        </Empty>
      )}

      {!error && hasMapping && (
        <Card
          size="small"
          title={`${stats.total ?? 0} VMs`}
          extra={
            <Space wrap>
              <Input
                placeholder="Search name, IP, MAC…"
                prefix={<SearchOutlined />}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onPressEnter={onSearch}
                allowClear
                style={{ width: 220 }}
              />
              <Select
                placeholder="Match"
                allowClear
                value={matchFilter || undefined}
                onChange={v => { setMatchFilter(v || ''); load(search, v || '', stateFilter); }}
                style={{ width: 140 }}
              >
                <Option value="matched">Matched only</Option>
                <Option value="unmatched">Unmatched only</Option>
              </Select>
              <Select
                placeholder="State"
                allowClear
                value={stateFilter || undefined}
                onChange={v => { setStateFilter(v || ''); load(search, matchFilter, v || ''); }}
                style={{ width: 130 }}
              >
                <Option value="Running">Running</Option>
                <Option value="Off">Stopped</Option>
                <Option value="Paused">Paused</Option>
                <Option value="Saved">Saved</Option>
              </Select>
              <Button icon={<SearchOutlined />} onClick={onSearch}>Search</Button>
              <Button icon={<ReloadOutlined />} onClick={() => load()} />
              <Button icon={<DownloadOutlined />} onClick={onExport}>Export CSV</Button>
            </Space>
          }
        >
          {loading
            ? <Spin style={{ display: 'block', margin: '60px auto' }} />
            : (
              <Table
                size="small"
                rowKey="id"
                dataSource={data?.results || []}
                columns={columns}
                scroll={{ x: 1600 }}
                sticky={{ offsetScroll: 0 }}
                pagination={{ pageSize: 50, showSizeChanger: false, showTotal: t => `${t} total` }}
                rowClassName={r => r.is_matched ? 'mac-matched-row' : ''}
              />
            )
          }
        </Card>
      )}
    </div>
  );
}
