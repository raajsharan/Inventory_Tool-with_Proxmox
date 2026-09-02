import { useEffect, useState } from 'react';
import { Card, Typography, Input, Button, Space, Spin, App } from 'antd';
import { EditOutlined, SaveOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;

function SectionEditor({ section, onSaved }) {
  const { message } = App.useApp();
  const [value, setValue] = useState(section.content || '');
  const [saving, setSaving] = useState(false);
  const dirty = value !== (section.content || '');

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/weekly-report/manual-sections/${section.section_key}`, { content: value });
      message.success(`"${section.title}" saved`);
      onSaved(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={section.title}
      style={{ marginBottom: 16 }}
      extra={section.updated_at && <Text type="secondary" style={{ fontSize: 12 }}>Last updated {new Date(section.updated_at).toLocaleString()}</Text>}
    >
      <Input.TextArea
        value={value}
        onChange={e => setValue(e.target.value)}
        autoSize={{ minRows: 4, maxRows: 20 }}
        placeholder="Type this section's content — bullet lines, notes, links, or a small table typed as plain text."
      />
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>
          Save
        </Button>
      </Space>
    </Card>
  );
}

export default function WeeklyReportInputs() {
  const { message } = App.useApp();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/weekly-report/manual-sections')
      .then(r => setSections(r.data || []))
      .catch(() => message.error('Failed to load Weekly Report sections'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const onSaved = (updated) => {
    setSections(prev => prev.map(s => s.section_key === updated.section_key ? updated : s));
  };

  return (
    <div>
      <Title level={4} style={{ margin: 0 }}>
        <EditOutlined style={{ marginRight: 8 }} />
        Weekly Report Inputs
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
        Content for the sections the Weekly Report can't compute automatically — BAU activities, SOP
        count, licenses, migration challenges, and so on. Whatever is saved here is what the next
        Wednesday snapshot (and the live "Current" preview) will show for that section.
      </Text>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : (
        sections.map(s => <SectionEditor key={s.section_key} section={s} onSaved={onSaved} />)
      )}
    </div>
  );
}
