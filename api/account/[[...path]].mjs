// The member API as a Vercel function: /api/account/*
//
// MongoDB is required here. A serverless filesystem is not persisted, so the
// file store would accept a signup and then lose it — better to answer 503 and
// say the database is missing than to pretend the account was saved.
import { createAccounts } from '../../accounts.mjs';
import { openStore } from '../../store.mjs';

let cached = null;

async function routes() {
  if (cached) return cached;
  const uri = process.env.DELUX_MONGODB_URI || process.env.MONGODB_URI || '';
  const store = await openStore({ uri });
  cached = createAccounts({ store, publicOrigin: process.env.DELUX_PUBLIC_ORIGIN || '' });
  return cached;
}

export default async function handler(req, res) {
  let handle;
  try {
    handle = await routes();
  } catch (error) {
    // The message names the missing setting; no credential is included.
    console.error('member api:', error.message);
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'The member database is not connected to this deployment yet.' }));
    return;
  }
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  if (!(await handle(req, res, url))) {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'Not found.' }));
  }
}
