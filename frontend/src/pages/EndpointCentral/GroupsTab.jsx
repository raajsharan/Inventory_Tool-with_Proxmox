import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Input, Popconfirm, Progress, Space, Table, Tag, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, SyncOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Text } = Typography;

const dash = v => (v == null || v === '' ? <Text type="secondary">-</Text> : v);
const fmt  = v => (v ? new Date(v).toLocaleString() : null);

function InInventory({ found }) {
  return found
    ? <span><CheckCircleFilled style={{ color: '#52c41a' }} /> Found</span>
    : <span><CloseCircleFilled style={{ color: '#faad14' }} /> Not found</span>;
}

function Members({ group }) {
  const [rows, setRows]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (group.dynamic) return;
    setLoading(true);
    api.get(`/endpoint-central/groups/${group.group_id}/members`)
      .then(r => setRows(r.data.members || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [group.group_id, group.dynamic]);

  if (group.dynamic) {
    const c = group.criteria || {};
    const list = Array.isArray(c.criteriaList) ? c.criteriaList : [];
    return (
      <div>
        <Text>Members are computed by Endpoint Central for dynamic groups.</Text>
        <div style={{ marginTop: 8 }}>
          {c.criteriaPattern && <Tag>Pattern: {String(c.criteriaPattern)}</Tag>}
          {list.map((x, i) => <Tag key={i}>{typeof x === 'object' ? JSON.stringify(x) : String(x)}</Tag>)}
          {!c.criteriaPattern && !list.length && <Text type="secondary">Rule not available.</Text>}
        </div>
      </div>
    );
  }
  return (
    <Table
      size="small" rowKey="resource_id" loading={loading} dataSource={rows || []}
      pagination={rows && rows.length > 20 ? { pageSize: 20 } : false}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: 'Computer', dataIndex: 'name', render: dash },
        { title: 'Domain', dataIndex: 'domain', render: dash },
        { title: 'OS', dataIndex: 'os_platform', render: dash },
        { title: 'In your records', dataIndex: 'in_inventory', render: v => <InInventory found={v} /> },
      ]}
    />
  );
}

export default function GroupsTab({ canSync, onSynced }) {
  const { message } = App.useApp();
  const [groups, setGroups]   = useState([]);
  const [sync, setSync]       = useState({ progress: { running: false }, last_result: null });
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/endpoint-central/groups');
      setGroups(r.data.groups || []);
      setSync(r.data.sync);
    } catch (e) {
      message.error(e?.response?.data?.error || 'Failed to load custom groups');
    } finally { setLoading(false); }
  }, [message]);

  useEffect(() => { load(); }, [load]);

  const running = !!sync.progress?.running;

  // Poll progress every 2 s while a sync runs; refresh groups + computers when it ends
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) { wasRunning.current = false; load(); onSynced?.(); }
      return undefined;
    }
    wasRunning.current = true;
    const t = setInterval(async () => {
      try { setSync((await api.get('/endpoint-central/groups/sync')).data); } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(t);
  }, [running, load, onSynced]);

  const start = async (force) => {
    try {
      const r = await api.post('/endpoint-central/groups/sync', { force });
      setSync(r.data);
    } catch (e) {
      message.error(e?.response?.data?.error || 'Could not start the sync');
    }
  };

  const p = sync.progress || {};
  const last = sync.last_result;
  const filtered = groups.filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button type="primary" icon={<SyncOutlined spin={running} />} disabled={running || !canSync} onClick={() => start(false)}>
            Sync now
          </Button>
          <Popconfirm
            title="Re-fetch every group from Endpoint Central?"
            description="Uses one call per group (EC allows 30 a minute), so this can take a while."
            onConfirm={() => start(true)} disabled={running || !canSync}
          >
            <Button disabled={running || !canSync}>Full re-sync</Button>
          </Popconfirm>
          <Input.Search placeholder="Search groups…" allowClear style={{ width: 240 }}
            value={search} onChange={e => setSearch(e.target.value)} />
        </Space>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Groups are copied in the background (EC allows 30 group calls a minute).
          </Text>
        </div>
        {running && (
          <div style={{ marginTop: 8, maxWidth: 420 }}>
            <Text>{p.phase === 'listing' ? 'Reading group list…' : `Fetching members: ${p.done} of ${p.total}`}</Text>
            <Progress percent={p.total ? Math.round((p.done / p.total) * 100) : 0} size="small" />
          </div>
        )}
      </Card>

      {!running && last && (
        <Alert
          type={last.ok === false ? 'error' : last.errors?.length ? 'warning' : 'success'} showIcon
          style={{ marginBottom: 12 }}
          message={last.message}
          description={last.errors?.length
            ? last.errors.filter(e => e.group).map(e => `${e.group}: ${e.error}`).join('; ') || undefined
            : undefined}
        />
      )}
      {!groups.length && !running && !loading && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="No custom groups synced yet"
          description={canSync ? 'Press "Sync now" to copy the groups from Endpoint Central.' : 'Ask an administrator to run a sync.'} />
      )}

      <Table
        size="small" rowKey="group_id" loading={loading} dataSource={filtered}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} groups` }}
        expandable={{ expandedRowRender: g => <Members group={g} /> }}
        columns={[
          { title: 'Group', dataIndex: 'name', render: v => <Text strong>{v}</Text>, sorter: (a, b) => a.name.localeCompare(b.name) },
          { title: 'Type', dataIndex: 'group_type', render: dash },
          { title: 'Category', dataIndex: 'category', render: dash },
          { title: 'Domain', dataIndex: 'domain', render: dash },
          { title: 'Members', dataIndex: 'member_count', align: 'right',
            render: (v, g) => v != null ? v : g.dynamic ? <Text type="secondary">by EC rule</Text> : dash(null) },
          { title: 'Changed in EC', dataIndex: 'modified_on', render: v => dash(fmt(v)) },
          { title: 'Last synced', dataIndex: 'members_synced_at', render: v => dash(fmt(v)) },
        ]}
      />
    </>
  );
}
