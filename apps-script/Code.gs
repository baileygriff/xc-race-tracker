/**
 * XC Race Tracker — Google Apps Script backend.
 * Paste into Extensions → Apps Script of a blank Google Sheet, run setup() once,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Sheets:  Config | Roster | Times | Places | Results | TeamScores
 */
const SS = () => SpreadsheetApp.getActiveSpreadsheet();
const HEADERS = {
  Config:     ['Key', 'Value'],
  Roster:     ['Team', 'Name', 'Grade', 'Race', 'Bib'],
  Times:      ['Race', 'Pos', 'Ms', 'Time', 'Device', 'Submitted'],
  Places:     ['Race', 'Pos', 'Bib', 'Device', 'Submitted'],
  Results:    ['Race', 'Pos', 'Bib', 'Name', 'Team', 'Time', 'ScoringPlace', 'Flags', 'TimesByDevice', 'BibsByDevice'],
  TeamScores: ['Race', 'Rank', 'Team', 'Score', 'Scorers', 'Displacers', 'Note'],
  Starts:     ['Race', 'StartMs', 'Device', 'SetAt'],
};

// ---------- one-time setup ----------
function setup() {
  const ss = SS();
  Object.entries(HEADERS).forEach(([name, hdr]) => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(hdr); sh.setFrozenRows(1); sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold'); }
  });
  const cfg = ss.getSheetByName('Config');
  const defaults = [
    ['races', 'Boys, Girls'],
    ['volunteer_code', ''], ['coach_code', ''], ['director_code', ''], ['teams', ''],
    ['note', 'Edit these from the app (Meet setup page) or here. Three codes: volunteer (timer/finishers/results), coach (roster page), director (meet setup; also opens everything else).']];
  if (cfg.getLastRow() < 2) cfg.getRange(2, 1, defaults.length, 2).setValues(defaults);
  const first = ss.getSheets()[0]; if (first.getName() === 'Sheet1' && first.getLastRow() === 0) ss.deleteSheet(first);
  Logger.log('Setup done. Now put a director_code in Config and deploy as a web app; the rest is set from the app.');
}
function config(key) {
  const rows = SS().getSheetByName('Config').getDataRange().getValues();
  const r = rows.find(r => r[0] === key); return r ? String(r[1]) : '';
}
function setConfig(key, value) {
  const sh = SS().getSheetByName('Config'); const rows = sh.getDataRange().getValues();
  const i = rows.findIndex(r => r[0] === key);
  if (i >= 0) sh.getRange(i + 1, 2).setValue(value); else sh.appendRow([key, value]);
}
const races = () => config('races').split(',').map(s => s.trim()).filter(Boolean);
/** Three codes. The director's opens everything; a blank code in Config means that door is open. */
const codeIs = (given, ...keys) => { const wants = keys.map(k => config(k).trim()).filter(Boolean); return !wants.length || wants.includes(String(given || '').trim()); };
function checkVolunteer(key) { if (!codeIs(key, 'volunteer_code', 'director_code')) throw new Error('Wrong volunteer code'); }
function checkCoach(code) { if (!codeIs(code, 'coach_code', 'director_code')) throw new Error('Wrong coach code'); }
function checkDirector(key) { if (!codeIs(key, 'director_code')) throw new Error('Wrong director code'); }

/** A coach's pasted roster for one team + race. Replaces that team's rows for the race, keeping bibs
 *  already assigned to runners with the same name, then assigns bibs to the new ones. */
function submitRoster(p) {
  let team = String(p.team || '').trim(); const race = String(p.race || '').trim();
  if (!team || !race) throw new Error('Team and race are required');
  if (!races().includes(race)) throw new Error('Unknown race ' + race);
  const runners = (p.runners || []).map(r => ({ name: String(r.name || '').trim(), grade: String(r.grade || '').trim(), bib: /^\d{3}$/.test(String(r.bib || '').trim()) ? String(r.bib).trim() : '' })).filter(r => r.name);
  if (!runners.length) throw new Error('No runners');
  const names = new Set(); const dup = runners.find(r => { const k = r.name.toLowerCase(); if (names.has(k)) return true; names.add(k); });
  if (dup) throw new Error(`"${dup.name}" is listed twice`);
  const sh = SS().getSheetByName('Roster'); const data = sh.getDataRange().getValues();
  const mine = r => String(r[0]).trim().toLowerCase() === team.toLowerCase() && String(r[3]).trim() === race;
  const seen = data.slice(1).find(r => String(r[0]).trim().toLowerCase() === team.toLowerCase()); if (seen) team = String(seen[0]).trim(); // keep the spelling already on file
  const oldBib = {}; data.slice(1).filter(mine).forEach(r => oldBib[String(r[1]).trim().toLowerCase()] = String(r[4]));
  const keep = data.filter((r, i) => i === 0 || !mine(r));
  sh.clearContents(); sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  const taken = new Set(keep.slice(1).map(r => String(r[4])));
  const rows = runners.map(r => { const bib = r.bib && !taken.has(r.bib) ? r.bib : oldBib[r.name.toLowerCase()] || ''; if (bib) taken.add(bib); return [team, r.name, r.grade, race, bib]; }); // a supplied bib wins if free
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  assignBibs();
  return rosterList().filter(r => r.team.toLowerCase() === team.toLowerCase() && r.race === race);
}
const splitList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
/** Teams coaches can pick from: the director's list, plus any team that already has a roster on file. */
function teamsList() {
  const fromRoster = SS().getSheetByName('Roster').getDataRange().getValues().slice(1).map(r => String(r[0]).trim()).filter(Boolean);
  return [...new Set([...splitList(config('teams')), ...fromRoster])].sort((a, b) => a.localeCompare(b));
}
/** Everything the meet director can change from the app. `teams` is exactly the list on file; `rosters` is who has submitted. */
function meetConfig() {
  const counts = {}; rosterList().forEach(r => { counts[r.team] = counts[r.team] || {}; counts[r.team][r.race] = (counts[r.team][r.race] || 0) + 1; });
  return { races: races(), volunteer_code: config('volunteer_code'), coach_code: config('coach_code'), director_code: config('director_code'), teams: splitList(config('teams')),
    rosters: Object.keys(counts).sort((a, b) => a.localeCompare(b)).map(t => ({ team: t, counts: counts[t] })) };
}
function setMeetConfig(p) {
  if (p.races !== undefined) { const r = splitList(Array.isArray(p.races) ? p.races.join(',') : p.races); if (!r.length) throw new Error('At least one race is needed'); setConfig('races', r.join(', ')); }
  if (p.teams !== undefined) setConfig('teams', splitList(Array.isArray(p.teams) ? p.teams.join(',') : p.teams).join(', '));
  ['volunteer_code', 'coach_code', 'director_code'].forEach(k => { if (p[k] !== undefined && String(p[k]).trim()) setConfig(k, String(p[k]).trim()); }); // blank keeps the current one
  return meetConfig();
}

/** Gives every Roster row without a bib a 3-digit number that is unused anywhere in the meet and differs from every
 *  other bib IN THE SAME RACE in at least two digit positions, so a single misread digit can never land on another
 *  runner in the grid a finish logger is looking at. (Across the whole meet that is impossible past ~90 runners.) */
function assignBibs() {
  const sh = SS().getSheetByName('Roster'); const rows = sh.getDataRange().getValues(); rows.shift();
  const all = new Set(rows.map(r => String(r[4])).filter(b => /^\d{3}$/.test(b)));
  const byRace = {}; rows.forEach(r => { if (/^\d{3}$/.test(String(r[4]))) (byRace[r[3]] = byRace[r[3]] || []).push(String(r[4])); });
  const distance = (a, b) => [0, 1, 2].filter(i => a[i] !== b[i]).length;
  const pool = []; for (let n = 100; n <= 999; n++) pool.push(String(n));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let assigned = 0;
  // Numbers whose digit sums agree mod 10 always differ in two places, and there are 90 of each family, so each race
  // draws first from the family that its existing bibs leave the most room in.
  const digitSum = b => (+b[0] + +b[1] + +b[2]) % 10;
  const family = {};
  const familyFor = race => { if (family[race] !== undefined) return family[race];
    let best = 0, room = -1; for (let f = 0; f < 10; f++) { const n = pool.filter(c => digitSum(c) === f && !all.has(c) && (byRace[race] || []).every(u => distance(c, u) >= 2)).length; if (n > room) { room = n; best = f; } }
    return family[race] = best; };
  rows.forEach((r, i) => {
    if (/^\d{3}$/.test(String(r[4]))) return;
    const same = byRace[r[3]] = byRace[r[3]] || []; const f = familyFor(r[3]);
    const ok = (c, minDist) => !all.has(c) && same.every(u => distance(c, u) >= minDist);
    const pick = minDist => pool.find(c => digitSum(c) === f && ok(c, minDist)) || pool.find(c => ok(c, minDist));
    const bib = pick(2) || pick(1); if (!bib) throw new Error('Out of bib numbers');
    all.add(bib); same.push(bib); sh.getRange(i + 2, 5).setValue(bib); assigned++;
  });
  return assigned;
}

// ---------- shared race start: one instant, in sheet time, that every timer on a race adopts ----------
function sharedStart(race) {
  const r = SS().getSheetByName('Starts').getDataRange().getValues().slice(1).find(r => r[0] === race);
  return r ? { ms: Number(r[1]), device: String(r[2]) } : null;
}
function setSharedStart(race, start) {
  if (!race) throw new Error('Missing race');
  writeRows('Starts', race, start ? [[race, start.ms, start.device, new Date()]] : []);
}

// ---------- keep Results and TeamScores true when someone edits the sheet by hand ----------
/** Simple trigger: any edit to Times, Places or Roster recomputes every race's Results and TeamScores. */
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if (['Times', 'Places', 'Roster'].includes(name)) recomputeAll();
}
function recomputeAll() { races().forEach(r => computeResults(r)); }
function onOpen() { SpreadsheetApp.getUi().createMenu('XC Tracker').addItem('Recompute results', 'recomputeAll').addToUi(); }

// ---------- web endpoints ----------
// Every reply carries the sheet's clock (`now`) so phones can measure their own offset and share one start instant.
const json = o => ContentService.createTextOutput(JSON.stringify(Object.assign({ now: Date.now() }, o))).setMimeType(ContentService.MimeType.JSON);
function rosterList() {
  return SS().getSheetByName('Roster').getDataRange().getValues().slice(1)
    .filter(r => r[4] !== '').map(r => ({ team: r[0], name: r[1], grade: r[2], race: r[3], bib: String(r[4]) }));
}
function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.action === 'coach') { checkCoach(p.code); return json({ ok: true, races: races(), teams: teamsList(),
      roster: p.team ? rosterList().filter(r => r.team.toLowerCase() === String(p.team).toLowerCase()) : [] }); }
    if (p.action === 'config') { checkDirector(p.key); return json(Object.assign({ ok: true }, meetConfig())); }
    checkVolunteer(p.key);
    if (p.action === 'roster') return json({ ok: true, races: races(), roster: rosterList() });
    if (p.action === 'start') return json({ ok: true, start: sharedStart(p.race) });
    if (p.action === 'results') return json(Object.assign({ ok: true }, computeResults(p.race)));
    return json({ ok: true, ping: 'XC Race Tracker', races: races() });
  } catch (err) { return json({ ok: false, error: err.message }); }
}
function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.action === 'roster_submit') { checkCoach(p.code); return json({ ok: true, roster: submitRoster(p) }); }
    if (p.action === 'config_set') { checkDirector(p.key); return json(Object.assign({ ok: true }, setMeetConfig(p))); }
    checkVolunteer(p.key);
    if (p.action === 'start_set') { const s = sharedStart(p.race); if (s) return json({ ok: true, start: s, adopted: true }); // first press wins
      setSharedStart(p.race, { ms: Number(p.ms), device: p.device || '' }); return json({ ok: true, start: sharedStart(p.race), adopted: false }); }
    if (p.action === 'start_clear') { setSharedStart(p.race, null); return json({ ok: true, start: null }); }
    if (!p.race || !p.role || !p.device || !Array.isArray(p.entries)) throw new Error('Missing race, role, device or entries');
    const now = new Date();
    const sheetName = p.role === 'timer' ? 'Times' : p.role === 'places' ? 'Places' : null;
    if (!sheetName) throw new Error('Unknown role ' + p.role);
    const sh = SS().getSheetByName(sheetName);
    // Replace: a re-send from the same phone for the same race overwrites its earlier rows, so sending twice is always safe.
    const devCol = p.role === 'timer' ? 4 : 3;
    const data = sh.getDataRange().getValues(); const keep = data.filter((r, i) => i === 0 || r[0] !== p.race || r[devCol] !== p.device);
    sh.clearContents(); if (keep.length) sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
    const rows = p.role === 'timer'
      ? p.entries.map(x => [p.race, x.pos, x.ms, x.time, p.device || '', now])
      : p.entries.map(x => [p.race, x.pos, String(x.bib), p.device || '', now]);
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    const res = computeResults(p.race);
    const flagged = res.results.filter(r => r.flags).length;
    const note = [...res.warnings, flagged ? `${flagged} row${flagged === 1 ? '' : 's'} flagged` : ''].filter(Boolean).join('; ');
    return json({ ok: true, received: rows.length, note });
  } catch (err) { return json({ ok: false, error: err.message }); }
  finally { lock.releaseLock(); }
}

// ---------- scoring ----------
const TIME_TOLERANCE_MS = 1000; // two timers further apart than this on the same position get flagged
function avg(a) { return Math.round(a.reduce((x, y) => x + y, 0) / a.length); }
function fmtMs(ms) { const t = Math.round(ms / 100); return `${String(Math.floor(t / 600)).padStart(2, '0')}:${String(Math.floor(t / 10) % 60).padStart(2, '0')}.${t % 10}`; };
/** Groups a sheet's rows for one race by device: { device: rows sorted by pos }, devices in alphabetical order. */
function byDevice(sheetName, race, devCol, sortCol) {
  const out = {};
  SS().getSheetByName(sheetName).getDataRange().getValues().slice(1).filter(r => r[0] === race)
    .forEach(r => (out[r[devCol]] = out[r[devCol]] || []).push(r));
  Object.values(out).forEach(rows => rows.sort((a, b) => a[sortCol] - b[sortCol]));
  return Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
}
/** Merges every timer's and every finisher-logger's list by position. Time is the average of the timers;
 *  bib comes from the first logger (alphabetical) and the others are checked against it. */
function computeResults(race) {
  race = race || '';
  const times = byDevice('Times', race, 4, 2), places = byDevice('Places', race, 3, 1); // times by elapsed ms (finish order IS time order), places by position
  const byBib = {}; rosterList().forEach(r => byBib[r.bib] = r);
  const tDevs = Object.keys(times), pDevs = Object.keys(places);
  const counts = [...tDevs.map(d => times[d].length), ...pDevs.map(d => places[d].length)];
  const n = Math.max(0, ...counts);
  const warnings = [];
  if (counts.length > 1 && new Set(counts).size > 1)
    warnings.push('COUNT MISMATCH: ' + [...tDevs.map(d => `${d} ${times[d].length} times`), ...pDevs.map(d => `${d} ${places[d].length} places`)].join(', '));
  if (!tDevs.length) warnings.push('no times yet'); if (!pDevs.length) warnings.push('no places yet');
  const results = [];
  for (let i = 0; i < n; i++) {
    const flags = [];
    const ts = tDevs.map(d => times[d][i]).filter(Boolean).map(r => Number(r[2]));
    if (ts.length > 1 && Math.max(...ts) - Math.min(...ts) > TIME_TOLERANCE_MS) flags.push('timers disagree: ' + tDevs.map(d => times[d][i] ? `${d} ${times[d][i][3]}` : `${d} —`).join(' / '));
    if (tDevs.length && ts.length < tDevs.length) flags.push('missing a time from ' + tDevs.filter(d => !times[d][i]).join(', '));
    const bibs = pDevs.map(d => places[d][i] ? String(places[d][i][2]) : '');
    const bib = bibs.find(Boolean) || '';
    if (pDevs.length && bibs.some(b => !b)) flags.push('missing a bib from ' + pDevs.filter((d, k) => !bibs[k]).join(', '));
    if (new Set(bibs.filter(Boolean)).size > 1) flags.push('loggers disagree: ' + pDevs.map((d, k) => `${d} ${bibs[k] || '—'}`).join(' / '));
    const r = byBib[bib] || {};
    if (bib === '???') flags.push('runner had no bib'); else if (bib && !byBib[bib]) flags.push('bib not on roster');
    else if (r.race && r.race !== race) flags.push(`bib is on the ${r.race} roster`);
    const ms = ts.length ? avg(ts) : '';
    results.push({ pos: i + 1, bib, name: r.name || '', team: r.team || '', ms, time: ms === '' ? '' : fmtMs(ms), scoringPlace: '', flags: flags.join('; '),
      times: Object.fromEntries(tDevs.map(d => [d, times[d][i] ? times[d][i][3] : ''])), bibs: Object.fromEntries(pDevs.map((d, k) => [d, bibs[k]])) });
  }
  // Team scoring: only teams with 5+ finishers score; places are renumbered among those runners only.
  const count = {}; results.forEach(r => { if (r.team) count[r.team] = (count[r.team] || 0) + 1; });
  let sp = 0; const teamRuns = {};
  results.forEach(r => { if (r.team && count[r.team] >= 5) { r.scoringPlace = ++sp; (teamRuns[r.team] = teamRuns[r.team] || []).push(sp); } });
  const teams = Object.entries(teamRuns).map(([team, p]) => ({ team, score: p.slice(0, 5).reduce((a, b) => a + b, 0),
    scorers: p.slice(0, 5).join(', '), displacers: p.slice(5, 7).join(', '), sixth: p[5] || 9999, note: '' }));
  teams.sort((a, b) => a.score - b.score || a.sixth - b.sixth);
  Object.entries(count).filter(([, c]) => c < 5).forEach(([team, c]) =>
    teams.push({ team, score: null, scorers: '', displacers: '', note: `incomplete team (${c} finisher${c === 1 ? '' : 's'})` }));
  teams.forEach((t, i) => { if (t.score != null) t.rank = i + 1; if (t.note === '' && i > 0 && teams[i - 1].score === t.score) t.note = 'tie broken on 6th runner'; });
  writeRows('Results', race, results.map(r => [race, r.pos, r.bib, r.name, r.team, r.time, r.scoringPlace, r.flags,
    tDevs.map(d => `${d}: ${r.times[d]}`).join(' | '), pDevs.map(d => `${d}: ${r.bibs[d]}`).join(' | ')]));
  writeRows('TeamScores', race, teams.map(t => [race, t.rank || '', t.team, t.score == null ? '' : t.score, t.scorers, t.displacers, t.note]));
  return { race, warnings, results, teams,
    devices: { timer: tDevs.map(d => ({ device: d, count: times[d].length })), places: pDevs.map(d => ({ device: d, count: places[d].length })) } };
}
function writeRows(sheetName, race, rows) {
  const sh = SS().getSheetByName(sheetName); const data = sh.getDataRange().getValues();
  const keep = data.filter((r, i) => i === 0 || r[0] !== race);
  sh.clearContents(); sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
