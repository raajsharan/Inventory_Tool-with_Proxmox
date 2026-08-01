import { useEffect, useState } from 'react';
import { Card, Table, Select, Space, Tag, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const ACTIONS = ['LOGIN','CREATE','UPDATE','DELETE','IMPORT','EXPORT'];

export default function AuditLogs() {
  const [data, setData] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [action, setAction] = useState();

  async function load() {
    const { data } = await api.get('/audit', { params: { page, pageSize, action } });
    setData(data);
  }
  useEffect(() => { load(); }, [page, pageSize, action]); // eslint-disable-line

  return (
    <Card className="dashcard"
      title={<Space><HistoryOutlined style={{ color: '#1677ff' }} /><Typography.Title level={4} style={{ margin: 0 }}>Audit Log</Typography.Title></Space>}
      extra={
        <Space>
          <Select allowClear placeholder="Action" style={{ width: 160 }}
            options={ACTIONS.map(a => ({ label: a, value: a }))} onChange={setAction} />
        </Space>
      }>
      <style>{DASH_CSS}</style>
      <Table
        rowKey="id"
        dataSource={data.items}
        rowClassName="dashcard-row"
        pagination={{ current: page, pageSize, total: data.total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        columns={[
          { title: 'When', dataIndex: 'created_at', width: 180, render: v => new Date(v).toLocaleString() },
          { title: 'User', dataIndex: 'user_email', width: 200 },
          { title: 'Action', dataIndex: 'action', width: 100, render: a => <Tag>{a}</Tag> },
          { title: 'Entity', dataIndex: 'entity_type', width: 120 },
          { title: 'Entity ID', dataIndex: 'entity_id', width: 280, render: v => <code style={{ fontSize: 12 }}>{v}</code> },
          { title: 'Details', dataIndex: 'details', render: v => v ? <code style={{ fontSize: 12 }}>{JSON.stringify(v)}</code> : '—' },
          { title: 'IP', dataIndex: 'ip_address', width: 140 },
        ]}
      />
    </Card>
  );
}
