/* XC Race Tracker — one page, three jobs. Every tap is saved on the phone at once.
   Sending is optional and repeatable: the sheet replaces this phone's earlier data for the same race and job. */
const VERSION = '0.6.0';
const $ = id => document.getElementById(id);

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('xc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('xc.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save: ' + e.message, true); } },
};
const settings = Object.assign({ race: '', device: '', endpoint: '', key: '', dkey: '', bibs: '' }, store.get('settings', {}));
// A link can carry settings (?race=..&device=..&endpoint=..&key=..&mode=..) so each volunteer just opens what you text them.
// They are applied once per distinct link, so a value later changed under ⚙ is not clobbered by reopening the same link.
const qs = new URLSearchParams(location.search);
const saveSettings = () => store.set('settings', settings);
if (location.search && store.get('lastLink') !== location.search) {
  for (const k of ['race', 'device', 'endpoint', 'key', 'dkey']) if (qs.get(k)) settings[k] = qs.get(k);
  store.set('lastLink', location.search);
}
saveSettings();
let sheetError = ''; // last reason the sheet could not be read, shown on the home screen
// A phone opened from the director link holds the director code, which the sheet accepts for every role.
const isDirector = () => !!settings.dkey;
const volunteerKey = () => settings.dkey || settings.key;
const coachCode = () => settings.dkey || ro.code;
const raceKey = () => (settings.race || '').trim();
// Race data is keyed by race name, so switching races never touches another race's taps.
const rd = {
  get() { return store.get('race.' + raceKey(), { start: null, end: null, laps: [], finishers: [] }); },
  set(v) { store.set('race.' + raceKey(), v); },
};
let roster = store.get('roster', []);   // [{bib, name, team, race}]
let races = store.get('races', []);     // race names from the sheet

// ---------- ui helpers ----------
let toastTimer;
function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = err ? 'err' : ''; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 2500);
}
// Two-tap confirmation that lives in the button itself (no browser popups): first tap arms it, second within 3 s fires.
function armed(btn, label, fn) {
  if (btn.dataset.armed) { clearTimeout(+btn.dataset.armed); disarm(btn); return fn(); }
  btn.dataset.label = btn.innerHTML; btn.innerHTML = label; btn.classList.add('armed');
  btn.dataset.armed = setTimeout(() => disarm(btn), 3000);
}
function disarm(btn) { if (!btn.dataset.armed) return; btn.innerHTML = btn.dataset.label; btn.classList.remove('armed'); delete btn.dataset.armed; }
const TITLES = { home: 'XC Race Tracker', timer: 'Timer', finishers: 'Finishers', results: 'Results', settings: 'Settings', roster: 'Roster', setup: 'Meet setup' };
function show(view) {
  clearInterval(sharedPoll);
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');
  $('hdr-title').textContent = TITLES[view];
  $('hdr-race').textContent = view === 'home' || view === 'roster' || view === 'setup' ? '' : [settings.race, settings.device].filter(Boolean).join(' · ');
  $('btn-back').classList.toggle('hidden', view === 'home');
  store.set('view', view);
  ({ home: renderHome, timer: renderTimer, finishers: renderFinishers, results: loadResults, settings: renderSettings, roster: renderRoster, setup: renderSetup })[view]();
  window.scrollTo(0, 0);
}
function fmt(ms) {
  const t = Math.round(ms / 100), tenths = t % 10, s = Math.floor(t / 10) % 60, m = Math.floor(t / 600);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}
function parseTime(str) { // "12:34.5", "12:34", "754.5" (seconds)
  const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); if (!m) return null;
  return Math.round(((+m[1] || 0) * 60 + +m[2]) * 1000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied — paste it into a text to the scorer'); }
  catch { prompt('Copy this:', text); }
}
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

// ---------- network ----------
function needEndpoint() { if (!settings.endpoint) throw new Error('No sheet endpoint set — open ⚙ Settings'); }
// The sheet stamps its clock on every reply. offset = this phone's clock minus the sheet's, estimated at the midpoint of the
// round trip; the sample with the shortest round trip is kept (NTP-style), refreshed if it is older than ten minutes.
const clock = Object.assign({ offset: 0, rtt: Infinity, at: 0 }, store.get('clock', {}));
function noteClock(j, t0, t1) {
  if (typeof j.now !== 'number') return;
  const rtt = t1 - t0, offset = (t0 + t1) / 2 - j.now;
  if (rtt < clock.rtt || Date.now() - clock.at > 600000) { clock.offset = offset; clock.rtt = rtt; clock.at = Date.now(); store.set('clock', clock); }
}
const toLocal = sheetMs => sheetMs + clock.offset, toSheet = localMs => localMs - clock.offset;
// Google occasionally answers with an HTML error page instead of JSON. Every request here is safe to repeat
// (each send replaces that phone's rows, the start is first-press-wins, a reset clears), so retry a few times.
async function sheetFetch(url, opts) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 600 * attempt));
    const t0 = Date.now();
    let r; try { r = await fetch(url, Object.assign({ redirect: 'follow' }, opts)); } catch (e) { last = new Error('No connection to the sheet'); continue; }
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { last = new Error(`Google returned an error page (${r.status}); tried ${attempt + 1}×`); continue; }
    noteClock(j, t0, Date.now());
    if (!j.ok) throw new Error(j.error || 'Sheet rejected the request');
    return j;
  }
  throw last;
}
async function post(payload) {
  needEndpoint();
  // text/plain avoids a CORS preflight, which Apps Script cannot answer.
  return sheetFetch(settings.endpoint, { method: 'POST', body: JSON.stringify(Object.assign({ key: volunteerKey() }, payload)), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
}
async function get(params) {
  needEndpoint();
  const u = new URL(settings.endpoint); Object.entries(Object.assign({ key: volunteerKey() }, params)).forEach(([k, v]) => { if (v !== undefined) u.searchParams.set(k, v); });
  return sheetFetch(u);
}
async function sendWithFeedback(btns, payload, what) {
  btns.forEach(b => { b.disabled = true; b.dataset.prev = b.innerHTML; b.innerHTML = 'Sending…'; });
  try { const j = await post(payload); toast(`Sent ${what} to the sheet ✓` + (j.note ? ' — ' + j.note : ''), !!j.note); return true; }
  catch (e) { toast('Send failed: ' + explain(e) + '. Nothing is lost — try again or use Copy.', true); return false; }
  finally { btns.forEach(b => { b.disabled = false; if (b.dataset.prev) b.innerHTML = b.dataset.prev; }); }
}
function explain(e) { return /volunteer code/i.test(e.message) ? 'Wrong volunteer code — fix it under ⚙ Settings' : e.message; }
async function syncFromSheet(quiet) {
  try {
    const j = await get({ action: 'roster' });
    roster = j.roster || []; races = j.races || []; store.set('roster', roster); store.set('races', races); store.set('lastSync', Date.now()); sheetError = '';
    if (!quiet) toast(`Connected — ${races.length} races, ${roster.length} bibs loaded`);
    return true;
  } catch (e) { sheetError = explain(e); if (!quiet) toast('Sheet: ' + sheetError, true); return false; }
}

// ---------- HOME ----------
function renderHome() {
  const sel = $('home-race'); const known = [...new Set([...races, ...roster.map(r => r.race).filter(Boolean)])];
  sel.innerHTML = '<option value="">Choose a race…</option>' + known.map(r => `<option>${r}</option>`).join('') + '<option value="__other">Other (type it)…</option>';
  const isKnown = known.includes(settings.race);
  sel.value = settings.race && !isKnown ? '__other' : settings.race;
  $('home-race-other').classList.toggle('hidden', sel.value !== '__other');
  $('home-race-other').value = isKnown ? '' : settings.race;
  $('home-device').value = settings.device;
  const d = settings.race ? rd.get() : null;
  const last = store.get('lastSync'); 
  $('home-status').innerHTML = (isDirector() ? '<span class="badge ok">Director</span> Every screen, every team. ' : '') + (!settings.endpoint ? 'Sheet: not set up (⚙)' : sheetError ? `<span class="flag">⚠ Sheet: ${sheetError}</span>` : last ? `Sheet: ${roster.length} bibs loaded ${new Date(last).toLocaleTimeString([], {timeStyle:'short'})}` : 'Sheet: not reached yet') +
    (d && (d.laps.length || d.finishers.length) ? ` · this phone has ${d.laps.length} times / ${d.finishers.length} finishers for ${settings.race}` : '');
}
$('home-race').onchange = () => { const v = $('home-race').value; $('home-race-other').classList.toggle('hidden', v !== '__other');
  settings.race = v === '__other' ? $('home-race-other').value.trim() : v; saveSettings(); renderHome(); };
$('home-race-other').oninput = () => { settings.race = $('home-race-other').value.trim(); saveSettings(); };
$('home-device').oninput = () => { settings.device = $('home-device').value.trim(); saveSettings(); };
document.querySelectorAll('button.mode').forEach(b => b.onclick = () => {
  if (!settings.race) return toast('Choose a race first', true);
  if (!settings.device && b.dataset.mode !== 'results') return toast('Enter your name first — it labels your data in the sheet', true);
  show(b.dataset.mode);
});

// ---------- TIMER ----------
let clockTimer, sharedPoll;
function sharedLine(d) {
  if (d.sharedNote) return `<span class="flag">${d.sharedNote}</span>`;
  if (!d.start) return navigator.onLine && settings.endpoint ? 'Waiting for the gun — will also start when any other timer presses START.' : '';
  return d.sharedBy ? `Shared start, pressed by ${d.sharedBy === settings.device ? 'you' : d.sharedBy}` : 'Started on this phone only (no signal at the gun)';
}
/** While on the timer page, keep an eye on the race's shared start: adopt it, or notice that it was reset. */
let pollBusy = false; // never stack polls: when Google is slow, overlapping requests make it slower for every phone
async function pollShared() {
  if (pollBusy || $('view-timer').classList.contains('hidden') || !navigator.onLine || !settings.endpoint) return;
  pollBusy = true;
  try {
    const j = await get({ action: 'start', race: raceKey() }); const d = rd.get(); const s = j.start;
    if (s && !d.start) { d.start = toLocal(s.ms); d.startSheet = s.ms; d.sharedBy = s.device; d.end = null; d.sharedNote = ''; rd.set(d); keepAwake(); renderTimer(); toast(`Started by ${s.device} — clock adopted`); }
    else if (s && d.start && !d.sharedBy) { const diff = Math.round((d.start - toLocal(s.ms)) / 100) / 10; // started locally, now a shared start exists
      if (Math.abs(diff) > 2) { d.sharedNote = `${s.device} started ${Math.abs(diff)}s ${diff > 0 ? 'before' : 'after'} you — results will flag the difference`; rd.set(d); renderTimer(); } }
    else if (!s && d.start && d.sharedBy && !d.end) { // the shared start was reset by someone
      if (!d.laps.length) { d.start = null; d.sharedBy = null; d.sharedNote = ''; rd.set(d); renderTimer(); toast('The race start was reset — waiting for the gun again'); }
      else if (!d.sharedNote) { d.sharedNote = 'Another timer reset the race start. Your times are kept; reset here too if the race really restarted.'; rd.set(d); renderTimer(); } }
  } catch {} finally { pollBusy = false; }
}
function renderTimer() {
  const d = rd.get(); const phase = !d.start ? 'idle' : d.end ? 'done' : 'running';
  ['idle', 'running', 'done'].forEach(p => $('timer-phase-' + p).classList.toggle('hidden', p !== phase));
  $('timer-shared').innerHTML = sharedLine(d);
  clearInterval(sharedPoll); if (phase !== 'done') sharedPoll = setInterval(pollShared, phase === 'idle' ? 2000 : 15000);
  $('lap-count').textContent = `${d.laps.length} finisher${d.laps.length === 1 ? '' : 's'}`;
  const sig = d.laps.join(',');
  $('timer-done-msg').innerHTML = `Race finished — ${d.laps.length} finishers. ` + (!d.sentSig ? '<span class="flag">Not sent to the sheet yet.</span>'
    : d.sentSig === sig ? `Sent to the sheet at ${new Date(d.sentAt).toLocaleTimeString([], { timeStyle: 'short' })}.` : '<span class="flag">Changed since it was last sent — send again.</span>');
  $('timer-list').innerHTML = d.laps.map((ms, i) => `<li data-i="${i}"><span class="pos">${i + 1}</span><span>${fmt(ms)}</span></li>`).reverse().join('');
  clearInterval(clockTimer);
  const tick = () => { $('clock').textContent = d.start ? fmt((d.end || Date.now()) - d.start) : '00:00.0'; };
  tick(); if (phase === 'running') clockTimer = setInterval(tick, 100);
}
$('btn-start').onclick = async () => {
  const d = rd.get(); if (d.start) return; const now = Date.now();
  d.start = now; d.end = null; d.sharedBy = null; d.sharedNote = ''; rd.set(d); keepAwake(); renderTimer(); toast('Race started');
  if (!navigator.onLine || !settings.endpoint) return;
  try { const j = await post({ action: 'start_set', race: raceKey(), device: settings.device, ms: toSheet(now) }); const d2 = rd.get(); if (!d2.start) return;
    if (j.adopted) { const theirs = toLocal(j.start.ms); const diff = Math.round((d2.start - theirs) / 100) / 10;
      d2.start = theirs; d2.laps = d2.laps.map(ms => ms + (now - theirs)); } // first press wins: re-base onto the shared instant
    d2.startSheet = j.start.ms; d2.sharedBy = j.start.device; rd.set(d2); renderTimer();
    if (j.adopted) toast(`${j.start.device} pressed first — clock adopted`); else toast('Race started for every timer on ' + raceKey());
  } catch (e) { toast('Started on this phone; could not share the start: ' + explain(e), true); }
};
$('btn-lap').onclick = () => { const now = Date.now(); const d = rd.get(); if (!d.start || d.end) return;
  d.laps.push(now - d.start); rd.set(d); renderTimer(); navigator.vibrate?.(30); };
$('btn-timer-undo').onclick = () => { const d = rd.get(); if (!d.laps.length) return toast('Nothing to undo');
  armed($('btn-timer-undo'), `Tap again to remove #${d.laps.length}`, () => { d.laps.pop(); rd.set(d); renderTimer(); toast('Removed'); }); };
$('btn-finish').onclick = () => armed($('btn-finish'), 'Tap again to finish', () => { const d = rd.get(); d.end = Date.now(); d.sharedNote = ''; rd.set(d); renderTimer(); if (d.laps.length) sendTimes(); });
$('btn-resume').onclick = () => { const d = rd.get(); d.end = null; rd.set(d); renderTimer(); };
const timerPayload = () => { const d = rd.get(); return { role: 'timer', race: raceKey(), device: settings.device, start: d.start, end: d.end,
  entries: d.laps.map((ms, i) => ({ pos: i + 1, ms, time: fmt(ms) })) }; };
const sendTimes = async () => { const p = timerPayload(); if (!p.entries.length) return toast('No finishers yet');
  const ok = await sendWithFeedback([$('btn-timer-send'), $('btn-timer-send2')], p, p.entries.length + ' times');
  if (ok) { const d = rd.get(); d.sentSig = p.entries.map(e => e.ms).join(','); d.sentAt = Date.now(); rd.set(d); }
  renderTimer(); };
$('btn-timer-send').onclick = sendTimes; $('btn-timer-send2').onclick = sendTimes;
$('btn-timer-copy').onclick = () => copyText(`TIMES ${raceKey()} (${settings.device})\n` + rd.get().laps.map((ms, i) => `${i + 1}\t${fmt(ms)}`).join('\n'));
$('btn-timer-reset').onclick = () => armed($('btn-timer-reset'), 'Tap again: erase times, reset start for ALL timers', async () => {
  const d = rd.get(); const shared = !!d.sharedBy; d.start = null; d.end = null; d.laps = []; d.sentSig = null; d.sharedBy = null; d.sharedNote = ''; rd.set(d); renderTimer();
  if (navigator.onLine && settings.endpoint) { try { await post({ action: 'start_clear', race: raceKey(), device: settings.device }); toast('Reset — every timer on ' + raceKey() + ' is back to waiting for the gun'); }
    catch (e) { toast('Reset this phone; could not clear the shared start: ' + explain(e), true); } }
  else toast(shared ? 'Reset this phone. No signal, so the shared start is still set — reset again with signal.' : 'Timer reset', shared); });
$('timer-list').onclick = e => { const li = e.target.closest('li'); if (li) openEdit('timer', +li.dataset.i); };

// ---------- FINISHERS ----------
function bibsForRace() {
  const fromRoster = roster.filter(r => !r.race || r.race === raceKey()).map(r => String(r.bib));
  const manual = (settings.bibs || '').split(/[^0-9]+/).filter(Boolean);
  return [...new Set([...fromRoster, ...manual])].sort((a, b) => a - b);
}
function nameFor(bib) { const r = roster.find(r => String(r.bib) === String(bib)); return r ? `${r.name} · ${r.team}` : ''; }
function renderFinishers() {
  const d = rd.get(); const done = new Set(d.finishers); const filter = $('bib-filter').value.trim();
  const all = bibsForRace(); const bibs = all.filter(b => !filter || b.includes(filter));
  $('bib-grid').innerHTML = !all.length
    ? `<p class="hint">No bibs for “${raceKey()}” on this phone yet. Tap “Reload bib list” (needs signal), or type them under ⚙ Settings.</p>`
    : bibs.filter(b => !done.has(b)).map(b => `<button class="bib" data-bib="${b}">${b}</button>`).join('') || `<p class="hint">${filter ? 'No bib matches' : 'Every bib has finished'}</p>`;
  $('fin-list').innerHTML = d.finishers.map((b, i) =>
    `<li data-i="${i}"><span class="pos">${i + 1}</span><span>${b === '???' ? '<span class="badge bad">no bib</span>' : b} <small style="color:var(--muted)">${nameFor(b)}</small></span></li>`).reverse().join('');
}
$('bib-grid').onclick = e => {
  const btn = e.target.closest('.bib'); if (!btn) return; const bib = btn.dataset.bib; const d = rd.get();
  if (d.finishers.includes(bib)) return toast(`Bib ${bib} is already #${d.finishers.indexOf(bib) + 1}. Tap it in the list below to change something.`, true);
  d.finishers.push(bib); rd.set(d); $('bib-filter').value = ''; renderFinishers(); navigator.vibrate?.(30);
  toast(`#${d.finishers.length}  bib ${bib}  ${nameFor(bib)}`);
};
$('bib-filter').oninput = renderFinishers;
$('btn-unknown').onclick = () => { const d = rd.get(); d.finishers.push('???'); rd.set(d); renderFinishers();
  toast(`#${d.finishers.length} recorded as "no bib" — write down who it was, then fix it in the list`); };
$('btn-fin-undo').onclick = () => { const d = rd.get(); if (!d.finishers.length) return toast('Nothing to undo');
  armed($('btn-fin-undo'), `Tap again to remove #${d.finishers.length}`, () => { d.finishers.pop(); rd.set(d); renderFinishers(); toast('Removed'); }); };
const finPayload = () => ({ role: 'places', race: raceKey(), device: settings.device, entries: rd.get().finishers.map((bib, i) => ({ pos: i + 1, bib })) });
$('btn-fin-send').onclick = () => { const p = finPayload(); if (!p.entries.length) return toast('No finishers yet');
  sendWithFeedback([$('btn-fin-send')], p, p.entries.length + ' places'); };
$('btn-fin-copy').onclick = () => copyText(`PLACES ${raceKey()} (${settings.device})\n` + rd.get().finishers.map((b, i) => `${i + 1}\t${b}`).join('\n'));
$('btn-roster-refresh').onclick = async () => { const before = bibsForRace().length; if (await syncFromSheet(true)) { renderFinishers();
  toast(`Bib list reloaded: ${bibsForRace().length} bibs for ${raceKey()}` + (before === bibsForRace().length ? ' (no change)' : '')); } else toast(`Sheet: ${sheetError}. Keeping the bibs already on this phone.`, true); };
$('btn-fin-reset').onclick = () => armed($('btn-fin-reset'), 'Tap again to erase ALL finishers', () => { const d = rd.get(); d.finishers = []; rd.set(d); renderFinishers(); toast('Finishers reset'); });
$('fin-list').onclick = e => { const li = e.target.closest('li'); if (li) openEdit('finishers', +li.dataset.i); };

// ---------- EDIT ONE ENTRY (both roles) ----------
let edit = null; // {role, i}
function openEdit(role, i) {
  edit = { role, i }; const d = rd.get(); const isT = role === 'timer';
  $('edit-title').textContent = `#${i + 1} — ${isT ? 'time' : 'bib'}`;
  $('edit-value').value = isT ? fmt(d.laps[i]) : d.finishers[i];
  $('edit-value').type = 'text'; $('edit-value').inputMode = isT ? 'decimal' : 'numeric';
  $('edit-hint').textContent = isT ? 'Minutes:seconds.tenths, e.g. 18:42.3. The list re-sorts by time after any change.' : 'A bib number from this race, or ??? for no bib';
  $('edit-before').classList.toggle('hidden', isT); $('edit-after').classList.toggle('hidden', isT); $('edit-add').classList.toggle('hidden', !isT);
  $('edit').classList.remove('hidden'); $('edit-value').focus();
}
function closeEdit() { edit = null; $('edit').classList.add('hidden'); }
function editValue() {
  const v = $('edit-value').value.trim();
  if (edit.role === 'timer') { const ms = parseTime(v); if (ms == null) { toast('Time must look like 18:42.3', true); return undefined; } return ms; }
  if (v === '???') return v;
  if (!bibsForRace().includes(v)) { toast(`Bib ${v} is not in this race`, true); return undefined; } return v;
}
function editApply(fn) { const d = rd.get(); const list = edit.role === 'timer' ? d.laps : d.finishers; fn(list); if (edit.role === 'timer') d.laps.sort((a, b) => a - b); rd.set(d); closeEdit();
  renderTimer(); renderFinishers(); }
$('edit-save').onclick = () => { const v = editValue(); if (v === undefined) return; const isT = edit.role === 'timer', i = edit.i; const d = rd.get(); const newPos = isT ? d.laps.filter((_, k) => k !== i).filter(ms => ms < v).length + 1 : null;
  editApply(l => l[i] = v); toast(isT && newPos !== i + 1 ? `Saved — that time moved to #${newPos}` : 'Saved'); };
$('edit-add').onclick = () => { const v = editValue(); if (v === undefined) return; const d = rd.get(); const pos = d.laps.filter(ms => ms < v).length + 1;
  editApply(l => l.push(v)); toast(`Added as #${pos} — everyone after moved down one`); };
$('edit-before').onclick = () => { const v = editValue(); if (v === undefined) return; editApply(l => l.splice(edit.i, 0, v)); toast('Inserted — everyone after moved down one'); };
$('edit-after').onclick = () => { const v = editValue(); if (v === undefined) return; editApply(l => l.splice(edit.i + 1, 0, v)); toast('Inserted — everyone after moved down one'); };
$('edit-delete').onclick = () => armed($('edit-delete'), 'Tap again to delete', () => { editApply(l => l.splice(edit.i, 1)); toast('Deleted — everyone after moved up one'); });
$('edit-cancel').onclick = closeEdit;
$('edit').onclick = e => { if (e.target === $('edit')) closeEdit(); };

// ---------- RESULTS ----------
async function loadResults() {
  $('results-status').textContent = 'Loading…'; $('results-out').innerHTML = '';
  try {
    const j = await get({ action: 'results', race: raceKey() });
    const flagged = (j.results || []).filter(r => r.flags).length;
    const devs = j.devices || { timer: [], places: [] };
    $('results-status').innerHTML = `${raceKey()} — timers: ${devs.timer.map(d => `${d.device} (${d.count})`).join(', ') || 'none'}; ` +
      `finishers: ${devs.places.map(d => `${d.device} (${d.count})`).join(', ') || 'none'} ` +
      `<span class="badge ${j.warnings?.length || flagged ? 'bad' : 'ok'}">${j.warnings?.length || flagged ? [...(j.warnings || []), flagged ? flagged + ' flagged rows' : ''].filter(Boolean).join(' · ') : 'all consistent'}</span>`;
    let h = '<h3>Team scores</h3><table><tr><th>#</th><th>Team</th><th>Score</th><th>Scorers</th><th></th></tr>' +
      (j.teams || []).map(t => `<tr><td>${t.rank || ''}</td><td>${t.team}</td><td>${t.score ?? ''}</td><td>${t.scorers || ''}</td><td class="flag">${t.note || ''}</td></tr>`).join('') + '</table>';
    h += '<h3>Individual</h3><table><tr><th>#</th><th>Bib</th><th>Name</th><th>Team</th><th>Time</th><th></th></tr>' +
      (j.results || []).map(r => `<tr class="${r.flags ? 'flagged' : ''}"><td>${r.pos}</td><td>${r.bib || ''}</td><td>${r.name || ''}</td><td>${r.team || ''}</td><td>${r.time || ''}</td><td class="flag">${r.flags || ''}</td></tr>`).join('') + '</table>';
    $('results-out').innerHTML = h;
  } catch (e) { $('results-status').textContent = 'Could not load: ' + explain(e); }
}
$('btn-results-refresh').onclick = loadResults;

// ---------- ROSTER (coaches paste, check, submit) ----------
const ro = Object.assign({ code: '', team: '', race: '', drafts: {} }, store.get('roster-form', {}));
if (qs.get('code')) ro.code = qs.get('code');
let roTeams = store.get('teams', []);
let roRows = []; // [{name, grade}]
let roOnFile = []; // runners already in the sheet for this team + race
const draftKey = () => `${ro.team.toLowerCase()}|${ro.race}`;
const bibOnFile = name => (roOnFile.find(r => r.name.toLowerCase() === name.toLowerCase()) || {}).bib;
/** Fetches this team + race from the sheet. With `fill`, or when the editor is empty, puts it in the editor so small edits are easy. */
async function loadOnFile(fill) {
  roOnFile = []; if (!ro.team || !ro.race) { $('ro-file-status').textContent = ''; return; }
  $('ro-file-status').textContent = 'Checking the sheet…';
  try { const j = await get({ action: 'coach', code: coachCode(), team: ro.team, key: undefined });
    roOnFile = (j.roster || []).filter(r => r.race === ro.race);
    const empty = !$('ro-paste').value.trim();
    if (roOnFile.length && (fill || empty)) { $('ro-paste').value = roOnFile.map(r => r.grade ? `${r.name}, ${r.grade}` : r.name).join('\n'); ro.drafts[draftKey()] = $('ro-paste').value; saveRo(); }
    $('ro-file-status').textContent = roOnFile.length ? `${roOnFile.length} runners on file for ${ro.team} ${ro.race}, loaded below with their bibs. Edit, add or remove lines, then submit.` : `Nothing on file yet for ${ro.team} ${ro.race}.`;
  } catch (e) { $('ro-file-status').innerHTML = `<span class="flag">⚠ ${e.message}</span>`; }
  renderRosterPreview();
}
const saveRo = () => store.set('roster-form', ro);
/** Turns pasted text into rows. Accepts tabs, commas or runs of spaces between fields; a 1–2 digit field is the grade. */
function parseRoster(text) {
  const rows = [];
  text.split(/\r?\n/).forEach(line => {
    const raw = line.trim(); if (!raw) return;
    if (/^(name|runner|first|last|athlete)\b/i.test(raw) && /grade|gr\b|year/i.test(raw)) return; // header row
    let fields = raw.split(/\t|,|;|\s{2,}/).map(f => f.trim()).filter(Boolean);
    if (fields.length === 1) { const m = raw.match(/^(.*\S)\s+(\d{1,2})$/); if (m) fields = [m[1], m[2]]; } // "Jane Smith 10"
    let grade = ''; const names = [];
    fields.forEach(f => { if (/^\d{1,2}$/.test(f) && !grade) grade = f; else if (!/^\d+$/.test(f)) names.push(f.replace(/^\d+[.)]\s*/, '')); });
    rows.push({ name: names.join(' ').replace(/\s+/g, ' ').trim(), grade });
  });
  return rows;
}
function rowProblem(r, i) { if (!r.name) return 'missing name'; if (i !== undefined && roRows.findIndex(x => x.name.toLowerCase() === r.name.toLowerCase()) !== i) return 'listed twice'; if (r.grade && !(+r.grade >= 5 && +r.grade <= 12)) return 'grade?'; if (!/\s/.test(r.name)) return 'one word — full name?'; return ''; }
let codeRejected = false;
function renderRoster() {
  $('ro-code').value = ro.code;
  $('ro-code-wrap').classList.toggle('hidden', (isDirector() || !!qs.get('code')) && !codeRejected); // the link carries the code; only show it if the sheet says it is wrong
  $('ro-team-status').textContent = '';
  const tsel = $('ro-team-sel'); const known = roTeams.includes(ro.team);
  tsel.innerHTML = '<option value="">Choose your team…</option>' + roTeams.map(t => `<option>${t}</option>`).join('') + '<option value="__other">Not listed (type it)…</option>';
  tsel.value = ro.team && !known ? '__other' : ro.team;
  $('ro-team').classList.toggle('hidden', tsel.value !== '__other'); $('ro-team').value = known ? '' : ro.team;
  const sel = $('ro-race'); sel.innerHTML = '<option value="">Choose a race…</option>' + races.map(r => `<option>${r}</option>`).join(''); sel.value = ro.race;
  $('ro-paste').value = ro.drafts[draftKey()] || '';
  $('ro-result').innerHTML = '';
  if (settings.endpoint) coachSync(true).then(() => loadOnFile(false));
  renderRosterPreview();
}
async function coachSync(quiet) {
  $('ro-team-status').textContent = 'Loading teams from the sheet…';
  try { const j = await get({ action: 'coach', code: coachCode(), key: undefined });
    codeRejected = false; $('ro-code-wrap').classList.toggle('hidden', isDirector() || !!qs.get('code'));
    races = j.races || []; store.set('races', races); roTeams = j.teams || []; store.set('teams', roTeams);
    $('ro-team-status').textContent = roTeams.length ? `${roTeams.length} teams loaded from the sheet` : 'The meet director has not entered any teams yet — pick “Not listed” and type yours';
    const tsel = $('ro-team-sel'); const known = roTeams.includes(ro.team);
    tsel.innerHTML = '<option value="">Choose your team…</option>' + roTeams.map(t => `<option>${t}</option>`).join('') + '<option value="__other">Not listed (type it)…</option>';
    tsel.value = ro.team && !known ? '__other' : ro.team;
    const sel = $('ro-race'); sel.innerHTML = '<option value="">Choose a race…</option>' + races.map(r => `<option>${r}</option>`).join(''); sel.value = ro.race; return j; }
  catch (e) { codeRejected = /coach code/i.test(e.message); $('ro-code-wrap').classList.remove('hidden');
    $('ro-team-status').innerHTML = `<span class="flag">⚠ ${codeRejected ? 'Wrong coach code — check with the meet director' : 'Could not reach the sheet: ' + e.message}</span>`;
    if (!quiet) toast(e.message, true); }
}
let codeTimer;
const previewHint = () => { const bad = roRows.filter((r, i) => rowProblem(r, i)).length; return `${roRows.length} runners${bad ? `, <span class="flag">${bad} to check</span>` : ''}. Edit any cell.`; };
function renderRosterPreview() {
  roRows = parseRoster($('ro-paste').value);
  if (!roRows.length) return $('ro-preview').innerHTML = '';
  $('ro-preview').innerHTML = `<p class="hint">${previewHint()}</p>` +
    '<table class="ro"><tr><th>Bib</th><th>Name</th><th>Grade</th><th></th></tr>' + roRows.map((r, i) => { const p = rowProblem(r, i); const bib = bibOnFile(r.name);
      return `<tr><td class="ro-bib">${bib ? `<b>${bib}</b>` : '<span class="badge">new</span>'}</td><td class="${p ? 'bad' : ''}"><input data-i="${i}" data-f="name" value="${r.name.replace(/"/g, '&quot;')}"><small class="flag why">${p}</small></td>` +
        `<td class="${p === 'grade?' ? 'bad' : ''}"><input data-i="${i}" data-f="grade" value="${r.grade}" inputmode="numeric" style="width:4em"></td><td><button class="x" data-del="${i}">✕</button></td></tr>`; }).join('') + '</table>';
}
const rowsToText = () => roRows.map(r => r.grade ? `${r.name}, ${r.grade}` : r.name).join('\n');
$('ro-paste').oninput = () => { ro.drafts[draftKey()] = $('ro-paste').value; saveRo(); renderRosterPreview(); };
$('ro-preview').oninput = e => { const t = e.target; if (!t.dataset.f) return; const i = +t.dataset.i; roRows[i][t.dataset.f] = t.value.trim();
  ro.drafts[draftKey()] = rowsToText(); $('ro-paste').value = ro.drafts[draftKey()]; saveRo(); // keep the text box in step with the table
  const mark = (row, k) => { const q = rowProblem(roRows[k], k); const tds = row.querySelectorAll('td'); tds[1].className = q ? 'bad' : ''; tds[1].querySelector('.why').textContent = q; tds[2].className = q === 'grade?' ? 'bad' : ''; };
  $('ro-preview').querySelectorAll('tr').forEach((row, k) => { if (k) mark(row, k - 1); });
  const bib = bibOnFile(roRows[i].name); tds[0].innerHTML = bib ? `<b>${bib}</b>` : '<span class="badge">new</span>';
  $('ro-preview').querySelector('p').innerHTML = previewHint(); };
$('ro-preview').onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; roRows.splice(+b.dataset.del, 1);
  ro.drafts[draftKey()] = rowsToText(); $('ro-paste').value = ro.drafts[draftKey()]; saveRo(); renderRosterPreview(); };
function switchDraft() { $('ro-paste').value = ro.drafts[draftKey()] || ''; $('ro-result').innerHTML = ''; renderRosterPreview(); loadOnFile(false); }
$('ro-code').oninput = () => { ro.code = $('ro-code').value.trim(); saveRo(); clearTimeout(codeTimer); codeTimer = setTimeout(() => coachSync(true), 600); };
$('ro-team-sel').onfocus = () => { if (navigator.onLine) coachSync(true); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('view-roster').classList.contains('hidden')) coachSync(true); });
$('ro-team-sel').onchange = () => { const v = $('ro-team-sel').value; $('ro-team').classList.toggle('hidden', v !== '__other');
  ro.team = v === '__other' ? $('ro-team').value.trim() : v; saveRo(); switchDraft(); };
$('ro-team').oninput = () => { ro.team = $('ro-team').value.trim(); saveRo(); switchDraft(); };
$('ro-race').onchange = () => { ro.race = $('ro-race').value; saveRo(); switchDraft(); };
function showRosterOnFile(rows, title) {
  $('ro-result').innerHTML = `<h3>${title}</h3>` + (rows.length ? '<table><tr><th>Bib</th><th>Name</th><th>Grade</th><th>Race</th></tr>' +
    rows.map(r => `<tr><td><b>${r.bib}</b></td><td>${r.name}</td><td>${r.grade || ''}</td><td>${r.race}</td></tr>`).join('') + '</table>' : '<p class="hint">Nothing on file for this team yet.</p>');
}
$('ro-submit').onclick = async () => {
  const rows = roRows.filter(r => r.name);
  if (!ro.team) return toast('Choose your team', true); if (!ro.race) return toast('Choose a race', true); if (!rows.length) return toast('Paste your runners first', true);
  const bad = roRows.filter((r, i) => ['missing name', 'grade?', 'listed twice'].includes(rowProblem(r, i))); if (bad.length) return toast(`Fix the ${bad.length} highlighted row${bad.length > 1 ? 's' : ''} first (${rowProblem(bad[0], roRows.indexOf(bad[0]))})`, true);
  $('ro-submit').disabled = true;
  try { const j = await post({ action: 'roster_submit', code: coachCode(), team: ro.team, race: ro.race, runners: rows });
    showRosterOnFile(j.roster.filter(r => r.race === ro.race), `Submitted — ${ro.team}, ${ro.race}. Bibs:`); toast('Roster submitted ✓'); coachSync(true); loadOnFile(true); }
  catch (e) { toast('Could not submit: ' + e.message, true); }
  finally { $('ro-submit').disabled = false; }
};
$('ro-load').onclick = () => { if (!ro.team || !ro.race) return toast('Choose your team and race', true);
  const current = $('ro-paste').value.trim(), onFile = roOnFile.map(r => r.grade ? `${r.name}, ${r.grade}` : r.name).join('\n');
  if (current && current !== onFile) return armed($('ro-load'), 'Tap again to discard your edits', () => loadOnFile(true));
  loadOnFile(true); };
$('link-roster').onclick = e => { e.preventDefault(); show('roster'); };

// ---------- MEET SETUP (director) ----------
let setupDirty = false;
async function renderSetup(force) {
  $('su-dkey').value = settings.dkey;
  if (!settings.dkey) { $('su-body').classList.add('hidden'); $('su-status').textContent = 'Enter the director code to open meet setup.'; return; }
  $('su-status').textContent = 'Loading from the sheet…';
  try { const c = await get({ action: 'config', key: settings.dkey });
    $('su-body').classList.remove('hidden');
    if (force || !setupDirty) { $('su-races').value = c.races.join('\n'); $('su-teams').value = c.teams.join('\n');
      $('su-volunteer').value = c.volunteer_code; $('su-coach').value = c.coach_code; $('su-director').value = c.director_code; setupDirty = false; }
    const base = location.origin + location.pathname, ep = encodeURIComponent(settings.endpoint);
    const links = [['Volunteers', `${base}?endpoint=${ep}&key=${encodeURIComponent(c.volunteer_code)}`], ['Coaches', `${base}?page=roster&endpoint=${ep}&code=${encodeURIComponent(c.coach_code)}`],
      ['Director', `${base}?page=setup&endpoint=${ep}&key=${encodeURIComponent(c.volunteer_code)}&dkey=${encodeURIComponent(c.director_code)}`]];
    $('su-links').innerHTML = links.map(([who, url]) => `<div class="linkrow"><b>${who}</b><input readonly value="${url}"><button class="secondary small" data-copy="${url}">Copy</button></div>`).join('');
    const all = [...c.teams, ...c.rosters.map(t => t.team).filter(t => !c.teams.includes(t))]; const counts = Object.fromEntries(c.rosters.map(t => [t.team, t.counts]));
    $('su-status').innerHTML = (all.length ? '<h3>Teams and runners on file</h3><table><tr><th>Team</th>' + c.races.map(r => `<th>${r}</th>`).join('') + '</tr>' +
      all.map(t => `<tr><td>${t}${c.teams.includes(t) ? '' : ' <span class="badge">not in list</span>'}</td>${c.races.map(r => `<td>${(counts[t] || {})[r] || '<span style="color:var(--muted)">—</span>'}</td>`).join('')}</tr>`).join('') + '</table>' +
      '<p class="hint">A team with a roster on file stays available to its coach even if it is removed from the list above.</p>' : '<p class="hint">No teams yet.</p>');
  } catch (e) { $('su-body').classList.add('hidden'); $('su-status').innerHTML = `<span class="flag">⚠ ${/director code/i.test(e.message) ? 'Wrong director code' : 'Could not load: ' + e.message}</span>`; }
}
let dkeyTimer;
$('su-dkey').oninput = () => { settings.dkey = $('su-dkey').value.trim(); saveSettings(); clearTimeout(dkeyTimer); dkeyTimer = setTimeout(() => renderSetup(false), 600); };
['su-races', 'su-teams', 'su-volunteer', 'su-coach', 'su-director'].forEach(id => $(id).oninput = () => { setupDirty = true; });
$('su-links').onclick = e => { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); };
$('su-save').onclick = async () => {
  $('su-save').disabled = true;
  const v = $('su-volunteer').value.trim(), c = $('su-coach').value.trim(), d = $('su-director').value.trim();
  try { const before = await get({ action: 'config', key: settings.dkey });
    await post({ action: 'config_set', key: settings.dkey, races: $('su-races').value.split('\n').map(x => x.trim()).filter(Boolean), teams: $('su-teams').value.split('\n').map(x => x.trim()).filter(Boolean),
      volunteer_code: v, coach_code: c, director_code: d });
    if (d) { settings.dkey = d; saveSettings(); }
    const changed = [v && v !== before.volunteer_code ? 'volunteer' : '', c && c !== before.coach_code ? 'coach' : '', d && d !== before.director_code ? 'director' : ''].filter(Boolean);
    toast(changed.length ? `Saved ✓ — the ${changed.join(', ')} code changed: send out new links, or have people update it under ⚙` : 'Meet setup saved ✓', !!changed.length);
    await syncFromSheet(true); renderSetup(true); }
  catch (e) { toast('Could not save: ' + explain(e), true); }
  finally { $('su-save').disabled = false; }
};
$('link-setup').onclick = e => { e.preventDefault(); show('setup'); };

// ---------- SETTINGS / NAV ----------
function renderSettings() { $('set-endpoint').value = settings.endpoint; $('set-key').value = settings.key; $('set-bibs').value = settings.bibs; }
$('btn-settings').onclick = () => show('settings');
$('btn-back').onclick = () => show('home');
$('btn-settings-save').onclick = async () => {
  settings.endpoint = $('set-endpoint').value.trim(); settings.key = $('set-key').value.trim(); settings.bibs = $('set-bibs').value.trim(); saveSettings();
  if (await syncFromSheet(false)) show('home');
};
$('btn-wipe').onclick = () => armed($('btn-wipe'), 'Tap again to erase EVERYTHING', () => { localStorage.clear(); location.href = location.pathname; });
$('version').textContent = 'v' + VERSION;

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  if (settings.endpoint && navigator.onLine) await syncFromSheet(true);
  const start = qs.get('mode') || store.get('view', 'home');
  if ((qs.get('page') === 'roster' || qs.get('page') === 'setup') && settings.endpoint) show(qs.get('page')); else if (!settings.endpoint) show('settings'); else if (start !== 'home' && start !== 'settings' && settings.race && (settings.device || start === 'results')) show(start); else show('home');
})();
