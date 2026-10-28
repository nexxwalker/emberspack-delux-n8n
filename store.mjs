// Where member accounts live: a private JSON file by default, or a MongoDB database.
//
// Both stores answer the same two questions — read() returns the current
// { users, sessions } document, write(data) persists it — so the account routes
// never learn which one is behind them.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const empty = () => ({ users: [], sessions: [] });
// Documents carry their database identity; the account routes work with plain records.
const plain = (doc) => {
  const copy = { ...doc };
  delete copy._id;
  delete copy.expiresAt;
  return copy;
};
// A cheap fingerprint per record, so a write only touches the documents that changed.
const fingerprint = (data) => {
  const map = new Map();
  for (const user of data.users) map.set('u:' + user.id, JSON.stringify(user));
  for (const session of data.sessions) map.set('s:' + session.token, JSON.stringify(session));
  return map;
};

export function createFileStore({ directory }) {
  if (!directory) throw new Error('A directory is required for file account storage.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'accounts.json');
  return {
    mode: 'file',
    directory,
    file,
    async read() {
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : empty();
    },
    async write(data) {
      data.sessions = data.sessions.filter((s) => s.expires > Date.now());
      const temp = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(temp, file);
    },
    async close() {},
  };
}

export async function createMongoStore({ uri, database = 'delux_crew' }) {
  if (!/^mongodb(\+srv)?:\/\//.test(uri || ''))
    throw new Error('DELUX_MONGODB_URI must start with mongodb:// or mongodb+srv://.');
  let MongoClient;
  try {
    ({ MongoClient } = await import('mongodb'));
  } catch {
    throw new Error('The MongoDB driver is missing. Run `npm install mongodb` and start again.');
  }
  const client = new MongoClient(uri, {
    appName: 'delux-crew',
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(database);
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  // The database enforces the rules the JSON file had to check by hand.
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ user: 1 }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  let snapshot = new Map();
  return {
    mode: 'mongo',
    database,
    async read() {
      const [userDocs, sessionDocs] = await Promise.all([
        users.find({}).toArray(),
        sessions.find({ expires: { $gt: Date.now() } }).toArray(),
      ]);
      const data = { users: userDocs.map(plain), sessions: sessionDocs.map(plain) };
      snapshot = fingerprint(data);
      return data;
    },
    async write(data) {
      data.sessions = data.sessions.filter((s) => s.expires > Date.now());
      const next = fingerprint(data);
      const work = [];
      const userOps = [];
      for (const user of data.users) {
        if (snapshot.get('u:' + user.id) === next.get('u:' + user.id)) continue;
        userOps.push({
          replaceOne: { filter: { _id: user.id }, replacement: { ...user, _id: user.id }, upsert: true },
        });
      }
      const sessionOps = [];
      for (const session of data.sessions) {
        if (snapshot.get('s:' + session.token) === next.get('s:' + session.token)) continue;
        sessionOps.push({
          replaceOne: {
            filter: { _id: session.token },
            // expiresAt gives the TTL index a real date; `expires` stays in milliseconds for the routes.
            replacement: { ...session, _id: session.token, expiresAt: new Date(session.expires) },
            upsert: true,
          },
        });
      }
      if (userOps.length) work.push(users.bulkWrite(userOps, { ordered: true }));
      if (sessionOps.length) work.push(sessions.bulkWrite(sessionOps, { ordered: true }));
      const goneUsers = [...snapshot.keys()].filter((k) => k.startsWith('u:') && !next.has(k)).map((k) => k.slice(2));
      const goneSessions = [...snapshot.keys()]
        .filter((k) => k.startsWith('s:') && !next.has(k))
        .map((k) => k.slice(2));
      if (goneUsers.length) work.push(users.deleteMany({ _id: { $in: goneUsers } }));
      if (goneSessions.length) work.push(sessions.deleteMany({ _id: { $in: goneSessions } }));
      if (work.length) await Promise.all(work);
      snapshot = next;
    },
    async close() {
      await client.close();
    },
  };
}

// MongoDB when a connection string is configured, the local file otherwise.
export async function openStore({
  directory,
  uri = process.env.DELUX_MONGODB_URI || process.env.MONGODB_URI || '',
  database = process.env.DELUX_MONGODB_DB || 'delux_crew',
}) {
  return uri ? createMongoStore({ uri, database }) : createFileStore({ directory });
}
