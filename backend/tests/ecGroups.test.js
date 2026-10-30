// Run with: node --test tests/
const test   = require('node:test');
const assert = require('node:assert');
const http   = require('node:http');

const svc = require('../src/services/ecGroupsService');

// ── Fake Endpoint Central ───────────────────────────────────────────────────
// Follows the response formats documented for the group APIs. `limit` mimics
// EC's rate limit: more than `limit.max` calls inside `limit.windowMs` → 429.
function fakeEc(groups, { limit } = {}) {
  const state = { groups, calls: [], stamps: [], rejected429: 0, emptyList: false };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const now = Date.now();
    state.stamps = state.stamps.filter(t => now - t < (limit?.windowMs ?? 0));
    if (limit && state.stamps.length >= limit.max) {
      state.rejected429++;
      res.writeHead(429); return res.end('{"error":"too many calls"}');
    }
    state.stamps.push(now);
    state.calls.push(url.pathname);
    const send = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

    if (url.pathname === '/api/1.4/customgroup/getCGList') {
      if (state.emptyList || !state.groups.length) { res.writeHead(204); return res.end(); }
      return send({ message_response: { getcglist: { response: { result: { cg_list: state.groups.map(g => ({
        groupId: g.id, groupName: g.name, groupType: g.type, groupCategory: 'Computer',
        domainName: '--', createdOn: 1700000000000, modifiedOn: g.modified,
      })) } } } } });
    }
    if (url.pathname === '/api/1.4/customgroup/getCGDetails') {
      const g = state.groups.find(x => x.name === url.searchParams.get('cgName'));
      if (!g) { res.writeHead(404); return res.end('{}'); }
      const result = /dynamic/i.test(g.type)
        ? { criteriaPattern: '1 AND 2', criteriaList: [{ field: 'OS', value: 'Windows' }] }
        : { groupMembers: [{ resourceId: 301, name: 'WEB-01', domainName: 'corp', osPlatform: 1 }] };
      return send({ message_response: { getcgdetails: { response: { result } } } });
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({
    state, config: { server_url: `http://127.0.0.1:${server.address().port}`, api_key: 'k', auth_mode: 'api_key' },
    close: () => new Promise(c => server.close(c)),
  })));
}

// ── In-memory store replacing the SQL one ───────────────────────────────────
function memStore() {
  const groups = new Map();
  return {
    groups,
    async existingGroups() { return new Map([...groups].map(([k, v]) => [k, { ...v }])); },
    async upsertGroups(list) {
      for (const g of list) groups.set(String(g.group_id), { ...(groups.get(String(g.group_id)) || {}), ...g });
    },
    async deleteGroupsExcept(ids) {
      const keep = new Set(ids.map(String));
      for (const k of [...groups.keys()]) if (!keep.has(k)) groups.delete(k);
    },
    async replaceMembers(g, members, criteria) {
      Object.assign(groups.get(String(g.group_id)), {
        members_synced_modified: g.modified_on, members,
        member_count: criteria ? null : members.length, criteria,
      });
    },
  };
}

const G = (id, name, type, modified = 1) => ({ id, name, type, modified });
const noThrottle = async () => {};

test('status codes map exactly and "--" becomes null', () => {
  assert.strictEqual(svc.LIVE_STATUS[3], 'Unknown');
  assert.strictEqual(svc.LIVE_STATUS[1], 'Live');
  assert.strictEqual(svc.INSTALL_STATUS[29], 'Installation failed');
  assert.strictEqual(svc.INSTALL_STATUS[22], 'Installed');
  assert.strictEqual(svc.label(svc.OS_PLATFORM, 3), 'Linux');
  assert.strictEqual(svc.label(svc.APPROVAL, 3), 'Pending');
  assert.strictEqual(svc.nullify('--'), null);
  assert.strictEqual(svc.epochToIso('1700000000000'), '2023-11-14T22:13:20.000Z');
  const s = svc.normalizeStaged({ computerName: 'PC-1', ipAddress: '--', macAddress: '--', approvalStatus: 3 });
  assert.strictEqual(s.ip_address, null);
  assert.strictEqual(s.approval_status, 'Pending');
});

test('first sync: 1 list call + 1 details call per computer group (Users skipped)', async () => {
  const ec = await fakeEc([G(1, 'Servers', 'Static'), G(2, 'Lab', 'Static Unique'), G(3, 'Admins', 'Users')]);
  const st = memStore();
  const r = await svc.runSync({ config: ec.config, throttle: noThrottle, store: st });
  await ec.close();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calls, 3);                       // 1 list + 2 details
  assert.strictEqual(st.groups.size, 3);                // Users group is stored, just not fetched
  assert.strictEqual(st.groups.get('1').member_count, 1);
});

test('second sync with nothing changed = 1 call; one changed group = 2; forced = all', async () => {
  const groups = [G(1, 'Servers', 'Static'), G(2, 'Lab', 'Static')];
  const ec = await fakeEc(groups);
  const st = memStore();
  await svc.runSync({ config: ec.config, throttle: noThrottle, store: st });

  assert.strictEqual((await svc.runSync({ config: ec.config, throttle: noThrottle, store: st })).calls, 1);

  groups[1].modified = 99;
  assert.strictEqual((await svc.runSync({ config: ec.config, throttle: noThrottle, store: st })).calls, 2);

  assert.strictEqual((await svc.runSync({ force: true, config: ec.config, throttle: noThrottle, store: st })).calls, 3);
  await ec.close();
});

test('with a throttle the sync never triggers a 429', async () => {
  const groups = Array.from({ length: 5 }, (_, i) => G(i + 1, `G${i}`, 'Static'));
  const ec = await fakeEc(groups, { limit: { max: 3, windowMs: 1500 } });
  const r = await svc.runSync({
    config: ec.config, store: memStore(),
    throttle: svc.createThrottle(3, 1500),
  });
  await ec.close();
  assert.strictEqual(ec.state.rejected429, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fetched, 5);
});

test('without a throttle the fake returns 429 and the sync stops with a clear message', async () => {
  const groups = Array.from({ length: 5 }, (_, i) => G(i + 1, `G${i}`, 'Static'));
  const ec = await fakeEc(groups, { limit: { max: 3, windowMs: 1500 } });
  const r = await svc.runSync({ config: ec.config, throttle: noThrottle, store: memStore() });
  await ec.close();
  assert.ok(ec.state.rejected429 >= 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /wait 5 minutes/);
});

test('dynamic group stores its rule and has member_count NULL', async () => {
  const ec = await fakeEc([G(7, 'Windows PCs', 'Dynamic')]);
  const st = memStore();
  await svc.runSync({ config: ec.config, throttle: noThrottle, store: st });
  await ec.close();
  const g = st.groups.get('7');
  assert.strictEqual(g.member_count, null);
  assert.deepStrictEqual(g.members, []);
  assert.strictEqual(g.criteria.criteriaPattern, '1 AND 2');
});

test('HTTP 204 from getCGList means no groups, not an error; deleted groups are removed', async () => {
  const groups = [G(1, 'Servers', 'Static')];
  const ec = await fakeEc(groups);
  const st = memStore();
  await svc.runSync({ config: ec.config, throttle: noThrottle, store: st });
  assert.strictEqual(st.groups.size, 1);
  groups.length = 0;
  const r = await svc.runSync({ config: ec.config, throttle: noThrottle, store: st });
  await ec.close();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(st.groups.size, 0);
});

test('one failing group is recorded and the sync continues', async () => {
  const groups = [G(1, 'Gone', 'Static'), G(2, 'Fine', 'Static')];
  const ec = await fakeEc(groups);
  const st = memStore();
  // make the first group's details 404 by renaming it after the list is served
  const orig = ec.state.groups.find;
  ec.state.groups = new Proxy(groups, {
    get: (t, p) => p === 'find' ? (fn) => t.find(x => x.name !== 'Gone' && fn(x)) : t[p],
  });
  const r = await svc.runSync({ config: ec.config, throttle: noThrottle, store: st });
  await ec.close();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].group, 'Gone');
  assert.strictEqual(r.fetched, 1);
  void orig;
});
