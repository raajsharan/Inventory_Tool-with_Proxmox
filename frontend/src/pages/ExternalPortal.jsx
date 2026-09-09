import { Typography, Button, Tooltip } from 'antd';
import { GlobalOutlined, ExportOutlined, InfoCircleOutlined } from '@ant-design/icons';

const { Title } = Typography;

const EXTERNAL_URL = 'http://192.168.84.103/sign-in';

export default function ExternalPortal() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            <GlobalOutlined style={{ marginRight: 8 }} />
            DCIM-IPAM Link
          </Title>
          <Tooltip title="If the page below stays blank, the site is refusing to be embedded — use “Open in new tab” instead.">
            <InfoCircleOutlined style={{ color: '#8c8c8c', fontSize: 15 }} />
          </Tooltip>
        </div>
        <Button icon={<ExportOutlined />} href={EXTERNAL_URL} target="_blank" rel="noreferrer">
          Open in new tab
        </Button>
      </div>

      <iframe
        title="DCIM-IPAM Link"
        src={EXTERNAL_URL}
        style={{ flex: 1, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
      />
    </div>
  );
}
