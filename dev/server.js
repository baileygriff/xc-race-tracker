// Local demo: serves the app and pretends to be the Google Sheet. `node dev/server.js`, then open
// the links it prints (codes: volunteer 1234, coach "coach", director "director")
const http = require('http'), fs = require('fs'), path = require('path');
const { load } = require('./fakesheets');
const { ctx, sheets } = load();
const PORT = +process.env.PORT || 8765;
ctx.setup(); ctx.setConfig('races', 'Boys, Girls'); ctx.setConfig('volunteer_code', '1234'); ctx.setConfig('coach_code', 'coach'); ctx.setConfig('director_code', 'director');

// Seed: 3 schools, 5 boys and 5 girls each, grades 6-8, the way coaches would have submitted them.
ctx.setConfig('teams', 'Exploris, Magellan, Cary Christian');
const seed = {
  Exploris: { Boys: ['Owen Hartley 6', 'Miles Okafor 7', 'Theo Lindqvist 8', 'Jasper Nguyen 6', 'Rowan Delgado 8'],
              Girls: ['Nora Whitfield 7', 'Priya Raman 8', 'Elise Marchetti 6', 'Harper Sato 7', 'Maeve Callahan 8'] },
  Magellan: { Boys: ['Caleb Ferreira 8', 'Ezra Blackwood 6', 'Luca Petrov 7', 'Silas Moreno 8', 'Finn Adebayo 6'],
              Girls: ['Ivy Castellano 8', 'Zara Holloway 6', 'Lena Fitzgerald 7', 'Amara Osei 8', 'Ruby Thornton 7'] },
  'Cary Christian': { Boys: ['Nathan Kowalski 7', 'Eli Brennan 6', 'Isaac Tran 8', 'Gabriel Sandoval 7', 'Micah Ellery 8'],
                      Girls: ['Abigail Foster 6', 'Claire Whitaker 8', 'Hannah Reyes 7', 'Sophie Lindgren 6', 'Grace Mbeki 8'] },
};
Object.entries(seed).forEach(([team, byRace]) => Object.entries(byRace).forEach(([race, names]) =>
  names.forEach(n => { const m = n.match(/^(.*) (\d)$/); sheets.Roster.rows.push([team, m[1], +m[2], race, '']); })));
ctx.assignBibs();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const root = path.join(__dirname, '..');
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function sheetPage() {
  const tabs = ['Roster', 'Times', 'Places', 'Results', 'TeamScores'];
  const tables = tabs.map(t => `<h2>${t} <small>(${Math.max(0, sheets[t].rows.length - 1)} rows)</small></h2><table>` +
    sheets[t].rows.map((r, i) => `<tr>${r.map(c => `<${i ? 'td' : 'th'}>${esc(c instanceof Date ? c.toLocaleTimeString() : c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('') + '</table>').join('');
  return `<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=3><title>Fake Google Sheet</title>
<style>body{font:14px system-ui;margin:20px;color:#111}table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #ccc;padding:3px 8px;text-align:left}th{background:#eee}h2{margin:12px 0 4px}small{color:#666;font-weight:400}</style>
<p><b>This page stands in for the Google Sheet</b> — it refreshes every 3 s and shows exactly what the real script would write to each tab.</p>${tables}`;
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(body); };
  if (url.pathname === '/api') {
    if (req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const out = ctx.doPost({ postData: { contents: b } }); console.log('POST', b.slice(0, 80), '→', JSON.stringify(out)); send(200, 'application/json', JSON.stringify(out)); }); return; }
    const out = ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }); return send(200, 'application/json', JSON.stringify(out));
  }
  if (url.pathname === '/sheet') return send(200, 'text/html', sheetPage());
  const f = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(404, 'text/plain', 'not found');
  send(200, MIME[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
}).listen(PORT, () => {
  const ep = encodeURIComponent(`http://localhost:${PORT}/api`);
  console.log(`Demo running. Codes: volunteer 1234, coach "coach", director "director".
  Volunteers: http://localhost:${PORT}/index.html?endpoint=${ep}&key=1234
  Coaches:    http://localhost:${PORT}/index.html?page=roster&endpoint=${ep}&code=coach
  Director:   http://localhost:${PORT}/index.html?page=setup&endpoint=${ep}&key=1234&dkey=director
  Sheet:      http://localhost:${PORT}/sheet`);
});
