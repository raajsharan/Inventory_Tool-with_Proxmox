import { useEffect, useState } from 'react';
import {
  Card, Select, Table, Input, Button, Space, Typography, App, Alert, Tag, Popconfirm, Empty,
} from 'antd';
import { SwapOutlined, SearchOutlined, ArrowRightOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const { Text } = Typography;

const INVENTORIES = {
  assets:         { label: 'Asset Inventory',      apiPath: '/assets' },
  beijing_assets: { label: 'Beijing Asset List',   apiPath: '/beijing-assets' },
  ext_assets:     { label: 'Ext. Asset Inventory', apiPath: '/ext-assets' },
};
const INVENTORY_OPTS = Object.entries(INVENTORIES).map(([value, m]) => ({ value, label: m.label }));

const columns = [
  { title: 'VM Name',       dataIndex: 'vm_name',       ellipsis: true },
  { title: 'IP Address',    dataIndex: 'ip_address',    width: 150 },
  { title: 'Asset Type',    dataIndex: 'asset_type',    width: 130 },
  { title: 'Server Status', dataIndex: 'server_status', width: 130 },
];

export default function AssetTransfer() {
  const { message } = App.useApp();
  const [source, setSource] = useState('ext_assets');
  const [target, setTarget] = useState('assets');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [transferring, setTransferring] = useState(false);
  const [result, setResult] = useState(null); // { moved, failed }
  const pageSize = 20;

  async function load() {
    setLoading(true);
    setResult(null);
    setSelectedIds([]);
    try {
      const { data } = await api.get(INVENTORIES[source].apiPath, {
        params: { search: search || undefined, page, pageSize },
      });
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load records');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [source, page]); // eslint-disable-line

  function onSourceChange(v) {
    setSource(v);
    setPage(1);
    if (v === target) setTarget(Object.keys(INVENTORIES).find(k => k !== v));
  }

  async function onTransfer() {
    setTransferring(true);
    setResult(null);
    try {
      const { data } = await api.post('/asset-transfer/transfer', { source, target, ids: selectedIds });
      setResult(data);
      if (data.moved.length) {
        message.success(`Moved ${data.moved.length} record(s) to ${INVENTORIES[target].label}`);
      }
      if (data.failed.length) {
        message.error(`${data.failed.length} record(s) failed to transfer`);
      }
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Transfer failed');
    } finally { setTransferring(false); }
  }

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      <Card
        size="small"
        className="dashcard"
        title={<Space><SwapOutlined /><span>Transfer Assets Between Inventories</span></Space>}
      >
        <Space align="center" wrap style={{ marginBottom: 16 }}>
          <Text type="secondary">From</Text>
          <Select value={source} onChange={onSourceChange} options={INVENTORY_OPTS} style={{ width: 220 }} />
          <ArrowRightOutlined />
          <Text type="secondary">To</Text>
          <Select
            value={target}
            onChange={setTarget}
            style={{ width: 220 }}
            options={INVENTORY_OPTS.filter(o => o.value !== source)}
          />
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search VM name, IP…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onPressEnter={() => { setPage(1); load(); }}
            allowClear
            style={{ width: 240 }}
          />
          <Button onClick={() => { setPage(1); load(); }}>Search</Button>
        </Space>

        {result && (
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            {result.moved.length > 0 && (
              <Alert
                type="success"
                showIcon
                message={`Moved ${result.moved.length} record(s) to ${INVENTORIES[target].label}`}
                description={result.moved.map(m => m.vm_name).join(', ')}
              />
            )}
            {result.failed.length > 0 && (
              <Alert
                type="error"
                showIcon
                message={`${result.failed.length} record(s) failed`}
                description={
                  <Space direction="vertical" size={2}>
                    {result.failed.map(f => (
                      <span key={f.id}>
                        {f.error}
                        {f.recoverable && (
                          <Tag color="orange" style={{ marginLeft: 6 }}>
                            removed from source — restore from Recycle Bin and retry
                          </Tag>
                        )}
                      </span>
                    ))}
                  </Space>
                }
              />
            )}
          </Space>
        )}

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: setSelectedIds,
          }}
          locale={{ emptyText: <Empty description={`No records in ${INVENTORIES[source].label}`} /> }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: setPage,
            showTotal: t => `${t} total`,
          }}
        />

        <Space style={{ marginTop: 16 }}>
          <Popconfirm
            title={`Move ${selectedIds.length} record(s) to ${INVENTORIES[target]?.label}?`}
            description="Each record is removed from the source inventory (recoverable via Recycle Bin) and re-created in the target."
            onConfirm={onTransfer}
            okText="Transfer"
            disabled={!selectedIds.length}
          >
            <Button
              type="primary"
              icon={<SwapOutlined />}
              disabled={!selectedIds.length}
              loading={transferring}
            >
              Transfer {selectedIds.length > 0 ? `${selectedIds.length} Selected` : ''} to {INVENTORIES[target]?.label}
            </Button>
          </Popconfirm>
        </Space>
      </Card>
    </div>
  );
}
