// 簡易的 SpreadsheetApp 模擬：只記錄儲存格的值，格式類方法一律忽略。
function makeRange(sheet, r, c, nr, nc) {
  nr = nr || 1; nc = nc || 1;
  const chain = new Proxy({}, {
    get(_, prop) {
      if (prop === 'setValues') return (vals) => { vals.forEach((row, i) => row.forEach((v, j) => sheet._set(r + i, c + j, v))); return chain; };
      if (prop === 'setValue') return (v) => { sheet._set(r, c, v); return chain; };
      if (prop === 'getValues') return () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sheet._get(r + i, c + j)));
      if (prop === 'getValue') return () => sheet._get(r, c);
      if (prop === 'clear' || prop === 'clearContent') return () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sheet._set(r + i, c + j, ''); return chain; };
      if (prop === 'setRichTextValues') return (vals) => { vals.forEach((row, i) => row.forEach((v, j) => sheet._set(r + i, c + j, v.text))); return chain; };
      if (prop === 'createFilter') return () => { sheet._filter = { remove() { sheet._filter = null; } }; return sheet._filter; };
      return () => chain;  // 其他格式設定
    },
  });
  return chain;
}
function makeSheet(name, ss) {
  const data = [];
  const sh = {
    _name: name, _filter: null, _hidden: false,
    _set(r, c, v) { while (data.length < r) data.push([]); const row = data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; },
    _get(r, c) { return (data[r - 1] || [])[c - 1] ?? ''; },
    getName: () => name,
    getRange: (r, c, nr, nc) => makeRange(sh, r, c, nr, nc),
    getLastRow() { for (let i = data.length; i > 0; i--) if (data[i - 1].some(v => v !== '' && v != null)) return i; return 0; },
    getMaxRows: () => Math.max(1000, data.length), getMaxColumns: () => Math.max(26, ...data.map(r => r.length)),
    insertRowsAfter(after, n) { data.splice(after, 0, ...Array.from({ length: n }, () => [])); },
    deleteRows(start, n) { data.splice(start - 1, n); }, deleteRow(r) { data.splice(r - 1, 1); },
    appendRow(row) { data.splice(sh.getLastRow(), 0, row.slice()); },
    getFilter: () => sh._filter, hideSheet() { sh._hidden = true; }, activate() { ss._active = sh; },
    _data: data,
  };
  return new Proxy(sh, { get: (t, p) => (p in t ? t[p] : () => sh) });
}
function makeSpreadsheet() {
  const sheets = [makeSheet('工作表1')];
  const ss = {
    _active: null,
    getSheetByName: (n) => sheets.find(s => s.getName() === n) || null,
    insertSheet(n) { const s = makeSheet(n, ss); sheets.push(s); return s; },
    getSheets: () => sheets.slice(), deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); },
    setSpreadsheetTimeZone() {}, setActiveSheet(s) { ss._active = s; }, moveActiveSheet() {},
  };
  return ss;
}
const builder = () => new Proxy({}, { get: (t, p) => (p === 'build' ? () => ({}) : () => builder()) });
function richBuilder() {
  const st = {};
  const b = { setText(t) { st.text = t; return b; }, setLinkUrl(u) { st.url = u; return b; }, build: () => st };
  return b;
}
module.exports = { makeSpreadsheet, builder, richBuilder };
