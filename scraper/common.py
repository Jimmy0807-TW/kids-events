"""共用工具：文字正規化、縣市判斷、日期／價格／年齡解析、網路抓取。"""
import datetime as dt
import os
import re
import ssl
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

import certifi
import requests

TZ = dt.timezone(dt.timedelta(hours=8))
TODAY = dt.datetime.now(TZ).date()

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
class _Adapter(requests.adapters.HTTPAdapter):
    """照常驗證憑證，但關掉 Python 3.13 新增的嚴格格式檢查（部分政府網站憑證會被擋）。"""

    @staticmethod
    def _ctx():
        ctx = ssl.create_default_context(cafile=os.environ.get("REQUESTS_CA_BUNDLE") or certifi.where())
        ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
        return ctx

    def init_poolmanager(self, *a, **kw):
        kw["ssl_context"] = self._ctx()
        return super().init_poolmanager(*a, **kw)

    def proxy_manager_for(self, proxy, **kw):
        kw["ssl_context"] = self._ctx()
        return super().proxy_manager_for(proxy, **kw)


_session = requests.Session()
_session.mount("https://", _Adapter())
_session.headers.update({"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"})


def fetch(url, *, as_json=False, binary=False, retries=2, timeout=30):
    """抓取網址；失敗會重試，最後仍失敗就丟出例外。"""
    last = None
    for i in range(retries + 1):
        try:
            r = _session.get(url, timeout=timeout)
            r.raise_for_status()
            if binary:
                return r.content
            if as_json:
                return r.json()
            r.encoding = r.apparent_encoding if r.encoding in (None, "ISO-8859-1") else r.encoding
            return r.text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


def fetch_many(urls, workers=8, **kw):
    """平行抓多個網址，回傳 {url: 內容或 None}。"""
    def one(u):
        try:
            return u, fetch(u, **kw)
        except Exception:  # noqa: BLE001
            return u, None
    with ThreadPoolExecutor(workers) as ex:
        return dict(ex.map(one, urls))


# ---------- 文字 ----------

def norm(s):
    """全形轉半形、台→臺、去頭尾空白。"""
    s = unicodedata.normalize("NFKC", s or "")
    return s.replace("台", "臺").strip()


def title_key(title):
    """比對用的名稱鍵：去標點、去空白、去「第N場」與場次時間尾巴。"""
    s = norm(title).lower()
    s = re.sub(r"[-－–—:：]\s*\d{1,2}月\s*\d{1,2}日.*$", "", s)
    s = re.sub(r"\d{1,2}月\s*\d{1,2}日\s*\d{1,2}:\d{2}.*$", "", s)
    s = re.sub(r"(?<![a-z])[a-z]{2,4}\d{6}(?!\d)", "", s)
    s = re.sub(r"[（(]?第[一二三四五六七八九十\d]+[場梯期堂][)）]?", "", s)
    return re.sub(r"[\W_]+", "", s)


def clean_text(s):
    s = re.sub(r"[ \t　\xa0]+", " ", s or "")
    return re.sub(r"\n\s*\n+", "\n", s).strip()


# ---------- 縣市 ----------

REGIONS = {
    "北部": ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"],
    "中部": ["苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣"],
    "南部": ["嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣"],
    "東部": ["花蓮縣", "臺東縣"],
    "離島": ["澎湖縣", "金門縣", "連江縣"],
}
CITY_REGION = {c: r for r, cs in REGIONS.items() for c in cs}
ALL_CITIES = list(CITY_REGION)

EN_CITY = {
    "taipei city": "臺北市", "new taipei city": "新北市", "keelung city": "基隆市",
    "taoyuan city": "桃園市", "hsinchu city": "新竹市", "hsinchu county": "新竹縣",
    "yilan county": "宜蘭縣", "miaoli county": "苗栗縣", "taichung city": "臺中市",
    "changhua county": "彰化縣", "nantou county": "南投縣", "yunlin county": "雲林縣",
    "chiayi city": "嘉義市", "chiayi county": "嘉義縣", "tainan city": "臺南市",
    "kaohsiung city": "高雄市", "pingtung county": "屏東縣", "hualien county": "花蓮縣",
    "taitung county": "臺東縣", "penghu county": "澎湖縣", "kinmen county": "金門縣",
    "lienchiang county": "連江縣",
}
TAIPEI_DISTRICTS = ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區",
                    "士林區", "北投區", "內湖區", "南港區", "文山區"]
SHORT_CITY = [("北市", "臺北市"), ("新北", "新北市"), ("桃市", "桃園市"), ("中市", "臺中市"),
              ("高市", "高雄市"), ("南市", "臺南市")]


def detect_city(text, head=20):
    """從地址判斷縣市。先看開頭，再看整段；判斷不出來回傳 None。"""
    s = norm(text)
    if not s:
        return None
    low = s.lower()
    for en, zh in EN_CITY.items():
        if en in low:
            return zh
    for part in (s[:head], s):
        hits = [(part.find(c), c) for c in ALL_CITIES if c in part]
        if hits:
            return min(hits)[1]
    for d in TAIPEI_DISTRICTS:
        if d in s[:head]:
            return "臺北市"
    for short, full in SHORT_CITY:
        if s.startswith(short):
            return full
    return None


# ---------- 日期 ----------

CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7, "七": 7}
REG_WORDS = r"報名|登記|錄取|公告|截止|抽籤|備取|候補|額滿|名單|發布|發佈|更新"
CLOSED_WORDS = r"暫停|休館|停止|取消"


def _mk(y, m, d):
    try:
        return dt.date(y, m, d)
    except ValueError:
        return None


def _dates_in(s, ref=None):
    """抓出一段文字內所有日期（依出現順序）。"""
    s = norm(s)
    found = []  # (位置, date 或 (月,日))
    used = []

    def take(m):
        if any(a <= m.start() < b for a, b in used):
            return False
        used.append(m.span())
        return True

    for m in re.finditer(r"(20\d{2})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})", s):
        if take(m):
            found.append((m.start(), _mk(int(m.group(1)), int(m.group(2)), int(m.group(3)))))
    for m in re.finditer(r"(?<!\d)(1[01]\d)\s*[/.年]\s*(\d{1,2})\s*[/.月]\s*(\d{1,2})", s):
        if take(m):
            found.append((m.start(), _mk(int(m.group(1)) + 1911, int(m.group(2)), int(m.group(3)))))
    for m in re.finditer(r"(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日號]?", s):
        if take(m):
            found.append((m.start(), (int(m.group(1)), int(m.group(2)))))
    for m in re.finditer(r"(?<![\d/.])(\d{1,2})/(\d{1,2})(?![\d/:])", s):
        if take(m):
            found.append((m.start(), (int(m.group(1)), int(m.group(2)))))
    # 「11月每週三」這類固定場次：展開成該月所有星期三
    for m in re.finditer(r"(\d{1,2})\s*月\s*(?:份)?\s*(?:的)?每(?:週|周|星期)([一二三四五六日天])", s):
        if take(m):
            mon, wd = int(m.group(1)), CN_NUM[m.group(2)] - 1
            y = (ref or TODAY).year
            if mon < (ref or TODAY).month - 6:
                y += 1
            d = _mk(y, mon, 1)
            while d and d.month == mon:
                if d.weekday() == wd:
                    found.append((m.start() + d.day / 100, d))
                d += dt.timedelta(days=1)

    found.sort(key=lambda x: x[0])
    out, prev = [], None
    for _, v in found:
        if v is None:
            continue
        if isinstance(v, tuple):
            mon, day = v
            if not (1 <= mon <= 12 and 1 <= day <= 31):
                continue
            base = prev or ref or TODAY
            d = _mk(base.year, mon, day)
            if d is None:
                continue
            if prev is None and d < (ref or TODAY) - dt.timedelta(days=180):
                d = _mk(d.year + 1, mon, day)
            elif prev is not None and d < prev - dt.timedelta(days=60):
                d = _mk(d.year + 1, mon, day)
            v = d
        if v:
            out.append(v)
            prev = v
    return out


def split_registration(text):
    """把文字拆成（活動內容, 報名相關行）。報名、公告、截止等行的日期不算活動日期。"""
    keep, reg = [], []
    for line in re.split(r"[\n。；;]", norm(text)):
        if re.search(REG_WORDS, line):
            reg.append(line)
        elif re.search(CLOSED_WORDS, line):
            continue
        else:
            keep.append(line)
    return "\n".join(keep), "\n".join(reg)


def parse_dates(text, ref=None):
    body, _ = split_registration(text)
    return _dates_in(body, ref)


def parse_registration(text, ref=None):
    """回傳 (報名開始, 報名截止)；找不到為 None。"""
    _, reg = split_registration(text)
    start = end = None
    for line in reg.split("\n"):
        if not re.search(r"報名|登記", line) or re.search(r"錄取|公告|名單", line):
            continue
        ds = _dates_in(line, ref)
        if not ds:
            continue
        if re.search(r"截止|前|為止", line) and len(ds) == 1:
            end = end or ds[0]
        elif re.search(r"開放|開始|起", line) and len(ds) == 1:
            start = start or ds[0]
        else:
            start = start or ds[0]
            if len(ds) > 1:
                end = end or ds[-1]
    return start, end


# ---------- 價格 ----------

FREE_RE = r"免費|免票|自由入場|自由參觀|免報名費|不收費|無須付費|免付費|免門票"
PRICE_LABEL = r"費用|票價|報名費|材料費|收費|價格|入場費|參加費|學費|課程費|售價"


def _amounts(s):
    out = []
    for m in re.finditer(r"(?:NT\$|NTD|\$)\s*([\d,]{1,7})|([\d,]{1,7})\s*(?:元|圓)", s, re.I):
        v = int((m.group(1) or m.group(2)).replace(",", "") or 0)
        if 0 < v < 100000:
            out.append(v)
    if re.search(r"1,?000\s*(?:元)?\s*(?:↑|以上)", s):
        out.append(1001)
    return out


def parse_price(text):
    """回傳最低票價（0 = 免費）；判斷不出來回傳 None。"""
    s = norm(text)
    segs = [s[m.end():m.end() + 80] for m in re.finditer(PRICE_LABEL, s)]
    for seg in segs:
        a = _amounts(seg)
        free = re.search(FREE_RE, seg)
        if free and (not a or free.start() < 15):
            return 0
        if a:
            return min(a)
    if re.search(FREE_RE, s):
        return 0
    a = [int(x.replace(",", "")) for x in re.findall(r"(?:NT\$|每人)\s*([\d,]{2,6})", s, re.I)]
    return min(a) if a else None


# ---------- 年齡 ----------

CN_DIGIT = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
            "十": 10, "十一": 11, "十二": 12}
AGE_LABEL = r"對象|年齡|適合|適齡|參加資格|參加者|招生|限定|參與對象|活動對象"


def _num(x):
    return int(x) if x.isdigit() else CN_DIGIT.get(x)


def _age_ranges(s):
    specific, generic = [], []
    N = r"(\d{1,2}|十[一二]?|[一二三四五六七八九])"
    for m in re.finditer(N + r"\s*(?:歲)?\s*[至~～\-－到、]\s*" + N + r"\s*歲", s):
        a, b = _num(m.group(1)), _num(m.group(2))
        if a is not None and b is not None and a <= b:
            specific.append((a, b))
    for m in re.finditer(N + r"\s*歲\s*(?:\(含\)|（含）)?\s*以上", s):
        specific.append((_num(m.group(1)), 99))
    for m in re.finditer(N + r"\s*歲\s*(?:\(含\)|（含）)?\s*(?:以下|以內)", s):
        specific.append((0, _num(m.group(1))))
    for m in re.finditer(r"(?:國小|小學)?\s*([一二三四五六1-6])\s*[至~～\-－到、]\s*([一二三四五六1-6])\s*年級", s):
        a, b = _num(m.group(1)), _num(m.group(2))
        if a and b and a <= b:
            specific.append((a + 5, b + 6))
    for word, rng in (("低年級", (6, 8)), ("中年級", (8, 10)), ("高年級", (10, 12)),
                      ("小一", (6, 7)), ("大班", (5, 6))):
        if word in s:
            specific.append(rng)
    for word, rng in (("國小", (6, 12)), ("小學", (6, 12)), ("學童", (6, 12)),
                      ("幼兒園", (3, 6)), ("幼稚園", (3, 6)), ("學齡前", (3, 6)),
                      ("嬰幼兒", (0, 3)), ("寶寶", (0, 3)), ("國中", (12, 15)),
                      ("高中", (15, 18)), ("成人", (18, 99)),
                      ("全齡", (0, 99)), ("不限", (0, 99)), ("一般民眾", (0, 99))):
        if word in s:
            generic.append(rng)
    return [r for r in specific if r[0] is not None] or generic


def parse_age(text):
    """回傳 (最小, 最大) 或 None。先找「對象／年齡」標籤後的文字，找不到再看全文。"""
    s = norm(text)
    for m in re.finditer(AGE_LABEL, s):
        r = _age_ranges(s[m.end():m.end() + 60])
        if r:
            return min(a for a, _ in r), max(b for _, b in r)
    r = _age_ranges(s)
    if r:
        return min(a for a, _ in r), max(b for _, b in r)
    return None


def age_label(age):
    if not age:
        return "未標示"
    a, b = age
    if a <= 3 and b >= 99:
        return "全齡"
    if b >= 99:
        return f"{a}歲以上"
    if a == 0:
        return f"{b}歲以下"
    return f"{a}～{b}歲"


def field(text, labels, length=100):
    """取「標籤」後面的一段文字，例如 field(t, '活動地點')；遇到下一個標籤就停。"""
    s = norm(text)
    m = re.search(r"[【\[]?(?:" + labels + r")[】\]]?\s*[:：|｜]?\s*", s)
    if not m:
        return ""
    seg = re.sub(r"\s+", " ", s[m.end():m.end() + length])
    stop = re.search(r"[【\[]|[一二三四五六七八九十]+、|(?<!\d)\d+[.、](?!\d)|"
                     r"(?:活動|報名|聯絡|洽詢|參加|參與)?(?:時間|日期|地點|電話|對象|費用|方式|講師|名額|說明|內容|網址)\s*[:：|｜]",
                     seg[1:])
    if stop:
        seg = seg[:stop.start() + 1]
    return seg.strip(" :：")
