#!/usr/bin/env node
// Builds the public spectator results page from a results snapshot. No codes, endpoint or volunteer names go in it.
//   node dev/build-results.js <snapshot.json> <out.html>
// Snapshot: { Girls: <results reply>, Boys: <results reply> } as saved by the fix scripts.
const fs = require('fs');
const [src, out] = process.argv.slice(2);
const snap = JSON.parse(fs.readFileSync(src, 'utf8'));
const MEET = { title: 'Exploris XC Home Meet', date: 'Thursday, September 24, 2026', place: 'Dix Park, Raleigh' };
const races = ['Girls', 'Boys'].filter(r => snap[r]).map(race => {
  const res = snap[race];
  const gradeOf = {}; (snap.roster || []).forEach(r => { if (r.race === race) gradeOf[r.bib] = r.grade; });
  // Only identified runners are listed. Places are the real finish places, so an unidentified finisher leaves a gap
  // rather than moving anyone up a place.
  // A finisher the chute logged as "runner with no bib" keeps their place and time as "No bib"; a time with nothing logged
  // against it at all (the logger came up short) is left out.
  const runners = res.results.filter(r => r.name || r.bib === '???').map(r => r.name
    ? { place: r.pos, name: r.name, team: r.team, grade: gradeOf[r.bib] || '', time: r.time, pts: r.scoringPlace === '' ? null : r.scoringPlace }
    : { place: r.pos, name: 'No bib', team: '', grade: '', time: r.time, pts: null, nobib: true });
  const teams = res.teams.map(t => ({ rank: t.rank || null, team: t.team, score: t.score,
    scorers: t.score == null ? [] : runners.filter(r => r.team === t.team && r.pts != null).slice(0, 5).map(r => ({ name: r.name, pts: r.pts, place: r.place })),
    note: t.score == null ? t.note.replace('incomplete team', 'Fewer than 5 finishers, not scored') : '' }));
  return { race, runners, teams, hidden: res.results.length - runners.length, finishers: runners.filter(r => !r.nobib).length };
});
const data = JSON.stringify({ meet: MEET, races, builtAt: new Date().toISOString() });
const html = fs.readFileSync(__dirname + '/results-template.html', 'utf8').replace('/*DATA*/null', data.replace(/</g, '\\u003c'));
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ` + races.map(r => `${r.race} ${r.runners.length} runners, ${r.teams.length} teams${r.hidden ? `, ${r.hidden} unidentified hidden` : ''}`).join('; '));
