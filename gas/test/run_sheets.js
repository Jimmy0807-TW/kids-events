// 用模擬試算表跑完整流程：初始化 → 更新 → 讀回 → 網頁資料 → 按標記／排除 → 再更新 → 週報 HTML
const ctx = require('./harness');
const vm = require('vm'), fs = require('fs');
const { makeSpreadsheet, builder, richBuilder } = require('./sheets_mock');
const out = process.argv[2];
const ss = makeSpreadsheet();
const props = {};
ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ss, newDataValidation: builder, newRichTextValue: richBuilder,
  getUi: () => ({ alert: (...a) => { console.log('[alert]', a[0]); return 'YES'; }, Button: { YES: 'YES' }, ButtonSet: {} }) };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const sent = [];
ctx.MailApp = { sendEmail: o => sent.push(o), getRemainingDailyQuota: () => 99 };
const run = (code) => vm.runInContext(code, ctx);

run('setupSheets_(ss_())');
console.log('分頁：', ss.getSheets().map(s => s.getName()).join(', '));
const set = ss.getSheetByName('設定');
console.log('設定列數：', set.getLastRow() - 1, '｜第一項：', set._data[1].slice(0, 2));
// 使用者在設定表填收件人
const iTo = set._data.findIndex(r => r[0] === 'Email收件人'); set._data[iTo][1] = 'family@example.com';
const iUrl = set._data.findIndex(r => r[0] === '網頁網址'); set._data[iUrl][1] = 'https://script.google.com/macros/s/XXXX/exec';

const r1 = run('runUpdate_()');
console.log('第一次更新：', r1.summary);
const list = ss.getSheetByName('活動清單');
console.log('活動清單列數：', list.getLastRow() - 1, '｜第 1 列：', list._data[1].slice(0, 7));

const d1 = JSON.parse(run('getData()'));
console.log('網頁 getData：', d1.events.length, '筆；第一筆日期', d1.events[0].dates, d1.events[0].next);

// 網頁按「想去」與「排除」
const a = d1.events.find(e => e.view === 'main' && e.home), b = d1.events.find(e => e.view === 'outing' && e.home);
run(`setMark(${JSON.stringify(a.uid)}, '想去')`);
run(`setMark(${JSON.stringify(b.uid)}, '排除')`);
console.log('已排除表：', ss.getSheetByName('已排除')._data.slice(1).map(r => r.slice(0, 4)));
// 試算表下拉選「排除」另一筆
const c = d1.events.find(e => e.view === 'main' && e.home && e.uid !== a.uid);
const iMark = list._data[0].indexOf('標記'), iUid = list._data[0].indexOf('UID');
list._data.find(r => r[iUid] === c.uid)[iMark] = '排除';

const r2 = run('runUpdate_()');
console.log('第二次更新：', r2.summary, JSON.stringify(r2.res.stats));
const d2 = JSON.parse(run('getData()'));
console.log('想去標記保留：', d2.events.find(e => e.uid === a.uid)?.mark,
  '｜網頁排除的已消失：', !d2.events.some(e => e.uid === b.uid), '｜試算表排除的已消失：', !d2.events.some(e => e.uid === c.uid));
console.log('已排除表：', ss.getSheetByName('已排除')._data.slice(1).filter(r => r[0]).map(r => r.slice(0, 4)));

// 恢復
run(`restoreExcluded(${JSON.stringify(b.uid)})`);
run('runUpdate_()');
const d3 = JSON.parse(run('getData()'));
console.log('恢復後重新出現：', d3.events.some(e => e.uid === b.uid));

console.log(run('sendDigest_()'));
fs.writeFileSync(out + '/getData.json', run('getData()'));
fs.writeFileSync(out + '/digest.html', sent[sent.length - 1].htmlBody);
console.log('log 前 3 列：', ss.getSheetByName('執行紀錄')._data.slice(1, 4));
