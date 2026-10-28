import { applyTheme } from './theme.js';

// Account links and a live connection map; a map is not evidence of an API request.
export function initMember({ THREE }) {
  const links = document.getElementById('memberLinks');
  if (!/^https?:$/.test(location.protocol)) {
    links.hidden = true;
    return { tick() {}, onToolsUsed() {} };
  }
  const providers = { openai: 'OpenAI', whatsapp: 'WhatsApp' };
  const states = { openai: 'disconnected', whatsapp: 'disconnected' };
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = 'providerWires';
  svg.setAttribute('aria-hidden', 'true');
  document.getElementById('hud').prepend(svg);
  const paths = new Map(),
    pulses = new Map();
  const position = new THREE.Vector3();
  let selected = null,
    lastFrame = -Infinity,
    userTheme = '',
    pendingDark = false;
  let loading = false;
  links.addEventListener('keydown', (event) => event.stopPropagation());
  for (const id of Object.keys(providers)) {
    const link = links.querySelector(`[data-provider="${id}"]`);
    const select = () => {
      selected = id;
    };
    const clear = () => {
      if (selected === id) selected = null;
    };
    link.addEventListener('pointerenter', select);
    link.addEventListener('pointerleave', clear);
    link.addEventListener('focus', select);
    link.addEventListener('blur', clear);
  }
  function updateLabels() {
    for (const [id, name] of Object.entries(providers)) {
      const link = links.querySelector(`[data-provider="${id}"]`);
      const verified = states[id] === 'verified';
      link.dataset.verified = String(verified);
      link.title = `${name} — ${verified ? 'API access verified · agent connection map' : 'Connection map preview · configure in Settings'}`;
      link.setAttribute(
        'aria-label',
        `${name}: ${verified ? 'API access verified' : 'configure connection'}. Open settings.`,
      );
    }
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/account/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 401) {
        for (const id of Object.keys(providers)) states[id] = 'disconnected';
      } else {
        if (!response.ok) throw new Error('Status unavailable');
        const { user } = await response.json();
        const theme = JSON.stringify(user.theme);
        if (userTheme !== theme) {
          userTheme = theme;
          applyTheme(user.theme, true);
          pendingDark = true;
          document.body.classList.add('personal-theme');
        }
        for (const id of Object.keys(providers)) states[id] = user.providers[id].status;
      }
      svg.dataset.stale = 'false';
      updateLabels();
    } catch {
      svg.dataset.stale = 'true';
      for (const id of Object.keys(providers)) {
        const link = links.querySelector(`[data-provider="${id}"]`);
        link.dataset.verified = 'false';
        link.title = `${providers[id]} — status unavailable · connection map preview`;
        link.setAttribute('aria-label', `${providers[id]}: status unavailable. Open settings.`);
      }
    } finally {
      clearTimeout(timeout);
      loading = false;
    }
  }
  updateLabels();
  refresh();
  const interval = setInterval(refresh, 15000);
  const onFocus = () => refresh();
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });

  function onToolsUsed(agentId, keys) {
    for (const id of Object.keys(providers))
      if (keys.includes(id)) pulses.set(`${id}:${agentId}`, performance.now() + 1800);
  }
  function tick(now, camera, agents, focused) {
    if (pendingDark && window.CC) {
      window.CC.setDark(document.documentElement.style.colorScheme === 'dark');
      pendingDark = false;
    }
    if (document.hidden || now - lastFrame < 50) return;
    lastFrame = now;
    const show = focused !== 'brain' && !document.body.classList.contains('hero');
    svg.style.display = show ? '' : 'none';
    if (!show) return;
    const visible = new Set();
    for (const [id] of Object.entries(providers)) {
      const link = links.querySelector(`[data-provider="${id}"]`);
      const bounds = link.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const verified = states[id] === 'verified' && svg.dataset.stale !== 'true';
      for (const [agentId, agent] of Object.entries(agents)) {
        const key = `${id}:${agentId}`,
          pulse = (pulses.get(key) || 0) > now;
        if (!pulse && (focused ? agent.a.dept !== focused : !agent.a.lead)) continue;
        position.copy(agent.person.position);
        position.y += 4;
        position.project(camera);
        if (position.z < -1 || position.z > 1) continue;
        const x = ((position.x + 1) * innerWidth) / 2,
          y = ((1 - position.y) * innerHeight) / 2;
        if (x < 0 || x > innerWidth || y < 104 || y > innerHeight) continue;
        let path = paths.get(key);
        if (!path) {
          path = document.createElementNS(svgNS, 'path');
          path.classList.add('provider-wire');
          path.dataset.provider = id;
          path.dataset.agent = agentId;
          svg.appendChild(path);
          paths.set(key, path);
        }
        const sx = bounds.left + bounds.width / 2,
          sy = bounds.bottom;
        path.setAttribute('d', `M ${sx} ${sy} C ${sx} ${sy + (y - sy) * 0.45}, ${x} ${y - 35}, ${x} ${y}`);
        path.dataset.verified = String(verified);
        path.classList.toggle('highlighted', selected === id);
        path.classList.toggle('muted', !!selected && selected !== id);
        path.classList.toggle('activity', pulse);
        path.style.display = '';
        visible.add(key);
      }
    }
    for (const [key, path] of paths) if (!visible.has(key)) path.style.display = 'none';
    for (const [key, expiry] of pulses) if (expiry <= now) pulses.delete(key);
  }
  return { tick, onToolsUsed };
}
