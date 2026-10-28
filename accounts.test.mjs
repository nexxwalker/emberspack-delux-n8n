import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAccounts } from './accounts.mjs';

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'delux-accounts-test-'));
  let handle = createAccounts({ directory, ...options });
  const server = http.createServer(async (req, res) => {
    if (!(await handle(req, res, new URL(req.url, 'http://localhost')))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  async function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/account/${route}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-delux-request': '1',
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json();
    return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
  }
  const signup = (email = 'member@example.test') =>
    request('signup', {
      method: 'POST',
      body: { email, password: 'local-test-password', name: 'Test Member', workspace: 'Test Studio' },
    });
  return {
    request,
    signup,
    directory,
    reload: () => {
      handle = createAccounts({ directory, ...options });
    },
  };
}
const draft = {
  title: 'Plan a launch',
  description: 'A clear outcome',
  department: 'marketing',
  stage: 'queued',
  provider: 'openai',
  due: '2026-12-20',
};

test('signup stores hashed passwords and sessions; login/logout and durable session work', async (t) => {
  const f = await fixture(t);
  const signup = await f.signup();
  assert.equal(signup.status, 201);
  assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800/);
  assert.equal(signup.data.user.email, 'member@example.test');
  assert.equal(signup.data.user.password, undefined);
  const stored = JSON.parse(fs.readFileSync(path.join(f.directory, 'accounts.json')));
  assert.equal(stored.users[0].password.length, 128);
  assert.notEqual(stored.sessions[0].token, signup.cookie.split('=')[1]);
  assert.ok(!JSON.stringify(stored).includes('local-test-password'));
  assert.equal(fs.statSync(path.join(f.directory, 'accounts.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(f.directory, 'provider.key')).mode & 0o777, 0o600);
  f.reload();
  assert.equal((await f.request('me', { cookie: signup.cookie })).status, 200);
  assert.equal((await f.signup()).status, 409);
  assert.equal(
    (
      await f.request('login', {
        method: 'POST',
        body: { email: 'member@example.test', password: 'incorrect-password' },
      })
    ).status,
    401,
  );
  const login = await f.request('login', {
    method: 'POST',
    body: { email: 'MEMBER@example.test', password: 'local-test-password' },
  });
  assert.equal(login.status, 200);
  assert.equal((await f.request('logout', { method: 'POST', cookie: login.cookie })).status, 200);
  assert.equal((await f.request('me', { cookie: login.cookie })).status, 401);
});

test('workflows remain account-scoped across CRUD, profile changes and restart', async (t) => {
  const f = await fixture(t);
  const a = await f.signup('a@example.test'),
    b = await f.signup('b@example.test');
  const created = await f.request('workflows', { method: 'POST', cookie: a.cookie, body: draft });
  assert.equal(created.status, 201);
  const id = created.data.workflow.id;
  assert.equal((await f.request('workflows', { cookie: b.cookie })).data.workflows.length, 0);
  for (const method of ['PATCH', 'DELETE'])
    assert.equal(
      (await f.request('workflows/' + id, { method, cookie: b.cookie, ...(method === 'PATCH' ? { body: draft } : {}) }))
        .status,
      404,
    );
  await f.request('workflows/' + id, {
    method: 'PATCH',
    cookie: a.cookie,
    body: { ...draft, stage: 'done', title: '<img src=x onerror=alert(1)>' },
  });
  await f.request('profile', {
    method: 'PATCH',
    cookie: a.cookie,
    body: { name: 'Updated Member', workspace: 'Updated Studio' },
  });
  f.reload();
  const list = (await f.request('workflows', { cookie: a.cookie })).data;
  assert.equal(list.workflows[0].stage, 'done');
  assert.equal(list.workflows[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(list.activity.length, 3);
  assert.equal((await f.request('me', { cookie: a.cookie })).data.user.name, 'Updated Member');
  assert.equal((await f.request('me', { cookie: b.cookie })).data.user.name, 'Test Member');
  assert.equal((await f.request('workflows/' + id, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal((await f.request('workflows', { cookie: a.cookie })).data.workflows.length, 0);
});

test('authentication, CSRF, body limits and field validation reject invalid mutations', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('workflows')).status, 401);
  assert.equal(
    (await f.request('signup', { method: 'POST', body: {}, headers: { 'x-delux-request': '' } })).status,
    403,
  );
  assert.equal(
    (await f.request('signup', { method: 'POST', body: {}, headers: { origin: 'https://other.example' } })).status,
    403,
  );
  assert.equal(
    (await f.request('signup', { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status,
    415,
  );
  const { cookie } = await f.signup();
  for (const body of [
    { ...draft, stage: 'unknown' },
    { ...draft, department: 'unknown' },
    { ...draft, due: '2026-02-30' },
    { ...draft, title: '' },
    { ...draft, provider: 'untrusted' },
  ]) {
    assert.equal((await f.request('workflows', { method: 'POST', cookie, body })).status, 400);
  }
  assert.equal(
    (await f.request('workflows', { method: 'POST', cookie, body: { ...draft, description: 'x'.repeat(34000) } }))
      .status,
    413,
  );
  assert.equal(
    (
      await f.request('theme', {
        method: 'PATCH',
        cookie,
        body: { accent: 'url(https://example.test)', background: '#111111' },
      })
    ).status,
    400,
  );
});

test('colors are durable and isolated to the member', async (t) => {
  const f = await fixture(t);
  const a = await f.signup('a@example.test'),
    b = await f.signup('b@example.test');
  const colors = { accent: '#aaBBcc', background: '#f5f1e8' };
  assert.equal((await f.request('theme', { method: 'PATCH', cookie: a.cookie, body: colors })).status, 200);
  f.reload();
  assert.deepEqual((await f.request('me', { cookie: a.cookie })).data.user.theme, {
    accent: '#aabbcc',
    background: '#f5f1e8',
  });
  assert.equal((await f.request('me', { cookie: b.cookie })).data.user.theme.background, '#111411');
});

test('provider secrets are encrypted, never returned, isolated and verified via documented read endpoints', async (t) => {
  const calls = [];
  const f = await fixture(t, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify(
          url.includes('/models')
            ? { data: [{ id: 'sample-model' }] }
            : { id: '123456', display_phone_number: '+1 555 0100' },
        ),
      );
    },
  });
  const a = await f.signup('a@example.test'),
    b = await f.signup('b@example.test');
  for (const id of ['openai', 'whatsapp']) {
    const secret = 'synthetic-' + id + '-test-credential';
    const saved = await f.request('providers/' + id, {
      method: 'PATCH',
      cookie: a.cookie,
      body: { secret, phoneId: '123456' },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.user.providers[id].status, 'configured');
    assert.ok(!JSON.stringify(saved.data).includes(secret));
    assert.ok(!fs.readFileSync(path.join(f.directory, 'accounts.json'), 'utf8').includes(secret));
    assert.equal((await f.request('me', { cookie: b.cookie })).data.user.providers[id].configured, false);
    f.reload();
    const verified = await f.request('providers/' + id + '/verify', { method: 'POST', cookie: a.cookie });
    assert.equal(verified.data.user.providers[id].status, 'verified');
    assert.ok(verified.data.user.providers[id].checkedAt);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer ' + secret);
    assert.equal(calls.at(-1).options.redirect, 'error');
    assert.ok(calls.at(-1).options.signal);
    assert.equal(
      (await f.request('providers/' + id, { method: 'DELETE', cookie: a.cookie })).data.user.providers[id].status,
      'disconnected',
    );
  }
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(calls[1].url, 'https://graph.facebook.com/v25.0/123456?fields=display_phone_number,verified_name');
});

test('provider failures are sanitized and never marked verified', async (t) => {
  let result = 'denied';
  const f = await fixture(t, {
    fetchImpl: async () => {
      if (result === 'offline') throw Error('secret provider detail');
      if (result === 'denied') return new Response('secret provider detail', { status: 401 });
      return new Response('{"unexpected":true}');
    },
  });
  const { cookie } = await f.signup();
  assert.equal((await f.request('providers/openai/verify', { method: 'POST', cookie })).status, 400);
  await f.request('providers/openai', { method: 'PATCH', cookie, body: { secret: 'synthetic-secret-key' } });
  for (result of ['denied', 'offline', 'malformed']) {
    const r = await f.request('providers/openai/verify', { method: 'POST', cookie });
    assert.equal(r.data.user.providers.openai.status, 'error');
    assert.ok(!JSON.stringify(r.data).includes('secret provider detail'));
  }
});

test('a changed credential cannot inherit an in-flight verification', async (t) => {
  let finish, started;
  const began = new Promise((resolve) => (started = resolve));
  const f = await fixture(t, {
    fetchImpl: async () => {
      started();
      return new Promise((resolve) => (finish = resolve));
    },
  });
  const { cookie } = await f.signup();
  await f.request('providers/openai', { method: 'PATCH', cookie, body: { secret: 'synthetic-first-key' } });
  const verification = f.request('providers/openai/verify', { method: 'POST', cookie });
  await began;
  await f.request('providers/openai', { method: 'PATCH', cookie, body: { secret: 'synthetic-replacement-key' } });
  finish(new Response('{"data":[]}'));
  assert.equal((await verification).status, 409);
  assert.equal((await f.request('me', { cookie })).data.user.providers.openai.status, 'configured');
});

test('concurrent signup and workflow writes do not lose updates', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.signup('same@example.test'), f.signup('same@example.test')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const { cookie } = results.find((r) => r.status === 201);
  const writes = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      f.request('workflows', { method: 'POST', cookie, body: { ...draft, title: 'Work ' + i } }),
    ),
  );
  assert.ok(writes.every((r) => r.status === 201));
  assert.equal((await f.request('workflows', { cookie })).data.workflows.length, 8);
});

test('HTTPS public origin sets secure cookie and enforces configured origin', async (t) => {
  const f = await fixture(t, { publicOrigin: 'https://delux.example' });
  const { headers } = await f.signup();
  assert.match(headers.get('set-cookie'), /; Secure/);
  assert.equal(
    (await f.request('login', { method: 'POST', headers: { origin: 'https://other.example' }, body: {} })).status,
    403,
  );
});

test('missing encryption key with existing data fails closed', async (t) => {
  const f = await fixture(t);
  await f.signup();
  fs.unlinkSync(path.join(f.directory, 'provider.key'));
  assert.throws(() => f.reload(), /Missing provider encryption key/);
});
