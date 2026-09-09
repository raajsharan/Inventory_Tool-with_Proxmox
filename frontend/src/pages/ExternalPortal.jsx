import { Typography, Button, Alert } from 'antd';
import { GlobalOutlined, ExportOutlined } from '@ant-design/icons';

const { Title } = Typography;

const EXTERNAL_URL = 'http://192.168.84.103/sign-in';

export default function ExternalPortal() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <GlobalOutlined style={{ marginRight: 8 }} />
          External Portal
        </Title>
        <Button icon={<ExportOutlined />} href={EXTERNAL_URL} target="_blank" rel="noreferrer">
          Open in new tab
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="If the page below stays blank, the site is refusing to be embedded — use “Open in new tab” instead."
      />

      <iframe
        title="External Portal"
        src={EXTERNAL_URL}
        style={{ width: '100%', height: 'calc(100vh - 260px)', minHeight: 400, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
      />
    </div>
  );
}
