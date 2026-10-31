"""各資料來源。每個來源函式回傳「原始活動」清單，欄位見 make_event()。

新增來源的方法：寫一個函式回傳 make_event(...) 清單，再登記到檔案最下方的 SOURCES。
"""
import datetime as dt
import html
import io
import json
import re
import zipfile
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup

from common import (TZ, clean_text, detect_city, fetch, fetch_many, field, norm,
                    parse_age, parse_dates, parse_price, parse_registration)

GOV_RE = (r"政府|公所|國立|市立|縣立|文化部|教育部|交通部|農業部|環境部|內政部|衛生福利部|"
          r"文化局|教育局|觀光署|觀光局|文化中心|圖書館|藝文中心|國家兩廳院|國家表演藝術中心|"
          r"林業及自然保育署|國家公園|博物館|美術館|科學教育館|動物園|天文")


def make_event(source, uid, title, url, *, sessions, org="", gov=False, price=None,
               age=None, reg=(None, None), text="", kid_required=True, venue="", city=None):
    """sessions: [(開始日期, 結束日期, 縣市, 地點)]"""
    return {
        "source": source, "uid": f"{source}:{uid}", "title": norm(title).strip(), "url": url,
        "org": norm(org), "gov": gov, "price": price, "age": age,
        "reg_start": reg[0], "reg_end": reg[1],
        "sessions": [{"start": s, "end": e or s, "city": c or city, "venue": norm(v or venue)}
                     for s, e, c, v in sessions if s],
        "text": clean_text(text)[:1500], "kid_required": kid_required,
    }


def _text(h):
    return BeautifulSoup(h or "", "lxml").get_text("\n")


# ---------------- 1. 文化部藝文活動（全國） ----------------
MOC_CATS = {"4": "親子", "19": "研習", "2": "戲劇", "3": "舞蹈", "1": "音樂", "6": "展覽", "7": "講座"}


def src_moc():
    out = []
    for code in MOC_CATS:
        data = fetch("https://cloud.culture.tw/frontsite/trans/SearchShowAction.do"
                     f"?method=doFindTypeJ&category={code}", as_json=True)
        for e in data:
            infos = e.get("showInfo") or []
            sessions = []
            for s in infos:
                st = _moc_date(s.get("time"))
                en = _moc_date(s.get("endTime"))
                city = detect_city(s.get("location")) or detect_city(s.get("locationName"))
                sessions.append((st, en, city, s.get("locationName") or s.get("location")))
            if not sessions:
                sessions = [(_moc_date(e.get("startDate")), _moc_date(e.get("endDate")), None, "")]
            prices = " ".join(s.get("price") or "" for s in infos)
            text = " ".join([e.get("title", ""), prices, e.get("comment") or "",
                             e.get("discountInfo") or "", _text(e.get("descriptionFilterHtml"))])
            org = "、".join(e.get("masterUnit") or []) or e.get("sourceWebName") or ""
            url = e.get("sourceWebPromote") or e.get("webSales") or ""
            out.append(make_event(
                "文化部", e["UID"], e.get("title", ""), url, sessions=sessions, org=org,
                gov=bool(re.search(GOV_RE, org)), price=parse_price(text), age=parse_age(text),
                reg=parse_registration(text), text=text, kid_required=(code != "4")))
    return out


def _moc_date(s):
    m = re.match(r"(\d{4})/(\d{1,2})/(\d{1,2})", s or "")
    return dt.date(*map(int, m.groups())) if m else None


# ---------------- 2. 交通部觀光署 活動資料庫（全國） ----------------

def src_tourism():
    raw = fetch("https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Event-json.zip",
                binary=True, timeout=90)
    z = zipfile.ZipFile(io.BytesIO(raw))
    name = next(n for n in z.namelist() if n.lower().endswith(".json"))
    data = json.loads(z.read(name).decode("utf-8-sig"))
    items = _find_list(data, "EventName")
    out = []
    for e in items:
        addr = e.get("PostalAddress") or {}
        city = norm(addr.get("City")) or detect_city(json.dumps(addr, ensure_ascii=False))
        st, en = _iso_local(e.get("StartDateTime")), _iso_local(e.get("EndDateTime"))
        fee = e.get("FeeInfo") or ""
        text = " ".join([e.get("EventName", ""), e.get("Description") or "", fee])
        price = 0 if e.get("IsAccessibleForFree") in (True, "true", 1, "1") else parse_price(fee or text)
        orgs = e.get("Organizations") or []
        org = "、".join(o.get("Name", "") for o in orgs if isinstance(o, dict)) if isinstance(orgs, list) else str(orgs)
        url = e.get("WebsiteURL") or ""  # 觀光署沒有活動詳細頁，沒附網址就不放連結
        venue = " ".join(filter(None, [addr.get("Town"), addr.get("StreetAddress")]))
        out.append(make_event(
            "觀光署", e.get("EventID"), e.get("EventName", ""), url,
            sessions=[(st, en, city, venue)], org=org or "交通部觀光署", gov=True, price=price,
            age=parse_age(text), text=text, kid_required=True))
    return out


def _find_list(o, key):
    if isinstance(o, list) and o and isinstance(o[0], dict) and key in o[0]:
        return o
    if isinstance(o, dict):
        for v in o.values():
            r = _find_list(v, key)
            if r:
                return r
    return []


def _iso_local(s):
    """觀光署時間寫成 +08:00 但其實是 UTC，例如 2026-07-17T16:00:00 = 7/18 00:00。"""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", s or "")
    if not m:
        return None
    t = dt.datetime(*map(int, m.groups())) + dt.timedelta(hours=8)
    return t.date()


# ---------------- 3. 臺北市立圖書館 兒童活動 ----------------

def src_tpml():
    x = fetch("https://tpml.gov.taipei/OpenData.aspx?SN=8770FE105FF71B93")
    soup = BeautifulSoup(x.lstrip("﻿"), "xml")
    out = []
    for it in soup.find_all("item"):
        title = it.title.text
        text = clean_text(_text(it.description.text))
        when = field(text, "活動時間|活動日期|時間", 160) or text
        place = field(text, "活動地點|地點", 60)
        dates = parse_dates(when) or parse_dates(text)
        sessions = [(d, d, detect_city(place) or "臺北市", place) for d in dates]
        age = parse_age(field(text, "活動對象|對象|參加對象", 80) or text)
        out.append(make_event(
            "北市圖", re.sub(r".*s=", "", it.link.text), title, it.link.text, sessions=sessions,
            org="臺北市立圖書館", gov=True, price=parse_price(text) or 0, age=age,
            reg=parse_registration(text), text=text, kid_required=False))
    return out


# ---------------- 4. 新北市立圖書館 活動資訊 ----------------
NTPC = "https://www.library.ntpc.gov.tw"


def src_ntpclib(pages=3):
    links = {}
    for p in range(1, pages + 1):
        x = fetch(f"{NTPC}/multiplehtml/ActvInfo?categoryCode=008&pageNum={p}")
        for href, title in re.findall(
                r"""href=['"](/singlehtml/ActvInfo\?cntId=[0-9a-f]+)['"][^>]*title=['"]([^'"]+)['"]""", x):
            if not re.search(r"嬰幼兒|寶寶|0-3歲|0～3歲", title):
                links[NTPC + href] = html.unescape(title)
    pages_ = fetch_many(list(links))
    out = []
    for url, x in pages_.items():
        if not x:
            continue
        i = x.find("article-page paging-content")
        j = x.find("發布單位", i)
        text = clean_text(_text(x[i:j] if i > 0 else x))
        title = links[url]
        place = field(text, "活動地點|地點", 60)
        when = field(text, "活動時間|活動日期|時間", 300) or text
        dates = parse_dates(when) or parse_dates(text)
        unit = re.match(r"【([^】]+)】", title)
        out.append(make_event(
            "新北圖", url.rsplit("=", 1)[-1], title, url,
            sessions=[(d, d, detect_city(place) or "新北市",
                       place if len(place) >= 4 and not re.match(r"內容|說明", place)
                       else (unit.group(1) if unit else "")) for d in dates],
            org="新北市立圖書館", gov=True, price=parse_price(text) or 0,
            age=parse_age(field(text, "參與對象|活動對象|對象", 80) or text),
            reg=parse_registration(text), text=text, kid_required=False))
    return out


# ---------------- 5. 國立臺灣科學教育館 ----------------
NTSEC = "https://estore.ntsec.gov.tw/"


def src_ntsec():
    cards = {}
    for t in (1, 4):
        soup = BeautifulSoup(fetch(f"{NTSEC}classes.aspx?TYPE2={t}"), "lxml")
        for li in soup.find_all("li"):
            a = li.find("a", href=re.compile(r"classDetail\.aspx\?CLASS_NUM="))
            txt = clean_text(li.get_text("\n"))
            if not a or "課程日期" not in txt or len(txt) > 1500:
                continue
            num = re.search(r"CLASS_NUM=(\w+)", a["href"]).group(1)
            cards[num] = txt
    details = fetch_many([f"{NTSEC}classDetail.aspx?CLASS_NUM={n}" for n in cards])
    out = []
    for num, txt in cards.items():
        if "報名中" not in txt:
            continue
        lines = [l.strip() for l in txt.split("\n") if l.strip()]
        title = next((l for l in lines if len(l) > 8 and not re.search(r"報名中|收藏|^課程", l)), "")
        if re.search(r"國中|高中|教師|成人|友善學生卡|大專", title):
            continue
        rng = re.search(r"課程日期\s*(\d{4}/\d{1,2}/\d{1,2})\s*~\s*(\d{4}/\d{1,2}/\d{1,2})", txt)
        st, en = (parse_dates(rng.group(1))[0], parse_dates(rng.group(2))[0]) if rng else (None, None)
        price = re.search(r"一般會員\s*NT\s*\$\s*([\d,]+)", txt)
        url = f"{NTSEC}classDetail.aspx?CLASS_NUM={num}"
        dtext = clean_text(_text(details.get(url) or ""))
        body = field(dtext, "課程內容|課程介紹|課程說明", 600)
        age = parse_age(title) or parse_age(field(dtext, "適合對象|課程對象|對象", 40) + " " + body)
        reg_d = re.search(r"報名日期時間\s*(\d{4}/\d{1,2}/\d{1,2})", dtext)
        out.append(make_event(
            "科教館", num, title, url, sessions=[(st, en, "臺北市", "國立臺灣科學教育館")],
            org="國立臺灣科學教育館", gov=True,
            price=int(price.group(1).replace(",", "")) if price else parse_price(txt), age=age,
            reg=(parse_dates(reg_d.group(1))[0] if reg_d else None, None),
            text=title + "\n" + body, kid_required=False))
    return out


# ---------------- 6. 桃園市民卡 桃園活動 ----------------
TYPASS = "https://typass.tycg.gov.tw"


def src_typass():
    x = fetch(f"{TYPASS}/activity/index")
    links = {}
    for href, inner in re.findall(r"""href=['"]([^'"]*activity/view\?uuid=[\w-]+)['"][^>]*>(.*?)</a>""", x, re.S):
        t = clean_text(_text(inner))
        if t:
            links[urljoin(TYPASS, html.unescape(href))] = t.split("\n")[0]
    out = []
    for url, x in fetch_many(list(links)).items():
        if not x:
            continue
        text = clean_text(_text(x))
        when = field(text, "活動日期|活動時間", 120)
        place = field(text, "活動地點|地點", 60)
        out.append(make_event(
            "桃園市民卡", url.rsplit("=", 1)[-1], links[url], url,
            sessions=[(d, d, detect_city(place) or "桃園市", place) for d in parse_dates(when)],
            org="桃園市政府", gov=True, price=parse_price(text), age=parse_age(text),
            reg=parse_registration(text), text=links[url] + "\n" + when, kid_required=True))
    return out


# ---------------- 7. ACCUPASS 活動通 ----------------

def src_accupass():
    out = {}
    for q in ("免費親子活動", "兒童 免費 活動", "親子 活動", "市集", "親子市集", "免費 戶外 表演", "嘉年華"):
        x = fetch(f"https://www.accupass.com/search?q={quote(q)}")
        x = x.replace('\\"', '"')
        for m in re.finditer(r'\{"eventIdNumber":"(\d+)".*?"utm":[^}]*?\}', x):
            try:
                e = json.loads(m.group(0))
            except ValueError:
                continue
            tags = " ".join(t.get("name", "") for t in e.get("tags") or [])
            name = e.get("name", "")
            st = _utc_local(e.get("startDateTime"))
            en = _utc_local(e.get("endDateTime"))
            city = detect_city(e.get("location") or "")
            free = re.search(r"免費", name + tags)
            out[e["eventIdNumber"]] = make_event(
                "ACCUPASS", e["eventIdNumber"], name,
                f"https://www.accupass.com/event/{e['eventIdNumber']}",
                sessions=[(st, en, city, "")], org="", gov=False, price=0 if free else None,
                age=parse_age(name + " " + tags), text=name + " " + tags, kid_required=True)
    return list(out.values())


def _utc_local(s):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", s or "")
    if not m:
        return None
    return (dt.datetime(*map(int, m.groups())) + dt.timedelta(hours=8)).date()


# ---------------- 8. 市集・展演場地 ----------------
# 場地活動不限兒童：名稱含兒童關鍵字歸「親子活動」，市集類歸「市集・節慶・戶外」，其餘不收。

def _roc_range(t):
    m = re.search(r"(1\d\d)-(\d\d)-(\d\d)\s*~\s*(1\d\d)-(\d\d)-(\d\d)", t)
    if not m:
        return None, None
    a = list(map(int, m.groups()))
    return dt.date(a[0] + 1911, a[1], a[2]), dt.date(a[3] + 1911, a[4], a[5])


def src_expopark():
    """臺北花博公園：首頁活動卡片含入場方式（自由／售票／索票）與分類（市集活動／展覽活動）。"""
    base = "https://www.expopark.taipei/"
    soup = BeautifulSoup(fetch(base), "lxml")
    out, seen = [], set()
    for a in soup.find_all("a", href=re.compile(r"News_Photo_Content")):
        t = clean_text(a.get_text(" ", strip=True))
        st, en = _roc_range(t)
        if not st or a["href"] in seen:
            continue
        seen.add(a["href"])
        m = re.match(r"((?:(?:自由|售票|索票|邀請)入場\s*)+)(.*?)\s*(市集活動|展覽活動|藝文活動|運動活動|其他活動)", t)
        if not m:
            continue
        entry, title, cat = m.group(1), m.group(2).strip(), m.group(3)
        venue = re.search(r"爭艷館|流行館|長廊廣場|環形廣場|花海廣場|爭艷廣場|入口廣場|舞蝶館|美術公園", t[m.end():m.end() + 160])
        price = None if "售票" in entry else 0
        uid = re.search(r"[?&]s=(\d+)", a["href"])
        e = make_event(
            "花博公園", uid.group(1) if uid else a["href"], title, urljoin(base, a["href"]),
            sessions=[(st, en, "臺北市", "花博公園 " + (venue.group(0) if venue else ""))],
            org="臺北市會展產業發展基金會", gov=False, price=price, text=t[:300], kid_required=True)
        e["outing_hint"] = cat in ("市集活動", "藝文活動") and price == 0
        out.append(e)
    return out


def src_huashan(pages=4):
    """華山 1914 文化創意產業園區：展演列表卡片（日期、名稱、館別）。"""
    base = "https://www.huashan1914.com"
    out = {}
    for p in range(1, pages + 1):
        soup = BeautifulSoup(fetch(f"{base}/exhibition" + (f"?page={p}" if p > 1 else "")), "lxml")
        for a in soup.find_all("a", class_="exhi-card__link"):
            tm, h3 = a.find("time"), a.find("h3")
            if not tm or not h3:
                continue
            ds = re.findall(r"(20\d\d)\.(\d\d)\.(\d\d)", tm.get_text())
            if not ds:
                continue
            st = dt.date(*map(int, ds[0]))
            en = dt.date(*map(int, ds[-1]))
            venue = a.find(class_="exhi-card__content-venue")
            title = clean_text(h3.get_text(" "))
            out[a["href"]] = make_event(
                "華山1914", a["href"].rsplit("/", 1)[-1], title, base + quote(a["href"]),
                sessions=[(st, en, "臺北市", "華山1914 " + (clean_text(venue.get_text(" ")) if venue else ""))],
                org="華山1914文化創意產業園區", text=title, kid_required=True)
    return list(out.values())


def src_songshan():
    """松山文創園區：展演資訊列表。"""
    base = "https://www.songshanculturalpark.org"
    soup = BeautifulSoup(fetch(f"{base}/exhibition"), "lxml")
    out = {}
    for a in soup.find_all("a", href=re.compile(r"/exhibition/activity/")):
        t, d = a.find(class_="title"), a.find(class_="date")
        if not t or not d:
            continue
        ds = re.findall(r"(20\d\d)-(\d\d)-(\d\d)", d.get_text())
        title = clean_text(t.get_text(" "))
        if not ds or re.search(r"展演攻略", title):
            continue
        out[a["href"]] = make_event(
            "松山文創園區", a["href"].rsplit("/", 1)[-1], title, base + a["href"],
            sessions=[(dt.date(*map(int, ds[0])), dt.date(*map(int, ds[-1])), "臺北市", "松山文創園區")],
            org="松山文創園區", text=title, kid_required=True)
    return list(out.values())


# ---------------- 新聞線索 ----------------
NEWS_KEYWORDS = ["親子活動 免費", "兒童 活動 報名", "寒假 兒童 營隊", "親子 週末 活動"]


def fetch_news():
    out = []
    for kw in NEWS_KEYWORDS:
        x = fetch(f"https://news.google.com/rss/search?q={quote(kw + ' when:7d')}"
                  "&hl=zh-TW&gl=TW&ceid=TW:zh-Hant")
        for it in BeautifulSoup(x, "xml").find_all("item"):
            src = it.find("source")
            pub = it.pubDate.text if it.pubDate else ""
            try:
                pd = dt.datetime.strptime(pub[5:25], "%d %b %Y %H:%M:%S").replace(
                    tzinfo=dt.timezone.utc).astimezone(TZ).date().isoformat()
            except ValueError:
                pd = ""
            out.append({"title": it.title.text, "link": it.link.text,
                        "source": src.text if src else "", "date": pd, "keyword": kw})
    return out


# 名稱 → (函式, 設定檔裡的開關名稱)
SOURCES = {
    "文化部": src_moc,
    "觀光署": src_tourism,
    "北市圖": src_tpml,
    "新北圖": src_ntpclib,
    "科教館": src_ntsec,
    "桃園市民卡": src_typass,
    "ACCUPASS": src_accupass,
    "花博公園": src_expopark,
    "華山1914": src_huashan,
    "松山文創園區": src_songshan,
}
