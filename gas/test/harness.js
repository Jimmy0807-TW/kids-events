// 在 Node.js 模擬 Google Apps Script 環境，實際連網執行 Code.gs 的抓取與篩選（不含試算表寫入）。
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'));
let n = 0;
const CACHE = process.env.GAS_CACHE;  // 設定後同一網址只抓一次（測試用）
function curl(url) {
  if (CACHE) {
    const h = require('crypto').createHash('md5').update(url).digest('hex');
    const cf = path.join(CACHE, h);
    if (fs.existsSync(cf)) return { code: 200, buf: fs.readFileSync(cf) };
    const r = curlNet(url);
    if (r.code === 200) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cf, r.buf); }
    return r;
  }
  return curlNet(url);
}
function curlNet(url) {
  const f = path.join(tmp, 'r' + (n++));
  for (let i = 0; i < 3; i++) {
    try {
      const code = execFileSync('curl', ['-sS', '-L', '-m', '60', '-A', 'Mozilla/5.0', '-o', f, '-w', '%{http_code}', url], { encoding: 'utf8' });
      return { code: +code, buf: fs.readFileSync(f) };
    } catch (e) { if (i === 2) return { code: 0, buf: Buffer.alloc(0) }; }
  }
}
function resp(url) {
  const r = curl(url);
  return {
    getResponseCode: () => r.code,
    getContentText: () => r.buf.toString('utf8'),
    getBlob: () => ({ bytes: r.buf, setContentType() { return this; } }),
  };
}
const fmtParts = (d) => {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return p;
};
const ctx = {
  console,
  UrlFetchApp: { fetch: (u) => resp(u), fetchAll: (reqs) => reqs.map(r => resp(r.url)) },
  Utilities: {
    sleep() {},
    formatDate(d, tz, f) {
      const p = fmtParts(d);
      return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute)
        .replace(/\bM\b/, String(+p.month)).replace(/\bd\b/, String(+p.day));
    },
    unzip(blob) {
      const z = path.join(tmp, 'z' + (n++));
      fs.writeFileSync(z + '.zip', blob.bytes);
      execFileSync('unzip', ['-o', '-q', z + '.zip', '-d', z]);
      return fs.readdirSync(z).map(f => ({ getName: () => f, getDataAsString: () => fs.readFileSync(path.join(z, f), 'utf8') }));
    },
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
module.exports = ctx;
