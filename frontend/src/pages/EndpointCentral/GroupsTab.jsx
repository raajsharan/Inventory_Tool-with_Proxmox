import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, InputNumber, Popconfirm, Progress, Switch, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { Dash, found, orDash } from './common';

const errText = (e, fallback) => e?.response?.data?.error || fallback;

const ruleChips = (c) => {
  if (!c) return [];
  const list = Array.isArray(c.criteriaList) ? c.criteriaList : [];
  const parts = list.map((x) => (x && typeof x === 'object'
    ? Object.values(x).filter((v) => v !== null && v !== '' && typeof v !== 'object').join(' ')
    : String(x)));
  return [...(c.criteriaPattern ? [`Rule: ${c.criteriaPattern}`] : []), ...parts];
};

function Members({ group }) {
  const [rows, setRows] = useState(null);
  const [err, setErr]   = useState('');
  const users = /user/i.test(group.group_type || '');

  useEffect(() => {
    if (group.dynamic || users) return;
    api.get(`/endpoint-central/groups/${group.group_id}/members`)
      .then((r) => setRows(r.data.members)).catch((e) => setErr(errText(e, 'Could not load members')));
  }, [group.group_id, group.dynamic, users]);

  if (users) return <span className="nx-dim">Members of user groups are not copied.</span>;
  if (group.dynamic) {
    const chips = ruleChips(group.criteria);
    return (
      <div>
        <div>Members are computed by Endpoint Central.</div>
        {chips.length > 0
          ? <div style={{ marginTop: 6 }}>{chips.map((c, i) => <Tag key={i}>{c}</Tag>)}</div>
          : <div className="nx-dim">No rule was returned.</div>}
      </div>
    );
  }
  if (err) return <Alert type="error" showIcon message={err} />;
  return (
    <Table size="small" rowKey="resource_id" loading={rows === null} dataSource={rows || []} locale={{ emptyText: 'No members' }}
      pagination={rows && rows.length > 20 ? { defaultPageSize: 20 } : false}
      columns={[
        { title: 'Computer', dataIndex: 'name', render: orDash },
        { title: 'Domain', dataIndex: 'domain', render: orDash },
        { title: 'OS', dataIndex: 'os_platform', render: orDash },
        { title: 'In your records', render: (_, r) => found(r.in_inventory) },
      ]} />
  );
}

/** Group list, background sync with progress, and the members of each static group. */
export default function GroupsTab({ reload, onCount, onSynced }) {
  const { message } = App.useApp();
  const { user } = useAuth();
  const canWrite = ['admin', 'asset_manager', 'superadmin'].includes(user?.role);

  const [groups, setGroups] = useState([]);
  const [sync, setSync]     = useState({ progress: { running: false }, last_result: null });
  const [auto, setAuto]     = useState({ enabled: false, interval_minutes: 360 });
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState('');
  const was = useRef(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/endpoint-central/groups');
      setGroups(data.groups); setSync(data.sync); setAuto(data.auto);
      onCount?.(data.groups.length);
    } catch (e) { setErr(errText(e, 'Failed to load custom groups')); } finally { setLoading(false); }
  }, [onCount]);
  useEffect(() => { load(); }, [load, reload]);

  const running = !!sync.progress?.running;
  const p = sync.progress || {};

  // While a sync runs, poll its progress every 2 s; when it ends, refresh the groups and the computers.
  useEffect(() => {
    if (!running) {
      if (was.current) { was.current = false; load(); onSynced?.(); }
      return undefined;
    }
    was.current = true;
    const t = setInterval(() => api.get('/endpoint-central/groups/sync').then((r) => setSync(r.data)).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (force) => {
    try { setSync((await api.post('/endpoint-central/groups/sync', { force })).data); }
    catch (e) { message.error(errText(e, 'Could not start the sync')); load(); }
  };
  const saveAuto = async (next) => {
    try { setAuto((await api.put('/endpoint-central/groups/auto-sync', next)).data); message.success('Saved'); }
    catch (e) { message.error(errText(e, 'Could not save auto-sync')); }
  };

  const last = sync.last_result;
  const status = running
    ? <span>Syncing ({p.phase === 'members' ? `${p.done} of ${p.total} groups` : 'reading the group list'})</span>
    : last?.finished_at
      ? <span>Last sync {dayjs(last.finished_at).format('D MMM HH:mm')}: {last.fetched ?? 0} of {last.groups ?? 0} groups updated, {last.calls ?? 0} calls{last.errors?.length ? `, ${last.errors.length} failed` : ''}.</span>
      : <span className="nx-dim">Never synced.</span>;
  const groupErrors = (last?.errors || []).filter((e) => e.group);

  return (
    <div>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      {last && last.ok === false && !running && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="The last sync stopped early" description={last.message} />}
      {groupErrors.length > 0 && !running && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${groupErrors.length} group(s) could not be read`}
          description={groupErrors.slice(0, 5).map((e) => `${e.group}: ${e.error}`).join(' | ')} />
      )}
      <div className="nx-toolbar" style={{ gap: 12 }}>
        {canWrite && <>
          <Button type="primary" disabled={running} onClick={() => start(false)}>Sync now</Button>
          <Popconfirm title="Full re-sync reads every group again" okText="Full re-sync" onConfirm={() => start(true)} disabled={running}
            description="This uses many of Endpoint Central's 30 calls a minute and can take a while.">
            <Button disabled={running}>Full re-sync</Button>
          </Popconfirm>
        </>}
        <span>{status}</span>
        {running && p.total > 0 && <Progress style={{ width: 160 }} size="small" percent={Math.round((p.done * 100) / p.total)} />}
        <span style={{ flex: 1 }} />
        <span>Auto-sync every{' '}
          <InputNumber size="small" min={15} max={10080} value={auto.interval_minutes} disabled={!canWrite} style={{ width: 80 }}
            onChange={(v) => setAuto((a) => ({ ...a, interval_minutes: v }))}
            onBlur={() => canWrite && saveAuto({ enabled: auto.enabled, interval_minutes: auto.interval_minutes })} />{' '}
          min <Switch size="small" checked={auto.enabled} disabled={!canWrite} aria-label="Auto-sync"
            onChange={(v) => saveAuto({ enabled: v, interval_minutes: auto.interval_minutes })} />
        </span>
      </div>
      <div className="nx-dim nx-small" style={{ marginBottom: 8 }}>
        Groups are copied in the background (Endpoint Central allows 30 group calls a minute).
      </div>
      <Table rowKey="group_id" size="small" loading={loading} dataSource={groups} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], hideOnSinglePage: groups.length <= 25 }}
        expandable={{ expandedRowRender: (g) => <Members group={g} />, rowExpandable: () => true }}
        columns={[
          { title: 'Group', dataIndex: 'name', render: (v) => <b>{v}</b> },
          { title: 'Type', dataIndex: 'group_type', render: orDash },
          { title: 'Category', dataIndex: 'category', render: orDash },
          { title: 'Domain', dataIndex: 'domain', render: orDash },
          { title: 'Members', render: (_, g) => (g.member_count !== null ? g.member_count : g.dynamic ? <span className="nx-dim">computed by EC</span> : <Dash />) },
          { title: 'Changed in EC', dataIndex: 'modified_on', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : <Dash />) },
          { title: 'Last synced', dataIndex: 'members_synced_at', render: (v) => (v ? dayjs(v).format('D MMM HH:mm') : <Dash />) },
        ]} />
    </div>
  );
}
