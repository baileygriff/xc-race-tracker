// In-memory stand-in for the bits of the Apps Script runtime Code.gs uses. Shared by the tests and the local demo.
const fs = require('fs'), vm = require('vm'), path = require('path');
class Sheet { constructor(n){ this.name=n; this.rows=[]; }
  getName(){return this.name} getLastRow(){return this.rows.length} appendRow(r){this.rows.push(r)} setFrozenRows(){}
  getDataRange(){ const s=this; return { getValues(){ return s.rows.map(r=>[...r]); } }; }
  clearContents(){ this.rows=[]; }
  getRange(r,c,nr=1,nc=1){ const s=this; return {
    setValues(v){ if (v.length !== nr || v.some(row => row.length !== nc)) throw new Error(`The number of rows in the data does not match the number of rows in the range. The data has ${v.length} but the range has ${nr}.`); v.forEach((row,i)=>{ s.rows[r-1+i]=s.rows[r-1+i]||[]; row.forEach((x,j)=>s.rows[r-1+i][c-1+j]=x); }); },
    setValue(x){ s.rows[r-1]=s.rows[r-1]||[]; s.rows[r-1][c-1]=x; }, setFontWeight(){} }; } }
function load() {
  const sheets = {};
  const ss = { getSheetByName:n=>sheets[n]||null, insertSheet:n=>sheets[n]=new Sheet(n), getSheets:()=>Object.values(sheets), getId:()=>'id', deleteSheet(){} };
  const ctx = { SpreadsheetApp:{getActiveSpreadsheet:()=>ss}, LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    ContentService:{ createTextOutput:t=>({ t, setMimeType(){ return JSON.parse(t); } }), MimeType:{JSON:1} }, Logger:{log(){}},
    Math, JSON, String, Array, Object, Date, Set, Error, RegExp };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  return { ctx, sheets };
}
module.exports = { load };
