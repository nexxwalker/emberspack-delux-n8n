// LIVE SCREENS (14 Sep 2026). the owner: viewers ask "what are they doing, it just looks like an animation" —
// so every monitor plays what its seat really runs on. Three players, one per screen kind:
//   cli  — a recorded Claude Code session (real tool calls, real results, real timings; recorded by
//          industry-demos/screens/tools/record.mjs against the demo company's sample brain), replayed
//          at recorded speed and looped, drawn the way the CLI prints.
//   web  — a real web page captured from Chrome (a tall strip), scrolled at reading pace inside a
//          browser frame with the Claude-in-Chrome badge, the row being read outlined.
//   app  — the document the seat is producing, typed out in a document window.
// Data arrives as window.SCREENS ({ seats:{id:{kind, rec|page|doc}}, transcripts, pages }), built by
// industry-demos/screens/tools/assemble.mjs and injected by build-industry.mjs --screens. Without it
// every export is a no-op and the desks keep their cream three-line screens (the shipped build and the
// served office are unchanged).
import * as THREE from 'three';

export const SCREENS = typeof window !== 'undefined' && window.SCREENS && window.SCREENS.seats ? window.SCREENS : null;
export const hasScreens = () => !!SCREENS;

export const W = 512,
  H = 320;
const BRAIN = (SCREENS && SCREENS.brain) || 'harlan-grove-brain';
const OWNER = SCREENS && SCREENS.company ? String(SCREENS.company).split(' · ')[0] : 'Harlan Grove'; // one texture size for every screen (16:10 monitor)
const MONO = 'system-ui, sans-serif';
const SANS = 'system-ui, sans-serif';
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rnd = (a, b) => a + Math.random() * (b - a);

function canvas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { c, x, tex };
}
function rrect(x, X, y, w, h, r) {
  x.beginPath();
  x.roundRect(X, y, w, h, r);
}

/* ================= cli: Claude Code, exactly as it prints ================= */
const CLI = {
  bg: '#141416',
  ink: '#E8E6DF',
  dim: '#8B8E95',
  tool: '#5FCB95',
  spin: '#D97757',
  box: '#D97757',
  bar: '#26262A',
  prompt: '#E8E6DF',
};
const VERBS = [
  'Thinking',
  'Cogitating',
  'Pondering',
  'Deliberating',
  'Synthesizing',
  'Reasoning',
  'Considering',
  'Working',
  'Reading',
  'Composing',
  'Checking',
];
const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const FONT = 12,
  LH = 16,
  COLS = 63,
  PAD = 10,
  TOP = 24;

function wrap(s, cols) {
  const out = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      if ((line + ' ' + w).trim().length > cols) {
        if (line) out.push(line);
        line = w;
      } else line = (line ? line + ' ' : '') + w;
    }
    out.push(line);
  }
  return out;
}

function cliPlayer(seat, tr) {
  const { c, x, tex } = canvas();
  const task = tr.task || 'Working through the queue';
  const events = (tr.events || []).filter((e) => e.k !== 'init');
  const t0 = events.length ? events[0].t : 0;
  // the loop's timeline: banner → typed prompt → the recorded events at their own spacing → hold → again
  const TYPE_MS = 26,
    TYPE_AT = 900,
    GAP_CAP = 7000,
    HOLD = 6500;
  const typed = TYPE_AT + task.length * TYPE_MS + 600;
  const steps = [];
  let clock = typed,
    prev = t0;
  for (const e of events) {
    const gap = Math.min(GAP_CAP, Math.max(120, e.t - prev));
    clock += gap;
    prev = e.t;
    steps.push({ at: clock, e });
  }
  const total = clock + HOLD;
  let start = performance.now() - Math.random() * total; // every seat starts somewhere else in its loop
  let lastDraw = -1;
  const lastKey = '';
  const lines = []; // { s, col, bold }
  const push = (s, col, indent = 0) => {
    for (const l of wrap(s, COLS - indent)) lines.push({ s: ' '.repeat(indent) + l, col });
  };
  const banner = () => {
    lines.length = 0;
    lines.push({ s: '╭' + '─'.repeat(COLS - 2) + '╮', col: CLI.box });
    lines.push({
      s: '│ ✻ Welcome to Claude Code' + ' '.repeat(COLS - 27) + '│',
      col: CLI.box,
      mix: [
        [2, 3, CLI.spin],
        [4, 26, CLI.ink],
      ],
    });
    lines.push({ s: '│' + ' '.repeat(COLS - 2) + '│', col: CLI.box });
    lines.push({
      s:
        '│   ' +
        (tr.model && /opus/i.test(tr.model) ? 'Opus' : 'Sonnet') +
        ' · ~/' +
        BRAIN +
        ' '.repeat(Math.max(1, COLS - 3 - 2 - (tr.model && /opus/i.test(tr.model) ? 4 : 6) - 5 - BRAIN.length)) +
        '│',
      col: CLI.box,
      mix: [[4, COLS - 2, CLI.dim]],
    });
    lines.push({ s: '╰' + '─'.repeat(COLS - 2) + '╯', col: CLI.box });
    lines.push({ s: '', col: CLI.ink });
  };
  banner();
  let built = 0,
    promptShown = false,
    done = null,
    tokens = 0;
  const spinVerb = 0;

  function rebuild(el) {
    // el = ms into this loop; rebuild the scrollback from the steps that have happened
    banner();
    promptShown = el >= TYPE_AT;
    done = null;
    const n = Math.min(task.length, Math.max(0, Math.floor((el - TYPE_AT) / TYPE_MS)));
    if (promptShown) {
      push('> ' + task.slice(0, n), CLI.prompt);
      lines.push({ s: '', col: CLI.ink });
    }
    built = 0;
    for (const st of steps) {
      if (el < st.at) break;
      built++;
      const e = st.e;
      if (e.k === 'tool') {
        lines.push({ s: '⏺ ' + e.name + '(' + (e.arg || '') + ')', col: CLI.ink, mix: [[0, 1, CLI.tool]], clip: true });
      } else if (e.k === 'result') {
        lines.push({ s: '  ⎿  ' + (e.line || 'Done'), col: CLI.dim, clip: true });
      } else if (e.k === 'text') {
        lines.push({ s: '', col: CLI.ink });
        push('⏺ ' + e.text, CLI.ink);
        lines.push({ s: '', col: CLI.ink });
      } else if (e.k === 'done') {
        done = e;
      }
    }
    if (done) {
      lines.push({ s: '', col: CLI.ink });
      lines.push({ s: '> ', col: CLI.prompt, cursor: true });
    }
  }

  function draw(now) {
    const el = (now - start) % total;
    if (now - start >= total) start = now - el;
    rebuild(el);
    x.fillStyle = CLI.bg;
    x.fillRect(0, 0, W, H);
    // title bar (macOS Terminal): traffic lights + title
    x.fillStyle = CLI.bar;
    x.fillRect(0, 0, W, TOP);
    for (const [i, col] of [['#FF5F57'], ['#FEBC2E'], ['#28C840']].map((a, i) => [i, a[0]])) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(14 + i * 18, TOP / 2, 5, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#A9ABB2';
    x.font = `500 11px ${SANS}`;
    x.textAlign = 'center';
    x.fillText(`${seat.name ? seat.name.toLowerCase().replace(/ /g, '-') : 'agent'} — claude — ~/${BRAIN}`, W / 2, 16);
    x.textAlign = 'left';
    // scrollback: the last lines that fit, leaving the spinner line
    const spinning = promptShown && el > typed && !done;
    const room = Math.floor((H - TOP - PAD - (spinning ? LH + 6 : 0)) / LH);
    const vis = lines.slice(Math.max(0, lines.length - room));
    x.font = `${FONT}px ${MONO}`;
    x.textBaseline = 'alphabetic';
    let y = TOP + PAD + FONT;
    const cw = x.measureText('M').width;
    for (const l of vis) {
      let s = l.s;
      if (l.clip && s.length > COLS) s = s.slice(0, COLS - 1) + '…';
      x.fillStyle = l.col;
      x.fillText(s, PAD, y);
      if (l.mix)
        for (const [a, b, col] of l.mix) {
          x.fillStyle = CLI.bg;
          x.fillRect(PAD + a * cw - 1, y - FONT, (b - a) * cw + 2, FONT + 4);
          x.fillStyle = col;
          x.fillText(s.slice(a, b), PAD + a * cw, y);
        }
      if (l.cursor && Math.floor(now / 530) % 2 === 0) {
        x.fillStyle = CLI.ink;
        x.fillRect(PAD + s.length * cw, y - FONT + 1, cw, FONT + 2);
      }
      y += LH;
    }
    if (promptShown && el < typed && Math.floor(now / 530) % 2 === 0) {
      // caret while typing the prompt
      const last = vis[vis.length - 2] || vis[vis.length - 1];
      if (last) {
        x.fillStyle = CLI.ink;
        x.fillRect(PAD + last.s.length * cw, y - LH * 2 - FONT + 1, cw, FONT + 2);
      }
    }
    if (spinning) {
      const secs = Math.floor((el - typed) / 1000);
      const verb = VERBS[(spinVerb + built) % VERBS.length];
      const g = GLYPHS[Math.floor(now / 110) % GLYPHS.length];
      tokens = Math.round((1.2 * (el - typed)) / 100 + built * 340);
      const yy = H - PAD - 2;
      x.fillStyle = CLI.spin;
      x.fillText(g + ' ' + verb + '…', PAD, yy);
      x.fillStyle = CLI.dim;
      x.fillText(
        `(${secs}s · ↓ ${tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : tokens} tokens · esc to interrupt)`,
        PAD + (verb.length + 3) * cw + 6,
        yy,
      );
    }
  }
  return {
    kind: 'cli',
    tex,
    canvas: c,
    tick(now, slow) {
      // redraw when the scene demands: spinner/caret cadence, slower when the camera is far away
      const period = slow ? 260 : 110;
      const key = Math.floor(now / period);
      if (key === lastDraw) return false;
      lastDraw = key;
      draw(now);
      tex.needsUpdate = true;
      return true;
    },
  };
}

/* ================= web: a real page under Claude in Chrome ================= */
const CH = {
  tabs: '#DEE1E6',
  tab: '#FFFFFF',
  bar: '#FFFFFF',
  omni: '#F1F3F4',
  ink: '#202124',
  dim: '#5F6368',
  claude: '#D97757',
  line: '#DADCE0',
};
const TABS = 24,
  BAR = 30,
  CHROME = TABS + BAR;

function webPlayer(seat, page) {
  const { c, x, tex } = canvas();
  const img = new Image();
  let ready = false;
  img.onload = () => {
    ready = true;
  };
  img.src = page.img;
  const scale = W / (page.w || 564);
  const view = H - CHROME; // page pixels visible, in canvas space
  const maxY = Math.max(0, Math.round((page.h || 3000) * scale) - view);
  let y = Math.random() * maxY * 0.6,
    from = y,
    to = y,
    t0 = 0,
    t1 = 0,
    hold = performance.now() + rnd(600, 2400);
  let mark = null; // { y, h, at }
  let reload = 0; // > now while the loading bar runs
  let lastDraw = -1;
  const host = (page.url || '').replace(/^https?:\/\//, '').split('/')[0];

  function plan(now) {
    if (now < hold) return;
    if (y >= maxY - 2) {
      // bottom: reload and go back to the top
      reload = now + 900;
      y = from = to = 0;
      hold = now + rnd(1400, 2200);
      mark = null;
      return;
    }
    from = y;
    to = Math.min(maxY, y + rnd(200, 420));
    t0 = now;
    t1 = now + rnd(700, 1100);
    hold = t1 + rnd(1500, 3200);
    mark = Math.random() < 0.7 ? { y: rnd(0.25, 0.6), h: rnd(70, 130), at: t1 + 200 } : null;
  }
  function draw(now) {
    plan(now);
    if (now < t1) y = from + (to - from) * ease(Math.min(1, (now - t0) / (t1 - t0)));
    else y = to;
    // page
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, CHROME, W, view);
    if (ready) {
      const sy = y / scale,
        sh = view / scale;
      x.drawImage(img, 0, sy, page.w || img.width, sh, 0, CHROME, W, view);
    } else {
      x.fillStyle = '#F1F3F4';
      x.fillRect(0, CHROME, W, view);
    }
    // the row being read: Claude's outline
    if (mark && now > mark.at && now < mark.at + 2600) {
      const a = Math.min(1, (now - mark.at) / 250) * Math.min(1, (mark.at + 2600 - now) / 500);
      x.strokeStyle = `rgba(217,119,87,${(0.95 * a).toFixed(2)})`;
      x.lineWidth = 2;
      rrect(x, 8, CHROME + mark.y * view, W - 16, mark.h, 4);
      x.stroke();
      x.fillStyle = `rgba(217,119,87,${(0.9 * a).toFixed(2)})`;
      rrect(x, 8, CHROME + mark.y * view - 12, 54, 12, 3);
      x.fill();
      x.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      x.font = `600 8px ${SANS}`;
      x.fillText('Claude', 14, CHROME + mark.y * view - 3);
    }
    // chrome: tab strip
    x.fillStyle = CH.tabs;
    x.fillRect(0, 0, W, TABS);
    for (const [i, col] of ['#FF5F57', '#FEBC2E', '#28C840'].entries()) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(13 + i * 17, TABS / 2, 5, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = CH.tab;
    rrect(x, 66, 4, 190, TABS - 4, 6);
    x.fill();
    x.fillStyle = CH.claude;
    x.beginPath();
    x.arc(78, TABS / 2 + 2, 4, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = CH.ink;
    x.font = `11px ${SANS}`;
    x.fillText((page.title || host).slice(0, 30), 88, TABS / 2 + 6);
    x.fillStyle = CH.dim;
    x.fillText('+', 268, TABS / 2 + 6);
    // toolbar + omnibox
    x.fillStyle = CH.bar;
    x.fillRect(0, TABS, W, BAR);
    x.fillStyle = CH.dim;
    x.font = `13px ${SANS}`;
    x.fillText('‹  ›  ↻', 10, TABS + 20);
    x.fillStyle = CH.omni;
    rrect(x, 66, TABS + 5, W - 66 - 74, BAR - 10, 10);
    x.fill();
    x.fillStyle = CH.ink;
    x.font = `11px ${SANS}`;
    x.fillText('🔒 ' + (page.url || '').replace(/^https?:\/\//, '').slice(0, 58), 76, TABS + 19);
    // the Claude in Chrome badge
    x.fillStyle = CH.claude;
    rrect(x, W - 66, TABS + 6, 56, BAR - 12, 9);
    x.fill();
    x.fillStyle = '#fff';
    x.font = `600 10px ${SANS}`;
    x.fillText('✱ Claude', W - 58, TABS + 19);
    x.fillStyle = CH.line;
    x.fillRect(0, CHROME - 1, W, 1);
    if (now < reload) {
      const p = 1 - (reload - now) / 900;
      x.fillStyle = '#1A73E8';
      x.fillRect(0, CHROME - 2, W * p, 2);
    }
  }
  return {
    kind: 'web',
    tex,
    canvas: c,
    tick(now, slow) {
      const moving = now < t1 || (mark && now > mark.at - 50 && now < mark.at + 2700) || now < reload;
      const period = moving ? (slow ? 120 : 50) : 900;
      const key = Math.floor(now / period);
      if (key === lastDraw) return false;
      lastDraw = key;
      draw(now);
      tex.needsUpdate = true;
      return true;
    },
  };
}

/* ================= app: the document the seat is writing ================= */
const DOC = { bar: '#ECECEC', page: '#FFFFFF', ink: '#1C1C1E', dim: '#6E6E73', accent: '#2B6BEB', bg: '#D9D9DC' };
function appPlayer(seat, doc) {
  const { c, x, tex } = canvas();
  const title = doc.title || 'Document';
  const body = [doc.task || '', '', ...(doc.lines || []), '', doc.total ? 'Total: ' + doc.total : ''].filter(
    (l, i, a) => !(l === '' && a[i - 1] === ''),
  );
  const chars = body.reduce((n, l) => n + l.length + 1, 0);
  const TYPE = 38,
    HOLD = 5200,
    LEAD = 900;
  const total = LEAD + chars * TYPE + HOLD;
  let start = performance.now() - Math.random() * total,
    lastDraw = -1;
  const file =
    (doc.file ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')) + '.md';
  function draw(now) {
    const el = (now - start) % total;
    if (now - start >= total) start = now - el;
    const n = Math.max(0, Math.floor((el - LEAD) / TYPE));
    x.fillStyle = DOC.bg;
    x.fillRect(0, 0, W, H);
    x.fillStyle = DOC.bar;
    x.fillRect(0, 0, W, 24);
    for (const [i, col] of ['#FF5F57', '#FEBC2E', '#28C840'].entries()) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(13 + i * 17, 12, 5, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = DOC.dim;
    x.font = `500 11px ${SANS}`;
    x.textAlign = 'center';
    x.fillText(`${file} — ${OWNER}`, W / 2, 16);
    x.textAlign = 'left';
    const finished = n >= chars;
    if (finished) {
      x.fillStyle = '#2E9E6B';
      rrect(x, W - 62, 5, 54, 14, 7);
      x.fill();
      x.fillStyle = '#fff';
      x.font = `600 9px ${SANS}`;
      x.fillText('✓ Saved', W - 52, 15);
    } else {
      x.fillStyle = DOC.dim;
      x.font = `9px ${SANS}`;
      x.fillText('Editing', W - 46, 15);
    }
    // the page
    x.fillStyle = DOC.page;
    x.fillRect(28, 34, W - 56, H - 34);
    x.fillStyle = DOC.ink;
    x.font = `600 15px ${SANS}`;
    x.fillText(title, 44, 62);
    x.fillStyle = DOC.accent;
    x.fillRect(44, 70, 36, 2);
    x.font = `11.5px ${SANS}`;
    let y = 92,
      left = n,
      drawn = 0;
    for (const l of body) {
      if (left <= 0 && !finished) break;
      const s = finished ? l : l.slice(0, Math.max(0, left));
      left -= l.length + 1;
      x.fillStyle = drawn === 0 ? DOC.ink : DOC.ink;
      x.font = drawn === 0 ? `600 11.5px ${SANS}` : `11.5px ${SANS}`;
      x.fillText(s, 44, y);
      if (!finished && left <= 0 && Math.floor(now / 500) % 2 === 0) {
        x.fillStyle = DOC.ink;
        x.fillRect(46 + x.measureText(s).width, y - 11, 1.5, 14);
      }
      y += 18;
      drawn++;
      if (y > H - 10) break;
    }
  }
  return {
    kind: 'app',
    tex,
    canvas: c,
    tick(now, slow) {
      const period = slow ? 240 : 90;
      const key = Math.floor(now / period);
      if (key === lastDraw) return false;
      lastDraw = key;
      draw(now);
      tex.needsUpdate = true;
      return true;
    },
  };
}

/* ================= the seat → player factory ================= */
export function makeScreen(seatId, seatName) {
  if (!SCREENS) return null;
  const s = SCREENS.seats[seatId];
  if (!s) return null;
  const seat = { id: seatId, name: seatName || s.name || '' };
  if (s.kind === 'web' && SCREENS.pages && SCREENS.pages[s.page]) return webPlayer(seat, SCREENS.pages[s.page]);
  if (s.kind === 'app' && s.doc) return appPlayer(seat, s.doc);
  const tr = SCREENS.transcripts && SCREENS.transcripts[s.rec || seatId];
  if (tr) return cliPlayer(seat, tr);
  return null;
}
