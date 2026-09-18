// Runs Code.gs in node against an in-memory sheet. `node test/backend.test.js`
const assert = require('assert');
const { ctx, sheets } = require('../dev/fakesheets').load();

ctx.setup();
ctx.setConfig('volunteer_code', 'pc'); ctx.setConfig('director_code', 'dc');
sheets.Roster.rows.push(['A','a1','','Boys','101'],['A','a2','','Boys','202'],['A','a3','','Boys','303'],['A','a4','','Boys','404'],['A','a5','','Boys','505'],['A','a6','','Boys','606'],
  ['B','b1','','Boys','111'],['B','b2','','Boys','222'],['B','b3','','Boys','333'],['B','b4','','Boys','444'],['B','b5','','Boys','555'],
  ['C','c1','','Boys','777'], ['D','d1','','Girls','']);
// bib assignment: fills the blank, and stays ≥2 digits away from every existing bib
assert.strictEqual(ctx.assignBibs(), 1);
const bibs = sheets.Roster.rows.slice(1).map(r=>String(r[4]));
const newBib = bibs[bibs.length-1]; assert.match(newBib, /^\d{3}$/);
bibs.slice(0,-1).forEach(b => assert.ok([0,1,2].filter(i=>b[i]!==newBib[i]).length >= 2, `${newBib} too close to ${b}`));

const post = body => ctx.doPost({ postData:{ contents: JSON.stringify(Object.assign({ key:'pc' }, body)) } });
// passcode
assert.match(ctx.doGet({parameter:{action:'roster'}}).error, /volunteer code/);
assert.match(ctx.doPost({ postData:{ contents: JSON.stringify({ key:'nope', role:'timer', race:'Boys', device:'x', entries:[] }) } }).error, /volunteer code/);
assert.ok(ctx.doGet({parameter:{action:'roster', key:'dc'}}).ok); // the director's code opens the volunteer door too
assert.ok(ctx.doGet({parameter:{action:'roster', key:'pc'}}).ok);

// finish order: c1, b1, a1, a2, b2, b3, a3, a4, b4, a5, b5, a6, unknown
const order = ['777','111','101','202','222','333','303','404','444','505','555','606','???'];
const times = order.map((_, i) => (600 + i*5) * 1000);
let r = post({ role:'places', race:'Boys', device:'Pat', entries: order.map((bib,i)=>({pos:i+1,bib})) });
assert.ok(r.ok, r.error);
r = post({ role:'timer', race:'Boys', device:'Sam', entries: times.map((ms,i)=>({pos:i+1, ms, time:ctx.fmtMs(ms)})) });
assert.ok(r.ok, r.error); assert.strictEqual(r.note, '1 row flagged'); // only the ??? runner
let res = ctx.computeResults('Boys');
// C has 1 runner → excluded; scoring places among A and B only: b1=1 a1=2 a2=3 b2=4 b3=5 a3=6 a4=7 b4=8 a5=9 b5=10 a6=11
const A = res.teams.find(t=>t.team==='A'), B = res.teams.find(t=>t.team==='B'), C = res.teams.find(t=>t.team==='C');
assert.strictEqual(B.score, 1+4+5+8+10); assert.strictEqual(A.score, 2+3+6+7+9);
assert.strictEqual(res.teams[0].team, 'A'); assert.strictEqual(A.rank, 1); assert.strictEqual(B.rank, 2);
assert.strictEqual(C.score, null); assert.match(C.note, /incomplete/);
assert.strictEqual(res.results[0].scoringPlace, '');           // c1 takes no scoring place
assert.strictEqual(res.results[12].flags, 'runner had no bib');
assert.strictEqual(res.results[0].time, '10:00.0');

// a second timer: times average; one that is 1.5 s off gets flagged, one 0.4 s off does not
const times2 = times.map((ms, i) => ms + (i === 2 ? 1500 : 400));
r = post({ role:'timer', race:'Boys', device:'Kim', entries: times2.map((ms,i)=>({pos:i+1, ms, time:ctx.fmtMs(ms)})) });
res = ctx.computeResults('Boys');
assert.strictEqual(res.results[0].time, '10:00.2');               // average of 10:00.0 and 10:00.4
assert.match(res.results[2].flags, /timers disagree: Kim 10:11.5 \/ Sam 10:10.0/);
assert.strictEqual(res.results[1].flags, '');
assert.strictEqual(res.devices.timer.map(d => d.device).join(), 'Kim,Sam');
// a second logger that disagrees on one position and is one short
const order2 = order.slice(0, 12); order2[4] = '333';
r = post({ role:'places', race:'Boys', device:'Zed', entries: order2.map((bib,i)=>({pos:i+1,bib})) });
assert.match(r.note, /COUNT MISMATCH: Kim 13 times, Sam 13 times, Pat 13 places, Zed 12 places/);
res = ctx.computeResults('Boys');
assert.match(res.results[4].flags, /loggers disagree: Pat 222 \/ Zed 333/);
assert.strictEqual(res.results[4].bib, '222');                     // first logger alphabetically wins
assert.match(res.results[12].flags, /missing a bib from Zed/);
// re-send from Zed with the full list replaces only Zed's rows
post({ role:'places', race:'Boys', device:'Zed', entries: order.map((bib,i)=>({pos:i+1,bib})) });
assert.strictEqual(sheets.Places.rows.length, 1 + 13 + 13);
res = ctx.computeResults('Boys'); assert.strictEqual(res.warnings.length, 0);
// another race's rows are untouched
post({ role:'places', race:'Girls', device:'Pat', entries:[{pos:1,bib:newBib}] });
assert.strictEqual(sheets.Places.rows.filter(x=>x[0]==='Girls').length, 1);
assert.strictEqual(sheets.Results.rows.filter(x=>x[0]==='Boys').length, 13);
assert.strictEqual(ctx.doGet({parameter:{action:'roster', key:'pc'}}).roster.length, 13);

// coach roster submission: wrong code refused; submit assigns bibs; re-submit keeps bibs and drops removed runners
ctx.setConfig('coach_code', 'cc');
const coach = body => ctx.doPost({ postData:{ contents: JSON.stringify(Object.assign({ action:'roster_submit', code:'cc' }, body)) } });
assert.match(ctx.doPost({ postData:{ contents: JSON.stringify({ action:'roster_submit', code:'pc', team:'E', race:'Girls', runners:[{name:'e1'}] }) } }).error, /coach code/);
assert.match(coach({ team:'E', race:'Girls', runners:[{name:'Same Kid'},{name:'same kid'}] }).error, /listed twice/);
let cr = coach({ team:'E', race:'Girls', runners:[{name:'Ella One', grade:'9'},{name:'Emma Two', grade:''}] });
assert.ok(cr.ok, cr.error); assert.strictEqual(cr.roster.length, 2); cr.roster.forEach(r => assert.match(r.bib, /^\d{3}$/));
const ellaBib = cr.roster.find(r => r.name === 'Ella One').bib;
cr = coach({ team:'e', race:'Girls', runners:[{name:'Ella One', grade:'10'},{name:'Eve Three', grade:'11'}] });
assert.strictEqual(cr.roster.length, 2);
assert.strictEqual(cr.roster.find(r => r.name === 'Ella One').bib, ellaBib);
assert.ok(!cr.roster.find(r => r.name === 'Emma Two'));
assert.strictEqual(sheets.Roster.rows.filter(r => String(r[0]).toLowerCase() === 'e').length, 2);
assert.match(coach({ team:'E', race:'Mixed', runners:[{name:'x y'}] }).error, /Unknown race/);
const cg = ctx.doGet({ parameter:{ action:'coach', code:'cc', team:'E' } });
assert.ok(cg.teams.includes('E') && cg.roster.length === 2);

// meet setup: read and change races/teams/codes; a team entered by the director shows for coaches before any roster exists
assert.match(ctx.doGet({ parameter:{ action:'config', key:'pc' } }).error, /director code/); // volunteers cannot open meet setup
let cfg = ctx.doGet({ parameter:{ action:'config', key:'dc' } });
assert.strictEqual(cfg.races.join(), 'Boys,Girls'); assert.ok(cfg.rosters.find(t => t.team === 'E' && t.counts.Girls === 2)); assert.strictEqual(cfg.teams.length, 0);
cfg = ctx.doPost({ postData:{ contents: JSON.stringify({ action:'config_set', key:'dc', races:['Boys', 'Girls', 'Open'], teams:'Zeta High', coach_code:'cc2' }) } });
assert.ok(cfg.ok, cfg.error); assert.strictEqual(cfg.races.length, 3); assert.strictEqual(cfg.teams.join(), 'Zeta High');
const ct = ctx.doGet({ parameter:{ action:'coach', code:'cc2' } }).teams; assert.ok(ct.includes('Zeta High') && ct.includes('E')); // director's list plus teams with rosters
assert.match(ctx.doPost({ postData:{ contents: JSON.stringify({ action:'config_set', key:'dc', races:'' }) } }).error, /At least one race/);
assert.strictEqual(ctx.doGet({ parameter:{ action:'config', key:'dc' } }).volunteer_code, 'pc'); // a blank code in a save leaves it alone

// a time corrected out of order on the phone is still placed by time in the sheet
post({ role:'timer', race:'Girls', device:'T', entries:[{pos:1, ms:100000, time:'01:40.0'},{pos:2, ms:90000, time:'01:30.0'},{pos:3, ms:110000, time:'01:50.0'}] });
const g = ctx.computeResults('Girls'); assert.strictEqual(g.results.map(r => r.time).join(), '01:30.0,01:40.0,01:50.0');

// a hand edit in the Times tab re-sorts positions and rescores without any phone involved
const girlsTimes = sheets.Times.rows.filter(r => r[0] === 'Girls'); girlsTimes[2][2] = 80000; girlsTimes[2][3] = '01:20.0'; // the 01:50 runner is now 01:20
ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'Times' }) } });
assert.strictEqual(sheets.Results.rows.filter(r => r[0] === 'Girls').map(r => r[5]).join(), '01:20.0,01:30.0,01:40.0');
ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'Config' }) } }); // other tabs do nothing

// a pre-printed bib supplied with a runner is kept when it is free, and ignored when another runner already has it
const coach2 = body => ctx.doPost({ postData:{ contents: JSON.stringify(Object.assign({ action:'roster_submit', code:'cc2' }, body)) } }); // the coach code was changed above
cr = coach2({ team:'F', race:'Girls', runners:[{name:'Fay One', bib:'321'},{name:'Fay Two', bib:'321'},{name:'Fay Three', bib: ellaBib}] });
assert.ok(cr.ok, cr.error); const fb = Object.fromEntries(cr.roster.map(r => [r.name, r.bib]));
assert.strictEqual(fb['Fay One'], '321'); assert.notStrictEqual(fb['Fay Two'], '321'); assert.notStrictEqual(fb['Fay Three'], ellaBib);
console.log('backend tests pass');
