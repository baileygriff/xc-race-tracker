#!/usr/bin/env node
// Loads rosters into a sheet (real or the local demo) through the same endpoint coaches use.
//   node dev/import-rosters.js <endpoint> <coach_code> rosters.txt
// File format, blank lines ignored, a line "## Team, Race" starts a block, then one runner per line:
//   ## Exploris, Boys
//   Owen Hartley, 6
//   Miles Okafor, 7, 412      <- optional third field: a pre-printed bib number
const fs = require('fs');
const [endpoint, code, file] = process.argv.slice(2);
if (!endpoint || !code || !file) { console.error('usage: node dev/import-rosters.js <endpoint> <coach_code> <file>'); process.exit(1); }
const blocks = []; let cur = null;
fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
  const t = line.trim(); if (!t) return;
  const h = t.match(/^##\s*(.+?)\s*,\s*(.+)$/); if (h) { cur = { team: h[1], race: h[2], runners: [] }; blocks.push(cur); return; }
  if (!cur) throw new Error(`Runner before any "## Team, Race" line: ${t}`);
  const f = t.split(/\t|,|;|\s{2,}/).map(x => x.trim()).filter(Boolean);
  const r = { name: '', grade: '', bib: '' };
  f.forEach(x => { if (/^\d{3}$/.test(x)) r.bib = x; else if (/^\d{1,2}$/.test(x)) r.grade = x; else r.name = (r.name + ' ' + x).trim(); });
  if (!r.name) { const m = t.match(/^(.*\S)\s+(\d{1,2})$/); if (m) { r.name = m[1]; r.grade = m[2]; } else r.name = t; }
  cur.runners.push(r);
});
(async () => {
  for (const b of blocks) {
    let res;
    for (let attempt = 0; attempt < 5 && !res; attempt++) { // safe to repeat: a submit replaces that team + race
      if (attempt) await new Promise(r => setTimeout(r, 1500 * attempt));
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
        body: JSON.stringify({ action: 'roster_submit', code, team: b.team, race: b.race, runners: b.runners }) });
      const t = await r.text(); try { res = JSON.parse(t); } catch { console.error(`  ${b.team} ${b.race}: Google error page (${r.status}), retrying`); }
    }
    if (!res) { console.error(`${b.team} ${b.race}: gave up after 5 tries`); process.exitCode = 1; continue; }
    if (!res.ok) { console.error(`${b.team} ${b.race}: ${res.error}`); process.exitCode = 1; continue; }
    console.log(`${b.team} ${b.race}: ${res.roster.length} runners`); res.roster.forEach(r => console.log(`   ${r.bib}  ${r.name}${r.grade ? ' (' + r.grade + ')' : ''}`));
  }
})();
