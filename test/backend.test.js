// Runs Code.gs in node with a tiny in-memory fake of the Sheets API. `node test/backend.test.js`
const assert = require('assert');
const { ctx, sheets } = require('../dev/fakesheets').load();

ctx.setup();
sheets.Roster.rows.push(['A','a1','','Boys','101'],['A','a2','','Boys','202'],['A','a3','','Boys','303'],['A','a4','','Boys','404'],['A','a5','','Boys','505'],['A','a6','','Boys','606'],
  ['B','b1','','Boys','111'],['B','b2','','Boys','222'],['B','b3','','Boys','333'],['B','b4','','Boys','444'],['B','b5','','Boys','555'],
  ['C','c1','','Boys','777'], ['D','d1','','Girls','']);
// bib assignment: fills the blank, and stays ≥2 digits away from every existing bib
assert.strictEqual(ctx.assignBibs(), 1);
const bibs = sheets.Roster.rows.slice(1).map(r=>String(r[4]));
const newBib = bibs[bibs.length-1]; assert.match(newBib, /^\d{3}$/);
bibs.slice(0,-1).forEach(b => assert.ok([0,1,2].filter(i=>b[i]!==newBib[i]).length >= 2, `${newBib} too close to ${b}`));

const post = body => ctx.doPost({ postData:{ contents: JSON.stringify(body) } });
// finish order: c1, b1, a1, a2, b2, b3, a3, a4, b4, a5, b5, a6, unknown
const order = ['777','111','101','202','222','333','303','404','444','505','555','606','???'];
let r = post({ role:'places', race:'Boys', device:'t', entries: order.map((bib,i)=>({pos:i+1,bib})) });
assert.ok(r.ok, r.error);
r = post({ role:'timer', race:'Boys', device:'t', entries: order.map((_,i)=>({pos:i+1, ms:(600+i*5)*1000, time:`${10+Math.floor(i*5/60)}:00.0`})) });
assert.ok(r.ok, r.error); assert.strictEqual(r.note, '');
const res = ctx.computeResults('Boys');
// C has 1 runner → excluded; scoring places among A and B only: b1=1 a1=2 a2=3 b2=4 b3=5 a3=6 a4=7 b4=8 a5=9 b5=10 a6=11
const A = res.teams.find(t=>t.team==='A'), B = res.teams.find(t=>t.team==='B'), C = res.teams.find(t=>t.team==='C');
assert.strictEqual(B.score, 1+4+5+8+10); assert.strictEqual(A.score, 2+3+6+7+9);
assert.strictEqual(res.teams[0].team, 'A'); assert.strictEqual(A.rank, 1); assert.strictEqual(B.rank, 2);
assert.strictEqual(C.score, null); assert.match(C.note, /incomplete/);
assert.strictEqual(res.results[0].scoringPlace, '');           // c1 takes no scoring place
assert.strictEqual(res.results[12].note, 'runner had no bib');
assert.strictEqual(res.results[0].time, '10:00.0');
// re-send with one fewer place → replaces, and flags the mismatch
r = post({ role:'places', race:'Boys', device:'t', entries: order.slice(0,12).map((bib,i)=>({pos:i+1,bib})) });
assert.match(r.note, /13 times vs 12 places/);
assert.strictEqual(sheets.Places.rows.length, 13); // header + 12, not 25
// a different race's rows are untouched by a re-send
post({ role:'places', race:'Girls', device:'t', entries:[{pos:1,bib:newBib}] });
post({ role:'places', race:'Boys', device:'t', entries: order.map((bib,i)=>({pos:i+1,bib})) });
assert.strictEqual(sheets.Places.rows.filter(x=>x[0]==='Girls').length, 1);
assert.strictEqual(sheets.Results.rows.filter(x=>x[0]==='Boys').length, 13);
assert.ok(ctx.doGet({parameter:{action:'roster'}}).roster.length === 13);
console.log('backend tests pass');
