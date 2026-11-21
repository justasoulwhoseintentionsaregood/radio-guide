'use strict';

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const HOUR = 3600e3;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
}
const svgIcon = (d, cls) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = d; return s;
};
const STAR = '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>';
const EXT = '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>';

const tf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const df = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dfLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const fmt = d => tf.format(d);
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (key, n) => { const d = dayStart(key); d.setDate(d.getDate() + n); return dayKey(d); };
function dayLabel(key, long = false) {
  const today = dayKey(new Date());
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return (long ? dfLong : df).format(dayStart(key));
}
const monogram = name => {
  const w = name.replace(/^BBC\s+/i, '').split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase();
};

/* ---------- state ---------- */
const state = {
  data: null,
  stations: [],
  view: store.get('view', 'now'),
  day: dayKey(new Date()),
  favs: new Set(store.get('favs', [])),
  favOnly: store.get('favOnly', false),
  order: store.get('order', null),   // station ids, as arranged on this device (null = default)
  q: '',
};

const groupOf = st => st.group || 'Other';

/* Stations in display order: the saved arrangement (if any) on top of the default order
   from stations.toml, with each group kept together in order of first appearance.
   Stations added later slot in after the last station of their group. */
function arranged() {
  const byId = state.byId || {};
  const ids = (state.order || []).filter(id => byId[id]);
  for (const st of state.stations) {
    if (ids.includes(st.id)) continue;
    let at = -1;
    ids.forEach((id, i) => { if (groupOf(byId[id]) === groupOf(st)) at = i; });
    if (at < 0) ids.push(st.id); else ids.splice(at + 1, 0, st.id);
  }
  const groups = new Map();
  for (const id of ids) {
    const g = groupOf(byId[id]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(byId[id]);
  }
  return [...groups.values()].flat();
}

function visibleStations() {
  const all = arranged();
  return state.favOnly ? all.filter(s => state.favs.has(s.id)) : all;
}

function prepare(data) {
  state.data = data;
  state.stations = data.stations.map(s => ({
    ...s,
    programmes: s.programmes.map(p => ({ ...p, s: new Date(p.start), e: new Date(p.end), station: s.id })),
  }));
  state.byId = Object.fromEntries(state.stations.map(s => [s.id, s]));
}

function onAir(st, now = new Date()) {
  const ps = st.programmes;
  const i = ps.findIndex(p => p.s <= now && now < p.e);
  const cur = i >= 0 ? ps[i] : null;
  const next = ps.find(p => p.s >= (cur ? cur.e : now));
  return { cur, next };
}

/* ---------- shared bits ---------- */
function logo(st, size) {
  const css = [size ? `width:${size}px;height:${size}px` : '', /^#[0-9a-f]{3,8}$/i.test(st.logo_bg || '') ? `background:${st.logo_bg}` : ''].filter(Boolean).join(';');
  const box = h('span', { class: 'logo', style: css || null, title: st.name });
  if (st.logo) {
    const img = h('img', { src: st.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { box.style.background = ''; box.textContent = monogram(st.name); });
    box.append(img);
    if (st.logo_badge) box.append(h('span', { class: 'logo-badge', 'aria-hidden': 'true' }, st.logo_badge));
  } else box.textContent = monogram(st.name);
  return box;
}

function toggleFav(st) {
  state.favs.has(st.id) ? state.favs.delete(st.id) : state.favs.add(st.id);
  store.set('favs', [...state.favs]);
  render();
}

function starBtn(st, after) {
  const on = state.favs.has(st.id);
  return h('button', {
    class: 'star', 'aria-pressed': String(on), 'aria-label': `${on ? 'Remove' : 'Add'} ${st.name} ${on ? 'from' : 'to'} favourites`,
    title: on ? 'Remove from favourites' : 'Add to favourites',
    onclick: e => { e.stopPropagation(); toggleFav(st); after?.(); },
  }, svgIcon(STAR));
}

/* A labelled favourite toggle for the station panel. */
function favButton(st) {
  const btn = h('button', { class: 'sh-fav' });
  const paint = () => {
    const on = state.favs.has(st.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.replaceChildren(svgIcon(STAR), on ? 'Favourite' : 'Add to favourites');
  };
  btn.addEventListener('click', () => { toggleFav(st); paint(); });
  paint();
  return btn;
}

/* ---------- now view ---------- */
function renderNow() {
  const root = $('#view-now');
  root.replaceChildren();
  const now = new Date();
  const groups = new Map();
  for (const st of visibleStations()) {
    const g = st.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(st);
  }
  for (const [g, list] of groups) {
    root.append(h('div', { class: 'group' }, h('h2', {}, g), h('div', { class: 'cards' }, list.map(st => card(st, now)))));
  }
}

function card(st, now) {
  const { cur, next } = onAir(st, now);
  const body = [];
  if (cur) {
    const pct = Math.min(100, Math.max(0, (now - cur.s) / (cur.e - cur.s) * 100));
    body.push(h('p', { class: 'live-title' }, cur.title));
    if (cur.subtitle) body.push(h('p', { class: 'live-sub' }, cur.subtitle));
    body.push(h('div', { class: 'progress' }, h('span', {}, fmt(cur.s)), h('span', { class: 'bar' }, h('i', { style: `width:${pct.toFixed(1)}%` })), h('span', {}, fmt(cur.e))));
  } else {
    body.push(h('p', { class: 'live-none' }, st.filler || (st.programmes.length ? 'No programme listed' : 'No schedule available')));
  }
  if (next) body.push(h('div', { class: 'next' }, h('b', {}, fmt(next.s)), h('span', {}, next.title)));
  return h('article', { class: 'card' },
    h('button', { class: 'card-open', 'aria-label': `${st.name} schedule`, onclick: () => openStation(st) }),
    h('div', { class: 'card-head' }, logo(st), h('span', { class: 'name' }, st.name), cur ? h('span', { class: 'dot', title: 'On air' }) : null, starBtn(st)),
    body);
}

/* ---------- guide view ---------- */
function availableDays() {
  let lo = Infinity, hi = -Infinity;
  for (const st of state.stations) for (const p of st.programmes) { lo = Math.min(lo, +p.e - 1); hi = Math.max(hi, +p.e - 1); }
  if (!isFinite(lo)) return [dayKey(new Date())];
  const out = [];
  for (let k = dayKey(new Date(lo)); k <= dayKey(new Date(hi)); k = addDays(k, 1)) out.push(k);
  return out;
}

function renderDays() {
  const days = availableDays();
  if (!days.includes(state.day)) state.day = days.includes(dayKey(new Date())) ? dayKey(new Date()) : days[0];
  $('#days').replaceChildren(...days.map(k => h('button', {
    role: 'tab', 'aria-selected': String(k === state.day),
    onclick: () => { state.day = k; renderDays(); renderGuide(true); },
  }, dayLabel(k))));
  $('#days [aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderGuide(scrollToNow = false) {
  const wrap = $('#grid-wrap'), grid = $('#grid');
  const keep = { x: wrap.scrollLeft, y: wrap.scrollTop };
  const cs = getComputedStyle(document.documentElement);
  const hourW = parseFloat(cs.getPropertyValue('--hour-w'));
  const t0 = dayStart(state.day), t1 = dayStart(addDays(state.day, 1));
  const hours = Math.round((t1 - t0) / HOUR); // 23/25 on DST days
  const width = hours * hourW;
  const x = t => (t - t0) / HOUR * hourW;
  const now = new Date();

  const ruler = h('div', { class: 'ruler' }, h('div', { class: 'corner' }));
  for (let i = 0; i < hours; i++) ruler.append(h('div', { class: 'hour' }, fmt(new Date(+t0 + i * HOUR))));

  const rows = visibleStations().map(st => {
    const lane = h('div', { class: 'lane', style: `width:${width}px` });
    for (const p of st.programmes) {
      if (p.e <= t0 || p.s >= t1) continue;
      const l = Math.max(0, x(p.s)), r = Math.min(width, x(p.e));
      const w = r - l - 3;
      if (w < 4) continue;
      const cls = ['prog', p.e <= now ? 'past' : p.s <= now ? 'now' : '', w < 70 ? 'tiny' : ''].join(' ');
      lane.append(h('button', {
        class: cls, style: `left:${l + 1.5}px;width:${w}px`, title: `${fmt(p.s)}–${fmt(p.e)}  ${p.title}`,
        onclick: () => openProgramme(p),
      }, h('span', { class: 't' }, p.title), h('span', { class: 's' }, `${fmt(p.s)}–${fmt(p.e)}${p.subtitle ? ' · ' + p.subtitle : ''}`)));
    }
    return h('div', { class: 'row' },
      h('button', { class: 'row-label', onclick: () => openStation(st), 'aria-label': `${st.name} schedule` }, logo(st, 30), h('span', { class: 'name' }, st.name)),
      lane);
  });

  const labelW = parseFloat(cs.getPropertyValue('--label-w'));
  const kids = [ruler, ...rows];
  if (now >= t0 && now < t1) kids.push(h('div', { class: 'now-line', style: `left:${labelW + x(now) - 1}px` }));
  grid.style.width = `${labelW + width}px`;
  grid.replaceChildren(...kids);

  if (scrollToNow) {
    const target = now >= t0 && now < t1 ? x(now) - Math.min(wrap.clientWidth * 0.25, 2 * hourW) + 0 : x(new Date(+t0 + 6 * HOUR));
    wrap.scrollTo({ left: Math.max(0, target), top: 0 });
  } else {
    wrap.scrollLeft = keep.x; wrap.scrollTop = keep.y;
  }
}

/* ---------- search ---------- */
function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
}

function renderSearch() {
  const root = $('#view-search');
  const q = state.q.toLowerCase();
  const startOfToday = dayStart(dayKey(new Date()));
  const hits = [];
  for (const st of visibleStations()) for (const p of st.programmes) {
    if (p.e < startOfToday) continue;
    if ([p.title, p.subtitle, p.description].some(t => t && t.toLowerCase().includes(q))) hits.push(p);
  }
  hits.sort((a, b) => a.s - b.s);
  root.replaceChildren();
  if (!hits.length) { root.append(h('p', { class: 'empty' }, `Nothing found for “${state.q}”.`)); return; }
  let last = '';
  for (const p of hits.slice(0, 300)) {
    const k = dayKey(p.s);
    if (k !== last) { root.append(h('div', { class: 'res-day' }, dayLabel(k, true))); last = k; }
    const st = state.byId[p.station];
    const meta = [st.name, p.subtitle].filter(Boolean).join(' · ');
    root.append(h('button', { class: 'res', onclick: () => openProgramme(p) },
      h('time', {}, fmt(p.s)), h('span', { class: 't' }, highlight(p.title, q)), h('span', { class: 'm' }, highlight(meta, q))));
  }
}

/* ---------- sheets ---------- */
function openSheet(...content) {
  // Optional parts are passed as null; replaceChildren would print those as "null".
  $('#sheet-body').replaceChildren(...content.filter(c => c !== null && c !== undefined && c !== false && c !== ''));
  const d = $('#sheet');
  if (!d.open) d.showModal();
  $('#sheet-body').scrollTop = 0;
}

/* ---------- arrange stations ---------- */
const UP = '<path d="m6 15 6-6 6 6"/>';
const DOWN = '<path d="m6 9 6 6 6-6"/>';

function saveOrder(ids, focusKey) {
  state.order = ids;
  store.set('order', ids);
  render();
  renderArrange(focusKey);
}

function moveStation(id, dir) {
  const list = arranged();
  const i = list.findIndex(s => s.id === id), j = i + dir;
  if (j < 0 || j >= list.length || groupOf(list[j]) !== groupOf(list[i])) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveOrder(list.map(s => s.id), `s:${id}:${dir}`);
}

function moveGroup(g, dir) {
  const blocks = [];
  for (const st of arranged()) {
    const last = blocks[blocks.length - 1];
    if (last && last.g === groupOf(st)) last.items.push(st); else blocks.push({ g: groupOf(st), items: [st] });
  }
  const i = blocks.findIndex(b => b.g === g), j = i + dir;
  if (j < 0 || j >= blocks.length) return;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  saveOrder(blocks.flatMap(b => b.items.map(s => s.id)), `g:${g}:${dir}`);
}

function arrowBtn(icon, label, disabled, onclick, key) {
  return h('button', { class: 'arr-btn', 'aria-label': label, title: label, disabled, onclick, 'data-key': key }, svgIcon(icon));
}

function renderArrange(focusKey) {
  const body = $('#sheet-body');
  const top = body.scrollTop;
  const list = arranged();
  const groups = [...new Set(list.map(groupOf))];
  const out = [
    h('h3', { class: 'sh-title' }, 'Your stations'),
    h('p', { class: 'arr-hint' }, 'Tap ☆ to make a station a favourite. Use the arrows to reorder stations within their group, or whole groups. Saved on this device.'),
  ];
  groups.forEach((g, gi) => {
    const items = list.filter(s => groupOf(s) === g);
    out.push(h('div', { class: 'arr-group' },
      h('span', {}, g),
      h('span', { class: 'arr-btns' },
        arrowBtn(UP, `Move group ${g} up`, gi === 0, () => moveGroup(g, -1), `g:${g}:-1`),
        arrowBtn(DOWN, `Move group ${g} down`, gi === groups.length - 1, () => moveGroup(g, 1), `g:${g}:1`))));
    items.forEach((st, si) => out.push(h('div', { class: 'arr-row' },
      logo(st, 28),
      h('span', { class: 'arr-name' }, st.name),
      h('span', { class: 'arr-btns' },
        starBtn(st, () => renderArrange()),
        arrowBtn(UP, `Move ${st.name} up`, si === 0, () => moveStation(st.id, -1), `s:${st.id}:-1`),
        arrowBtn(DOWN, `Move ${st.name} down`, si === items.length - 1, () => moveStation(st.id, 1), `s:${st.id}:1`)))));
  });
  out.push(h('button', {
    class: 'arr-reset', disabled: !state.order,
    onclick: () => { state.order = null; store.set('order', null); render(); renderArrange(); },
  }, 'Reset to default order'));
  body.replaceChildren(...out);
  body.scrollTop = top;
  if (focusKey) {
    const btn = [...body.querySelectorAll('.arr-btn')].find(b => b.dataset.key === focusKey);
    (btn && !btn.disabled ? btn : body.querySelector('.arr-btn:not([disabled])'))?.focus({ preventScroll: true });
  }
}

function openArrange() {
  openSheet();
  renderArrange();
}

function openProgramme(p) {
  const st = state.byId[p.station];
  const now = new Date();
  const live = p.s <= now && now < p.e;
  openSheet(
    h('div', { class: 'sh-station' }, logo(st, 28), st.name),
    h('h3', { class: 'sh-title' }, p.title),
    p.subtitle ? h('p', { class: 'sh-sub' }, p.subtitle) : null,
    h('p', { class: 'sh-time' }, live ? h('span', { class: 'dot' }) : null,
      `${dayLabel(dayKey(p.s), true)} · ${fmt(p.s)}–${fmt(p.e)} · ${Math.round((p.e - p.s) / 60e3)} min`),
    p.description ? h('p', { class: 'sh-desc' }, p.description) : null,
    p.url ? h('a', { class: 'sh-link', href: p.url, target: '_blank', rel: 'noopener' }, 'Programme page', svgIcon(EXT)) : null,
  );
}

function openStation(st) {
  const now = new Date();
  const from = dayStart(dayKey(now)), to = dayStart(addDays(dayKey(now), 2));
  const list = h('ul', { class: 'sh-list' });
  let last = '', nowEl = null;
  for (const p of st.programmes) {
    if (p.e <= from || p.s >= to) continue;
    const k = dayKey(p.s);
    if (k !== last && last) list.append(h('li', {}, h('span'), h('strong', {}, dayLabel(k, true))));
    last = k;
    const cls = p.e <= now ? 'past' : p.s <= now ? 'now' : '';
    const li = h('li', { class: cls }, h('time', {}, fmt(p.s)), h('button', { onclick: () => openProgramme(p) }, p.title));
    if (cls === 'now') nowEl = li;
    list.append(li);
  }
  openSheet(
    h('div', { class: 'sh-station' }, logo(st, 28), st.name),
    h('h3', { class: 'sh-title' }, 'Today & tomorrow'),
    h('div', { class: 'sh-actions' },
      favButton(st),
      st.homepage ? h('a', { class: 'sh-link', href: st.homepage, target: '_blank', rel: 'noopener' }, 'Station website', svgIcon(EXT)) : null),
    list.children.length ? list : h('p', { class: 'live-none' }, 'No schedule available'),
  );
  nowEl?.scrollIntoView({ block: 'center' });
}

/* ---------- footer ---------- */
function renderFoot() {
  const d = state.data;
  const status = d.status || {};
  const bad = state.stations.filter(s => status[s.id] && status[s.id].ok === false);
  const gen = new Date(d.generated);
  const ago = Math.round((Date.now() - gen) / 60e3);
  const when = ago < 60 ? `${ago} min ago` : `${dayLabel(dayKey(gen))} ${fmt(gen)}`;
  $('#foot').replaceChildren(...[
    `Updated ${when} · ${state.stations.length - bad.length}/${state.stations.length} stations fresh`,
    bad.length ? h('span', { class: 'bad', title: bad.map(s => `${s.name}: ${status[s.id].error}`).join('\n') }, ` · stale: ${bad.map(s => s.name).join(', ')}`) : null,
    ' · ', h('a', { href: 'guide.xml' }, 'XMLTV'),
  ].filter(Boolean));
}

/* ---------- top-level ---------- */
function setView(v) {
  state.view = v;
  if (v !== 'search') store.set('view', v);
  render();
}

function render() {
  if (!state.data) return;
  const searching = state.q.length >= 2;
  const v = searching ? 'search' : state.view;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(!searching && b.dataset.view === v));
  $('#fav-only').setAttribute('aria-pressed', String(state.favOnly));
  $('#view-now').hidden = v !== 'now';
  $('#view-guide').hidden = v !== 'guide';
  $('#view-search').hidden = v !== 'search';
  document.body.classList.toggle('guide-mode', v === 'guide');

  const empty = $('#empty');
  empty.hidden = true;
  if (state.favOnly && !visibleStations().length) {
    empty.replaceChildren('No favourites yet. ',
      h('button', { class: 'link-btn', onclick: () => openArrange() }, 'Choose favourite stations'), '.');
    empty.hidden = false;
    $('#view-now').hidden = $('#view-guide').hidden = $('#view-search').hidden = true;
  } else if (v === 'now') renderNow();
  else if (v === 'guide') { const first = !render.guideShown; renderDays(); renderGuide(first); render.guideShown = true; }
  else renderSearch();
  renderFoot();
}

async function load() {
  try {
    const r = await fetch('data/schedule.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    prepare(await r.json());
    render();
  } catch (e) {
    if (!state.data) { const el = $('#empty'); el.textContent = 'Could not load the schedule.'; el.hidden = false; }
  }
}

for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => {
  state.q = ''; $('#q').value = '';
  if (b.dataset.view === 'guide') render.guideShown = false;
  setView(b.dataset.view);
});
$('#q').addEventListener('input', e => { state.q = e.target.value.trim(); render(); });
$('#fav-only').addEventListener('click', () => { state.favOnly = !state.favOnly; store.set('favOnly', state.favOnly); render(); });
$('#arrange').addEventListener('click', () => { if (state.data) openArrange(); });
$('#sheet').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

setInterval(render, 60e3); // progress bars, now-line, past/now classes
setInterval(load, 15 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });

load();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
