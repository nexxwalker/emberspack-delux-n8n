// INDUSTRY PROFILE (12 Sep 2026, the owner: "separate HTML files, one per industry, dark, with the ANZ /
// North America strip swappable"). A per-industry demo file injects `window.PROFILE` ahead of the
// bundle; every content module below calls one of these appliers at module init and rewrites its
// constants IN PLACE, so the rest of the office never knows. Without window.PROFILE (the shipped
// build, the served office) every applier is a no-op and nothing here changes anything.
//
// Shape (built by industry-demos/tools/build-industry.mjs from profiles/<slug>.content.json):
//   { slug, industry, company, region: 'anz'|'na', regionName, sibling: { file, name },
//     pods: { emails: 'DISPATCH', … },           // the six pod labels
//     agents: { elead: { name, role, does, tools:[key], tasks:[3], chips:[3], greeting }, … },  // 35
//     worklines: { emails: [4 lines], … }, kpis: { emails: [{label, val}, {label, val}], … },
//     approvals: { emails: [2], … }, documents: { emails: { title, lines:[3], total }, … },
//     segments: [..], world: { customers, suppliers, competitors, cities },
//     strip: [{ key, name, depts:[..] }], logos: { key: { name, img } }, shared: { key: ink },
//     graph: { notes, nodes, links, floor } }
export const PROFILE = typeof window !== 'undefined' && window.PROFILE && window.PROFILE.pods ? window.PROFILE : null;

const DEPTS6 = ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery'];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s&/-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const lc1 = (s) => {
  s = String(s || '');
  return s.charAt(0).toLowerCase() + s.slice(1);
};

/** fill the {co} {n} {segment} {person} {count} placeholders the task pool uses */
export function fillVars(s, P) {
  const co = P && P.customers ? rnd(P.customers) : 'the client';
  return String(s)
    .replace(/\{co\}/g, co)
    .replace(/\{n\}/g, ri(6, 40))
    .replace(/\{count\}/g, ri(3, 9))
    .replace(/\{segment\}/g, PROFILE && PROFILE.segments && PROFILE.segments.length ? rnd(PROFILE.segments) : 'clients')
    .replace(/\{person\}/g, co);
}

/* ---------- data.js: pods, seats, billboards, approvals, screen lines ---------- */
export function applyData({ DEPTS, AGENTS, BILLBOARDS, APPROVAL_ASKS, APPROVAL_BY_AGENT, WORKLINES }) {
  if (!PROFILE) return;
  for (const k of DEPTS6) {
    if (PROFILE.pods[k]) {
      DEPTS[k].name = PROFILE.pods[k];
      DEPTS[k].short = PROFILE.pods[k];
    }
    if (PROFILE.kpis && PROFILE.kpis[k] && PROFILE.kpis[k][0]) {
      const a = PROFILE.kpis[k][0];
      BILLBOARDS[k] = [{ id: k + '_k0', label: a.label, val: typeof a.val === 'number' ? a.val : 0 }];
    }
    if (PROFILE.approvals && PROFILE.approvals[k] && PROFILE.approvals[k].length)
      APPROVAL_ASKS[k] = PROFILE.approvals[k].slice();
    if (PROFILE.worklines && PROFILE.worklines[k] && PROFILE.worklines[k].length)
      WORKLINES[k] = PROFILE.worklines[k].map((l) => (/^[▸✓•]/.test(l) ? l : '▸ ' + l));
  }
  for (const a of AGENTS) {
    const p = PROFILE.agents[a.id];
    if (p && p.name) a.name = p.name;
  }
  for (const k of Object.keys(APPROVAL_BY_AGENT)) delete APPROVAL_BY_AGENT[k]; // the dept pool is the profile's voice
  if (WORKLINES.brain)
    WORKLINES.brain = [
      '▸ ' + (PROFILE.company || 'the company') + ' notes indexed',
      '▸ ' +
        ((PROFILE.graph && PROFILE.graph.notes) || 0) +
        ' notes · ' +
        ((PROFILE.graph && PROFILE.graph.links && PROFILE.graph.links.length) || 0) +
        ' links',
      '▸ read: ' +
        ((PROFILE.graph && PROFILE.graph.nodes && PROFILE.graph.nodes[0] && PROFILE.graph.nodes[0].id) || 'index'),
      '▸ agents reading the Brain',
    ];
}

/* ---------- v1data.js: the fake world, every agent's persona, sample files ---------- */
export function applyV1({ P, V1, FILE_GEN, clockStr }) {
  if (!PROFILE) return;
  const W = PROFILE.world || {};
  if (W.customers && W.customers.length) P.co = W.customers.slice();
  if (W.competitors && W.competitors.length) P.competitor = W.competitors.slice();
  if (W.cities && W.cities.length) P.city = W.cities.slice();
  const stripNames = Object.fromEntries((PROFILE.strip || []).map((s) => [s.key, s.name]));
  const toolNames = (keys) =>
    (keys || []).map((k) => stripNames[k] || (PROFILE.logos && PROFILE.logos[k] && PROFILE.logos[k].name) || k);
  const slugf = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  for (const v of V1) {
    const p = PROFILE.agents[v.id];
    if (!p) continue;
    const tasks = (p.tasks && p.tasks.length ? p.tasks : ['Working through the queue']).slice();
    const tools = toolNames(p.tools);
    const does = p.does || '';
    const doc = (PROFILE.documents || {})[v.dept] || null;
    v.name = p.name || v.name;
    v.role = p.role || v.role;
    v.tagline = does || v.tagline;
    v.tasks = tasks;
    v.ev = [
      ...tasks.map((t, i) => ({
        i: ['▸', '✓', '⏱'][i % 3],
        t: () => (i % 3 === 1 ? 'Done: ' : '') + fillVars(t, W),
        p: 3,
      })),
      {
        i: '📚',
        t: () =>
          `Read "${PROFILE.graph && PROFILE.graph.nodes && PROFILE.graph.nodes.length ? rnd(PROFILE.graph.nodes).id : 'index'}" in the Brain before starting`,
        brain: true,
        p: 1,
      },
      ...(tools.length ? [{ i: '🔌', t: () => `Pulled what it needed from ${rnd(tools)}`, p: 2 }] : []),
    ];
    const seed = [...v.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const sr = (i) => ((seed * (i + 3) * 2654435761) >>> 0) % 100;
    v.stats = [
      ['Done this week', () => 8 + (sr(1) % 30)],
      ['In progress', () => 1 + (sr(2) % 3)],
      ['Waiting on you', () => sr(3) % 3],
      ['Avg turnaround', () => 9 + (sr(4) % 40) + ' min'],
    ];
    v.chartLbl = 'Tasks done — last 7 days';
    v.chart = [0, 1, 2, 3, 4, 5, 6].map((i) => 4 + (sr(i + 5) % 14));
    v.greeting =
      p.greeting ||
      `${p.name ? titleCase(p.name) : 'I'} here. ${does} Ask me what is on my desk, or give me a task in the bar on the right.`;
    v.chat = [
      {
        k: ['desk', 'today', 'working', 'doing', 'on', 'what'],
        r: [`On my desk right now: ${tasks.map((t) => fillVars(t, W)).join('; ')}.`],
      },
      {
        k: ['waiting', 'need', 'approve', 'ok', 'sign'],
        r: [
          `${sr(3) % 3 || 'Nothing'} waiting on you from me${sr(3) % 3 ? ': ' + fillVars(tasks[0], W) + '. It is in the panel on the right.' : ' at the moment.'}`,
        ],
      },
      {
        k: ['tool', 'use', 'system', 'software', 'connect'],
        r: [
          tools.length
            ? `I work in ${tools.join(' and ')}. I read freely; I only send, post or change anything outside this office when you tell me to.`
            : 'I work from the Brain and the office inbox. I only send or change anything when you tell me to.',
        ],
      },
      {
        k: ['how', 'why', 'rule', 'brain'],
        r: [
          `I read the Brain first, every task: the notes for ${PROFILE.company || 'the company'} say how we do it here. Then I do the work and put it in the panel for you.`,
        ],
      },
    ];
    v.fallback = [
      `I ${lc1(does) || 'work in ' + v.role}. Ask what is on my desk, what is waiting on you, or which tools I use.`,
      `Try "${(p.chips || [])[0] || 'What is on your desk?'}" or "${(p.chips || [])[1] || 'What is waiting on me?'}".`,
    ];
    v.chips = (
      p.chips && p.chips.length ? p.chips : ["What's on your desk?", "What's waiting on me?", 'Which tools do you use?']
    ).slice(0, 3);
  }
  for (const k of Object.keys(FILE_GEN)) delete FILE_GEN[k];
  for (const v of V1) {
    const p = PROFILE.agents[v.id];
    if (!p) continue;
    const doc = (PROFILE.documents || {})[v.dept];
    if (!doc) continue;
    FILE_GEN[v.id] = () => ({
      icon: '📄',
      name: slugf(doc.title) + '-' + clockStr().replace(':', '') + '.md',
      meta: 'draft · waiting for your OK · click to view',
      content: `${doc.title}\n${PROFILE.company || ''}\n\n${(doc.lines || []).join('\n')}\n\n${doc.total ? 'Total: ' + doc.total + '\n\n' : ''}Prepared by ${p.name || v.name}. Nothing goes out until you approve it.`,
    });
  }
}

/* ---------- tasks.js: the task pool, routing words, chains, segments ---------- */
export function applyTasks({ POOL, KEYS, CHAINS, SEGMENTS, AGENTS }) {
  if (!PROFILE) return;
  const stop = new Set([
    'the',
    'and',
    'for',
    'lead',
    'agent',
    'of',
    'to',
    'a',
    'in',
    'on',
    'with',
    'from',
    'this',
    'that',
    'our',
    'your',
    'every',
    'all',
    'day',
    'week',
  ]);
  const words = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
  for (const a of AGENTS) {
    const p = PROFILE.agents[a.id];
    if (!p) continue;
    if (p.tasks && p.tasks.length) POOL[a.id] = p.tasks.slice();
    const ks = new Set([...words(p.name), ...words(p.role)]);
    for (const t of p.tasks || []) for (const w of words(t).slice(0, 3)) ks.add(w);
    KEYS[a.id] = [...ks];
  }
  if (PROFILE.segments && PROFILE.segments.length) {
    SEGMENTS.length = 0;
    SEGMENTS.push(...PROFILE.segments);
  }
  // handoff chains: lead → a seat in the same pod, one per department, using that pod's own task titles
  CHAINS.length = 0;
  for (const k of DEPTS6) {
    const seats = AGENTS.filter((a) => a.dept === k);
    if (seats.length < 2) continue;
    const lead = seats[0],
      others = seats.slice(1);
    const pl = PROFILE.agents[lead.id],
      p1 = PROFILE.agents[others[0].id],
      p2 = PROFILE.agents[others[others.length - 1].id];
    if (pl && p1 && pl.tasks && p1.tasks)
      CHAINS.push([
        [lead.id, pl.tasks[0]],
        [others[0].id, p1.tasks[0]],
      ]);
    if (p1 && p2 && p1.tasks && p2.tasks && others.length > 1)
      CHAINS.push([
        [others[0].id, p1.tasks[1] || p1.tasks[0]],
        [others[others.length - 1].id, p2.tasks[0]],
      ]);
  }
}

/* ---------- mcplogos.js / mcp.js: the strip ---------- */
export function applyLogos({ MCP_LOGOS, MCP_BY_DEPT }) {
  if (!PROFILE) return;
  Object.assign(MCP_LOGOS, PROFILE.logos || {});
  for (const k of DEPTS6)
    MCP_BY_DEPT[k] = (PROFILE.strip || []).filter((s) => (s.depts || []).includes(k)).map((s) => s.key);
}
export function applyAgentTools(AGENT_MCP) {
  if (!PROFILE) return;
  for (const id of Object.keys(AGENT_MCP)) {
    const p = PROFILE.agents[id];
    if (p && p.tools && p.tools.length) AGENT_MCP[id] = p.tools.slice();
  }
}
export const profileShared = () => (PROFILE && PROFILE.shared) || null;

/* ---------- main.js: the top bar, the dept-card rows, the approval mockup ---------- */
export function profileRows() {
  // dept → [[label, () => value]] for the pod cards
  if (!PROFILE || !PROFILE.kpis) return null;
  const rows = {};
  for (const k of DEPTS6)
    rows[k] = (PROFILE.kpis[k] || [])
      .slice(0, 3)
      .map((x) => [
        x.label,
        () => (typeof x.val === 'number' ? Math.round(x.val).toLocaleString('en-NZ') : String(x.val)),
      ]);
  return rows;
}
export function profileTickKpi(dept, roll) {
  // the live feel: the first number in a pod ticks up as its agents work
  if (!PROFILE || !PROFILE.kpis || !PROFILE.kpis[dept]) return;
  const x = PROFILE.kpis[dept][0];
  if (x && typeof x.val === 'number' && roll < 0.35) x.val += 1;
}
export function profileMockup(dept, ask, agentName, esc) {
  if (!PROFILE || !PROFILE.documents || !PROFILE.documents[dept]) return null;
  const d = PROFILE.documents[dept];
  const line = (l) => {
    const m = String(l).match(/^(.{2,28}?)(?::| — | – )\s*(.+)$/);
    return m
      ? `<div class="d-line"><span>${esc(m[1])}</span><b>${esc(m[2])}</b></div>`
      : `<div class="d-line"><span>${esc(l)}</span></div>`;
  };
  // the dept's document only when the ask is about it; otherwise a cover sheet for THIS ask, so card and paper agree
  const words = (t) =>
    new Set(
      String(t)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const aw = words(ask),
    dw = words(d.title + ' ' + (d.lines || []).join(' '));
  const overlap = [...aw].filter((w) => dw.has(w)).length;
  if (!ask || overlap >= 1) {
    return `<div class="mk mk-doc"><div class="d-brand">${esc(d.title)}</div><div class="d-title">${esc(PROFILE.company || '')}</div>${(d.lines || []).map(line).join('')}${d.total ? `<div class="d-line"><span>Total</span><b>${esc(d.total)}</b></div>` : ''}<div class="d-p">Drafted from the Brain. Nothing goes out until you approve it.</div></div>`;
  }
  const notes = ((PROFILE.graph && PROFILE.graph.nodes) || []).filter((n) => n.g !== '00-Meta').slice(0, 40);
  const pick = notes.length
    ? [notes[(ask.length * 7) % notes.length].id, notes[(ask.length * 13 + 5) % notes.length].id]
    : [];
  return (
    `<div class="mk mk-doc"><div class="d-brand">${esc((PROFILE.pods[dept] || dept) + ' · FOR YOUR OK')}</div><div class="d-title">${esc(ask)}</div>` +
    `<div class="d-line"><span>From</span><b>${esc(agentName || '')}</b></div>` +
    (pick.length ? `<div class="d-line"><span>Read first</span><b>${esc(pick.join(' · '))}</b></div>` : '') +
    `<div class="d-line"><span>Status</span><b>draft · nothing sent</b></div>` +
    `<div class="d-p">Approve and it goes out as drafted. Reject with a note and it comes back reworked.</div></div>`
  );
}
export function applyTopbar() {
  if (!PROFILE) return;
  const brand = document.querySelector('#topbar .brand');
  if (brand && PROFILE.company) {
    const co = document.createElement('span');
    co.className = 'co';
    co.textContent = PROFILE.company;
    brand.appendChild(co);
  }
  document.title = `${PROFILE.company || PROFILE.industry || 'Delux crew'} — Delux crew`;
}
// (13 Sep 2026, the owner: the ANZ / NORTH AMERICA pill is gone — each region is simply its own file.)
