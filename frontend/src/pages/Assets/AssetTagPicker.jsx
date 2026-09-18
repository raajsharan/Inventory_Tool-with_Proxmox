import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Button, Select, Input, Space, Typography, Empty, Tag, Skeleton, Alert,
} from 'antd';
import {
  TagOutlined, ReloadOutlined, ThunderboltOutlined, EditOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

export default function AssetTagPicker({ value, onChange, department, apiPrefix = '/assets' }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('pick');

  async function load() {
    if (!department) { setStats(null); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`${apiPrefix}/tag-stats`, { params: { department } });
      setStats(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load tag stats');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [department]);

  if (!department) {
    return (
      <Input
        value={value || ''}
        onChange={e => onChange?.(e.target.value)}
        placeholder="Select a department first to use the picker"
      />
    );
  }

  return (
    <Card
      size="small"
      title={<Space><TagOutlined style={{ color: '#1677ff' }} /><strong style={{ color: '#1677ff' }}>Asset Tag</strong></Space>}
      extra={<Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={loading} />}
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      {loading && !stats && <Skeleton active paragraph={{ rows: 3 }} />}

      {stats && (
        <>
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="Range" value={`${stats.min}–${stats.max}`} valueStyle={{ fontSize: 18, textAlign: 'center' }} /></Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small"><Statistic title="Total Slots" value={stats.total} valueStyle={{ textAlign: 'center' }} /></Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" style={{ background: 'rgba(207,19,34,0.12)', borderColor: 'rgba(207,19,34,0.35)' }}>
                <Statistic title={<span style={{ color: '#cf1322' }}>Used</span>} value={stats.used} valueStyle={{ color: '#cf1322', textAlign: 'center' }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" style={{ background: 'rgba(56,158,13,0.12)', borderColor: 'rgba(56,158,13,0.35)' }}>
                <Statistic title={<span style={{ color: '#389e0d' }}>Available</span>} value={stats.available} valueStyle={{ color: '#389e0d', textAlign: 'center' }} />
              </Card>
            </Col>
          </Row>

          <Space style={{ marginBottom: 12 }} wrap>
            <Button type={mode === 'pick'   ? 'primary' : 'default'} icon={<UnorderedListOutlined />} onClick={() => setMode('pick')}>Pick from list</Button>
            <Button type={mode === 'manual' ? 'primary' : 'default'} icon={<EditOutlined />}          onClick={() => setMode('manual')}>Enter manually</Button>
          </Space>

          {mode === 'pick' ? (
            <Row gutter={16} align="bottom">
              <Col xs={24} md={14}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Asset Tag</Typography.Text>
                <Select
                  value={value && /^\d+$/.test(String(value)) ? Number(value) : undefined}
                  onChange={v => onChange?.(String(v))}
                  options={stats.availableAll.map(n => ({ value: n, label: String(n) }))}
                  placeholder="Select available tag…"
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%', marginTop: 4 }}
                  notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tags available" />}
                  virtual
                />
              </Col>
              <Col xs={24} md={10}>
                <Typography.Text style={{ fontSize: 12, color: '#1677ff' }}>
                  <ThunderboltOutlined /> Auto-assign next available
                </Typography.Text>
                <Space style={{ marginTop: 4 }}>
                  <Card
                    size="small"
                    style={{ background: 'rgba(22,119,255,0.12)', border: '1px solid rgba(22,119,255,0.35)', minWidth: 90, textAlign: 'center' }}
                    bodyStyle={{ padding: '6px 16px' }}
                  >
                    <span style={{ fontSize: 22, fontWeight: 600, color: '#1677ff' }}>
                      {stats.nextAvailable ?? '—'}
                    </span>
                  </Card>
                  <Button
                    type="primary"
                    disabled={!stats.nextAvailable}
                    onClick={() => onChange?.(String(stats.nextAvailable))}
                  >
                    Use this tag
                  </Button>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  Next available tag in {department}'s range
                </Typography.Text>
              </Col>
            </Row>
          ) : (
            <Input
              value={value || ''}
              onChange={e => onChange?.(e.target.value)}
              placeholder={`Enter a tag in ${stats.min}–${stats.max}`}
            />
          )}

          {stats.availableSample.length > 0 && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16 }}>
                Next 20 available tags
              </Typography.Text>
              <Space wrap size={[4, 4]} style={{ marginTop: 6 }}>
                {stats.availableSample.map(n => (
                  <Tag.CheckableTag
                    key={n}
                    checked={String(value) === String(n)}
                    onChange={() => onChange?.(String(n))}
                    style={{ border: '1px solid rgba(128,128,128,0.35)', padding: '2px 10px', borderRadius: 6 }}
                  >
                    {n}
                  </Tag.CheckableTag>
                ))}
              </Space>
            </>
          )}
        </>
      )}
    </Card>
  );
}
