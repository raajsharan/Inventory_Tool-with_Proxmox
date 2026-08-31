import { useEffect, useState } from 'react';
import { Card, Table, Tag, Modal, Typography, Button, Space, Tooltip } from 'antd';
import { EyeOutlined, ImportOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

export default function ImportHistory() {
  const [data, setData] = useState([]);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    api.get('/imports').then(r => setData(r.data.items));
  }, []);

  async function openDetail(id) {
    const { data } = await api.get(`/imports/${id}`);
    setDetail(data);
  }

  return (
    <Card className="dashcard"
      title={<Space><ImportOutlined style={{ color: '#1677ff' }} /><Typography.Title level={4} style={{ margin: 0 }}>Import History</Typography.Title></Space>}>
      <style>{DASH_CSS}</style>
      <Table
        rowKey="id"
        dataSource={data}
        rowClassName="dashcard-row"
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'When', dataIndex: 'created_at', render: v => new Date(v).toLocaleString() },
          { title: 'File', dataIndex: 'filename' },
          { title: 'Total', dataIndex: 'total_rows', width: 80 },
          { title: 'Success', dataIndex: 'success_rows', width: 100, render: v => <Tag color="green">{v}</Tag> },
          { title: 'Failed', dataIndex: 'failed_rows', width: 100, render: v => <Tag color={v ? 'red' : 'default'}>{v}</Tag> },
          { title: 'Actions', width: 100, render: (_, r) => (
            <Tooltip title="View full import detail"><Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)}>Detail</Button></Tooltip>
          ) },
        ]}
      />
      <Modal open={!!detail} title="Import Detail" onCancel={() => setDetail(null)} footer={null} width={800}>
        {detail && (
          <pre style={{ maxHeight: 500, overflow: 'auto', fontSize: 12 }}>
            {JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </Modal>
    </Card>
  );
}
