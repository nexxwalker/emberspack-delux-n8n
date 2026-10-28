// Delux crew V3.2.1 (16 Sep 2026) — the CALENDAR (P). One quiet screen with everything the office
// has done, is doing, and will do on the day it belongs to: finished tasks on the day they finished,
// today's work on today, tasks scheduled for a date, and every routine projected forward on the days
// it will fire. Click a day to schedule a task for it, or to start a routine from that date. A rail on
// the left lists the routines themselves — cadence, next run, paused — so the timetable is never a
// guess. Month and week. Reads the office's own task and routine arrays (tasks.js owns them); live or
// demo makes no difference here.
//
//   initCalendar(ctx) → { open, close, toggle, isOpen, refresh }
//   ctx: tasks, routines (the live arrays) · agentOf · DEPTS · DEPT_KEYS · RT_DEPTS · rtRefuse
//        create({ dept, text, at, model }) → Promise<{ ok, task, error }>   (a task for a date)
//        createRoutine({ dept, text, when, needsOk, model }) → Promise<{ ok, routine, error }>
//        cancelTask(t) · rtAct(id, act) · openAgent(id, tab) · esc · isLive() · officeModel() · MODEL_KEYS · modelName · business()
import { occurrences, describe, untilText, fromPicker, shortDate } from './when.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // the week starts on Monday (AU/NZ/UK)
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const startOfDay = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const mondayOf = (ts) => {
  const d = new Date(startOfDay(ts));
  const k = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - k);
  return d.getTime();
};
const CADENCES = [
  ['daily', 'Every day'],
  ['weekdays', 'Every weekday'],
  ['mon', 'Mondays'],
  ['tue', 'Tuesdays'],
  ['wed', 'Wednesdays'],
  ['thu', 'Thursdays'],
  ['fri', 'Fridays'],
  ['sat', 'Saturdays'],
  ['sun', 'Sundays'],
  ['hourly', 'Every hour, 9–5, weekdays'],
];

export function initCalendar(ctx) {
  const {
    tasks,
    routines,
    agentOf,
    DEPTS,
    DEPT_KEYS,
    RT_DEPTS,
    rtRefuse,
    create,
    createRoutine,
    cancelTask,
    rtAct,
    openAgent,
    esc,
    isLive,
    officeModel,
    MODEL_KEYS,
    modelName,
    business,
    currentDept,
  } = ctx;
  const ov = document.getElementById('calOv');
  if (!ov) return null;
  const $ = (s) => ov.querySelector(s);
  const E = {
    title: $('#cvTitle'),
    grid: $('#cvGrid'),
    dow: $('#cvDow'),
    rail: $('#cvRail'),
    railN: $('#cvRtN'),
    chips: $('#cvChips'),
    search: $('#cvSearch'),
    stats: $('#cvStats'),
    pop: $('#cvPop'),
    co: $('#cvCo'),
    seg: $('.cv-seg'),
  };
  let openNow = false,
    view = 'month',
    anchor = startOfDay(Date.now()),
    q = '',
    deptOn = new Set(DEPT_KEYS),
    showRoutines = true,
    showDone = true,
    onlyRoutine = null,
    popKind = null,
    lastDept = 'marketing';
  const MAX = { month: 3, week: 8 };

  /* ---------- what is on each day ---------- */
  function range() {
    // [from, to) of the days on screen
    if (view === 'week') {
      const a = mondayOf(anchor);
      return { from: a, to: a + 7 * DAY, days: 7 };
    }
    const d = new Date(anchor);
    d.setDate(1);
    const first = mondayOf(d.getTime());
    const rows = Math.ceil((new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() + ((d.getDay() + 6) % 7)) / 7);
    return { from: first, to: first + rows * 7 * DAY, days: rows * 7 };
  }
  const matches = (s) =>
    !q ||
    String(s || '')
      .toLowerCase()
      .includes(q);
  function events(from, to) {
    // day key → [{ kind, at, title, dept, agent, t?, r? }]
    const by = {};
    const push = (ev) => {
      if (!deptOn.has(ev.dept)) return;
      if (!matches(ev.title + ' ' + (agentOf(ev.agent)?.name || ''))) return;
      (by[ymd(new Date(ev.at))] ||= []).push(ev);
    };
    const today = startOfDay(Date.now());
    for (const t of tasks) {
      if (t.piece) continue; // a team's pieces sit under the lead's card
      if (onlyRoutine && t.routine !== onlyRoutine) continue;
      if (t.state === 'done') {
        if (showDone && t.doneAt >= from && t.doneAt < to)
          push({ kind: 'done', at: t.doneAt, title: t.title, dept: t.dept, agent: t.agent, t });
      } else if (t.state === 'scheduled') {
        if (t.dueAt >= from && t.dueAt < to)
          push({ kind: 'sched', at: t.dueAt, title: t.title, dept: t.dept, agent: t.agent, t });
      } else if (t.state === 'waiting' || t.state === 'doing' || t.state === 'next') {
        if (today >= from && today < to)
          push({
            kind: t.state,
            at: Math.max(today + 1, Math.min(today + DAY - 1, t.changedAt || Date.now())),
            title: t.title,
            dept: t.dept,
            agent: t.agent,
            t,
          });
      }
    }
    if (showRoutines)
      for (const r of routines) {
        if (r.paused || (onlyRoutine && r.id !== onlyRoutine)) continue;
        if (!r.when || r.when.kind === 'minutes') continue; // a filming cadence is not a calendar
        const startAt = Math.max(from - 1, Date.now() - 1); // routines are only projected forward: what has run is a done task already
        const occ = occurrences(r.when, startAt, to - 1, 800);
        if (r.when.kind === 'hourly') {
          const seen = new Set();
          for (const at of occ) {
            const k = ymd(new Date(at));
            if (seen.has(k)) continue;
            seen.add(k);
            push({ kind: 'routine', at, title: r.title, dept: r.dept, agent: r.agent, r, hourly: true });
          }
        } else for (const at of occ) push({ kind: 'routine', at, title: r.title, dept: r.dept, agent: r.agent, r });
      }
    for (const k in by) by[k].sort((a, b) => a.at - b.at);
    return by;
  }

  /* ---------- drawing ---------- */
  const av = (id) => {
    const a = agentOf(id);
    const c = a ? DEPTS[a.dept].chip : '#ccc';
    return `<i class="cv-av" style="border-color:${c};background:${c}55" title="${esc(a ? a.name : id)}">${esc(a ? a.name[0] : '?')}</i>`;
  };
  function cardHTML(ev) {
    const chip = DEPTS[ev.dept].chip,
      a = agentOf(ev.agent);
    const time =
      ev.kind === 'routine'
        ? ev.hourly
          ? describe(ev.r.when).replace(/ · from .*$/, '')
          : hm(ev.at)
        : ev.kind === 'done'
          ? `done ${hm(ev.at)}`
          : ev.kind === 'sched'
            ? `${hm(ev.at)} · scheduled`
            : ev.kind === 'doing'
              ? 'in progress'
              : ev.kind === 'waiting'
                ? 'waiting for your OK'
                : 'in the backlog';
    const id = ev.t ? `t:${ev.t.id}` : `r:${ev.r.id}:${ev.at}`;
    return `<div class="cv-ev ${ev.kind}${ev.t?.team?.members?.length ? ' team' : ''}" data-ev="${id}" style="--chip:${chip}" title="${esc(ev.title)} · ${esc(a ? a.name : '')}">
      <div class="cv-ev-t">${ev.kind === 'routine' ? '<span class="cv-rt">⏱</span>' : ev.kind === 'done' ? '<span class="cv-tick">✓</span>' : ev.kind === 'sched' ? '<span class="cv-rt">◷</span>' : ev.t?.team?.members?.length ? '<span class="cv-rt">⚑</span>' : ''}${esc(ev.title)}</div>
      <div class="cv-ev-m"><span>${esc(time)}</span>${av(ev.agent)}</div></div>`;
  }
  function render() {
    const { from, to, days } = range();
    const by = events(from, to),
      today = ymd(new Date());
    const a = new Date(anchor);
    E.title.innerHTML =
      view === 'month'
        ? `${MONTHS[a.getMonth()]} <small>${a.getFullYear()}</small>`
        : (() => {
            const s = new Date(from),
              e = new Date(to - DAY);
            return `${s.getDate()}–${e.getDate()} ${s.getMonth() === e.getMonth() ? MONTHS[e.getMonth()] : MONTHS[s.getMonth()].slice(0, 3) + ' – ' + e.getDate() + ' ' + MONTHS[e.getMonth()]} <small>${e.getFullYear()}</small>`;
          })();
    E.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    E.dow.innerHTML = DOW.map((d) => `<div>${d}</div>`).join('');
    E.grid.className = 'cv-grid ' + view;
    E.grid.style.setProperty('--rows', days / 7);
    let html = '',
      nDone = 0,
      nSched = 0,
      nRt = 0;
    for (let i = 0; i < days; i++) {
      const ts = from + i * DAY,
        d = new Date(ts),
        k = ymd(d),
        list = by[k] || [],
        dow = (d.getDay() + 6) % 7;
      const out = view === 'month' && d.getMonth() !== a.getMonth(),
        past = ts < startOfDay(Date.now()),
        max = view === 'month' && days > 35 ? 2 : MAX[view];
      for (const ev of list) {
        if (ev.kind === 'done') nDone++;
        else if (ev.kind === 'sched') nSched++;
        else if (ev.kind === 'routine') nRt++;
      }
      html += `<div class="cv-day${k === today ? ' today' : ''}${out ? ' out' : ''}${past ? ' past' : ''}${dow >= 5 ? ' wknd' : ''}" data-day="${k}">
        <button class="cv-add" title="schedule something on ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}">+</button>
        <div class="cv-evs">${list.slice(0, max).map(cardHTML).join('')}${list.length > max ? `<button class="cv-more" data-day="${k}">${list.length - max} more</button>` : ''}</div>
        <div class="cv-num">${view === 'week' ? `<span>${DOW[dow]}</span>` : ''}${d.getDate() === 1 && view === 'month' ? `<span>${MONTHS[d.getMonth()].slice(0, 3)}</span>` : ''}<b>${pad(d.getDate())}</b></div></div>`;
    }
    E.grid.innerHTML = html;
    E.stats.innerHTML = `<span><b>${nRt}</b> routine ${nRt === 1 ? 'run' : 'runs'}</span><span><b>${nSched}</b> scheduled</span><span><b>${nDone}</b> done</span>`;
    renderRail();
    renderChips();
  }
  function renderRail() {
    const list = routines
      .slice()
      .sort((x, y) => (x.paused ? Infinity : x.nextAt || Infinity) - (y.paused ? Infinity : y.nextAt || Infinity));
    E.railN.textContent = list.length;
    E.rail.innerHTML = list.length
      ? list
          .map((r) => {
            const a = agentOf(r.agent),
              chip = DEPTS[r.dept].chip;
            return `<div class="cv-r${r.paused ? ' paused' : ''}${onlyRoutine === r.id ? ' on' : ''}" data-rid="${r.id}" style="--chip:${chip}">
        <div class="cv-r-t">${esc(r.title)}</div>
        <div class="cv-r-m">${esc(r.desc || describe(r.when))} · ${esc(a ? a.name : r.agent)}</div>
        <div class="cv-r-n">${r.paused ? '<span class="cv-paused">PAUSED</span>' : `next ${esc(untilText(r.nextAt))}`}${r.needsOk ? ' · waits for your OK' : ''}</div></div>`;
          })
          .join('')
      : `<div class="cv-empty">No routines yet.<br>Click a day, write what should happen, switch on REPEAT.</div>`;
  }
  function renderChips() {
    E.chips.innerHTML =
      DEPT_KEYS.map(
        (k) =>
          `<button class="cv-chip${deptOn.has(k) ? ' on' : ''}" data-dept="${k}"><i style="background:${DEPTS[k].chip}"></i>${DEPTS[k].short}</button>`,
      ).join('') +
      `<span class="cv-sep"></span><button class="cv-chip${showRoutines ? ' on' : ''}" data-tog="routines"><i class="rt">⏱</i>ROUTINES</button><button class="cv-chip${showDone ? ' on' : ''}" data-tog="done"><i class="tick">✓</i>DONE</button>` +
      (onlyRoutine ? `<button class="cv-chip only on" data-tog="only">ONLY THIS ROUTINE ✕</button>` : '');
  }

  /* ---------- the popovers: a day (create), an event (details), "n more" (the whole day) ---------- */
  function place(el, anchorEl) {
    // beside the cell, kept on screen
    const r = anchorEl.getBoundingClientRect(),
      W = el.offsetWidth || 360,
      H = el.offsetHeight || 300;
    let x = r.right + 10,
      y = r.top;
    if (x + W > innerWidth - 12) x = r.left - W - 10;
    if (x < 12) x = Math.max(12, Math.min(innerWidth - W - 12, r.left));
    if (y + H > innerHeight - 12) y = Math.max(12, innerHeight - H - 12);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  function closePop() {
    E.pop.hidden = true;
    E.pop.innerHTML = '';
    popKind = null;
    ov.querySelectorAll('.cv-day.sel').forEach((n) => n.classList.remove('sel'));
  }
  function openCreate(dayKey, cell) {
    closePop();
    popKind = 'create';
    cell.classList.add('sel');
    if (currentDept && DEPT_KEYS.includes(currentDept())) lastDept = currentDept(); // the popover opens on the bar's department
    const d = new Date(dayKey + 'T00:00:00'),
      past = d.getTime() < startOfDay(Date.now());
    E.pop.innerHTML = `<div class="cv-pop-h"><span class="lab">SCHEDULE FOR</span><b>${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}</b><span class="sp"></span><button class="cv-x" data-act="close">✕</button></div>
      ${past ? '<div class="cv-note">That day has passed — pick today or a day after it.</div>' : ''}
      <div class="cv-row"><select class="cv-dept">${DEPT_KEYS.map((k) => `<option value="${k}"${k === lastDept ? ' selected' : ''}>${DEPTS[k].name}</option>`).join('')}</select><input type="time" class="cv-time" value="09:00"><select class="cv-model" title="which model runs it"><option value="">${esc(modelName(officeModel()).toUpperCase())}</option>${MODEL_KEYS.filter(
        (k) => k !== officeModel(),
      )
        .map((k) => `<option value="${k}">${esc(modelName(k).toUpperCase())}</option>`)
        .join('')}</select></div>
      <textarea class="cv-text" rows="3" placeholder="What should happen that day?"></textarea>
      <div class="cv-row"><button class="cv-rep" data-act="rep">REPEAT</button><select class="cv-cad" hidden>${CADENCES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><label class="cv-ok" hidden><input type="checkbox" class="cv-okc" checked> needs my OK</label><span class="sp"></span><button class="cv-go" data-act="go"${past ? ' disabled' : ''}>ADD</button></div>
      <div class="cv-hint">${past ? '' : 'A task for this day — it runs at that time and lands in the panel. REPEAT makes it a routine from this date.'}</div>`;
    E.pop.hidden = false;
    place(E.pop, cell);
    const P = {
      dept: E.pop.querySelector('.cv-dept'),
      time: E.pop.querySelector('.cv-time'),
      model: E.pop.querySelector('.cv-model'),
      text: E.pop.querySelector('.cv-text'),
      rep: E.pop.querySelector('.cv-rep'),
      cad: E.pop.querySelector('.cv-cad'),
      ok: E.pop.querySelector('.cv-ok'),
      okc: E.pop.querySelector('.cv-okc'),
      go: E.pop.querySelector('.cv-go'),
      hint: E.pop.querySelector('.cv-hint'),
    };
    let repeat = false;
    const hint = () => {
      if (past) return;
      const k = P.dept.value;
      lastDept = k;
      if (repeat) {
        const w = fromPicker(P.cad.value, P.time.value, dayKey);
        const first = occurrences(w, Date.now(), Date.now() + 400 * DAY, 1)[0];
        P.hint.innerHTML = RT_DEPTS.includes(k)
          ? `Routine · <b>${esc(describe(w))}</b> · first run ${esc(first ? new Date(first).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm(first) : '—')}${isLive() ? ' · Claude names the agent' : ''}`
          : `<span class="amber">${esc(rtRefuse(k))}</span>`;
        P.go.disabled = !RT_DEPTS.includes(k);
      } else {
        P.hint.innerHTML = `Task for <b>${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} · ${esc(P.time.value)}</b>${isLive() ? ' · Claude names the agent now, runs it then' : ''}`;
        P.go.disabled = false;
      }
    };
    P.rep.addEventListener('click', () => {
      repeat = !repeat;
      P.rep.classList.toggle('on', repeat);
      P.cad.hidden = !repeat;
      P.ok.hidden = !repeat;
      if (repeat) {
        const dow = (d.getDay() + 6) % 7;
        P.cad.value = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][dow];
      }
      hint();
    });
    [P.dept, P.time, P.cad, P.model].forEach((el) => {
      el.addEventListener('change', hint);
      el.addEventListener('keydown', (e) => e.stopPropagation());
    });
    P.text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        go();
      } else if (e.key === 'Escape') closePop();
    });
    P.go.addEventListener('click', go);
    hint();
    P.text.focus();
    async function go() {
      const text = P.text.value.trim().replace(/[.!]+$/, '');
      if (!text) {
        P.text.focus();
        return;
      }
      const k = P.dept.value,
        model = P.model.value || undefined;
      P.go.disabled = true;
      P.hint.innerHTML = isLive() ? 'Claude is naming the agent…' : 'Adding…';
      let r;
      if (repeat)
        r = await createRoutine({
          dept: k,
          text,
          when: fromPicker(P.cad.value, P.time.value, dayKey),
          needsOk: P.okc.checked,
          model,
        });
      else
        r = await create({ dept: k, text, at: new Date(`${dayKey}T${P.time.value || '09:00'}:00`).getTime(), model });
      if (!r || !r.ok) {
        P.hint.innerHTML = `<span class="amber">${esc((r && r.error) || 'Could not add it.')}</span>`;
        P.go.disabled = false;
        return;
      }
      closePop();
      render();
      const el = E.grid.querySelector(
        `.cv-ev[data-ev="${repeat ? 'r:' + r.routine.id + ':' : 't:' + r.task.id}"], .cv-ev[data-ev^="${repeat ? 'r:' + r.routine.id + ':' : 't:' + r.task.id}"]`,
      );
      if (el) {
        el.classList.add('new');
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }
  function openEvent(id, el) {
    closePop();
    const [kind, ...rest] = id.split(':');
    if (kind === 't') {
      const t = tasks.find((x) => String(x.id) === rest[0]);
      if (!t) return;
      if (t.state === 'done') {
        close();
        openAgent(t.agent, 'chat');
        return;
      } // the deliverable lives in the agent's chat
      const a = agentOf(t.agent);
      popKind = 'event';
      E.pop.innerHTML = `<div class="cv-pop-h"><span class="lab">${t.state === 'scheduled' ? 'SCHEDULED TASK' : t.state.toUpperCase()}</span><span class="sp"></span><button class="cv-x" data-act="close">✕</button></div>
        <div class="cv-pop-t">${esc(t.title)}</div>
        <div class="cv-pop-m">${av(t.agent)} ${esc(a ? a.name : '')} · ${esc(DEPTS[t.dept].name)}${t.state === 'scheduled' ? ` · runs ${esc(untilText(t.dueAt))} (${hm(t.dueAt)})` : ''}${t.modelUsed ? ' · ' + esc(modelName(t.modelUsed)) : ''}</div>
        ${t.text && t.text !== t.title ? `<div class="cv-pop-p">${esc(t.text)}</div>` : ''}
        <div class="cv-row"><button class="cv-btn" data-act="open">OPEN THE AGENT</button>${t.state === 'scheduled' ? '<button class="cv-btn warn" data-act="cancel">CANCEL IT</button>' : ''}</div>`;
      E.pop.hidden = false;
      place(E.pop, el);
      E.pop.querySelector('[data-act="open"]').addEventListener('click', () => {
        close();
        openAgent(t.agent, 'chat');
      });
      E.pop.querySelector('[data-act="cancel"]')?.addEventListener('click', async () => {
        await cancelTask(t);
        closePop();
        render();
      });
      return;
    }
    const r = routines.find((x) => x.id === rest[0]);
    if (!r) return;
    const a = agentOf(r.agent),
      at = +rest[1];
    popKind = 'event';
    E.pop.innerHTML = `<div class="cv-pop-h"><span class="lab">ROUTINE</span><span class="sp"></span><button class="cv-x" data-act="close">✕</button></div>
      <div class="cv-pop-t">${esc(r.title)}</div>
      <div class="cv-pop-m">${av(r.agent)} ${esc(a ? a.name : r.agent)} · ${esc(r.desc || describe(r.when))}${r.needsOk ? ' · waits for your OK' : ' · read-only'}${r.paused ? ' · <span class="cv-paused">PAUSED</span>' : ''}</div>
      <div class="cv-pop-p">This run: ${esc(new Date(at).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}${r.nextAt ? ` · next ${esc(untilText(r.nextAt))}` : ''}${r.lastAt ? ` · last ran ${esc(new Date(r.lastAt).toLocaleDateString([], { day: 'numeric', month: 'short' }))}` : ''}</div>
      <div class="cv-row"><button class="cv-btn" data-act="run">RUN NOW</button><button class="cv-btn" data-act="${r.paused ? 'resume' : 'pause'}">${r.paused ? 'RESUME' : 'PAUSE'}</button><button class="cv-btn" data-act="only">ONLY THIS</button><span class="sp"></span><button class="cv-btn warn" data-act="delete">DELETE</button></div>`;
    E.pop.hidden = false;
    place(E.pop, el);
    E.pop.querySelectorAll('.cv-btn').forEach((b) =>
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'only') {
          onlyRoutine = r.id;
          closePop();
          render();
          return;
        }
        await rtAct(r.id, act);
        closePop();
        render();
      }),
    );
  }
  function openMore(dayKey, cell) {
    closePop();
    popKind = 'more';
    const { from, to } = range();
    const list = events(from, to)[dayKey] || [];
    const d = new Date(dayKey + 'T00:00:00');
    E.pop.innerHTML = `<div class="cv-pop-h"><span class="lab">${DOW[(d.getDay() + 6) % 7].toUpperCase()} ${d.getDate()} ${MONTHS[d.getMonth()].toUpperCase()}</span><b>${list.length}</b><span class="sp"></span><button class="cv-x" data-act="close">✕</button></div><div class="cv-pop-list">${list.map(cardHTML).join('')}</div>`;
    E.pop.hidden = false;
    place(E.pop, cell);
  }

  /* ---------- wiring ---------- */
  ov.addEventListener('click', (e) => {
    const x = e.target.closest('[data-act="close"], .cv-x');
    if (x) {
      closePop();
      return;
    }
    const ev = e.target.closest('.cv-ev');
    if (ev) {
      openEvent(ev.dataset.ev, ev);
      return;
    }
    const more = e.target.closest('.cv-more');
    if (more) {
      openMore(more.dataset.day, more.closest('.cv-day'));
      return;
    }
    const add = e.target.closest('.cv-add');
    if (add) {
      const cell = add.closest('.cv-day');
      openCreate(cell.dataset.day, cell);
      return;
    }
    const rr = e.target.closest('.cv-r');
    if (rr) {
      onlyRoutine = onlyRoutine === rr.dataset.rid ? null : rr.dataset.rid;
      render();
      return;
    }
    const chip = e.target.closest('.cv-chip');
    if (chip) {
      if (chip.dataset.dept) {
        const k = chip.dataset.dept;
        if (deptOn.size === DEPT_KEYS.length) {
          deptOn = new Set([k]);
        } else if (deptOn.has(k)) {
          deptOn.delete(k);
          if (!deptOn.size) deptOn = new Set(DEPT_KEYS);
        } else deptOn.add(k);
      } else if (chip.dataset.tog === 'routines') showRoutines = !showRoutines;
      else if (chip.dataset.tog === 'done') showDone = !showDone;
      else if (chip.dataset.tog === 'only') onlyRoutine = null;
      render();
      return;
    }
    const day = e.target.closest('.cv-day');
    if (day && !E.pop.contains(e.target)) {
      if (e.target === day || e.target.classList.contains('cv-evs') || e.target.closest('.cv-num')) {
        openCreate(day.dataset.day, day);
        return;
      }
    }
    if (!E.pop.contains(e.target) && !E.pop.hidden) closePop();
  });
  E.seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    view = b.dataset.v;
    closePop();
    render();
  });
  $('#cvPrev').addEventListener('click', () => {
    step(-1);
  });
  $('#cvNext').addEventListener('click', () => {
    step(1);
  });
  $('#cvToday').addEventListener('click', () => {
    anchor = startOfDay(Date.now());
    closePop();
    render();
  });
  $('#cvClose').addEventListener('click', () => close());
  E.search.addEventListener('input', () => {
    q = E.search.value.trim().toLowerCase();
    render();
  });
  E.search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      E.search.value = '';
      q = '';
      E.search.blur();
      render();
    }
  });
  function step(n) {
    const d = new Date(anchor);
    if (view === 'week') d.setDate(d.getDate() + 7 * n);
    else {
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
    }
    anchor = d.getTime();
    closePop();
    render();
  }
  ov.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't' || e.key === 'T') {
      anchor = startOfDay(Date.now());
      render();
    } else if (e.key === 'w' || e.key === 'W') {
      view = 'week';
      render();
    } else if (e.key === 'm' || e.key === 'M') {
      view = 'month';
      render();
    }
  });

  let timer = null;
  function open() {
    if (openNow) return;
    openNow = true;
    E.co.textContent = business ? business() : '';
    ov.classList.add('on');
    document.body.classList.add('calOpen');
    render();
    ov.tabIndex = -1;
    ov.focus();
    timer = setInterval(() => {
      if (E.pop.hidden) render();
    }, 30000);
  }
  function close() {
    if (!openNow) return;
    openNow = false;
    closePop();
    ov.classList.remove('on');
    document.body.classList.remove('calOpen');
    clearInterval(timer);
    timer = null;
  }
  function toggle() {
    openNow ? close() : open();
  }
  return {
    open,
    close,
    toggle,
    isOpen: () => openNow,
    refresh: () => {
      if (openNow && E.pop.hidden) render();
    },
    popOpen: () => !E.pop.hidden,
    closePop,
    get view() {
      return view;
    },
    set view(v) {
      view = v;
      render();
    },
  };
}
