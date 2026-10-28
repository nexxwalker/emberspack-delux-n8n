// Account-scoped workflow tracking and encrypted provider settings for the member workspace.
import fs from 'node:fs';
import path from 'node:path';
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';
import { createFileStore } from './store.mjs';
const derive = promisify(scrypt);
const TTL = 7 * 24 * 60 * 60 * 1000;
const departments = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'];
const stages = ['queued', 'active', 'review', 'done'];
const providers = ['openai', 'whatsapp'];
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const defaults = () => ({ accent: '#c5a572', background: '#111411' });
function field(value, label, max = 120, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    fail(400, `Enter a valid ${label}.`);
  return value.trim();
}
function theme(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !/^#[0-9a-f]{6}$/i.test(value.accent) ||
    !/^#[0-9a-f]{6}$/i.test(value.background)
  )
    fail(400, 'Choose valid colors.');
  return { accent: value.accent.toLowerCase(), background: value.background.toLowerCase() };
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Use JSON for this request.');
  let text = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32768) fail(413, 'Request is too large.');
    text += chunk;
  }
  try {
    const data = JSON.parse(text || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid request.');
    return data;
  } catch {
    fail(400, 'Invalid JSON.');
  }
}
const send = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
};

// The provider key decrypts stored credentials, so it never travels to the database with them.
function providerKey(store) {
  const hex = (process.env.DELUX_PROVIDER_KEY || '').trim();
  if (hex) {
    if (!/^[0-9a-f]{64}$/i.test(hex))
      throw new Error('DELUX_PROVIDER_KEY must be 32 bytes written as 64 hexadecimal characters.');
    return Buffer.from(hex, 'hex');
  }
  const keyFile =
    process.env.DELUX_PROVIDER_KEY_FILE || (store.directory ? path.join(store.directory, 'provider.key') : '');
  if (!keyFile)
    throw new Error(
      'Set DELUX_PROVIDER_KEY (64 hex characters) or DELUX_PROVIDER_KEY_FILE to read stored credentials.',
    );
  if (!fs.existsSync(keyFile)) {
    if (store.mode !== 'file')
      throw new Error(
        'Set DELUX_PROVIDER_KEY or DELUX_PROVIDER_KEY_FILE: a newly generated key would make the credentials already stored in MongoDB unreadable.',
      );
    // A missing key alongside existing data must never silently replace the encryption key.
    if (fs.existsSync(path.join(store.directory, 'accounts.json')))
      throw new Error('Missing provider encryption key. Restore provider.key from the same backup as accounts.json.');
    fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  const key = fs.readFileSync(keyFile);
  if (key.length !== 32) throw new Error('Invalid provider encryption key.');
  return key;
}

export function createAccounts({
  directory,
  store = createFileStore({ directory }),
  fetchImpl = fetch,
  openaiURL = process.env.DELUX_OPENAI_URL || 'https://api.openai.com/v1',
  whatsappURL = process.env.DELUX_WHATSAPP_URL || 'https://graph.facebook.com/v25.0',
  publicOrigin = process.env.DELUX_PUBLIC_ORIGIN || '',
}) {
  const key = providerKey(store);
  const read = () => store.read();
  const write = (data) => store.write(data);
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const text = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), text].map((b) => b.toString('base64')).join('.');
  }
  function decrypt(value) {
    const [iv, tag, text] = value.split('.').map((s) => Buffer.from(s, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(text), cipher.final()]).toString('utf8');
  }
  const providerView = (p) =>
    p
      ? {
          configured: true,
          status: p.status || 'configured',
          checkedAt: p.checkedAt || null,
          phoneId: p.phoneId || '',
          detail: p.detail || '',
        }
      : { configured: false, status: 'disconnected', checkedAt: null, phoneId: '', detail: '' };
  const publicUser = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    workspace: user.workspace,
    createdAt: user.createdAt,
    theme: user.theme,
    providers: Object.fromEntries(providers.map((id) => [id, providerView(user.providers[id])])),
  });
  const activity = (user, text) => {
    user.activity.unshift({ id: randomUUID(), text, at: new Date().toISOString() });
    user.activity = user.activity.slice(0, 100);
  };
  function tokenOf(req) {
    return (
      (req.headers.cookie || '')
        .split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('delux_session='))
        ?.slice(14) || ''
    );
  }
  function current(req, data) {
    const token = tokenOf(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = data.sessions.find((s) => s.token === hash(token) && s.expires > Date.now());
    return session && data.users.find((u) => u.id === session.user);
  }
  function cookie(req, res, token, maxAge) {
    const secure = req.socket.encrypted || publicOrigin.startsWith('https://');
    res.setHeader(
      'set-cookie',
      `delux_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
    );
  }
  async function session(req, res, data, user) {
    const token = randomBytes(32).toString('hex');
    const previous = tokenOf(req);
    data.sessions = data.sessions.filter((s) => s.token !== hash(previous));
    data.sessions.push({ user: user.id, token: hash(token), expires: Date.now() + TTL });
    await write(data);
    cookie(req, res, token, TTL / 1000);
  }
  const limits = new Map();
  function rate(id, max = 20) {
    const now = Date.now();
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const bucket = limits.get(id) || { count: 0, until: now + 15 * 60 * 1000 };
    bucket.count++;
    limits.set(id, bucket);
    if (bucket.count > max || limits.size > 10000) fail(429, 'Too many attempts. Try again in 15 minutes.');
  }
  async function verify(id, saved) {
    const secret = decrypt(saved.secret);
    const url =
      id === 'openai'
        ? openaiURL.replace(/\/$/, '') + '/models'
        : whatsappURL.replace(/\/$/, '') + '/' + saved.phoneId + '?fields=display_phone_number,verified_name';
    try {
      const r = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!r.ok)
        return {
          status: 'error',
          detail:
            r.status === 401 || r.status === 403
              ? 'Access was refused. Check the credentials and permissions.'
              : r.status === 429
                ? 'Provider rate limit reached. Try again later.'
                : 'Provider check failed. Check the account details and try again.',
        };
      const data = await r.json();
      if (id === 'openai' ? !Array.isArray(data.data) : !data.id || !data.display_phone_number)
        return { status: 'error', detail: 'The provider returned an unexpected response.' };
      return {
        status: 'verified',
        detail:
          id === 'openai'
            ? 'API access verified. No generation request was made.'
            : 'Business phone access verified. No message was sent.',
      };
    } catch {
      return { status: 'error', detail: 'Could not reach the provider. Try again shortly.' };
    }
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/account/')) return false;
    try {
      const route = url.pathname.slice('/api/account/'.length);
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) fail(405, 'Method not allowed.');
      if (req.method !== 'GET') {
        // Custom header prevents cross-site form submissions; no CORS permission is granted.
        if (req.headers['x-delux-request'] !== '1') fail(403, 'Request verification failed.');
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (publicOrigin ? origin.origin !== new URL(publicOrigin).origin : origin.host !== req.headers.host)
            fail(403, 'Request origin is not allowed.');
        }
      }
      if (req.method === 'POST' && ['signup', 'login'].includes(route)) {
        rate('auth:' + req.socket.remoteAddress);
        const b = await readBody(req);
        const email = field(b.email, 'email', 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
        const password = b.password;
        if (typeof password !== 'string' || password.length < 10 || password.length > 128)
          fail(400, 'Use a password between 10 and 128 characters.');
        if (route === 'signup') {
          const name = field(b.name, 'name', 80),
            workspace = field(b.workspace, 'workspace name', 80);
          const salt = randomBytes(16).toString('hex');
          const derived = await derive(password, salt, 64);
          const data = await read();
          if (data.users.some((u) => u.email === email))
            fail(409, 'An account already uses this email. Sign in instead.');
          const user = {
            id: randomUUID(),
            name,
            email,
            workspace,
            password: derived.toString('hex'),
            salt,
            createdAt: new Date().toISOString(),
            theme: defaults(),
            providers: {},
            workflows: [],
            activity: [],
          };
          activity(user, 'Workspace created');
          data.users.push(user);
          try {
            await session(req, res, data, user);
          } catch (e) {
            // The database's unique email index is the last word on a signup race.
            if (e?.code === 11000) fail(409, 'An account already uses this email. Sign in instead.');
            throw e;
          }
          send(res, 201, { user: publicUser(user) });
          return true;
        }
        const data = await read();
        const user = data.users.find((u) => u.email === email);
        const derived = await derive(password, user?.salt || 'delux-invalid-account', 64);
        if (!user || !timingSafeEqual(derived, Buffer.from(user.password, 'hex')))
          fail(401, 'Email or password is incorrect.');
        // Reload after the async password check so another request's changes cannot be lost.
        const latest = await read();
        await session(
          req,
          res,
          latest,
          latest.users.find((u) => u.id === user.id),
        );
        send(res, 200, { user: publicUser(latest.users.find((u) => u.id === user.id)) });
        return true;
      }
      const data = await read();
      const user = current(req, data);
      if (!user) fail(401, 'Sign in to your workspace.');
      if (route === 'me' && req.method === 'GET') {
        send(res, 200, { user: publicUser(user) });
        return true;
      }
      if (route === 'logout' && req.method === 'POST') {
        data.sessions = data.sessions.filter((s) => s.token !== hash(tokenOf(req)));
        await write(data);
        cookie(req, res, '', 0);
        send(res, 200, { ok: true });
        return true;
      }
      if (route === 'profile' && req.method === 'PATCH') {
        const b = await readBody(req);
        const name = field(b.name, 'name', 80),
          workspace = field(b.workspace, 'workspace name', 80);
        const latest = await read();
        const u = latest.users.find((u) => u.id === user.id);
        Object.assign(u, { name, workspace });
        await write(latest);
        send(res, 200, { user: publicUser(u) });
        return true;
      }
      if (route === 'theme' && req.method === 'PATCH') {
        const colors = theme(await readBody(req));
        const latest = await read(),
          u = latest.users.find((u) => u.id === user.id);
        u.theme = colors;
        await write(latest);
        send(res, 200, { user: publicUser(u) });
        return true;
      }
      if (route === 'workflows' && req.method === 'GET') {
        send(res, 200, { workflows: user.workflows, activity: user.activity });
        return true;
      }
      const workflowId = route.match(/^workflows\/([a-f0-9-]+)$/)?.[1];
      if ((route === 'workflows' && req.method === 'POST') || (workflowId && req.method === 'PATCH')) {
        const b = await readBody(req);
        const title = field(b.title, 'workflow title', 160),
          description = field(b.description ?? '', 'description', 2000, false);
        if (
          !departments.includes(b.department) ||
          !stages.includes(b.stage) ||
          !['manual', ...providers].includes(b.provider)
        )
          fail(400, 'Choose a valid department, stage and provider.');
        const due = b.due || '';
        if (
          typeof due !== 'string' ||
          (due &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(due) ||
              !Number.isFinite(Date.parse(due)) ||
              new Date(due).toISOString().slice(0, 10) !== due))
        )
          fail(400, 'Choose a valid due date.');
        const latest = await read(),
          u = latest.users.find((u) => u.id === user.id);
        let workflow = workflowId && u.workflows.find((w) => w.id === workflowId);
        if (workflowId && !workflow) fail(404, 'Workflow not found.');
        if (!workflow && u.workflows.length >= 500) fail(400, 'This workspace has reached its 500-workflow limit.');
        const isNew = !workflow;
        if (isNew) {
          workflow = { id: randomUUID(), createdAt: new Date().toISOString() };
          u.workflows.unshift(workflow);
        }
        Object.assign(workflow, {
          title,
          description,
          department: b.department,
          stage: b.stage,
          provider: b.provider,
          due,
          updatedAt: new Date().toISOString(),
        });
        activity(u, `${isNew ? 'Created' : 'Updated'} “${title}” · ${b.stage}`);
        await write(latest);
        send(res, isNew ? 201 : 200, { workflow });
        return true;
      }
      if (workflowId && req.method === 'DELETE') {
        const workflow = user.workflows.find((w) => w.id === workflowId);
        if (!workflow) fail(404, 'Workflow not found.');
        user.workflows = user.workflows.filter((w) => w.id !== workflowId);
        activity(user, `Deleted “${workflow.title}”`);
        await write(data);
        send(res, 200, { ok: true });
        return true;
      }
      const providerMatch = route.match(/^providers\/(openai|whatsapp)(\/verify)?$/);
      if (providerMatch) {
        const id = providerMatch[1];
        if (req.method === 'DELETE' && !providerMatch[2]) {
          delete user.providers[id];
          activity(user, `Disconnected ${id}`);
          await write(data);
          send(res, 200, { user: publicUser(user) });
          return true;
        }
        if (req.method === 'PATCH' && !providerMatch[2]) {
          const b = await readBody(req);
          const secret = field(b.secret, 'provider credential', 4096);
          if (secret.length < 10 || /\s/.test(secret)) fail(400, 'Enter a valid provider credential.');
          const phoneId = id === 'whatsapp' ? field(b.phoneId, 'business phone number ID', 40) : '';
          if (id === 'whatsapp' && !/^\d+$/.test(phoneId))
            fail(400, 'The WhatsApp phone number ID must contain digits only.');
          const latest = await read(),
            u = latest.users.find((u) => u.id === user.id);
          u.providers[id] = {
            secret: encrypt(secret),
            phoneId,
            status: 'configured',
            checkedAt: null,
            detail: 'Saved. Verify access to check this connection.',
          };
          activity(u, `Configured ${id}`);
          await write(latest);
          send(res, 200, { user: publicUser(u) });
          return true;
        }
        if (req.method === 'POST' && providerMatch[2]) {
          rate('provider:' + user.id, 12);
          const saved = user.providers[id];
          if (!saved) fail(400, 'Save credentials first.');
          const result = await verify(id, saved);
          const latest = await read(),
            u = latest.users.find((u) => u.id === user.id);
          if (!u.providers[id] || u.providers[id].secret !== saved.secret)
            fail(409, 'Settings changed during verification. Verify again.');
          Object.assign(u.providers[id], result, { checkedAt: new Date().toISOString() });
          await write(latest);
          send(res, 200, { user: publicUser(u) });
          return true;
        }
      }
      fail(404, 'Not found.');
    } catch (e) {
      send(res, e.status || 500, {
        error: e.status ? e.message : 'The request could not be completed. Please try again.',
      });
    }
    return true;
  };
}
