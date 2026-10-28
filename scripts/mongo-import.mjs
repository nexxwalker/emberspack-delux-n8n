// Copy members from the local JSON file into MongoDB.
//
//   DELUX_MONGODB_URI=mongodb+srv://… node scripts/mongo-import.mjs [accounts.json]
//
// Accounts already in the database are kept; only missing emails and live
// sessions are added. Run it once, then start the server with the same URI.
import fs from 'node:fs';
import path from 'node:path';
import { createMongoStore } from '../store.mjs';

const file = process.argv[2] || path.join('data', 'members', 'accounts.json');
const uri = process.env.DELUX_MONGODB_URI || process.env.MONGODB_URI || '';
if (!uri) {
  console.error('Set DELUX_MONGODB_URI first (Atlas → Connect → Drivers supplies the string).');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`No accounts file at ${file}. Nothing to import.`);
  process.exit(1);
}
const local = JSON.parse(fs.readFileSync(file, 'utf8'));
const store = await createMongoStore({ uri, database: process.env.DELUX_MONGODB_DB || 'delux_crew' });
try {
  const remote = await store.read();
  const emails = new Set(remote.users.map((u) => u.email));
  const tokens = new Set(remote.sessions.map((s) => s.token));
  const users = [...remote.users, ...(local.users || []).filter((u) => !emails.has(u.email))];
  const sessions = [
    ...remote.sessions,
    ...(local.sessions || []).filter((s) => s.expires > Date.now() && !tokens.has(s.token)),
  ];
  await store.write({ users, sessions });
  console.log(
    `Imported ${users.length - remote.users.length} account(s) and ${sessions.length - remote.sessions.length} session(s) into ${store.database}.`,
  );
} finally {
  await store.close();
}
