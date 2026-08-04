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

function powerTag(state) {
  if (state === 'poweredOn')  return <Tag color="success">On</Tag>;
  if (state === 'poweredOff') return <Tag color="default">Off</Tag>;
  if (state === 'suspended')  return <Tag color="warning">Suspended</Tag>;
  return <Tag>{state || '—'}</Tag>;
}

export default function VMMacLookup() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [powerFilter, setPowerFilter] = useState('');
  const [error,       setError]       = useState(null);

  const load = useCallback((q = search, mf = matchFilter, pf = powerFilter) => {
    setLoading(true);
    const params = {};
    if (q)  params.search      = q;
    if (mf) params.matchFilter = mf;
    if (pf) params.powerState  = pf;
    api.get('/vmware/mac-lookup', { params })
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load MAC lookup data.'))
      .finally(() => setLoading(false));
  }, [search, matchFilter, powerFilter]); // eslint-disable-line

  useEffect(() => { load(); }, []); // eslint-disable-line

  function onSearch() { load(search, matchFilter, powerFilter); }

  async function onExport() {
    const token = localStorage.getItem('token');
    const resp  = await fetch('/api/vmware/mac-lookup/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mac_lookup.csv';
    a.click();
  }

  const columns = [
    {
      title: 'VM Name', dataIndex: 'name', key: 'name', ellipsis: true, width: 180,
      render: v => <Tooltip title={v}>{v}</Tooltip>,
    },
    { title: 'Hostname', dataIndex: 'hostname', key: 'hostname', ellipsis: true, width: 160 },
    { title: 'ESXi Host', dataIndex: 'esxi_host_name', key: 'esxi_host_name', ellipsis: true, width: 160 },
    { title: 'OS Type', dataIndex: 'os_type', key: 'os_type', ellipsis: true, width: 140 },
    {
      title: 'VM IPs', dataIndex: 'ips', key: 'ips', width: 160,
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
      title: 'Power', dataIndex: 'power_state', key: 'power_state', width: 90,
      render: powerTag,
    },
    { title: 'Source', dataIndex: 'source_host', key: 'source_host', ellipsis: true, width: 140 },
  ];

  const stats = data?.stats || {};
  const hasMapping = stats.has_mapping;

  return (
    <div style={{ padding: 16 }}>
      {/* Stat cards */}
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

      {error && <Alert type="error" showIcon message="Couldn't load MAC lookup data" description={error} style={{ marginBottom: 16 }} />}

      {!error && !hasMapping && !loading && (
        <Empty
          description="No mapping file uploaded yet — go to the Upload tab to add one."
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
                onChange={v => { setMatchFilter(v || ''); load(search, v || '', powerFilter); }}
                style={{ width: 140 }}
              >
                <Option value="matched">Matched only</Option>
                <Option value="unmatched">Unmatched only</Option>
              </Select>
              <Select
                placeholder="Power"
                allowClear
                value={powerFilter || undefined}
                onChange={v => { setPowerFilter(v || ''); load(search, matchFilter, v || ''); }}
                style={{ width: 130 }}
              >
                <Option value="poweredOn">Powered On</Option>
                <Option value="poweredOff">Powered Off</Option>
                <Option value="suspended">Suspended</Option>
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
                scroll={{ x: 1800 }}
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
