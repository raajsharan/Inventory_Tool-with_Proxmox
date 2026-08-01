import { useEffect, useState } from 'react';
import {
  Card, Tabs, Switch, Typography, Space, Button, App, Tag, Row, Col, Divider, Alert, Tooltip,
} from 'antd';
import { SaveOutlined, ReloadOutlined, EyeOutlined, EyeInvisibleOutlined, ControlOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

export default function FieldVisibility() {
  const { message } = App.useApp();
  const [pages, setPages] = useState([]);
  const [active, setActive] = useState('assets');
  const [hidden, setHidden] = useState([]);
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/field-visibility')
      .then(r => setPages(r.data.items || []))
      .catch(e => message.error(e.response?.data?.error || 'Failed to load pages'));
  }, []);

  useEffect(() => { load(active); }, [active]); // eslint-disable-line

  async function load(pageKey) {
    setLoading(true);
    try {
      const { data } = await api.get(`/field-visibility/${pageKey}`);
      setFields(data.fields || []);
      setHidden(data.hidden || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }

  function toggle(key) {
    setHidden(h => h.includes(key) ? h.filter(k => k !== key) : [...h, key]);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/field-visibility/${active}`, { hidden });
      message.success('Saved');
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  // Group fields by section preserving order.
  const grouped = [];
  const seenSections = new Map();
  for (const f of fields) {
    const sec = f.section || 'General';
    if (!seenSections.has(sec)) {
      seenSections.set(sec, grouped.length);
      grouped.push({ name: sec, fields: [] });
    }
    grouped[seenSections.get(sec)].fields.push(f);
  }

  const shownCount = fields.length - hidden.length;

  return (
    <Card
      className="dashcard"
      title={<Space><ControlOutlined style={{ color: '#1677ff' }} /><Typography.Title level={4} style={{ margin: 0 }}>Field Customization</Typography.Title></Space>}
      extra={
        <Space>
          <Tag color="blue">{shownCount} shown</Tag>
          <Tag>{hidden.length} hidden</Tag>
          <Tooltip title="Discard unsaved changes and reload"><Button icon={<ReloadOutlined />} onClick={() => load(active)} loading={loading}>Reload</Button></Tooltip>
          <Tooltip title="Apply field visibility changes"><Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>Save</Button></Tooltip>
        </Space>
      }
    >
      <style>{DASH_CSS}</style>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Toggle a field off to hide it from the Add/Edit form and list columns for that page. Required fields cannot be hidden."
      />

      <Tabs
        activeKey={active}
        onChange={setActive}
        items={pages.map(p => ({ key: p.key, label: p.label }))}
      />

      {grouped.map((g, gi) => (
        <div key={g.name} className="dashcard" style={{ marginBottom: 16, animationDelay: `${gi * 50}ms` }}>
          <Divider orientation="left" style={{ fontSize: 12, letterSpacing: 1, color: '#94a3b8', textTransform: 'uppercase' }}>
            {g.name}
          </Divider>
          <Row gutter={[16, 12]}>
            {g.fields.map(f => {
              const isHidden = hidden.includes(f.key);
              return (
                <Col xs={24} md={12} lg={8} key={f.key}>
                  <Space>
                    <Switch
                      checked={!isHidden}
                      disabled={f.required}
                      onChange={() => toggle(f.key)}
                      checkedChildren={<EyeOutlined />}
                      unCheckedChildren={<EyeInvisibleOutlined />}
                    />
                    <span style={{ color: isHidden ? '#94a3b8' : 'inherit', textDecoration: isHidden ? 'line-through' : 'none' }}>
                      {f.label}
                    </span>
                    {f.required && <Tag color="red">required</Tag>}
                  </Space>
                </Col>
              );
            })}
          </Row>
        </div>
      ))}
    </Card>
  );
}
