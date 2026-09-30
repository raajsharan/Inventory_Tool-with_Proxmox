import { Typography, Button, Tooltip, Result } from 'antd';
import { GlobalOutlined, ExportOutlined, InfoCircleOutlined } from '@ant-design/icons';

const { Title } = Typography;

// Two separate reasons a target can't be embedded, both needing
// `embeddable: false` since neither has a code-side fix:
// 1. Plain-http sign-in: its session cookie can only be SameSite=Lax/Strict
//    (SameSite=None requires Secure, i.e. HTTPS), and browsers block that
//    cookie in a cross-site iframe — sign-in silently fails.
// 2. The target sends X-Frame-Options/CSP frame-ancestors that refuse
//    framing outright (common on sign-in pages, for clickjacking
//    protection) — the iframe area just shows "<host> refused to connect."
// Either way, the page has to actually navigate there, so `embeddable:
// false` skips the iframe and leads with the one path that works.
export default function ExternalLinkPage({ title, url, embeddable = true }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            <GlobalOutlined style={{ marginRight: 8 }} />
            {title}
          </Title>
          {embeddable && (
            <Tooltip title="If the page below stays blank, the site is refusing to be embedded — use “Open in new tab” instead.">
              <InfoCircleOutlined style={{ color: '#8c8c8c', fontSize: 15 }} />
            </Tooltip>
          )}
        </div>
        <Button icon={<ExportOutlined />} href={url} target="_blank" rel="noreferrer">
          Open in new tab
        </Button>
      </div>

      {embeddable ? (
        <iframe
          title={title}
          src={url}
          style={{ flex: 1, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        />
      ) : (
        <Result
          icon={<GlobalOutlined />}
          title="Sign-in has to happen in its own tab"
          subTitle="This site's login only works on a real page load — embedded here, the browser blocks its session cookie and sign-in silently fails."
          extra={
            <Button type="primary" size="large" icon={<ExportOutlined />} href={url} target="_blank" rel="noreferrer">
              Open {title}
            </Button>
          }
          style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        />
      )}
    </div>
  );
}
