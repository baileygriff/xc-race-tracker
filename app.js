/* XC Race Tracker — single page, three jobs. Everything is saved on the phone on every tap.
   Sending is optional and re-sendable: the sheet replaces earlier data for the same race + job. */
const VERSION = '0.1.0';
const $ = id => document.getElementById(id);

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('xc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('xc.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save: ' + e.message, true); } },
};
const settings = Object.assign({ race: '', device: '', endpoint: '', bibs: '' }, store.get('settings', {}));
// A pre-configured link (?race=..&endpoint=..&mode=..) wins over saved settings so you can text each volunteer a link.
const qs = new URLSearchParams(location.search);
for (const k of ['race', 'device', 'endpoint']) if (qs.get(k)) settings[k] = qs.get(k);
store.set('settings', settings);
const raceKey = () => (settings.race || 'race').trim();
// Race data is keyed by race name so switching races never clobbers another race's taps.
const rd = {
  get() { return store.get('race.' + raceKey(), { start: null, laps: [], finishers: [] }); },
  set(v) { store.set('race.' + raceKey(), v); },
};

// ---------- ui helpers ----------
let toastTimer;
function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = err ? 'err' : ''; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 5000 : 2200);
}
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');
  $('hdr-race').textContent = [settings.race, settings.device].filter(Boolean).join(' · ');
  if (view !== 'settings' && view !== 'home') store.set('mode', view);
  if (view === 'timer') renderTimer();
  if (view === 'finishers') renderFinishers();
  if (view === 'results') loadResults();
  if (view === 'settings') { $('set-race').value = settings.race; $('set-device').value = settings.device;
    $('set-endpoint').value = settings.endpoint; $('set-bibs').value = settings.bibs; }
}
function fmt(ms) {
  const t = Math.floor(ms / 100), tenths = t % 10, s = Math.floor(t / 10) % 60, m = Math.floor(t / 600);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied — paste it into a text to the scorer'); }
  catch { prompt('Copy this:', text); }
}
let wakeLock;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

// ---------- network ----------
async function post(payload) {
  if (!settings.endpoint) throw new Error('No sheet endpoint set (⚙ Settings)');
  // text/plain avoids a CORS preflight, which Apps Script cannot answer.
  const r = await fetch(settings.endpoint, { method: 'POST', body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Sheet rejected the data');
  return j;
}
async function get(params) {
  if (!settings.endpoint) throw new Error('No sheet endpoint set (⚙ Settings)');
  const u = new URL(settings.endpoint); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { redirect: 'follow' }); const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Sheet returned an error');
  return j;
}
async function sendWithFeedback(btn, payload, count) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…';
  try { const j = await post(payload); toast(`Sent ${count} to the sheet ✓` + (j.note ? ' — ' + j.note : '')); }
  catch (e) { toast('Send failed: ' + e.message + '. Data is safe on this phone — try again or use Copy.', true); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- TIMER ----------
let clockTimer;
function renderTimer() {
  const d = rd.get();
  $('btn-start').classList.toggle('hidden', !!d.start);
  $('btn-lap').classList.toggle('hidden', !d.start);
  $('lap-count').textContent = `${d.laps.length} finisher${d.laps.length === 1 ? '' : 's'}`;
  $('timer-list').innerHTML = d.laps.map((ms, i) =>
    `<li><span class="pos">${i + 1}</span><span>${fmt(ms)}</span></li>`).reverse().join('');
  clearInterval(clockTimer);
  const tick = () => { $('clock').textContent = d.start ? fmt(Date.now() - d.start) : '00:00.0'; };
  tick(); if (d.start) clockTimer = setInterval(tick, 100);
}
$('btn-start').onclick = () => {
  const d = rd.get(); if (d.start) return;
  d.start = Date.now(); rd.set(d); keepAwake(); renderTimer(); toast('Race started');
};
$('btn-lap').onclick = () => {
  const now = Date.now(); const d = rd.get(); if (!d.start) return;
  d.laps.push(now - d.start); rd.set(d); renderTimer();
  if (navigator.vibrate) navigator.vibrate(30);
};
$('btn-timer-undo').onclick = () => {
  const d = rd.get(); if (!d.laps.length) return toast('Nothing to undo');
  if (!confirm(`Remove finisher #${d.laps.length} (${fmt(d.laps[d.laps.length - 1])})?`)) return;
  d.laps.pop(); rd.set(d); renderTimer();
};
const timerPayload = () => { const d = rd.get(); return { role: 'timer', race: raceKey(), device: settings.device,
  start: d.start, entries: d.laps.map((ms, i) => ({ pos: i + 1, ms, time: fmt(ms) })) }; };
$('btn-timer-send').onclick = () => { const p = timerPayload();
  if (!p.entries.length) return toast('No finishers yet'); sendWithFeedback($('btn-timer-send'), p, p.entries.length + ' times'); };
$('btn-timer-copy').onclick = () => copyText(`TIMES ${raceKey()}\n` + rd.get().laps.map((ms, i) => `${i + 1}\t${fmt(ms)}`).join('\n'));
$('btn-timer-reset').onclick = () => { if (confirm('Erase the start time and ALL lap times for ' + raceKey() + '?') && confirm('Really erase? This cannot be undone.'))
  { const d = rd.get(); d.start = null; d.laps = []; rd.set(d); renderTimer(); } };

// ---------- FINISHERS ----------
let roster = store.get('roster', []); // [{bib, name, team, race}]
function bibsForRace() {
  const fromRoster = roster.filter(r => !r.race || r.race === raceKey()).map(r => String(r.bib));
  const manual = (settings.bibs || '').split(/[^0-9]+/).filter(Boolean);
  return [...new Set([...fromRoster, ...manual])].sort((a, b) => a - b);
}
function nameFor(bib) { const r = roster.find(r => String(r.bib) === String(bib)); return r ? `${r.name} · ${r.team}` : ''; }
function renderFinishers() {
  const d = rd.get(); const done = new Set(d.finishers); const filter = $('bib-filter').value.trim();
  const bibs = bibsForRace().filter(b => !filter || b.includes(filter));
  $('bib-grid').innerHTML = bibs.length
    ? bibs.map(b => `<button class="bib${done.has(b) ? ' done' : ''}" data-bib="${b}">${b}</button>`).join('')
    : `<p class="hint">No bibs loaded for “${raceKey()}”. Tap “Refresh bibs”, or type them under ⚙ Settings.</p>`;
  $('fin-list').innerHTML = d.finishers.map((b, i) =>
    `<li><span class="pos">${i + 1}</span><span>${b === '???' ? '<span class="badge bad">no bib</span>' : b} <small style="color:var(--muted)">${nameFor(b)}</small></span></li>`).reverse().join('');
}
$('bib-grid').onclick = e => {
  const btn = e.target.closest('.bib'); if (!btn) return;
  const bib = btn.dataset.bib; const d = rd.get();
  if (d.finishers.includes(bib) && !confirm(`Bib ${bib} already finished as #${d.finishers.indexOf(bib) + 1}. Add again anyway?`)) return;
  d.finishers.push(bib); rd.set(d); $('bib-filter').value = ''; renderFinishers();
  if (navigator.vibrate) navigator.vibrate(30);
  toast(`#${d.finishers.length}  bib ${bib}  ${nameFor(bib)}`);
};
$('bib-filter').oninput = renderFinishers;
$('btn-unknown').onclick = () => { const d = rd.get(); d.finishers.push('???'); rd.set(d); renderFinishers();
  toast(`#${d.finishers.length} recorded as "no bib" — write down who it was`); };
$('btn-fin-undo').onclick = () => {
  const d = rd.get(); if (!d.finishers.length) return toast('Nothing to undo');
  const last = d.finishers[d.finishers.length - 1];
  if (!confirm(`Remove #${d.finishers.length} (bib ${last})?`)) return;
  d.finishers.pop(); rd.set(d); renderFinishers();
};
const finPayload = () => ({ role: 'places', race: raceKey(), device: settings.device,
  entries: rd.get().finishers.map((bib, i) => ({ pos: i + 1, bib })) });
$('btn-fin-send').onclick = () => { const p = finPayload();
  if (!p.entries.length) return toast('No finishers yet'); sendWithFeedback($('btn-fin-send'), p, p.entries.length + ' places'); };
$('btn-fin-copy').onclick = () => copyText(`PLACES ${raceKey()}\n` + rd.get().finishers.map((b, i) => `${i + 1}\t${b}`).join('\n'));
$('btn-fin-reset').onclick = () => { if (confirm('Erase ALL finishers for ' + raceKey() + '?') && confirm('Really erase? This cannot be undone.'))
  { const d = rd.get(); d.finishers = []; rd.set(d); renderFinishers(); } };
async function refreshRoster(quiet) {
  try { const j = await get({ action: 'roster' }); roster = j.roster || []; store.set('roster', roster);
    if (!quiet) toast(`Loaded ${roster.length} bibs`); }
  catch (e) { if (!quiet) toast('Could not load bibs: ' + e.message, true); }
  renderFinishers();
}
$('btn-roster-refresh').onclick = () => refreshRoster(false);

// ---------- RESULTS ----------
async function loadResults() {
  $('results-status').textContent = 'Loading…';
  try {
    const j = await get({ action: 'results', race: raceKey() });
    const ok = j.timesCount === j.placesCount;
    $('results-status').innerHTML = `${raceKey()} — ${j.timesCount} times, ${j.placesCount} places ` +
      `<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'lists match' : 'COUNT MISMATCH — check the lists'}</span>`;
    let h = '<h3>Team scores</h3><table><tr><th>#</th><th>Team</th><th>Score</th><th>Scorers</th></tr>' +
      (j.teams || []).map((t, i) => `<tr><td>${i + 1}</td><td>${t.team}</td><td>${t.score ?? 'n/a'}</td><td>${t.note || ''}</td></tr>`).join('') + '</table>';
    h += '<h3>Individual</h3><table><tr><th>#</th><th>Bib</th><th>Name</th><th>Team</th><th>Time</th></tr>' +
      (j.results || []).map(r => `<tr><td>${r.pos}</td><td>${r.bib || ''}</td><td>${r.name || ''}</td><td>${r.team || ''}</td><td>${r.time || ''}</td></tr>`).join('') + '</table>';
    $('results-out').innerHTML = h;
  } catch (e) { $('results-status').textContent = 'Could not load: ' + e.message; }
}
$('btn-results-refresh').onclick = loadResults;

// ---------- SETTINGS / NAV ----------
$('btn-settings').onclick = () => show('settings');
$('btn-settings-save').onclick = () => {
  settings.race = $('set-race').value.trim(); settings.device = $('set-device').value.trim();
  settings.endpoint = $('set-endpoint').value.trim(); settings.bibs = $('set-bibs').value.trim();
  store.set('settings', settings); toast('Saved'); show(store.get('mode', 'home'));
};
$('btn-home').onclick = () => show('home');
document.querySelectorAll('button.mode').forEach(b => b.onclick = () => {
  if (!settings.race) { toast('Set the race name first', true); return show('settings'); }
  show(b.dataset.mode);
});
$('version').textContent = 'v' + VERSION;

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
const startMode = qs.get('mode') || store.get('mode', 'home');
show(settings.race ? startMode : 'settings');
if (settings.endpoint && navigator.onLine) refreshRoster(true);
