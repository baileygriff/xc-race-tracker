/**
 * XC Race Tracker — Google Apps Script backend.
 * Paste into Extensions → Apps Script of a blank Google Sheet, run setup() once,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Sheets:  Config | Roster | Times | Places | Results | TeamScores  (+ the form's own responses tab)
 */
const SS = () => SpreadsheetApp.getActiveSpreadsheet();
const HEADERS = {
  Config:     ['Key', 'Value'],
  Roster:     ['Team', 'Name', 'Grade', 'Race', 'Bib'],
  Times:      ['Race', 'Pos', 'Ms', 'Time', 'Device', 'Submitted'],
  Places:     ['Race', 'Pos', 'Bib', 'Device', 'Submitted'],
  Results:    ['Race', 'Pos', 'Bib', 'Name', 'Team', 'Time', 'ScoringPlace', 'Note'],
  TeamScores: ['Race', 'Rank', 'Team', 'Score', 'Scorers', 'Displacers', 'Note'],
};

// ---------- one-time setup ----------
function setup() {
  const ss = SS();
  Object.entries(HEADERS).forEach(([name, hdr]) => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(hdr); sh.setFrozenRows(1); sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold'); }
  });
  const cfg = ss.getSheetByName('Config');
  if (cfg.getLastRow() < 2) cfg.getRange(2, 1, 4, 2).setValues([
    ['races', 'Girls Varsity, Boys Varsity, Girls JV, Boys JV'],
    ['form_url', ''], ['form_edit_url', ''], ['note', 'Edit the races list, then run createRosterForm().']]);
  const first = ss.getSheets()[0]; if (first.getName() === 'Sheet1' && first.getLastRow() === 0) ss.deleteSheet(first);
  Logger.log('Setup done. Now edit Config!races and run createRosterForm().');
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

/** Creates the Google Form coaches fill in, one submission per team per race. */
function createRosterForm() {
  const form = FormApp.create('XC Meet Roster Submission');
  form.setDescription('One submission per team per race. List every runner, one per line.');
  form.addTextItem().setTitle('Team / School').setRequired(true);
  form.addTextItem().setTitle('Coach email');
  form.addListItem().setTitle('Race').setChoiceValues(races()).setRequired(true);
  form.addParagraphTextItem().setTitle('Runners')
    .setHelpText('One runner per line, like:\nJane Smith, 10\nSam Lee, 11\n(grade is optional)').setRequired(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SS().getId());
  setConfig('form_url', form.getPublishedUrl()); setConfig('form_edit_url', form.getEditUrl());
  Logger.log('Send coaches this link: ' + form.getPublishedUrl());
}

/** Pulls every form response into Roster (skipping runners already there) and assigns bibs. */
function importRoster() {
  const ss = SS();
  const resp = ss.getSheets().find(s => /^Form Responses/.test(s.getName()));
  if (!resp) throw new Error('No form responses tab yet');
  const data = resp.getDataRange().getValues(); const hdr = data.shift();
  const col = name => hdr.findIndex(h => String(h).toLowerCase().startsWith(name));
  const cTeam = col('team'), cRace = col('race'), cRunners = col('runners');
  const roster = ss.getSheetByName('Roster');
  const existing = new Set(roster.getDataRange().getValues().slice(1).map(r => [r[0], r[1], r[3]].join('|').toLowerCase()));
  const add = [];
  data.forEach(row => {
    const team = String(row[cTeam]).trim(), race = String(row[cRace]).trim();
    String(row[cRunners]).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(line => {
      const [name, grade] = line.split(',').map(s => s.trim());
      const key = [team, name, race].join('|').toLowerCase();
      if (existing.has(key)) return; existing.add(key);
      add.push([team, name, grade || '', race, '']);
    });
  });
  if (add.length) roster.getRange(roster.getLastRow() + 1, 1, add.length, 5).setValues(add);
  const n = assignBibs();
  Logger.log(`Imported ${add.length} runners, assigned ${n} bibs.`);
}

/** Gives every Roster row without a bib a 3-digit number that differs from every other bib
 *  in at least two digit positions, so a single misread digit can never land on another real runner. */
function assignBibs() {
  const sh = SS().getSheetByName('Roster'); const rows = sh.getDataRange().getValues(); rows.shift();
  const used = rows.map(r => String(r[4])).filter(b => /^\d{3}$/.test(b));
  const distance = (a, b) => [0, 1, 2].filter(i => a[i] !== b[i]).length;
  const pool = []; for (let n = 100; n <= 999; n++) pool.push(String(n));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const pick = minDist => pool.find(c => !used.includes(c) && used.every(u => distance(c, u) >= minDist));
  let assigned = 0;
  rows.forEach((r, i) => {
    if (/^\d{3}$/.test(String(r[4]))) return;
    const bib = pick(2) || pick(1); if (!bib) throw new Error('Out of bib numbers');
    used.push(bib); sh.getRange(i + 2, 5).setValue(bib); assigned++;
  });
  return assigned;
}

// ---------- web endpoints ----------
const json = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
function rosterList() {
  return SS().getSheetByName('Roster').getDataRange().getValues().slice(1)
    .filter(r => r[4] !== '').map(r => ({ team: r[0], name: r[1], grade: r[2], race: r[3], bib: String(r[4]) }));
}
function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.action === 'roster') return json({ ok: true, races: races(), roster: rosterList() });
    if (p.action === 'results') return json(Object.assign({ ok: true }, computeResults(p.race)));
    return json({ ok: true, ping: 'XC Race Tracker', races: races() });
  } catch (err) { return json({ ok: false, error: err.message }); }
}
function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const p = JSON.parse(e.postData.contents);
    if (!p.race || !p.role || !Array.isArray(p.entries)) throw new Error('Missing race, role or entries');
    const now = new Date();
    const sheetName = p.role === 'timer' ? 'Times' : p.role === 'places' ? 'Places' : null;
    if (!sheetName) throw new Error('Unknown role ' + p.role);
    const sh = SS().getSheetByName(sheetName);
    // Replace: a re-send of the same race + job overwrites, so sending twice is always safe.
    const data = sh.getDataRange().getValues(); const keep = data.filter((r, i) => i === 0 || r[0] !== p.race);
    sh.clearContents(); if (keep.length) sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
    const rows = p.role === 'timer'
      ? p.entries.map(x => [p.race, x.pos, x.ms, x.time, p.device || '', now])
      : p.entries.map(x => [p.race, x.pos, String(x.bib), p.device || '', now]);
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    const res = computeResults(p.race);
    const note = res.timesCount && res.placesCount && res.timesCount !== res.placesCount
      ? `WARNING: ${res.timesCount} times vs ${res.placesCount} places` : '';
    return json({ ok: true, received: rows.length, note });
  } catch (err) { return json({ ok: false, error: err.message }); }
  finally { lock.releaseLock(); }
}

// ---------- scoring ----------
function computeResults(race) {
  const ss = SS(); race = race || '';
  const times = ss.getSheetByName('Times').getDataRange().getValues().slice(1).filter(r => r[0] === race).sort((a, b) => a[1] - b[1]);
  const places = ss.getSheetByName('Places').getDataRange().getValues().slice(1).filter(r => r[0] === race).sort((a, b) => a[1] - b[1]);
  const byBib = {}; rosterList().forEach(r => byBib[r.bib] = r);
  const n = Math.max(times.length, places.length);
  const results = [];
  for (let i = 0; i < n; i++) {
    const t = times[i], pl = places[i]; const bib = pl ? String(pl[2]) : ''; const r = byBib[bib] || {};
    let note = '';
    if (!t) note = 'no time'; else if (!pl) note = 'no bib recorded';
    else if (bib === '???') note = 'runner had no bib';
    else if (!byBib[bib]) note = 'bib not on roster';
    else if (r.race && r.race !== race) note = `bib is on the ${r.race} roster`;
    results.push({ pos: i + 1, bib, name: r.name || '', team: r.team || '', ms: t ? t[2] : '', time: t ? t[3] : '', scoringPlace: '', note });
  }
  // Team scoring: only teams with 5+ finishers score; places are renumbered among those runners only.
  const count = {}; results.forEach(r => { if (r.team) count[r.team] = (count[r.team] || 0) + 1; });
  let sp = 0; const teamRuns = {};
  results.forEach(r => {
    if (r.team && count[r.team] >= 5) { r.scoringPlace = ++sp; (teamRuns[r.team] = teamRuns[r.team] || []).push(sp); }
  });
  const teams = Object.entries(teamRuns).map(([team, p]) => ({ team, score: p.slice(0, 5).reduce((a, b) => a + b, 0),
    scorers: p.slice(0, 5).join(', '), displacers: p.slice(5, 7).join(', '), sixth: p[5] || 9999, note: '' }));
  teams.sort((a, b) => a.score - b.score || a.sixth - b.sixth);
  Object.entries(count).filter(([, c]) => c < 5).forEach(([team, c]) =>
    teams.push({ team, score: null, scorers: '', displacers: '', note: `incomplete team (${c} finisher${c === 1 ? '' : 's'})` }));
  teams.forEach((t, i) => { if (t.score != null) t.rank = i + 1; if (t.note === '' && i > 0 && teams[i - 1].score === t.score) t.note = 'tie broken on 6th runner'; });
  writeRows('Results', race, results.map(r => [race, r.pos, r.bib, r.name, r.team, r.time, r.scoringPlace, r.note]));
  writeRows('TeamScores', race, teams.map(t => [race, t.rank || '', t.team, t.score == null ? '' : t.score, t.scorers, t.displacers, t.note]));
  return { race, timesCount: times.length, placesCount: places.length, results, teams };
}
function writeRows(sheetName, race, rows) {
  const sh = SS().getSheetByName(sheetName); const data = sh.getDataRange().getValues();
  const keep = data.filter((r, i) => i === 0 || r[0] !== race);
  sh.clearContents(); sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
