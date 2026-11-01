/**
 * 親子活動週報（GAS 版）
 * 每週自動從網路收集適合 6～8 歲孩子的親子活動、市集與節慶，整理到試算表、網頁，並寄 Email 週報。
 *
 * 安裝：試算表 →「擴充功能」→「Apps Script」→ 貼上本檔（Code.gs）與 Index.html → 存檔 →
 *       回試算表重新整理 →「親子活動」選單 →「① 初始化」。詳細步驟見 gas/README.md。
 */

// ======================= 預設值（設定表的值會覆蓋這裡） =======================
const DEFAULTS = {
  '網頁網址': '',
  'Email收件人': '',
  '每週執行星期': '四',
  '每週執行時間': '18:00',
  '年齡下限': 6,
  '年齡上限': 8,
  '價格上限': 1000,
  '低價門檻': 500,
  '往後看幾天': 60,
  '長期展覽天數': 45,
  '常用地區': '臺北市、新北市、基隆市、桃園市',
  '獨立按鈕來源': '科教館',
  '額外排除關鍵字': '',
  '週報-週末活動筆數': 12,
  '週報-本週新增筆數': 15,
  '週報-市集節慶筆數': 8,
  '週報-外縣市精選筆數': 5,
  '週報-即將開放報名筆數': 10,
  '來源-文化部': '開',
  '來源-觀光署': '開',
  '來源-北市圖': '開',
  '來源-新北圖': '開',
  '來源-科教館': '開',
  '來源-ACCUPASS': '開',
  '來源-花博公園': '開',
  '來源-華山1914': '開',
  '來源-松山文創園區': '開',
  '來源-新聞線索': '開',
};

const SETTING_NOTES = {
  '網頁網址': '部署網頁應用程式後，把 /exec 結尾的網址貼在這裡（週報信會附上）',
  'Email收件人': '多個用逗號分隔；空白＝寄給自己。建議填家人或另一個信箱（自己寄給自己通常不會跳通知）',
  '每週執行星期': '一～日',
  '每週執行時間': '24 小時制，例如 18:00；改完要按選單「啟用每週自動執行」才會生效',
  '年齡下限': '孩子年齡範圍，活動適齡與此區間有重疊就收',
  '年齡上限': '',
  '價格上限': '最低票價超過此金額不收（元）',
  '低價門檻': '≤ 此金額歸為「② 低價」',
  '往後看幾天': '只收今天起幾天內有場次的活動（7～180）',
  '長期展覽天數': '活動期間超過幾天標為「長期」，網頁預設隱藏',
  '常用地區': '用頓號分隔完整縣市名（臺北市、新北市…），網頁預設顯示、週報主要內容',
  '獨立按鈕來源': '數量多的來源，不放主清單，網頁上獨立一個按鈕（頓號分隔）',
  '額外排除關鍵字': '活動名稱含這些字不收（頓號分隔）',
  '週報-週末活動筆數': '週報「這個週末」最多列幾筆',
  '週報-本週新增筆數': '',
  '週報-市集節慶筆數': '',
  '週報-外縣市精選筆數': '常用地區以外的公家免費活動',
  '週報-即將開放報名筆數': '',
};

const SH = { LIST: '活動清單', EXC: '已排除', NEWS: '新聞線索', LOG: '執行紀錄', SET: '設定', MEMO: '系統紀錄' };
const LIST_HEAD = ['編號', '標記', '分頁', '優先級', '活動名稱', '下一場', '結束日', '全部日期', '縣市', '地區', '地點',
  '費用', '適齡', '報名狀態', '報名開始', '報名截止', '主辦', '來源', '本週末', '長期', '新增', '首次發現',
  'UID', '比對鍵', '連結', '開始日'];
const EXC_HEAD = ['狀態', '活動名稱', '期間起', '期間迄', '排除日', '縣市', 'UID', '比對鍵'];
const NEWS_HEAD = ['發布日', '標題', '來源', '關鍵字', '首次發現', '連結'];
const LOG_HEAD = ['執行時間', '項目', '抓到', '期間內', '狀態', '秒數'];
const MEMO_HEAD = ['鍵', '首次發現', '標記'];
const MARKS = ['想去', '已報名', '排除'];
const TIERS = { 1: '① 公家機關', 2: '② 低價', 3: '③ 中價位', 4: '④ 價格未標示' };
const VIEW_LABEL = { main: '親子活動', outing: '市集・節慶・戶外', own: '獨立按鈕' };
const WD = '日一二三四五六';
const TZ = 'Asia/Taipei';

// ======================= 選單 =======================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('親子活動')
    .addItem('① 初始化（建立分頁與欄位）', 'menuInit')
    .addItem('② 確認目前設定', 'menuCheckSettings')
    .addSeparator()
    .addItem('立即更新清單（不寄信）', 'menuUpdate')
    .addItem('立即更新並寄送週報', 'menuUpdateAndMail')
    .addItem('只寄送週報（用目前清單）', 'menuMailOnly')
    .addItem('寄送測試信', 'menuTestMail')
    .addSeparator()
    .addItem('啟用每週自動執行', 'menuEnableTrigger')
    .addItem('停止每週自動執行', 'menuDisableTrigger')
    .addItem('檢查目前狀態', 'menuStatus')
    .addSeparator()
    .addItem('開啟網頁清單', 'menuOpenWeb')
    .addItem('查看已排除的活動', 'menuShowExcluded')
    .addToUi();
}

function ui_() { return SpreadsheetApp.getUi(); }
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function menuInit() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  setupSheets_(ss);
  ui_().alert('初始化完成',
    '已建立分頁：' + Object.values(SH).join('、') + '\n\n' +
    '下一步：\n1. 到「設定」分頁檢查黃底欄位（收件人、常用地區…）\n' +
    '2. 選單 → 立即更新清單（第一次會要求授權）\n' +
    '3. 選單 → 啟用每週自動執行\n' +
    '4. 依說明部署網頁，把網址貼回「設定」', ui_().ButtonSet.OK);
}

function menuCheckSettings() {
  const cfg = getConfig_();
  const w = checkConfig_(cfg);
  ui_().alert('目前設定', configSummary_(cfg) + (w.length ? '\n\n⚠️ 注意：\n' + w.join('\n') : '\n\n✅ 設定檢查沒有問題'),
    ui_().ButtonSet.OK);
}

function confirmRun_(title) {
  const cfg = getConfig_();
  const w = checkConfig_(cfg);
  const r = ui_().alert(title, configSummary_(cfg) + (w.length ? '\n\n⚠️ 注意：\n' + w.join('\n') : '') +
    '\n\n要用這些條件開始嗎？（約 1～3 分鐘）\n按「否」會開啟「設定」分頁。', ui_().ButtonSet.YES_NO);
  if (r !== ui_().Button.YES) { ss_().getSheetByName(SH.SET).activate(); return false; }
  return true;
}

function menuUpdate() {
  if (!confirmRun_('立即更新清單')) return;
  const r = runUpdate_();
  ui_().alert('更新完成', r.summary, ui_().ButtonSet.OK);
}

function menuUpdateAndMail() {
  if (!confirmRun_('立即更新並寄送週報')) return;
  const r = runUpdate_();
  const m = sendDigest_();
  ui_().alert('完成', r.summary + '\n\n' + m, ui_().ButtonSet.OK);
}

function menuMailOnly() {
  ui_().alert('寄送週報', sendDigest_(), ui_().ButtonSet.OK);
}

function menuTestMail() {
  const cfg = getConfig_();
  const to = recipients_(cfg);
  MailApp.sendEmail({ to: to, name: '親子活動週報', subject: '【親子活動週報】測試信',
    htmlBody: '<div style="font-family:\'Microsoft JhengHei\',\'微軟正黑體\',sans-serif;font-size:12pt">這是測試信，收到代表寄信設定正常。</div>' });
  log_([['寄送測試信', '', '', '成功：' + to, '']]);
  ui_().alert('已寄出', '收件人：' + to + '\n今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota(), ui_().ButtonSet.OK);
}

function menuEnableTrigger() {
  const cfg = getConfig_();
  const next = scheduleNext_(cfg);
  ui_().alert('已啟用每週自動執行', '下次執行：' + fmtWd_(next) +
    '\n之後每週' + cfg['每週執行星期'] + ' ' + cfg['每週執行時間'] + ' 自動更新並寄信。', ui_().ButtonSet.OK);
}

function menuDisableTrigger() {
  const n = clearTriggers_();
  ui_().alert('已停止', '已刪除 ' + n + ' 個自動執行排程。', ui_().ButtonSet.OK);
}

function menuStatus() {
  const cfg = getConfig_();
  const trig = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runWeekly');
  const props = PropertiesService.getScriptProperties();
  const lines = [
    '自動執行：' + (trig.length ? '已啟用，下次 ' + (props.getProperty('nextRun') || '（未知）') : '未啟用'),
    '收件人：' + recipients_(cfg),
    '今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota(),
    '最近一次更新：' + (props.getProperty('lastUpdate') || '尚未執行'),
    '最近一次寄信：' + (props.getProperty('lastMail') || '尚未寄出'),
    '網頁網址：' + (cfg['網頁網址'] || '（尚未填寫）'),
  ];
  ui_().alert('目前狀態', lines.join('\n'), ui_().ButtonSet.OK);
}

function menuOpenWeb() {
  const url = getConfig_()['網頁網址'];
  if (!url) {
    ui_().alert('尚未設定網頁網址', 'Apps Script 編輯器 → 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」\n' +
      '執行身分：我；存取權：只有我自己 → 部署 → 複製 /exec 結尾的網址，貼到「設定」分頁的「網頁網址」。', ui_().ButtonSet.OK);
    return;
  }
  const html = HtmlService.createHtmlOutput('<div style="font-family:Microsoft JhengHei,sans-serif;font-size:12pt;padding:8px">' +
    '<a href="' + esc_(url) + '" target="_blank" onclick="setTimeout(function(){google.script.host.close()},300)">👉 點這裡開啟網頁清單</a></div>')
    .setWidth(260).setHeight(80);
  ui_().showModalDialog(html, '開啟中…');
}

function menuShowExcluded() {
  ss_().getSheetByName(SH.EXC).activate();
  ui_().alert('已排除的活動', '「排除」只排除當時那段期間的場次；之後同名活動有新日期，仍會重新出現。\n\n' +
    '要恢復：把該列的「狀態」清成空白（或刪除整列），下次更新時就會重新列入。\n期間已過的紀錄會自動刪除。', ui_().ButtonSet.OK);
}

// ======================= 自動執行 =======================
/** 每週排程進入點：先排好下一次，再更新並寄信。 */
function runWeekly() {
  const cfg = getConfig_();
  try { scheduleNext_(cfg); } catch (e) { console.error(e); }
  runUpdate_();
  sendDigest_();
}

/** 用「指定時間」的單次排程鏈接，確保準時在設定的時間執行（每週觸發器只能指定到小時）。 */
function scheduleNext_(cfg) {
  clearTriggers_();
  const wd = WD.indexOf(String(cfg['每週執行星期']).trim().replace('天', '日'));
  const hm = String(cfg['每週執行時間']).match(/(\d{1,2})(?::(\d{2}))?/) || [0, 18, 0];
  const now = new Date();
  const tp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd').split('-').map(Number);
  // 以台灣時間計算下一個執行日
  let target = taipeiDate_(tp[0], tp[1], tp[2], +hm[1], +(hm[2] || 0));
  const todayWd = new Date(Date.UTC(tp[0], tp[1] - 1, tp[2])).getUTCDay();
  let add = ((wd < 0 ? 4 : wd) - todayWd + 7) % 7;
  target = new Date(target.getTime() + add * 864e5);
  if (target.getTime() <= now.getTime() + 60e3) target = new Date(target.getTime() + 7 * 864e5);
  ScriptApp.newTrigger('runWeekly').timeBased().at(target).create();
  PropertiesService.getScriptProperties().setProperty('nextRun', fmtWd_(target));
  return target;
}

function taipeiDate_(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm));
}

function clearTriggers_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runWeekly') { ScriptApp.deleteTrigger(t); n++; }
  });
  PropertiesService.getScriptProperties().deleteProperty('nextRun');
  return n;
}

// ======================= 設定 =======================
function getConfig_() {
  const cfg = Object.assign({}, DEFAULTS);
  const sh = ss_().getSheetByName(SH.SET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
      if (k !== '' && k in cfg && v !== '') cfg[k] = v instanceof Date ? Utilities.formatDate(v, TZ, 'HH:mm') : v;
    });
  }
  return cfg;
}

function listOf_(v) {
  return String(v || '').split(/[、,，\s]+/).map(s => norm_(s)).filter(Boolean);
}

function isOn_(v) { return /^(開|on|true|1|是)$/i.test(String(v).trim()); }

function recipients_(cfg) {
  return String(cfg['Email收件人'] || '').trim() || Session.getEffectiveUser().getEmail();
}

function checkConfig_(cfg) {
  const w = [];
  listOf_(cfg['常用地區']).forEach(c => { if (!CITY_REGION[c]) w.push('・常用地區「' + c + '」不是完整縣市名（例：臺北市）'); });
  if (+cfg['年齡下限'] > +cfg['年齡上限']) w.push('・年齡下限大於上限');
  if (+cfg['低價門檻'] > +cfg['價格上限']) w.push('・低價門檻大於價格上限');
  if (+cfg['往後看幾天'] < 7 || +cfg['往後看幾天'] > 180) w.push('・往後看幾天建議在 7～180');
  if (!Object.keys(SOURCES).some(n => isOn_(cfg['來源-' + n]))) w.push('・所有來源都關閉了');
  const to = String(cfg['Email收件人'] || '').trim();
  if (to && to.split(/[,，;\s]+/).some(e => e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) w.push('・Email 收件人格式有誤');
  if (!to) w.push('・Email 收件人空白：會寄給自己（Gmail 自己寄給自己通常不跳通知）');
  if (WD.indexOf(String(cfg['每週執行星期']).trim()) < 0) w.push('・每週執行星期請填「一」～「日」');
  if (!cfg['網頁網址']) w.push('・網頁網址尚未填寫（週報信不會附網頁連結）');
  return w;
}

function configSummary_(cfg) {
  const on = Object.keys(SOURCES).filter(n => isOn_(cfg['來源-' + n]));
  return [
    '年齡：' + cfg['年齡下限'] + '～' + cfg['年齡上限'] + ' 歲（有重疊就收）',
    '價格：' + cfg['價格上限'] + ' 元以內；低價門檻 ' + cfg['低價門檻'] + ' 元',
    '期間：今天起 ' + cfg['往後看幾天'] + ' 天；長期 > ' + cfg['長期展覽天數'] + ' 天',
    '常用地區：' + listOf_(cfg['常用地區']).join('、'),
    '來源（' + on.length + '）：' + on.join('、') + (isOn_(cfg['來源-新聞線索']) ? '、新聞線索' : ''),
    '收件人：' + recipients_(cfg),
    '每週：' + cfg['每週執行星期'] + ' ' + cfg['每週執行時間'],
  ].join('\n');
}

// ======================= 初始化 =======================
function setupSheets_(ss) {
  const mk = (name, head, widths) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8f0ef');
    sh.setFrozenRows(1);
    (widths || []).forEach((w, i) => w && sh.setColumnWidth(i + 1, w));
    return sh;
  };
  const list = mk(SH.LIST, LIST_HEAD, [50, 70, 110, 120, 360, 95, 95, 160, 70, 50, 200, 110, 80, 100, 90, 90, 150, 110, 55, 45, 45, 90]);
  list.setFrozenColumns(3);
  list.hideColumns(LIST_HEAD.indexOf('UID') + 1, 4);
  const exc = mk(SH.EXC, EXC_HEAD, [60, 360, 95, 95, 95, 70]);
  exc.hideColumns(7, 2);
  mk(SH.NEWS, NEWS_HEAD, [95, 420, 120, 140, 95, 300]);
  mk(SH.LOG, LOG_HEAD, [150, 180, 60, 60, 360, 60]);
  const memo = mk(SH.MEMO, MEMO_HEAD, [300, 100, 80]);
  memo.hideSheet();

  // 設定表：保留已填的值，補上新項目
  const set = mk(SH.SET, ['項目', '值', '說明'], [170, 320, 520]);
  const have = {};
  if (set.getLastRow() > 1) set.getRange(2, 1, set.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
    have[k] = v instanceof Date ? Utilities.formatDate(v, TZ, 'HH:mm') : v;
  });
  const rows = Object.keys(DEFAULTS).map(k => [k, k in have ? have[k] : DEFAULTS[k],
    SETTING_NOTES[k] || (k.indexOf('來源-') === 0 ? '開／關' : '')]);
  set.getRange(2, 1, set.getMaxRows() - 1, 3).clearContent().clearDataValidations();
  set.getRange(2, 1, rows.length, 3).setValues(rows);
  set.getRange(2, 2, rows.length, 1).setBackground('#fff8c5').setNumberFormat('@');
  set.getRange(2, 3, rows.length, 1).setFontColor('#666666').setWrap(true);
  const onOff = SpreadsheetApp.newDataValidation().requireValueInList(['開', '關'], true).build();
  const wdRule = SpreadsheetApp.newDataValidation().requireValueInList(WD.split('').map(c => c), true).build();
  rows.forEach((r, i) => {
    if (r[0].indexOf('來源-') === 0) set.getRange(i + 2, 2).setDataValidation(onOff);
    if (r[0] === '每週執行星期') set.getRange(i + 2, 2).setDataValidation(wdRule);
  });

  // 字型：微軟正黑體 12pt
  [SH.LIST, SH.EXC, SH.NEWS, SH.LOG, SH.SET].forEach(n => {
    const sh = ss.getSheetByName(n);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setFontFamily('Microsoft JhengHei').setFontSize(12);
  });
  // 排列分頁順序
  [SH.LIST, SH.EXC, SH.NEWS, SH.SET, SH.LOG].forEach((n, i) => { ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1); });
  const def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  ss.getSheetByName(SH.LIST).activate();
}

// ======================= 文字工具 =======================
function norm_(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/台/g, '臺').trim();
}

function titleKey_(t) {
  let s = norm_(t).toLowerCase();
  s = s.replace(/[-－–—:：]\s*\d{1,2}月\s*\d{1,2}日.*$/, '');
  s = s.replace(/\d{1,2}月\s*\d{1,2}日\s*\d{1,2}:\d{2}.*$/, '');
  s = s.replace(/(^|[^a-z])[a-z]{2,4}\d{6}(?!\d)/g, '$1');
  s = s.replace(/[（(]?第[一二三四五六七八九十\d]+[場梯期堂][)）]?/g, '');
  return s.replace(/[^\p{L}\p{N}]+/gu, '');
}

function decode_(s) {
  return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlText_(h) {
  let s = String(h || '').replace(/<!\[CDATA\[|\]\]>/g, '');
  s = s.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|td|th|dd|dt|section|article|caption)>/gi, '\n');
  s = decode_(s.replace(/<[^>]+>/g, ' '));
  return cleanText_(s);
}

function cleanText_(s) {
  return String(s || '').replace(/[ \t　\xa0]+/g, ' ').replace(/\n\s*\n+/g, '\n').replace(/^\s+|\s+$/g, '');
}

function field_(text, labels, len) {
  const s = norm_(text);
  const m = new RegExp('[【\\[]?(?:' + labels + ')[】\\]]?\\s*[:：|｜]?\\s*').exec(s);
  if (!m) return '';
  let seg = s.substr(m.index + m[0].length, len || 100).replace(/\s+/g, ' ');
  const stop = /[【\[]|[一二三四五六七八九十]+、|(?<!\d)\d+[.、](?!\d)|(?:活動|報名|聯絡|洽詢|參加|參與)?(?:時間|日期|地點|電話|對象|費用|方式|講師|名額|說明|內容|網址)\s*[:：|｜]/.exec(seg.substr(1));
  if (stop) seg = seg.substr(0, stop.index + 1);
  return seg.replace(/^[\s:：]+|[\s:：]+$/g, '');
}

// ======================= 縣市 =======================
const REGIONS = {
  '北部': ['臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
  '中部': ['苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣'],
  '南部': ['嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣'],
  '東部': ['花蓮縣', '臺東縣'],
  '離島': ['澎湖縣', '金門縣', '連江縣'],
};
const CITY_REGION = {};
Object.keys(REGIONS).forEach(r => REGIONS[r].forEach(c => { CITY_REGION[c] = r; }));
const ALL_CITIES = Object.keys(CITY_REGION);
const EN_CITY = {
  'taipei city': '臺北市', 'new taipei city': '新北市', 'keelung city': '基隆市', 'taoyuan city': '桃園市',
  'hsinchu city': '新竹市', 'hsinchu county': '新竹縣', 'yilan county': '宜蘭縣', 'miaoli county': '苗栗縣',
  'taichung city': '臺中市', 'changhua county': '彰化縣', 'nantou county': '南投縣', 'yunlin county': '雲林縣',
  'chiayi city': '嘉義市', 'chiayi county': '嘉義縣', 'tainan city': '臺南市', 'kaohsiung city': '高雄市',
  'pingtung county': '屏東縣', 'hualien county': '花蓮縣', 'taitung county': '臺東縣', 'penghu county': '澎湖縣',
  'kinmen county': '金門縣', 'lienchiang county': '連江縣',
};
const TAIPEI_DISTRICTS = ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區'];

function detectCity_(text) {
  const s = norm_(text);
  if (!s) return null;
  const low = s.toLowerCase();
  for (const en in EN_CITY) if (low.indexOf(en) >= 0) return EN_CITY[en];
  for (const part of [s.substr(0, 20), s]) {
    let best = null, pos = 1e9;
    ALL_CITIES.forEach(c => { const i = part.indexOf(c); if (i >= 0 && i < pos) { pos = i; best = c; } });
    if (best) return best;
  }
  if (TAIPEI_DISTRICTS.some(d => s.substr(0, 20).indexOf(d) >= 0)) return '臺北市';
  return null;
}

// ======================= 日期 =======================
const REG_WORDS = /報名|登記|錄取|公告|截止|抽籤|備取|候補|額滿|名單|發布|發佈|更新/;
const CLOSED_WORDS = /暫停|休館|停止|取消/;
const CN_WD = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };

function today_() {
  const p = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function mkDate_(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null;
}
function iso_(d) { return d ? d.toISOString().substr(0, 10) : ''; }
function fromIso_(s) { const p = String(s).substr(0, 10).split('-').map(Number); return mkDate_(p[0], p[1], p[2]); }
function addDays_(d, n) { return new Date(d.getTime() + n * 864e5); }
function fmt_(d, f) { return Utilities.formatDate(d, TZ, f); }
function fmtWd_(d) {
  const wd = WD[new Date(Date.parse(Utilities.formatDate(d, TZ, 'yyyy-MM-dd') + 'T00:00:00Z')).getUTCDay()];
  return Utilities.formatDate(d, TZ, 'yyyy/MM/dd') + '（' + wd + '）' + Utilities.formatDate(d, TZ, 'HH:mm');
}

function datesIn_(text, ref) {
  const s = norm_(text);
  ref = ref || today_();
  const found = [], used = [];
  const take = (m) => {
    if (used.some(([a, b]) => m.index >= a && m.index < b)) return false;
    used.push([m.index, m.index + m[0].length]); return true;
  };
  const scan = (re, fn) => { let m; re.lastIndex = 0; while ((m = re.exec(s))) if (take(m)) fn(m); };
  scan(/(20\d{2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/g, m => found.push([m.index, mkDate_(+m[1], +m[2], +m[3])]));
  scan(/(?<!\d)(1[01]\d)\s*[\/.年]\s*(\d{1,2})\s*[\/.月]\s*(\d{1,2})/g, m => found.push([m.index, mkDate_(+m[1] + 1911, +m[2], +m[3])]));
  scan(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日號]?/g, m => found.push([m.index, [+m[1], +m[2]]]));
  scan(/(?<![\d\/.])(\d{1,2})\/(\d{1,2})(?![\d\/:])/g, m => found.push([m.index, [+m[1], +m[2]]]));
  scan(/(\d{1,2})\s*月\s*(?:份)?\s*(?:的)?每(?:週|周|星期)([一二三四五六日天])/g, m => {
    const mon = +m[1], wd = CN_WD[m[2]];
    let y = ref.getUTCFullYear();
    if (mon < ref.getUTCMonth() + 1 - 6) y++;
    for (let d = mkDate_(y, mon, 1); d && d.getUTCMonth() === mon - 1; d = addDays_(d, 1))
      if (d.getUTCDay() === wd) found.push([m.index + d.getUTCDate() / 100, d]);
  });
  found.sort((a, b) => a[0] - b[0]);
  const out = [];
  let prev = null;
  found.forEach(([, v]) => {
    if (!v) return;
    if (Array.isArray(v)) {
      const [mon, day] = v;
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return;
      const base = prev || ref;
      let d = mkDate_(base.getUTCFullYear(), mon, day);
      if (!d) return;
      if (!prev && d < addDays_(ref, -180)) d = mkDate_(d.getUTCFullYear() + 1, mon, day);
      else if (prev && d < addDays_(prev, -60)) d = mkDate_(d.getUTCFullYear() + 1, mon, day);
      v = d;
    }
    if (v) { out.push(v); prev = v; }
  });
  return out;
}

function splitReg_(text) {
  const keep = [], reg = [];
  norm_(text).split(/[\n。；;]/).forEach(line => {
    if (REG_WORDS.test(line)) reg.push(line);
    else if (!CLOSED_WORDS.test(line)) keep.push(line);
  });
  return [keep.join('\n'), reg.join('\n')];
}

function parseDates_(text) { return datesIn_(splitReg_(text)[0]); }

function parseReg_(text) {
  let start = null, end = null;
  splitReg_(text)[1].split('\n').forEach(line => {
    if (!/報名|登記/.test(line) || /錄取|公告|名單/.test(line)) return;
    const ds = datesIn_(line);
    if (!ds.length) return;
    if (/截止|前|為止/.test(line) && ds.length === 1) end = end || ds[0];
    else if (/開放|開始|起/.test(line) && ds.length === 1) start = start || ds[0];
    else { start = start || ds[0]; if (ds.length > 1) end = end || ds[ds.length - 1]; }
  });
  return [start, end];
}

// ======================= 價格 =======================
const FREE_RE = /免費|免票|自由入場|自由參觀|免報名費|不收費|無須付費|免付費|免門票/;
const PRICE_LABEL = /費用|票價|報名費|材料費|收費|價格|入場費|參加費|學費|課程費|售價/g;

function amounts_(s) {
  const out = [];
  const re = /(?:NT\$|NTD|\$)\s*([\d,]{1,7})|([\d,]{1,7})\s*(?:元|圓)/gi;
  let m;
  while ((m = re.exec(s))) {
    const v = +String(m[1] || m[2]).replace(/,/g, '');
    if (v > 0 && v < 100000) out.push(v);
  }
  if (/1,?000\s*(?:元)?\s*(?:↑|以上)/.test(s)) out.push(1001);
  return out;
}

function parsePrice_(text) {
  const s = norm_(text);
  let m;
  PRICE_LABEL.lastIndex = 0;
  while ((m = PRICE_LABEL.exec(s))) {
    const seg = s.substr(m.index + m[0].length, 80);
    const a = amounts_(seg);
    const free = FREE_RE.exec(seg);
    if (free && (!a.length || free.index < 15)) return 0;
    if (a.length) return Math.min.apply(null, a);
  }
  if (FREE_RE.test(s)) return 0;
  const a = [];
  const re = /(?:NT\$|每人)\s*([\d,]{2,6})/gi;
  while ((m = re.exec(s))) a.push(+m[1].replace(/,/g, ''));
  return a.length ? Math.min.apply(null, a) : null;
}

// ======================= 年齡 =======================
const CN_DIGIT = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };
const AGE_LABEL = /對象|年齡|適合|適齡|參加資格|參加者|招生|限定|參與對象|活動對象/g;

function num_(x) { return /^\d+$/.test(x) ? +x : CN_DIGIT[x]; }

function ageRanges_(s) {
  const spec = [], gen = [];
  const N = '(\\d{1,2}|十[一二]?|[一二三四五六七八九])';
  let m, re;
  re = new RegExp(N + '\\s*(?:歲)?\\s*[至~～\\-－到、]\\s*' + N + '\\s*歲', 'g');
  while ((m = re.exec(s))) { const a = num_(m[1]), b = num_(m[2]); if (a != null && b != null && a <= b) spec.push([a, b]); }
  re = new RegExp(N + '\\s*歲\\s*(?:\\(含\\)|（含）)?\\s*以上', 'g');
  while ((m = re.exec(s))) spec.push([num_(m[1]), 99]);
  re = new RegExp(N + '\\s*歲\\s*(?:\\(含\\)|（含）)?\\s*(?:以下|以內)', 'g');
  while ((m = re.exec(s))) spec.push([0, num_(m[1])]);
  re = /(?:國小|小學)?\s*([一二三四五六1-6])\s*[至~～\-－到、]\s*([一二三四五六1-6])\s*年級/g;
  while ((m = re.exec(s))) { const a = num_(m[1]), b = num_(m[2]); if (a && b && a <= b) spec.push([a + 5, b + 6]); }
  [['低年級', [6, 8]], ['中年級', [8, 10]], ['高年級', [10, 12]], ['小一', [6, 7]], ['大班', [5, 6]]]
    .forEach(([w, r]) => { if (s.indexOf(w) >= 0) spec.push(r); });
  [['國小', [6, 12]], ['小學', [6, 12]], ['學童', [6, 12]], ['幼兒園', [3, 6]], ['幼稚園', [3, 6]], ['學齡前', [3, 6]],
    ['嬰幼兒', [0, 3]], ['寶寶', [0, 3]], ['國中', [12, 15]], ['高中', [15, 18]], ['成人', [18, 99]],
    ['全齡', [0, 99]], ['不限', [0, 99]], ['一般民眾', [0, 99]]]
    .forEach(([w, r]) => { if (s.indexOf(w) >= 0) gen.push(r); });
  const sp = spec.filter(r => r[0] != null);
  return sp.length ? sp : gen;
}

function parseAge_(text) {
  const s = norm_(text);
  let m;
  AGE_LABEL.lastIndex = 0;
  while ((m = AGE_LABEL.exec(s))) {
    const r = ageRanges_(s.substr(m.index + m[0].length, 60));
    if (r.length) return [Math.min.apply(null, r.map(x => x[0])), Math.max.apply(null, r.map(x => x[1]))];
  }
  const r = ageRanges_(s);
  return r.length ? [Math.min.apply(null, r.map(x => x[0])), Math.max.apply(null, r.map(x => x[1]))] : null;
}

function ageLabel_(age) {
  if (!age) return '未標示';
  const [a, b] = age;
  if (a <= 3 && b >= 99) return '全齡';
  if (b >= 99) return a + '歲以上';
  if (a === 0) return b + '歲以下';
  return a + '～' + b + '歲';
}

// ======================= 網路抓取 =======================
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function req_(url) {
  return { url: url, muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: true,
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' } };
}

function fetch_(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = UrlFetchApp.fetch(url, req_(url));
      if (r.getResponseCode() === 200) return r;
      last = new Error('HTTP ' + r.getResponseCode());
    } catch (e) { last = e; }
    Utilities.sleep(1500 * (i + 1));
  }
  throw last;
}

function fetchText_(url) { return fetch_(url).getContentText('UTF-8').replace(/^﻿/, ''); }

/** 平行抓多個網址（每批 20 個），回傳 {url: 文字或 null}。 */
function fetchMany_(urls) {
  const out = {};
  for (let i = 0; i < urls.length; i += 20) {
    const batch = urls.slice(i, i + 20);
    let res = [];
    try { res = UrlFetchApp.fetchAll(batch.map(req_)); } catch (e) { res = []; }
    batch.forEach((u, j) => {
      const r = res[j];
      out[u] = r && r.getResponseCode() === 200 ? r.getContentText('UTF-8') : null;
    });
  }
  return out;
}

// ======================= 資料來源 =======================
const GOV_RE = /政府|公所|國立|市立|縣立|文化部|教育部|交通部|農業部|環境部|內政部|衛生福利部|文化局|教育局|觀光署|觀光局|文化中心|圖書館|藝文中心|國家兩廳院|國家表演藝術中心|林業及自然保育署|國家公園|博物館|美術館|科學教育館|動物園|天文/;

/** 統一的活動格式。sessions: [[開始, 結束, 縣市, 地點]] */
function ev_(source, uid, title, url, o) {
  return {
    source: source, uid: source + ':' + uid, title: norm_(title), url: url || '',
    org: norm_(o.org || ''), gov: !!o.gov, price: o.price == null ? null : o.price, age: o.age || null,
    regStart: o.reg ? o.reg[0] : null, regEnd: o.reg ? o.reg[1] : null,
    sessions: (o.sessions || []).filter(s => s[0]).map(s => ({ start: s[0], end: s[1] || s[0], city: s[2] || o.city || null, venue: norm_(s[3] || o.venue || '') })),
    text: cleanText_(o.text || '').substr(0, 800), kidRequired: o.kidRequired !== false, outingHint: !!o.outingHint,
  };
}

const MOC_CATS = ['4', '19', '2', '3', '1', '6', '7'];

function srcMoc_() {
  const base = 'https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=';
  const pages = fetchMany_(MOC_CATS.map(c => base + c));
  const out = [];
  MOC_CATS.forEach(code => {
    const raw = pages[base + code];
    if (!raw) throw new Error('文化部分類 ' + code + ' 抓取失敗');
    JSON.parse(raw).forEach(e => {
      const infos = e.showInfo || [];
      let sessions = infos.map(s => [mocDate_(s.time), mocDate_(s.endTime), detectCity_(s.location) || detectCity_(s.locationName), s.locationName || s.location]);
      if (!sessions.length) sessions = [[mocDate_(e.startDate), mocDate_(e.endDate), null, '']];
      const prices = infos.map(s => s.price || '').join(' ');
      const text = [e.title, prices, e.comment || '', e.discountInfo || '', htmlText_(e.descriptionFilterHtml)].join(' ');
      const org = (e.masterUnit || []).join('、') || e.sourceWebName || '';
      out.push(ev_('文化部', e.UID, e.title, e.sourceWebPromote || e.webSales || '', {
        sessions: sessions, org: org, gov: GOV_RE.test(org), price: parsePrice_(text), age: parseAge_(text),
        reg: parseReg_(text), text: text, kidRequired: code !== '4' }));
    });
  });
  return out;
}

function mocDate_(s) {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s || '');
  return m ? mkDate_(+m[1], +m[2], +m[3]) : null;
}

function srcTourism_() {
  const blob = fetch_('https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Event-json.zip').getBlob().setContentType('application/zip');
  const file = Utilities.unzip(blob).filter(b => /\.json$/i.test(b.getName()))[0];
  const data = JSON.parse(file.getDataAsString('UTF-8').replace(/^﻿/, ''));
  const items = findList_(data, 'EventName');
  return items.map(e => {
    const addr = e.PostalAddress || {};
    const city = norm_(addr.City) || detectCity_(JSON.stringify(addr));
    const fee = e.FeeInfo || '';
    const text = [e.EventName, e.Description || '', fee].join(' ');
    const free = [true, 'true', 1, '1'].indexOf(e.IsAccessibleForFree) >= 0;
    const orgs = Array.isArray(e.Organizations) ? e.Organizations.map(o => o && o.Name).filter(Boolean).join('、') : '';
    return ev_('觀光署', e.EventID, e.EventName, e.WebsiteURL || '', {
      sessions: [[isoLocal_(e.StartDateTime), isoLocal_(e.EndDateTime), city, [addr.Town, addr.StreetAddress].filter(Boolean).join(' ')]],
      org: orgs || '交通部觀光署', gov: true, price: free ? 0 : parsePrice_(fee || text), age: parseAge_(text), text: text });
  });
}

function findList_(o, key) {
  if (Array.isArray(o) && o.length && o[0] && typeof o[0] === 'object' && key in o[0]) return o;
  if (o && typeof o === 'object') for (const k in o) { const r = findList_(o[k], key); if (r) return r; }
  return null;
}

/** 觀光署與 ACCUPASS 的時間其實是 UTC，加 8 小時才是台灣日期。 */
function isoLocal_(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 8, +m[5]));
  return mkDate_(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function srcTpml_() {
  const x = fetchText_('https://tpml.gov.taipei/OpenData.aspx?SN=8770FE105FF71B93');
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(x))) {
    const it = m[1];
    const title = htmlText_((/<title>([\s\S]*?)<\/title>/.exec(it) || [])[1]);
    const link = decode_((/<link>([\s\S]*?)<\/link>/.exec(it) || [])[1] || '').trim();
    const text = htmlText_(decode_((/<description>([\s\S]*?)<\/description>/.exec(it) || [])[1]));
    const when = field_(text, '活動時間|活動日期|時間', 160) || text;
    const place = field_(text, '活動地點|地點', 60);
    let dates = parseDates_(when);
    if (!dates.length) dates = parseDates_(text);
    out.push(ev_('北市圖', link.replace(/.*s=/, ''), title, link, {
      sessions: dates.map(d => [d, d, detectCity_(place) || '臺北市', place]),
      org: '臺北市立圖書館', gov: true, price: parsePrice_(text) || 0,
      age: parseAge_(field_(text, '活動對象|對象|參加對象', 80) || text), reg: parseReg_(text), text: text, kidRequired: false }));
  }
  return out;
}

function srcNtpclib_() {
  const NTPC = 'https://www.library.ntpc.gov.tw';
  const links = {};
  const lists = fetchMany_([1, 2, 3].map(p => NTPC + '/multiplehtml/ActvInfo?categoryCode=008&pageNum=' + p));
  if (!Object.values(lists).some(Boolean)) throw new Error('列表抓取失敗');
  Object.values(lists).forEach(x => {
    if (!x) return;
    const re = /href=['"](\/singlehtml\/ActvInfo\?cntId=[0-9a-f]+)['"][^>]*title=['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(x))) if (!/嬰幼兒|寶寶|0-3歲|0～3歲/.test(m[2])) links[NTPC + m[1]] = decode_(m[2]);
  });
  const pages = fetchMany_(Object.keys(links));
  const out = [];
  Object.keys(pages).forEach(url => {
    const x = pages[url];
    if (!x) return;
    const i = x.indexOf('article-page paging-content');
    const j = x.indexOf('發布單位', i);
    const text = htmlText_(i > 0 ? x.substring(i, j > i ? j : undefined) : x);
    const title = links[url];
    const place = field_(text, '活動地點|地點', 60);
    const when = field_(text, '活動時間|活動日期|時間', 300) || text;
    let dates = parseDates_(when);
    if (!dates.length) dates = parseDates_(text);
    const unit = /【([^】]+)】/.exec(title);
    const venue = place.length >= 4 && !/^(內容|說明)/.test(place) ? place : (unit ? unit[1] : '');
    out.push(ev_('新北圖', url.split('=').pop(), title, url, {
      sessions: dates.map(d => [d, d, detectCity_(place) || '新北市', venue]),
      org: '新北市立圖書館', gov: true, price: parsePrice_(text) || 0,
      age: parseAge_(field_(text, '參與對象|活動對象|對象', 80) || text), reg: parseReg_(text), text: text, kidRequired: false }));
  });
  return out;
}

function srcNtsec_() {
  const B = 'https://estore.ntsec.gov.tw/';
  const lists = fetchMany_([1, 4].map(t => B + 'classes.aspx?TYPE2=' + t));
  if (!Object.values(lists).some(Boolean)) throw new Error('列表抓取失敗');
  const cards = {};
  Object.values(lists).forEach(x => {
    (x || '').split(/<li>/).forEach(chunk => {
      if (chunk.indexOf('eventcourse-title') < 0) return;
      const num = /CLASS_NUM=(\w+)/.exec(chunk);
      if (num) cards[num[1]] = chunk.split('</li>')[0];
    });
  });
  const details = fetchMany_(Object.keys(cards).map(n => B + 'classDetail.aspx?CLASS_NUM=' + n));
  const out = [];
  Object.keys(cards).forEach(num => {
    const h = cards[num];
    if (h.indexOf('報名中') < 0) return;
    const title = htmlText_((/class='eventcourse-title'>([\s\S]*?)<\/div>/.exec(h) || [])[1]);
    if (!title || /國中|高中|教師|成人|友善學生卡|大專/.test(title)) return;
    const rng = /課程日期<\/p>\s*<p>(\d{4}\/\d{1,2}\/\d{1,2})\s*~\s*(\d{4}\/\d{1,2}\/\d{1,2})/.exec(h);
    const price = /一般會員<\/span>\s*<p>NT\s*\$\s*([\d,]+)/.exec(h);
    const url = B + 'classDetail.aspx?CLASS_NUM=' + num;
    const dtext = htmlText_(details[url] || '');
    const body = field_(dtext, '課程內容|課程介紹|課程說明', 600);
    const regD = /報名日期時間\s*(\d{4}\/\d{1,2}\/\d{1,2})/.exec(dtext);
    out.push(ev_('科教館', num, title, url, {
      sessions: [[rng ? datesIn_(rng[1])[0] : null, rng ? datesIn_(rng[2])[0] : null, '臺北市', '國立臺灣科學教育館']],
      org: '國立臺灣科學教育館', gov: true, price: price ? +price[1].replace(/,/g, '') : null,
      age: parseAge_(title) || parseAge_(field_(dtext, '適合對象|課程對象|對象', 40) + ' ' + body),
      reg: [regD ? datesIn_(regD[1])[0] : null, null], text: title + '\n' + body, kidRequired: false }));
  });
  return out;
}

function srcAccupass_() {
  const qs = ['免費親子活動', '兒童 免費 活動', '親子 活動', '市集', '親子市集', '免費 戶外 表演', '嘉年華'];
  const urls = qs.map(q => 'https://www.accupass.com/search?q=' + encodeURIComponent(q));
  const pages = fetchMany_(urls);
  if (!Object.values(pages).some(Boolean)) throw new Error('搜尋頁抓取失敗');
  const out = {};
  Object.values(pages).forEach(x => {
    if (!x) return;
    x = x.replace(/\\"/g, '"');
    const re = /\{"eventIdNumber":"(\d+)".*?"utm":[^}]*?\}/g;
    let m;
    while ((m = re.exec(x))) {
      let e;
      try { e = JSON.parse(m[0]); } catch (err) { continue; }
      const tags = (e.tags || []).map(t => t.name || '').join(' ');
      const free = /免費/.test(e.name + tags);
      out[e.eventIdNumber] = ev_('ACCUPASS', e.eventIdNumber, e.name, 'https://www.accupass.com/event/' + e.eventIdNumber, {
        sessions: [[isoLocal_(e.startDateTime), isoLocal_(e.endDateTime), detectCity_(e.location || ''), '']],
        price: free ? 0 : null, age: parseAge_(e.name + ' ' + tags), text: e.name + ' ' + tags });
    }
  });
  return Object.values(out);
}

function srcExpopark_() {
  const base = 'https://www.expopark.taipei/';
  const x = fetchText_(base);
  const out = [], seen = {};
  const re = /<a[^>]+href="([^"]*News_Photo_Content[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(x))) {
    const href = decode_(m[1]);
    const t = htmlText_(m[2]).replace(/\n/g, ' ');
    const r = /(1\d\d)-(\d\d)-(\d\d)\s*~\s*(1\d\d)-(\d\d)-(\d\d)/.exec(t);
    if (!r || seen[href]) continue;
    seen[href] = 1;
    const mm = /^((?:(?:自由|售票|索票|邀請)入場\s*)+)(.*?)\s*(市集活動|展覽活動|藝文活動|運動活動|其他活動)/.exec(t);
    if (!mm) continue;
    const price = mm[1].indexOf('售票') >= 0 ? null : 0;
    const venue = /爭艷館|流行館|長廊廣場|環形廣場|花海廣場|爭艷廣場|入口廣場|舞蝶館|美術公園/.exec(t.substr(mm.index + mm[0].length, 160));
    const uid = /[?&]s=(\d+)/.exec(href);
    out.push(ev_('花博公園', uid ? uid[1] : href, mm[2].trim(), base + href.replace(/^\//, ''), {
      sessions: [[mkDate_(+r[1] + 1911, +r[2], +r[3]), mkDate_(+r[4] + 1911, +r[5], +r[6]), '臺北市', '花博公園 ' + (venue ? venue[0] : '')]],
      org: '臺北市會展產業發展基金會', price: price, text: t.substr(0, 300),
      outingHint: (mm[3] === '市集活動' || mm[3] === '藝文活動') && price === 0 }));
  }
  return out;
}

function srcHuashan_() {
  const base = 'https://www.huashan1914.com';
  const pages = fetchMany_([1, 2, 3, 4].map(p => base + '/exhibition' + (p > 1 ? '?page=' + p : '')));
  if (!Object.values(pages).some(Boolean)) throw new Error('列表抓取失敗');
  const out = {};
  Object.values(pages).forEach(x => {
    if (!x) return;
    const re = /<a href="([^"]+)"[^>]*class="exhi-card__link"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(x))) {
      const card = m[2];
      const tm = /<time>([\s\S]*?)<\/time>/.exec(card);
      const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(card);
      if (!tm || !h3) continue;
      const ds = []; let d; const dre = /(20\d\d)\.(\d\d)\.(\d\d)/g;
      while ((d = dre.exec(tm[1]))) ds.push(mkDate_(+d[1], +d[2], +d[3]));
      if (!ds.length) continue;
      const vm = /exhi-card__content-venue">([\s\S]*?)<\/div>/.exec(card);
      const title = htmlText_(h3[1]);
      const href = decode_(m[1]);
      out[href] = ev_('華山1914', href.split('/').pop(), title, base + encodeURI(href), {
        sessions: [[ds[0], ds[ds.length - 1], '臺北市', '華山1914 ' + (vm ? htmlText_(vm[1]).replace(/\n/g, ' ') : '')]],
        org: '華山1914文化創意產業園區', text: title });
    }
  });
  return Object.values(out);
}

function srcSongshan_() {
  const base = 'https://www.songshanculturalpark.org';
  const x = fetchText_(base + '/exhibition');
  const out = {};
  const re = /<a href="(\/exhibition\/activity\/[^"]+)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(x))) {
    const t = /class="title">([\s\S]*?)<\/p>/.exec(m[2]);
    const d = /class="date[^"]*">([\s\S]*?)<\/p>/.exec(m[2]);
    if (!t || !d) continue;
    const ds = []; let k; const dre = /(20\d\d)-(\d\d)-(\d\d)/g;
    while ((k = dre.exec(d[1]))) ds.push(mkDate_(+k[1], +k[2], +k[3]));
    const title = htmlText_(t[1]);
    if (!ds.length || /展演攻略/.test(title)) continue;
    out[m[1]] = ev_('松山文創園區', m[1].split('/').pop(), title, base + m[1], {
      sessions: [[ds[0], ds[ds.length - 1], '臺北市', '松山文創園區']], org: '松山文創園區', text: title });
  }
  return Object.values(out);
}

const NEWS_KEYWORDS = ['親子活動 免費', '兒童 活動 報名', '寒假 兒童 營隊', '親子 週末 活動'];

function fetchNews_() {
  const urls = NEWS_KEYWORDS.map(k => 'https://news.google.com/rss/search?q=' + encodeURIComponent(k + ' when:7d') + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant');
  const pages = fetchMany_(urls);
  const out = [];
  NEWS_KEYWORDS.forEach((kw, i) => {
    const x = pages[urls[i]];
    if (!x) return;
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(x))) {
      const it = m[1];
      const g = (tag) => decode_(((new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>')).exec(it) || [])[1] || '').trim();
      const pub = new Date(g('pubDate'));
      out.push({ title: htmlText_(g('title')), link: g('link'), source: htmlText_(g('source')),
        date: isNaN(pub) ? '' : fmt_(pub, 'yyyy-MM-dd'), keyword: kw });
    }
  });
  return out;
}

const SOURCES = {
  '文化部': srcMoc_, '觀光署': srcTourism_, '北市圖': srcTpml_, '新北圖': srcNtpclib_, '科教館': srcNtsec_,
  'ACCUPASS': srcAccupass_, '花博公園': srcExpopark_, '華山1914': srcHuashan_, '松山文創園區': srcSongshan_,
};

// ======================= 篩選規則 =======================
const EXCLUDE_WORDS = ['樂齡', '銀髮', '長者', '成人限定', '親職講座', '招募', '志工', '徵件', '徵選', '說明會', '得獎名單', '得獎',
  '抽獎', '恭喜', '師資', '認證', '單身', '聯誼', '研討會', '教師研習', '公務人員', '錄取名單', '徵才', '求職', '職涯', '退休',
  '孕婦', '孕期', '新手爸媽', '嬰兒', '寶寶', '喜劇', '脫口秀', '單口', '酒', '青少年', '對談', '論壇', '座談', '大人必修',
  '家長講座', '教養講座', '樂團招生', '過敏', '長高', '扁平足', '才藝老師', '教學者', '先修班', '直播', '一對一', '藝術鑑賞'];
const KID_RE = /親子|兒童|孩子|小朋友|小孩|童話|童趣|童玩|國小|小學|學童|繪本|說故事|故事屋|故事時間|營隊|親子共學|小一|全家|闔家|小小|kids?|兒童劇|偶戲|家庭日|童樂|布袋戲|掌中劇/i;
const KID_RE_FIELD = new RegExp(KID_RE.source);  // 「對象」欄不分大小寫會誤判英文說明
const OUTING_RE = /市集|市場節|嘉年華|節慶|音樂節|音樂祭|燈節|燈會|花海|花季|煙火|遊行|草地|野餐|園遊會|踩街|戶外|露天|光雕|聖誕|耶誕|跨年|萬聖|童玩|風箏|文化節|文化祭|生活節|豐年祭|祭典|觀光季|藝術季/;
const OUTING_STRONG = /搗蛋|討糖|市集|市場節|園遊會|踩街|遊行|野餐|草地|露天|戶外|煙火|燈會|燈節|光雕|嘉年華|童玩節|風箏|萬聖|跨年/i;
const OUTING_STRONG_MOC = /搗蛋|討糖|市集|市場節|園遊會|踩街|遊行|野餐|草地|露天|戶外|煙火|燈會|燈節|光雕|童玩節|風箏|萬聖|跨年/i;
const NOT_OUTING = /音樂會|劇場|劇團|音樂劇|舞劇|講座|研習|課程|工作坊|徵|招募|募集|馬拉松|路跑|威士忌|啤酒|社交|身心靈|登山|飛盤|引導|派對|競賽|大賽|擂臺|毛孩|貓|二手衣|造型|紳士|立槳|SUP|鋼琴|弦樂|管樂|四重奏|交響|室內|MBTI|梵唱|美酒|婚|法會|創業|產業|招商|投資|求職|動漫|遊戲展/i;

function isKid_(e) {
  return !e.kidRequired || KID_RE.test(e.title) || KID_RE_FIELD.test(field_(e.text, '對象|適合|適齡', 40));
}

function isOuting_(e) {
  if (NOT_OUTING.test(e.title)) return false;
  if (e.outingHint) return true;
  if (e.source === '觀光署') return OUTING_RE.test(e.title);
  return (e.source === '文化部' ? OUTING_STRONG_MOC : OUTING_STRONG).test(e.title) && (e.price === 0 || e.price == null);
}

// ======================= 主流程 =======================
function runUpdate_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t0 = Date.now();
    const cfg = getConfig_();
    const fetched = fetchAll_(cfg);
    const res = processEvents_(fetched.raw, cfg);
    writeSheets_(res, fetched, cfg);
    const sec = Math.round((Date.now() - t0) / 1000);
    const now = fmt_(new Date(), 'yyyy/MM/dd HH:mm');
    PropertiesService.getScriptProperties().setProperty('lastUpdate', now + '（' + res.events.length + ' 筆）');
    const failed = fetched.log.filter(l => l.status.indexOf('失敗') === 0).map(l => l.source);
    const counts = { main: 0, outing: 0, own: 0 };
    res.events.forEach(e => counts[e.view]++);
    return {
      summary: '共 ' + res.events.length + ' 筆（親子活動 ' + counts.main + '、市集節慶 ' + counts.outing + '、獨立按鈕 ' + counts.own + '），用時 ' + sec + ' 秒。' +
        (failed.length ? '\n⚠️ 抓取失敗：' + failed.join('、') : ''), res: res };
  } finally {
    lock.releaseLock();
  }
}

function fetchAll_(cfg) {
  const raw = [], log = [];
  const today = today_(), horizon = addDays_(today, +cfg['往後看幾天']);
  Object.keys(SOURCES).forEach(name => {
    if (!isOn_(cfg['來源-' + name])) { log.push({ source: name, status: '關閉', fetched: 0, kept: 0, sec: 0 }); return; }
    const t0 = Date.now();
    try {
      const items = SOURCES[name]();
      let kept = 0;
      items.forEach(e => {
        e.sessions = e.sessions.filter(s => s.end >= today && s.start <= horizon && s.city);
        if (e.sessions.length && (isKid_(e) || isOuting_(e))) { raw.push(e); kept++; }
      });
      log.push({ source: name, status: '成功', fetched: items.length, kept: kept, sec: Math.round((Date.now() - t0) / 100) / 10 });
    } catch (err) {
      log.push({ source: name, status: '失敗：' + String(err && err.message || err).substr(0, 150), fetched: 0, kept: 0, sec: Math.round((Date.now() - t0) / 100) / 10 });
    }
  });
  let news = [];
  if (isOn_(cfg['來源-新聞線索'])) {
    try { news = fetchNews_(); log.push({ source: '新聞線索', status: '成功', fetched: news.length, kept: news.length, sec: 0 }); }
    catch (err) { log.push({ source: '新聞線索', status: '失敗：' + err, fetched: 0, kept: 0, sec: 0 }); }
  }
  return { raw: raw, log: log, news: news };
}

function readMemo_() {
  const sh = ss_().getSheetByName(SH.MEMO);
  const memo = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(([k, f, m]) => {
    if (k) memo[k] = { first: f instanceof Date ? fmt_(f, 'yyyy-MM-dd') : String(f), mark: m };
  });
  return memo;
}

function readExcluded_() {
  const sh = ss_().getSheetByName(SH.EXC);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, EXC_HEAD.length).getValues().map(r => ({
    status: r[0], title: r[1], from: dval_(r[2]), to: dval_(r[3]), on: dval_(r[4]), city: r[5], uid: r[6], key: r[7] }));
}

function dval_(v) { return v instanceof Date ? fmt_(v, 'yyyy-MM-dd') : String(v || '').replace(/\//g, '-'); }

/** 讀「活動清單」上次的標記（試算表下拉選的「想去／已報名／排除」）。 */
function readListMarks_() {
  const sh = ss_().getSheetByName(SH.LIST);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, LIST_HEAD.length).getValues();
  const iM = LIST_HEAD.indexOf('標記'), iU = LIST_HEAD.indexOf('UID'), iK = LIST_HEAD.indexOf('比對鍵'),
    iT = LIST_HEAD.indexOf('活動名稱'), iS = LIST_HEAD.indexOf('開始日'), iE = LIST_HEAD.indexOf('結束日'), iC = LIST_HEAD.indexOf('縣市');
  v.forEach(r => { if (r[iU]) out[r[iU]] = { mark: r[iM], key: r[iK], title: r[iT], from: dval_(r[iS]), to: dval_(r[iE]), city: r[iC] }; });
  return out;
}

function processEvents_(raw, cfg) {
  const lo = +cfg['年齡下限'], hi = +cfg['年齡上限'], pmax = +cfg['價格上限'], plow = +cfg['低價門檻'];
  const words = EXCLUDE_WORDS.concat(listOf_(cfg['額外排除關鍵字']));
  const own = listOf_(cfg['獨立按鈕來源']);
  const home = listOf_(cfg['常用地區']);
  const today = today_();
  const stats = { 原始: raw.length, 排除字: 0, 非兒童: 0, 年齡不符: 0, 超過價格: 0, 已排除: 0 };

  const groups = {};
  raw.forEach(e => {
    if (words.some(w => e.title.indexOf(w) >= 0)) { stats.排除字++; return; }
    const kind = isKid_(e) ? 'kid' : isOuting_(e) ? 'outing' : null;
    if (!kind) { stats.非兒童++; return; }
    if (e.age && (e.age[1] < lo || e.age[0] > hi)) { stats.年齡不符++; return; }
    if (e.price != null && e.price > pmax) { stats.超過價格++; return; }
    e.kind = kind;
    e.tier = e.gov ? 1 : e.price == null ? 4 : e.price <= plow ? 2 : 3;
    const k = titleKey_(e.title) + '|' + e.sessions[0].city;
    (groups[k] = groups[k] || []).push(e);
  });

  // 去重：完整名稱（去標點、去「第N場」與場次時間）＋縣市相同才合併
  let events = Object.keys(groups).map(k => {
    const es = groups[k].sort((a, b) => a.tier - b.tier || (a.price == null) - (b.price == null));
    const main = Object.assign({}, es[0]);
    const sess = {};
    es.forEach(x => x.sessions.forEach(s => { sess[iso_(s.start) + iso_(s.end)] = sess[iso_(s.start) + iso_(s.end)] || s; }));
    main.sessions = Object.values(sess).sort((a, b) => a.start - b.start || a.end - b.end);
    main.sources = Array.from(new Set(es.map(x => x.source))).sort();
    main.key = k.split('|')[0];
    ['regStart', 'regEnd', 'age', 'url', 'org'].forEach(f => { if (!main[f]) { const o = es.find(x => x[f]); if (o) main[f] = o[f]; } });
    return main;
  });

  // 排除：只排除「當時那段期間」的場次
  const listMarks = readListMarks_();
  const allExc = readExcluded_();
  const excl = allExc.filter(x => x.status === '排除' && x.to >= iso_(today));
  Object.keys(listMarks).forEach(uid => {
    const m = listMarks[uid];
    // 已排除表裡已有此活動（含被清成空白＝已恢復）就以已排除表為準
    if (m.mark === '排除' && !allExc.some(x => x.uid === uid)) {
      excl.push({ status: '排除', title: m.title, from: m.from, to: m.to, on: iso_(today), city: m.city, uid: uid, key: m.key, fresh: true });
    }
  });
  events = events.filter(e => {
    const hits = excl.filter(x => x.uid === e.uid || x.key === e.key);
    if (!hits.length) return true;
    e.sessions = e.sessions.filter(s => !hits.some(x => x.from <= iso_(s.start) && iso_(s.end) <= x.to));
    if (!e.sessions.length) { stats.已排除++; return false; }
    return true;
  });

  const memo = readMemo_();
  const init = (memo['_init'] || {}).first || iso_(today);
  memo['_init'] = { first: init, mark: '' };
  let sat = addDays_(today, (6 - today.getUTCDay() + 7) % 7);
  if (today.getUTCDay() === 0) sat = addDays_(today, -1);
  const sun = addDays_(sat, 1);
  const longDays = +cfg['長期展覽天數'];

  const out = events.map(e => {
    const ss = e.sessions;
    const start = new Date(Math.min.apply(null, ss.map(s => s.start))), end = new Date(Math.max.apply(null, ss.map(s => s.end)));
    const nxt = ss.find(s => s.end >= today);
    const nxtDay = nxt.start > today ? nxt.start : today;
    const m = memo[e.uid] || memo[e.key] || {};
    const first = m.first || iso_(today);
    const mark = (listMarks[e.uid] && listMarks[e.uid].mark !== '排除' ? listMarks[e.uid].mark : '') || m.mark || '';
    memo[e.uid] = { first: first, mark: mark };
    memo[e.key] = { first: first, mark: (memo[e.key] || {}).mark || '' };
    const rs = e.regStart, re = e.regEnd;
    let regStatus = '';
    if (rs && rs > today) regStatus = '即將開放報名';
    else if ((re && re >= today) || (rs && !re)) regStatus = '報名中';
    else if (re && re < today) regStatus = '報名已截止';
    const dates = Array.from(new Set(ss.map(s => iso_(s.start > today ? s.start : today)))).sort().slice(0, 12);
    return {
      uid: e.uid, key: e.key, title: e.title, url: e.url, tier: e.tier, sources: e.sources, org: e.org,
      view: e.kind === 'outing' ? 'outing' : e.sources.every(s => own.indexOf(s) >= 0) ? 'own' : 'main',
      city: nxt.city, region: CITY_REGION[nxt.city] || '', home: home.indexOf(nxt.city) >= 0, venue: nxt.venue.substr(0, 60),
      next: iso_(nxtDay), start: iso_(start), end: iso_(end), dates: dates,
      long: (end - start) / 864e5 > longDays, weekend: ss.some(s => s.start <= sun && s.end >= sat),
      isNew: first > init && first >= iso_(addDays_(today, -6)), firstSeen: first,
      price: e.price, priceLabel: e.price == null ? '未標示' + (e.gov ? '（公家活動，多為免費）' : '') : e.price === 0 ? '免費' : e.price.toLocaleString() + ' 元',
      ageLabel: ageLabel_(e.age), regStart: iso_(rs), regEnd: iso_(re), regStatus: regStatus, mark: mark,
    };
  });
  const rank = { main: 0, outing: 1, own: 2 };
  out.sort((a, b) => rank[a.view] - rank[b.view] || a.tier - b.tier || a.long - b.long || (a.next < b.next ? -1 : a.next > b.next ? 1 : a.title < b.title ? -1 : 1));
  out.forEach((e, i) => { e.no = i + 1; });
  stats.收錄 = out.length;
  return { events: out, stats: stats, memo: memo, excl: excl };
}

// ======================= 寫入試算表 =======================
function writeSheets_(res, fetched, cfg) {
  const ss = ss_();
  if (!ss.getSheetByName(SH.LIST)) setupSheets_(ss);
  const own = listOf_(cfg['獨立按鈕來源']).join('、') || '獨立按鈕';
  const viewName = { main: '親子活動', outing: '市集・節慶・戶外', own: own };

  // 活動清單：整表重寫
  const sh = ss.getSheetByName(SH.LIST);
  const rows = res.events.map(e => [
    e.no, e.mark, viewName[e.view], TIERS[e.tier], e.title, e.next, e.end, e.dates.map(d => d.substr(5).replace('-', '/')).join('、'),
    e.city, e.region, e.venue, e.priceLabel, e.ageLabel, e.regStatus, e.regStart, e.regEnd, e.org, e.sources.join('、'),
    e.weekend ? '✓' : '', e.long ? '長期' : '', e.isNew ? 'NEW' : '', e.firstSeen, e.uid, e.key, e.url, e.start]);
  if (sh.getFilter()) sh.getFilter().remove();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clear();
  sh.getRange(1, 1, 1, LIST_HEAD.length).setValues([LIST_HEAD]);
  if (rows.length) {
    const rg = sh.getRange(2, 1, rows.length, LIST_HEAD.length);
    rg.setNumberFormat('@').setValues(rows).setFontFamily('Microsoft JhengHei').setFontSize(12).setVerticalAlignment('middle');
    const iT = LIST_HEAD.indexOf('活動名稱') + 1;
    const rich = res.events.map(e => [e.url ? SpreadsheetApp.newRichTextValue().setText(e.title).setLinkUrl(e.url).build()
      : SpreadsheetApp.newRichTextValue().setText(e.title).build()]);
    sh.getRange(2, iT, rows.length, 1).setRichTextValues(rich);
    sh.getRange(2, LIST_HEAD.indexOf('標記') + 1, rows.length, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MARKS, true).setAllowInvalid(false).build());
    const tierColor = { 1: '#d9f0ec', 2: '#e3f2dc', 3: '#fdefd5', 4: '#eeeeee' };
    sh.getRange(2, LIST_HEAD.indexOf('優先級') + 1, rows.length, 1).setBackgrounds(res.events.map(e => [tierColor[e.tier]]));
    sh.getRange(2, iT, rows.length, 1).setFontWeights(res.events.map(e => [e.isNew ? 'bold' : 'normal']));
    sh.getRange(1, 1, rows.length + 1, LIST_HEAD.length).createFilter();
  }

  // 已排除：保留仍有效的紀錄＋這次新排除的
  const exc = ss.getSheetByName(SH.EXC);
  const keepRows = readExcluded_().filter(x => x.status === '排除' && x.to >= iso_(today_()));
  res.excl.filter(x => x.fresh).forEach(x => keepRows.push(x));
  if (exc.getLastRow() > 1) exc.getRange(2, 1, exc.getLastRow() - 1, exc.getMaxColumns()).clear();
  if (keepRows.length) {
    exc.getRange(2, 1, keepRows.length, EXC_HEAD.length).setValues(keepRows.map(x => ['排除', x.title, x.from, x.to, x.on, x.city, x.uid, x.key]))
      .setFontFamily('Microsoft JhengHei').setFontSize(12).setNumberFormat('@');
    exc.getRange(2, 1, keepRows.length, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['排除'], true).build());
  }

  // 系統紀錄（首次發現、標記）
  const memoSh = ss.getSheetByName(SH.MEMO);
  const cutoff = iso_(addDays_(today_(), -180));
  const memoRows = Object.keys(res.memo).filter(k => k === '_init' || res.memo[k].first >= cutoff).map(k => [k, res.memo[k].first, res.memo[k].mark || '']);
  if (memoSh.getLastRow() > 1) memoSh.getRange(2, 1, memoSh.getLastRow() - 1, 3).clear();
  if (memoRows.length) memoSh.getRange(2, 1, memoRows.length, 3).setNumberFormat('@').setValues(memoRows);

  // 新聞線索：只累加新連結，保留 30 天
  const news = ss.getSheetByName(SH.NEWS);
  const old = news.getLastRow() > 1 ? news.getRange(2, 1, news.getLastRow() - 1, NEWS_HEAD.length).getValues() : [];
  const have = {};
  old.forEach(r => { have[norm_(r[1])] = r; });
  fetched.news.forEach(n => { const k = norm_(n.title); if (!have[k]) have[k] = [n.date, n.title, n.source, n.keyword, iso_(today_()), n.link]; });
  const cut30 = iso_(addDays_(today_(), -30));
  const newsRows = Object.values(have).filter(r => dval_(r[4]) >= cut30).sort((a, b) => dval_(b[0]) < dval_(a[0]) ? -1 : 1);
  if (news.getLastRow() > 1) news.getRange(2, 1, news.getLastRow() - 1, NEWS_HEAD.length).clear();
  if (newsRows.length) news.getRange(2, 1, newsRows.length, NEWS_HEAD.length).setNumberFormat('@').setValues(newsRows.map(r => r.map(dval_)))
    .setFontFamily('Microsoft JhengHei').setFontSize(12);

  // 執行紀錄
  log_(fetched.log.map(l => [l.source, l.fetched, l.kept, l.status, l.sec])
    .concat([['篩選結果', res.stats.原始, res.stats.收錄, JSON.stringify(res.stats).replace(/["{}]/g, ''), '']]));
  PropertiesService.getScriptProperties().setProperty('lastSources', JSON.stringify(fetched.log));
}

function log_(rows) {
  const sh = ss_().getSheetByName(SH.LOG);
  if (!sh) return;
  const now = fmt_(new Date(), 'yyyy/MM/dd HH:mm');
  const data = rows.map(r => [now].concat(r));
  sh.insertRowsAfter(1, data.length);
  sh.getRange(2, 1, data.length, LOG_HEAD.length).setValues(data).setFontFamily('Microsoft JhengHei').setFontSize(12);
  if (sh.getLastRow() > 500) sh.deleteRows(501, sh.getLastRow() - 500);
}

// ======================= 從試算表讀回活動（網頁與週報用） =======================
function loadEvents_() {
  const sh = ss_().getSheetByName(SH.LIST);
  if (!sh || sh.getLastRow() < 2) return [];
  const own = listOf_(getConfig_()['獨立按鈕來源']).join('、') || '獨立按鈕';
  const home = listOf_(getConfig_()['常用地區']);
  const H = {}; LIST_HEAD.forEach((h, i) => { H[h] = i; });
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, LIST_HEAD.length).getValues();
  const tierNo = {}; Object.keys(TIERS).forEach(k => { tierNo[TIERS[k]] = +k; });
  return v.filter(r => r[H['UID']]).map(r => ({
    no: +r[H['編號']], mark: r[H['標記']], view: r[H['分頁']] === '親子活動' ? 'main' : r[H['分頁']] === '市集・節慶・戶外' ? 'outing' : 'own',
    tier: tierNo[r[H['優先級']]] || 4, title: String(r[H['活動名稱']]), next: dval_(r[H['下一場']]), end: dval_(r[H['結束日']]),
    dates: fullDates_(String(r[H['全部日期']] || ''), dval_(r[H['下一場']])), city: r[H['縣市']], region: r[H['地區']],
    home: home.indexOf(r[H['縣市']]) >= 0, venue: r[H['地點']], priceLabel: r[H['費用']], ageLabel: r[H['適齡']],
    regStatus: r[H['報名狀態']], regStart: dval_(r[H['報名開始']]), regEnd: dval_(r[H['報名截止']]), org: r[H['主辦']],
    sources: String(r[H['來源']]).split('、'), weekend: r[H['本週末']] === '✓', long: r[H['長期']] === '長期',
    isNew: r[H['新增']] === 'NEW', uid: r[H['UID']], key: r[H['比對鍵']], url: r[H['連結']], start: dval_(r[H['開始日']]),
  }));
}

/** 「11/07、11/14」轉回 yyyy-MM-dd（年份依下一場推算，可跨年）。 */
function fullDates_(s, next) {
  let y = +String(next).substr(0, 4) || today_().getUTCFullYear(), pm = 0;
  return s.split('、').filter(Boolean).map(md => {
    const [m, d] = md.split('/').map(Number);
    if (m < pm) y++;
    pm = m;
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  });
}

// ======================= Email 週報 =======================
function sendDigest_() {
  const cfg = getConfig_();
  const all = loadEvents_().filter(e => e.mark !== '排除');
  if (!all.length) return '活動清單是空的，沒有寄出。請先「立即更新清單」。';
  const html = buildDigestHtml_(all, cfg);
  const wk = all.filter(e => e.home && e.view === 'main' && e.weekend).length;
  const nw = all.filter(e => e.home && e.isNew).length;
  const to = recipients_(cfg);
  const subject = '【親子活動週報】週末 ' + wk + ' 場｜新增 ' + nw + ' 筆（' + fmt_(new Date(), 'M/d') + '）';
  try {
    MailApp.sendEmail({ to: to, name: '親子活動週報', subject: subject, htmlBody: html });
    const msg = '已寄出週報給：' + to + '\n主旨：' + subject;
    PropertiesService.getScriptProperties().setProperty('lastMail', fmt_(new Date(), 'yyyy/MM/dd HH:mm') + ' → ' + to);
    log_([['寄送週報', '', '', '成功：' + to, '']]);
    return msg;
  } catch (err) {
    log_([['寄送週報', '', '', '失敗：' + err, '']]);
    return '寄信失敗：' + err;
  }
}

function md_(iso) {
  if (!iso) return '';
  const d = fromIso_(iso);
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + WD[d.getUTCDay()] + '）';
}

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function buildDigestHtml_(all, cfg) {
  const home = all.filter(e => e.home);
  const main = home.filter(e => e.view === 'main');
  const n = (k) => +cfg[k] || 10;
  const sec = [];
  const item = (e, showReg) => {
    const t = e.url ? '<a href="' + esc_(e.url) + '" style="color:#0b6e6e;text-decoration:none;font-weight:bold">' + esc_(e.title) + '</a>'
      : '<b>' + esc_(e.title) + '</b>';
    const when = e.long ? md_(e.start) + '～' + md_(e.end) : md_(e.next) + (e.dates.length > 1 ? ' 等 ' + e.dates.length + ' 天' : '');
    const tags = [e.isNew ? '<span style="color:#c2185b">NEW</span>' : '',
      showReg && e.regStart ? '<span style="color:#8e24aa">' + md_(e.regStart) + ' 開放報名</span>' : '',
      !showReg && e.regStatus === '報名中' ? '<span style="color:#8e24aa">報名中</span>' : ''].filter(Boolean).join(' ');
    return '<tr><td style="padding:6px 8px 6px 0;color:#888;vertical-align:top;white-space:nowrap">#' + e.no + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #eee">' + t + ' ' + tags +
      '<div style="color:#555;font-size:11pt">' + when + '｜' + esc_(e.city) + ' ' + esc_(String(e.venue).substr(0, 20)) +
      '｜' + esc_(String(e.priceLabel).split('（')[0]) + '｜' + esc_(e.ageLabel) + '</div></td></tr>';
  };
  const block = (title, list, showReg, more) => {
    if (!list.length) return;
    sec.push('<h2 style="font-size:14pt;margin:22px 0 6px;border-left:5px solid #0b6e6e;padding-left:8px">' + title +
      ' <span style="font-size:11pt;color:#888;font-weight:normal">' + list.length + (more ? ' / ' + more : '') + ' 筆</span></h2>' +
      '<table style="border-collapse:collapse;width:100%;font-size:12pt">' + list.map(e => item(e, showReg)).join('') + '</table>');
  };
  const wk = main.filter(e => e.weekend && !e.long);
  block('🗓 這個週末可以去', wk.slice(0, n('週報-週末活動筆數')), false, wk.length);
  const soon = home.filter(e => e.regStatus === '即將開放報名').sort((a, b) => a.regStart < b.regStart ? -1 : 1);
  block('⏰ 即將開放報名', soon.slice(0, n('週報-即將開放報名筆數')), true, soon.length);
  const nw = main.filter(e => e.isNew && !e.weekend);
  [1, 2, 3, 4].forEach(t => {
    const g = nw.filter(e => e.tier === t);
    block('🆕 本週新增・' + TIERS[t], g.slice(0, n('週報-本週新增筆數')), false, g.length);
  });
  const fair = home.filter(e => e.view === 'outing' && !e.long);
  block('🎪 市集・節慶・戶外', fair.slice(0, n('週報-市集節慶筆數')), false, fair.length);
  const ownL = home.filter(e => e.view === 'own');
  if (ownL.length) sec.push('<p style="font-size:12pt">🔬 ' + esc_(listOf_(cfg['獨立按鈕來源']).join('、')) + '：共 ' + ownL.length + ' 堂（本週末 ' +
    ownL.filter(e => e.weekend).length + ' 堂），請到網頁的獨立按鈕查看。</p>');
  const away = all.filter(e => !e.home && e.tier === 1 && !e.long && (e.priceLabel === '免費' || /未標示/.test(e.priceLabel)));
  block('🚗 外縣市精選（公家、免費）', away.slice(0, n('週報-外縣市精選筆數')), false, away.length);
  const newsSh = ss_().getSheetByName(SH.NEWS);
  if (newsSh && newsSh.getLastRow() > 1) {
    const cut = iso_(addDays_(today_(), -7));
    const ns = newsSh.getRange(2, 1, newsSh.getLastRow() - 1, NEWS_HEAD.length).getValues().filter(r => dval_(r[4]) >= cut).slice(0, 10);
    if (ns.length) sec.push('<h2 style="font-size:14pt;margin:22px 0 6px;border-left:5px solid #999;padding-left:8px">📰 新聞線索（需自行確認）</h2><ul style="font-size:11pt">' +
      ns.map(r => '<li><a href="' + esc_(r[5]) + '">' + esc_(r[1]) + '</a></li>').join('') + '</ul>');
  }
  const failed = JSON.parse(PropertiesService.getScriptProperties().getProperty('lastSources') || '[]').filter(l => String(l.status).indexOf('失敗') === 0);
  if (failed.length) sec.push('<p style="color:#b00020;font-size:11pt">⚠️ 這次抓取失敗的來源：' + failed.map(l => esc_(l.source)).join('、') + '（清單可能不完整）</p>');
  const url = cfg['網頁網址'];
  return '<div style="font-family:\'Microsoft JhengHei\',\'微軟正黑體\',\'PingFang TC\',sans-serif;font-size:12pt;color:#1f2328;max-width:720px">' +
    '<h1 style="font-size:16pt;margin:0 0 4px">親子活動週報 ' + fmt_(new Date(), 'M/d') + '</h1>' +
    '<p style="color:#555;margin:0 0 8px">常用地區（' + esc_(listOf_(cfg['常用地區']).join('、')) + '）親子活動 ' + main.length + ' 筆，這個週末 ' + wk.length + ' 場；市集節慶 ' + fair.length + ' 筆。<br>討論時請用 #編號（以這次更新為準）。</p>' +
    (url ? '<p><a href="' + esc_(url) + '" style="display:inline-block;background:#0b6e6e;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">開啟完整清單（可篩選全台）</a></p>' : '') +
    sec.join('') + '<p style="color:#999;font-size:10pt;margin-top:24px">這封信由 Google 試算表「親子活動週報」自動寄出。</p></div>';
}

// ======================= 網頁 =======================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('親子活動清單')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 網頁載入時呼叫：回傳活動、設定、已排除與新聞。 */
function getData() {
  const cfg = getConfig_();
  const events = loadEvents_().filter(e => e.mark !== '排除');
  const excl = readExcluded_().filter(x => x.status === '排除');
  const newsSh = ss_().getSheetByName(SH.NEWS);
  const news = newsSh && newsSh.getLastRow() > 1 ? newsSh.getRange(2, 1, Math.min(20, newsSh.getLastRow() - 1), NEWS_HEAD.length).getValues()
    .map(r => ({ date: dval_(r[0]), title: r[1], link: r[5] })) : [];
  return JSON.stringify({
    generated: PropertiesService.getScriptProperties().getProperty('lastUpdate') || '',
    config: { home: listOf_(cfg['常用地區']), own: listOf_(cfg['獨立按鈕來源']).join('、') || '獨立按鈕',
      days: cfg['往後看幾天'], ageLo: cfg['年齡下限'], ageHi: cfg['年齡上限'], pmax: cfg['價格上限'], plow: cfg['低價門檻'] },
    regions: REGIONS, tiers: TIERS, events: events, excluded: excl.map(x => ({ title: x.title, from: x.from, to: x.to, uid: x.uid })),
    news: news, sources: JSON.parse(PropertiesService.getScriptProperties().getProperty('lastSources') || '[]'),
  });
}

/** 網頁按鈕：設定標記（想去／已報名／排除／空白＝取消）。排除會立即寫入「已排除」。 */
function setMark(uid, mark) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(SH.LIST);
    const iU = LIST_HEAD.indexOf('UID'), iM = LIST_HEAD.indexOf('標記');
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, LIST_HEAD.length).getValues();
    const idx = v.findIndex(r => r[iU] === uid);
    if (idx < 0) throw new Error('找不到這個活動，可能清單剛更新過，請重新整理網頁。');
    const r = v[idx];
    sh.getRange(idx + 2, iM + 1).setValue(mark || '');
    const exc = ss_().getSheetByName(SH.EXC);
    if (mark === '排除') {
      exc.appendRow(['排除', r[LIST_HEAD.indexOf('活動名稱')], dval_(r[LIST_HEAD.indexOf('開始日')]), dval_(r[LIST_HEAD.indexOf('結束日')]),
        iso_(today_()), r[LIST_HEAD.indexOf('縣市')], uid, r[LIST_HEAD.indexOf('比對鍵')]]);
    } else if (exc.getLastRow() > 1) {
      // 取消排除（網頁的「復原」）
      const ev = exc.getRange(2, 7, exc.getLastRow() - 1, 1).getValues();
      for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === uid) exc.deleteRow(i + 2);
    }
    // 同步到系統紀錄，下次更新會保留
    const memo = ss_().getSheetByName(SH.MEMO);
    const mv = memo.getLastRow() > 1 ? memo.getRange(2, 1, memo.getLastRow() - 1, 1).getValues() : [];
    const mi = mv.findIndex(x => x[0] === uid);
    if (mi >= 0) memo.getRange(mi + 2, 3).setValue(mark === '排除' ? '' : mark || '');
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** 網頁「恢復」：從已排除移除，下次更新重新列入。 */
function restoreExcluded(uid) {
  const exc = ss_().getSheetByName(SH.EXC);
  if (exc.getLastRow() >= 2) {
    const ev = exc.getRange(2, 7, exc.getLastRow() - 1, 1).getValues();
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === uid) exc.getRange(i + 2, 1).setValue('');
  }
  return true;
}
