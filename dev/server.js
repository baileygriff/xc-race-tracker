// Local demo: serves the app and pretends to be the Google Sheet. `node dev/server.js`, then open
// http://localhost:8765/index.html?mode=timer&race=Boys&device=Demo&endpoint=http://localhost:8765/api
const http = require('http'), fs = require('fs'), path = require('path');
const { load } = require('./fakesheets');
const { ctx, sheets } = load();
ctx.setup(); ctx.setConfig('races', 'Boys, Girls');

// Seed a roster the way importRoster would: 5 teams, 8 boys and 7 girls each, plus one unattached runner.
const teams = ['Broughton', 'Enloe', 'Leesville', 'Millbrook', 'Sanderson'];
const first = ['Ava','Ben','Cora','Dev','Eli','Fay','Gus','Hana','Ivy','Jon','Kai','Lia','Max','Nia','Oli','Pia'];
const seed = [];
teams.forEach((t, ti) => { for (let i = 0; i < 8; i++) seed.push([t, `${first[(ti*3+i)%16]} ${t[0]}${i+1}`, 9 + i % 4, 'Boys', '']);
                            for (let i = 0; i < 7; i++) seed.push([t, `${first[(ti*5+i+2)%16]} ${t[0]}${i+1}`, 9 + i % 4, 'Girls', '']); });
seed.push(['Unattached', 'Solo Runner', 11, 'Boys', '']);
seed.forEach(r => sheets.Roster.rows.push(r));
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
}).listen(8765, () => {
  const ep = encodeURIComponent('http://localhost:8765/api');
  console.log(`Demo running.
  Timer:     http://localhost:8765/index.html?mode=timer&race=Boys&device=Demo&endpoint=${ep}
  Finishers: http://localhost:8765/index.html?mode=finishers&race=Boys&device=Demo&endpoint=${ep}
  Sheet:     http://localhost:8765/sheet`);
});
