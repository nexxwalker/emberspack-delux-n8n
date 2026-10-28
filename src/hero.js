// Hero mode for the company website (16 Sep 2026). Opt-in: the page sets window.HERO before the bundle;
// without it every export here is inert and the office is unchanged.
//
//   window.HERO = { front: 'marketing', target: [-18, 0, 12], zoom: 1.25, keep: ['mlead','riley','gfx'] }
//
// What it adds, all inside the 3D scene (no HUD):
//   · the Brain sends data to every department and back: pulses run the walkways, then on to an
//     agent's screen, which flashes; replies run back gold
//   · every monitor is a bit wider
//   · the front department's connector tiles sit on the floor under its pod, wired to the pod and
//     to the Brain, with their own pulses
//   · the story, on a loop: in the front department some agents swallow the others' screens and
//     grow (7 → 3); while that happens the other departments stand up, their monitors go dark and
//     a bubble over them says "We're next"; then everything settles back and it plays again
import { MCP_LOGOS, MCP_BY_DEPT } from './mcplogos.js';

export const HERO = typeof window !== 'undefined' && window.HERO ? window.HERO : null;

export function initHero({
  THREE,
  scene,
  R,
  AGENTS,
  deptRT,
  LAYOUT,
  DEPTS,
  DEPT_KEYS,
  view,
  camera,
  spawnEmote,
  isBusy = () => false,
}) {
  const BLUE = 0x6fa0ff,
    GOLD = 0xf2b33d;
  const FRONT = HERO.front && LAYOUT[HERO.front] ? HERO.front : 'marketing';
  const OTHERS = DEPT_KEYS.filter((k) => k !== FRONT);
  const ids = (d) => AGENTS.filter((a) => a.dept === d).map((a) => a.id);
  const keep = (HERO.keep && HERO.keep.length ? HERO.keep : [ids(FRONT)[0], ids(FRONT)[2], ids(FRONT)[5]]).filter(
    (id) => R[id],
  );
  const absorbed = ids(FRONT).filter((id) => !keep.includes(id));

  /* ---------- monitors: find each agent's screen + bezel, widen them ---------- */
  for (const r of Object.values(R)) {
    r.screen = r.desk.getObjectByName('screen');
    r.monBack = r.desk.getObjectByName('monBack');
    if (r.screen) {
      r.screen.scale.x = 1.35;
      r.screen.userData.baseSX = 1.35;
      r.screen.userData.baseSY = 1;
    }
    if (r.monBack) {
      r.monBack.scale.x = 1.32;
      r.monBack.userData.baseSX = 1.32;
    }
    r.screenOn = true;
    r.heroStand = 0;
    r.absorbK = 0;
    r.seat0 = r.seat.clone();
    r.stand0 = r.stand.clone();
    r.stationBase = r.station.position.clone();
    r.seatOff = r.seat.clone().sub(r.stationBase);
    r.standOff = r.stand.clone().sub(r.stationBase);
  }
  const screenWorld = (r) => {
    const v = new THREE.Vector3();
    r.screen.getWorldPosition(v);
    return v;
  };

  /* ---------- pulses: a pooled particle that follows a list of points ---------- */
  const pulseGeo = new THREE.SphereGeometry(0.42, 10, 8);
  const matBlue = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.95, depthTest: false });
  const matGold = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95, depthTest: false });
  const pulses = [];
  function pulse(points, speed, gold, onDone) {
    const m = new THREE.Mesh(pulseGeo, gold ? matGold : matBlue);
    m.renderOrder = 5;
    const tail = [0, 1, 2].map((i) => {
      const t = new THREE.Mesh(pulseGeo, (gold ? matGold : matBlue).clone());
      t.material.opacity = 0.35 - i * 0.1;
      t.scale.setScalar(0.8 - i * 0.18);
      t.renderOrder = 5;
      scene.add(t);
      return t;
    });
    scene.add(m);
    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const l = points[i].distanceTo(points[i - 1]);
      segs.push(l);
      total += l;
    }
    pulses.push({ m, tail, points, segs, total, speed, s: 0, onDone, hist: [] });
  }
  function pulseTick(dt) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.s += p.speed * dt;
      let s = p.s,
        k = 0;
      while (k < p.segs.length && s > p.segs[k]) {
        s -= p.segs[k];
        k++;
      }
      if (k >= p.segs.length) {
        scene.remove(p.m);
        p.tail.forEach((t) => scene.remove(t));
        pulses.splice(i, 1);
        if (p.onDone) p.onDone();
        continue;
      }
      const a = p.points[k],
        b = p.points[k + 1];
      p.m.position.lerpVectors(a, b, s / p.segs[k]);
      p.hist.unshift(p.m.position.clone());
      if (p.hist.length > 9) p.hist.pop();
      p.tail.forEach((t, j) => {
        const h = p.hist[Math.min(p.hist.length - 1, (j + 1) * 3)];
        if (h) t.position.copy(h);
      });
    }
  }

  /* ---------- brain ↔ departments ---------- */
  const brainC = new THREE.Vector3(0, 1.2, 0);
  const lift = (v) => new THREE.Vector3(v.x, 0.9, v.z);
  function flash(r, gold) {
    if (!r.screen || !r.screenOn || liSeat(r.a.id)) return;
    r.flashUntil = performance.now() + 380;
    r.screen.material.color.set(gold ? 0xffe6b0 : 0xcfe0ff);
  }
  function sendToDept(k) {
    const d = deptRT[k],
      pool = ids(k).filter((id) => R[id].screenOn && R[id].absorbK < 0.5);
    if (!pool.length) return;
    const r = R[pool[Math.floor(Math.random() * pool.length)]];
    const target = screenWorld(r);
    pulse(
      [brainC, lift(d.brainGate), lift(d.gate), new THREE.Vector3(target.x, 0.9, target.z), target],
      34,
      false,
      () => {
        flash(r, false);
        setTimeout(
          () => {
            if (!R[r.a.id].screenOn) return;
            pulse(
              [screenWorld(r), new THREE.Vector3(target.x, 0.9, target.z), lift(d.gate), lift(d.brainGate), brainC],
              40,
              true,
            );
          },
          500 + Math.random() * 900,
        );
      },
    );
  }
  let nextSend = 0,
    sendI = 0;

  /* ---------- connector tiles: every department gets its own set below its pod, wired to the pod and the Brain ---------- */
  // The camera looks down the (1,0,1) diagonal: screen-down is world (+x,+z), screen-across is world (+x,-z).
  // A pod whose screen-down points straight at the Brain (emails) gets its row on its outward side instead,
  // so no row ever sits on a walkway.
  const DOWN = new THREE.Vector3(1, 0, 1).normalize(),
    ACROSS = new THREE.Vector3(1, 0, -1).normalize();
  const tiles = [];
  const lineMat = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.22 });
  const loader = new THREE.TextureLoader();
  for (const dk of DEPT_KEYS) {
    const Ld = LAYOUT[dk],
      keysD = (MCP_BY_DEPT[dk] || []).filter((k) => MCP_LOGOS[k] && MCP_LOGOS[k].img).slice(0, 7);
    if (!keysD.length) continue;
    const podC = new THREE.Vector3(Ld.pos[0], 0, Ld.pos[1]);
    const toBrainDir = podC.clone().negate().normalize();
    const useOutward = DOWN.dot(toBrainDir) > 0.85;
    const dir = useOutward ? toBrainDir.clone().negate() : DOWN.clone();
    const across = useOutward ? new THREE.Vector3(-dir.z, 0, dir.x) : ACROSS.clone();
    const centre = podC.clone().addScaledVector(dir, ((Ld.w + Ld.d) / 2) * 0.72 + 5.5);
    const gap = 4.6,
      span = gap * (keysD.length - 1);
    keysD.forEach((k, i) => {
      const pos = centre.clone().addScaledVector(across, -span / 2 + i * gap);
      const tex = loader.load(MCP_LOGOS[k].img);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.scale.set(3.2, 3.2, 1);
      sp.position.set(pos.x, 1.9, pos.z);
      sp.renderOrder = 4;
      scene.add(sp);
      const foot = new THREE.Vector3(pos.x, 0.4, pos.z);
      // the wire meets the pod where the line from the tile to the pod's centre crosses the pod's edge
      const d = podC.clone().sub(foot);
      d.y = 0;
      const tx = d.x ? (Ld.w / 2 - 0.4) / Math.abs(d.x) : 1e9,
        tz = d.z ? (Ld.d / 2 - 0.4) / Math.abs(d.z) : 1e9;
      const podEdge = podC.clone().addScaledVector(d, -Math.min(tx, tz));
      podEdge.y = 0.4;
      const toPod = new THREE.Line(new THREE.BufferGeometry().setFromPoints([foot, podEdge]), lineMat);
      const mid = foot
        .clone()
        .lerp(new THREE.Vector3(0, 0.4, 0), 0.5)
        .addScaledVector(across, 6);
      const curve = new THREE.QuadraticBezierCurve3(foot, mid, new THREE.Vector3(0, 0.4, 0));
      const toBrain = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)), lineMat);
      scene.add(toPod, toBrain);
      tiles.push({
        k,
        dept: dk,
        sp,
        foot,
        podEdge,
        brainPath: curve.getPoints(28).map((q) => new THREE.Vector3(q.x, 0.9, q.z)),
      });
    });
  }
  let nextTile = 0;

  /* ---------- LinkedIn on the big screens ---------- */
  // HERO.linkedin = the owner's feed column (identity removed at capture); HERO.linkedinJobs = a public LinkedIn Jobs results page.
  // Each is painted into a 16:10 canvas under a browser bar and LinkedIn's own top bar, scrolled, and put on one keeper's monitor.
  const LI_QUERIES = [
    'warehouse temps auckland',
    'forklift operators sydney',
    'site managers christchurch',
    'payroll officer melbourne',
  ];
  const liScreens = [];
  function liScreen(seat, src, opts) {
    if (!src || !R[seat]) return;
    const img = new Image();
    img.src = src;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 320;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    liScreens.push({
      seat,
      img,
      c,
      x: c.getContext('2d'),
      tex,
      y: 0,
      on: false,
      prev: null,
      url: opts.url,
      query: opts.query,
      speed: opts.speed || 30,
    });
  }
  liScreen(HERO.linkedinSeat || keep[keep.length - 1], HERO.linkedin, { url: 'linkedin.com/feed' });
  liScreen(HERO.linkedinJobsSeat || keep[0], HERO.linkedinJobs, {
    url: 'linkedin.com/jobs/search',
    query: 'Site Manager · Sydney, NSW',
    speed: 22,
  });
  function roundRect(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }
  function drawLi(L, dt) {
    if (!L.img.complete || !L.img.naturalWidth) return;
    const { x, c, img } = L,
      W = c.width,
      H = c.height,
      now = performance.now() / 1000;
    x.fillStyle = '#1b1f23';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#2a2e33';
    x.fillRect(0, 0, W, 24);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      x.fillStyle = col;
      x.beginPath();
      x.arc(14 + i * 14, 12, 4, 0, 7);
      x.fill();
    });
    x.fillStyle = '#3a3f45';
    roundRect(x, 64, 5, W - 80, 14, 7);
    x.fill();
    x.fillStyle = '#cfd3d8';
    x.font = '10px system-ui, sans-serif';
    x.textBaseline = 'middle';
    x.textAlign = 'left';
    x.fillText(L.url, 72, 12);
    const navY = 24,
      navH = 40;
    x.fillStyle = '#1b1f23';
    x.fillRect(0, navY, W, navH);
    x.fillStyle = '#2f3339';
    x.fillRect(0, navY + navH - 1, W, 1);
    x.fillStyle = '#0A66C2';
    roundRect(x, 10, navY + 8, 24, 24, 4);
    x.fill();
    x.fillStyle = '#fff';
    x.font = 'bold 15px system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillText('in', 22, navY + 21);
    x.fillStyle = '#38434f';
    roundRect(x, 42, navY + 9, 212, 22, 5);
    x.fill();
    let shown;
    if (L.query) shown = L.query;
    else {
      const qi = Math.floor(now / 7) % LI_QUERIES.length,
        q = LI_QUERIES[qi];
      shown =
        q.slice(0, Math.max(0, Math.min(q.length, Math.floor(((now % 7) - 0.6) * 11)))) +
        (Math.floor(now * 2) % 2 ? '|' : '');
    }
    x.fillStyle = '#9aa4ae';
    x.font = '11px system-ui, sans-serif';
    x.textAlign = 'left';
    x.fillText('⌕', 48, navY + 20);
    x.fillStyle = '#e8ecf0';
    x.fillText(shown, 62, navY + 20);
    x.font = '9px system-ui, sans-serif';
    x.textAlign = 'center';
    ['Home', 'My Network', 'Jobs', 'Messaging', 'Notifications'].forEach((t, i) => {
      const cx = 296 + i * 46,
        on = L.query ? i === 2 : i === 0;
      x.fillStyle = on ? '#ffffff' : '#7f8a95';
      x.fillRect(cx - 6, navY + 9, 12, 12);
      x.fillStyle = on ? '#ffffff' : '#b3bcc5';
      x.fillText(t, cx, navY + 30);
    });
    const top = navY + navH + 4,
      iw = W - 12,
      sc = iw / img.naturalWidth,
      ih = img.naturalHeight * sc;
    L.y = (L.y + dt * L.speed) % ih;
    x.save();
    x.beginPath();
    x.rect(6, top, iw, H - top - 4);
    x.clip();
    x.drawImage(img, 6, top - L.y, iw, ih);
    x.drawImage(img, 6, top - L.y + ih, iw, ih);
    x.restore();
    L.tex.needsUpdate = true;
  }
  function drawLinkedIn(dt) {
    for (const L of liScreens) if (L.on) drawLi(L, dt);
  }
  function linkedInOn(on) {
    for (const L of liScreens) {
      const r = R[L.seat];
      if (!r || !r.screen) continue;
      if (on && !L.on) {
        L.prev = r.screen.material.map;
        r.screen.material.map = L.tex;
        r.screen.material.color.set(0xffffff);
        r.screen.material.needsUpdate = true;
        L.on = true;
      }
      if (!on && L.on) {
        r.screen.material.map = L.prev;
        r.screen.material.needsUpdate = true;
        L.on = false;
      }
    }
  }
  const liSeat = (id) => liScreens.some((L) => L.on && L.seat === id);

  linkedInOn(true); // the feed runs on that screen from the start, so it is there whenever someone looks

  /* ---------- the speech bubbles over the other departments ---------- */
  // Everyone says "They streamlined their operations"; one person says "Wow that was quick".
  const BUBBLE_MAIN = 'They streamlined their operations',
    BUBBLE_ONE = 'Wow that was quick';
  const bubbleTexes = {};
  function bubbleTex(text) {
    if (bubbleTexes[text]) return bubbleTexes[text];
    const c = document.createElement('canvas'),
      x = c.getContext('2d');
    x.font = 'bold 60px system-ui, sans-serif';
    const tw = Math.ceil(x.measureText(text).width),
      pad = 44;
    c.width = tw + pad * 2 + 32;
    c.height = 256;
    const x2 = c.getContext('2d'),
      W = c.width;
    const rr = (px, py, w, h, r) => {
      x2.beginPath();
      x2.moveTo(px + r, py);
      x2.arcTo(px + w, py, px + w, py + h, r);
      x2.arcTo(px + w, py + h, px, py + h, r);
      x2.arcTo(px, py + h, px, py, r);
      x2.arcTo(px, py, px + w, py, r);
      x2.closePath();
    };
    rr(16, 16, W - 32, 168, 34);
    x2.fillStyle = 'rgba(244,244,245,0.97)';
    x2.fill();
    x2.lineWidth = 4;
    x2.strokeStyle = 'rgba(111,160,255,0.9)';
    x2.stroke();
    x2.beginPath();
    x2.moveTo(W / 2 - 46, 182);
    x2.lineTo(W / 2, 236);
    x2.lineTo(W / 2 + 34, 182);
    x2.closePath();
    x2.fillStyle = 'rgba(244,244,245,0.97)';
    x2.fill();
    x2.fillStyle = '#151414';
    x2.font = 'bold 60px system-ui, sans-serif';
    x2.textAlign = 'center';
    x2.textBaseline = 'middle';
    x2.fillText(text, W / 2, 102);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.aspect = W / 256;
    bubbleTexes[text] = t;
    return t;
  }
  const bubbles = new Map(); // agent id -> sprite
  function bubbleOn(r, text) {
    if (bubbles.has(r.a.id)) return;
    const tex = bubbleTex(text || BUBBLE_MAIN);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 }));
    s.scale.set(3.6 * tex.userData.aspect, 3.6, 1);
    s.renderOrder = 6;
    scene.add(s);
    bubbles.set(r.a.id, { s, r, born: performance.now() });
  }
  function bubblesOff() {
    for (const b of bubbles.values()) b.dying = performance.now();
  }
  function bubbleTick(now) {
    for (const [id, b] of bubbles) {
      const p = b.r.person.position;
      b.s.position.set(p.x + 0.4, p.y + 6.6 + Math.sin(now / 420) * 0.18, p.z);
      const inK = Math.min(1, (now - b.born) / 350);
      b.s.material.opacity = b.dying ? Math.max(0, 1 - (now - b.dying) / 350) : inK;
      if (b.dying && now - b.dying > 360) {
        scene.remove(b.s);
        bubbles.delete(id);
      }
    }
  }

  /* ---------- fading a whole agent (person + station) ---------- */
  // the engine shares one material per colour (builders.mat caches them), so an agent that fades must own
  // private copies first, or every desk of the same wood fades with it
  function ownMaterials(r) {
    if (r.ownsMats) return;
    for (const root of [r.person, r.station])
      root.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
        }
      });
    r.ownsMats = true;
  }
  function setFade(r, k) {
    // k: 1 = fully visible, 0 = gone: the agent AND its desk
    ownMaterials(r);
    for (const root of [r.person, r.station])
      root.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material.opacity = k;
          o.material.needsUpdate = true;
        }
      });
    r.person.visible = k > 0.02;
    r.station.visible = k > 0.02;
  }

  const Lf = LAYOUT[FRONT];
  /* ---------- the story ---------- */
  // phases (seconds): 0 calm · 3 absorb (front pod swallows, others stand + bubbles) · 9 hold · 13 settle · 16 loop
  const T = { absorbAt: 3, absorbLen: 5.5, holdLen: 4 }; // then 'after': the merged pod stays merged; the other departments go back to work
  let startAt = performance.now(),
    frozen = null; // frozen: a pinned story second, for checks
  let flights = []; // screens in flight
  let camK = 0,
    camBase = null;
  const keeperOf = (i) => R[keep[i % keep.length]];
  let phase = 'calm';
  const phaseStarted = false;
  function startAbsorb(now) {
    absorbed.forEach((id) => ownMaterials(R[id]));
    absorbed.forEach((id, i) => {
      const r = R[id],
        k = keeperOf(i);
      r.absorbK = 0.99;
      // the screen leaves the desk: clone the mesh so the station can fade underneath it
      const ghost = r.screen.clone();
      ghost.material = r.screen.material.clone();
      ghost.material.depthTest = false;
      ghost.renderOrder = 7;
      const from = screenWorld(r);
      ghost.position.copy(from);
      ghost.quaternion.copy(r.screen.getWorldQuaternion(new THREE.Quaternion()));
      ghost.scale.copy(r.screen.scale);
      scene.add(ghost);
      r.screen.material.color.set(0x0a0a0c);
      r.screenOn = false; // the desk stays; the monitor goes dark once its work has gone
      flights.push({ ghost, from, to: k, t0: now + i * 380, dur: 950, r });
    });
    for (const d of OTHERS)
      for (const id of ids(d)) {
        const r = R[id];
        r.heroStand = 1;
        r.screenOn = false;
        r.screen.material.color.set(0x0a0a0c);
      }
    for (const d of OTHERS) {
      const pool = ids(d);
      bubbleOn(R[pool[0]], BUBBLE_ONE);
      bubbleOn(R[pool[Math.min(pool.length - 1, 3)]], BUBBLE_MAIN);
    } // in every department: one says it, the other answers
  }
  function startSettle() {
    bubblesOff();
    for (const d of OTHERS)
      for (const id of ids(d)) {
        const r = R[id];
        r.heroStand = 0;
        r.screenOn = true;
        r.screen.material.color.set(0xffffff);
      }
    for (const id of keep) {
      const r = R[id];
      r.growTo = 1;
    }
  }
  function resetAll() {
    // idempotent: also puts the other departments back, so a seek straight to calm is clean
    startSettle();
    for (const id of absorbed) {
      const r = R[id];
      r.absorbK = 0;
      r.screenOn = true;
      r.screen.material.color.set(0xffffff);
      setFade(r, 1);
    }
    for (const id of keep) {
      const r = R[id];
      r.screen.scale.x = r.screen.userData.baseSX;
      r.screen.scale.y = 1;
      r.monBack.scale.x = r.monBack.userData.baseSX;
      r.monBack.scale.y = 1;
      r.monBack.scale.z = 1;
      r.person.scale.setScalar(1);
      r.station.scale.setScalar(1);
      r.station.position.copy(r.stationBase);
      r.seat.copy(r.seat0);
      r.stand.copy(r.stand0);
      r.grow = 0;
      r.growK = 0;
    }
    flights = [];
  }
  function storyTick(now, dt) {
    const t = frozen != null ? frozen : (now - startAt) / 1000;
    const ph =
      t < T.absorbAt
        ? 'calm'
        : t < T.absorbAt + T.absorbLen
          ? 'absorb'
          : t < T.absorbAt + T.absorbLen + T.holdLen
            ? 'hold'
            : 'after';
    if (ph !== phase) {
      if (ph === 'calm' && phase !== 'calm') resetAll();
      phase = ph;
      if (ph === 'absorb') startAbsorb(now);
      if (ph === 'after') startSettle();
    }
    // screens in flight → into the keeper's screen, which grows on arrival
    for (const f of flights) {
      if (f.done || now < f.t0) continue;
      const u = Math.min(1, (now - f.t0) / f.dur),
        e = u * u * (3 - 2 * u);
      const to = screenWorld(f.to);
      f.ghost.position.lerpVectors(f.from, to, e);
      f.ghost.position.y += Math.sin(e * Math.PI) * 3.2;
      f.ghost.scale.setScalar((1 - e * 0.85) * (f.r.screen.userData.baseSX || 1));
      setFade(f.r, 1 - e);
      if (u >= 1) {
        f.done = true;
        scene.remove(f.ghost);
        f.to.grow = (f.to.grow || 0) + 1;
        flash(f.to, true);
      }
    }
    // keepers: once they have swallowed a screen, the whole workstation grows (desk, chair, agent, screen)
    // and the three spread out to own the pod; everything eases back in settle
    keep.forEach((id, i) => {
      const r = R[id],
        want = phase !== 'calm' && (r.grow || 0) > 0 ? 1 : 0; // once grown, stays grown
      r.growK = (r.growK || 0) + (want - (r.growK || 0)) * Math.min(1, dt * 1.8);
      const g = r.growK,
        sc = 1 + 0.6 * g;
      const slot = new THREE.Vector3(Lf.pos[0] + 1.5, 0.12, Lf.pos[1] + (i - (keep.length - 1) / 2) * 9.8);
      r.station.position.lerpVectors(r.stationBase, slot, g);
      r.station.scale.setScalar(sc);
      r.seat.copy(r.station.position).addScaledVector(r.seatOff, sc);
      r.stand.copy(r.station.position).addScaledVector(r.standOff, sc);
      r.person.scale.setScalar(sc);
      const extra = Math.min(2, r.grow || 0) * 0.14 * g; // and the screen itself a little more per screen swallowed
      r.screen.scale.x = r.screen.userData.baseSX * (1 + extra);
      r.screen.scale.y = 1 + extra * 0.7;
      r.monBack.scale.x = r.monBack.userData.baseSX * (1 + extra);
      r.monBack.scale.y = 1 + extra * 0.7;
      r.monBack.scale.z = 1; // never in depth: the bezel would come through the screen
    });

    // camera: while the merge plays, push in on the front pod so the big screens fill the frame; ease back after
    if (!isBusy()) {
      const wantCam = phase === 'absorb' || phase === 'hold' ? 1 : 0;
      camK = camK + (wantCam - camK) * Math.min(1, dt * 1.4);
      if (!camBase) camBase = { target: view.target.clone(), zoom: view.zoom };
      const podT = new THREE.Vector3(Lf.pos[0] + 4, 0, Lf.pos[1] + 2);
      view.target.lerpVectors(camBase.target, podT, camK);
      view.zoom = camBase.zoom * (1 + 0.55 * camK);
    }
    // the other departments: stand, face the camera
    for (const d of OTHERS)
      for (const id of ids(d)) {
        const r = R[id];
        r.standK = (r.standK || 0) + (r.heroStand - (r.standK || 0)) * Math.min(1, dt * 3);
        if (r.standK > 0.01) {
          const k = r.standK,
            u = r.person.userData;
          r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * k;
          r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * k;
          r.person.position.y = 0.12 + 0.9 * k; // up out of the chair
          u.legs.visible = true;
          const target = Math.PI / 4;
          let dr = target - r.person.rotation.y;
          while (dr > Math.PI) dr -= 2 * Math.PI;
          while (dr < -Math.PI) dr += 2 * Math.PI;
          r.person.rotation.y += dr * Math.min(1, dt * 5) * k;
          if (u.shL) {
            u.shL.rotation.x = -0.15 * k;
            u.shR.rotation.x = -0.15 * k;
          }
        }
      }
  }

  /* ---------- tick ---------- */
  function tick(now, dt) {
    // brain → a department, round-robin, every ~0.45 s; tiles → brain every ~1.1 s
    if (now > nextSend) {
      sendToDept(DEPT_KEYS[sendI++ % DEPT_KEYS.length]);
      nextSend = now + 420 + Math.random() * 260;
    }
    if (tiles.length && now > nextTile) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      const up = Math.random() < 0.5;
      pulse(
        up
          ? [new THREE.Vector3(t.foot.x, 1.9, t.foot.z), ...t.brainPath, brainC]
          : [brainC, ...t.brainPath.slice().reverse(), new THREE.Vector3(t.foot.x, 1.9, t.foot.z)],
        36,
        !up,
      );
      if (Math.random() < 0.5) pulse([new THREE.Vector3(t.foot.x, 1.9, t.foot.z), t.podEdge], 26, false);
      nextTile = now + 380 + Math.random() * 320;
    }
    pulseTick(dt);
    drawLinkedIn(dt);
    for (const r of Object.values(R))
      if (r.flashUntil && now > r.flashUntil) {
        r.flashUntil = 0;
        if (r.screenOn) r.screen.material.color.set(0xffffff);
      }
    storyTick(now, dt);
    bubbleTick(now);
  }
  // for checks: hero.phase() and hero.seek(seconds) jump the story clock
  return {
    tick,
    phase: () => phase,
    seek: (sec) => {
      frozen = null;
      startAt = performance.now() - sec * 1000;
    },
    freeze: (sec) => {
      frozen = sec;
    },
  };
}
