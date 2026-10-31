"""主程式。

python scraper/build.py           抓全部來源 → 篩選 → 產生 data/events.json
python scraper/build.py --no-fetch 不重抓，用 data/raw.json 重新篩選（排除活動後用）
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from common import (CITY_REGION, REGIONS, TODAY, TZ, age_label, norm, field,  # noqa: E402
                    title_key)
from sources import SOURCES, fetch_news  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

EXCLUDE_WORDS = ["樂齡", "銀髮", "長者", "成人限定", "親職講座", "招募", "志工", "徵件", "徵選",
                 "說明會", "得獎名單", "得獎", "抽獎", "恭喜", "師資", "認證", "單身", "聯誼",
                 "研討會", "教師研習", "公務人員", "錄取名單", "徵才", "求職", "職涯", "退休",
                 "孕婦", "孕期", "新手爸媽", "嬰兒", "寶寶", "喜劇", "脫口秀", "單口", "酒", "青少年",
                 "對談", "論壇", "座談", "大人必修", "家長講座", "教養講座", "樂團招生",
                 "過敏", "長高", "扁平足", "才藝老師", "教學者", "先修班", "直播", "一對一", "藝術鑑賞"]
KID_RE = (r"親子|兒童|孩子|小朋友|小孩|童話|童趣|童玩|國小|小學|學童|繪本|說故事|故事屋|故事時間|"
          r"營隊|親子共學|小一|全家|闔家|小小|kids?|兒童劇|偶戲|家庭日")
TIERS = {1: "① 公家機關", 2: "② 500 元以下", 3: "③ 500～1,000 元", 4: "④ 價格未標示"}


def load_json(name, default):
    p = DATA / name
    return json.loads(p.read_text("utf-8")) if p.exists() else default


def save_json(name, obj):
    DATA.mkdir(exist_ok=True)
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=str), "utf-8")


def load_config():
    cfg = yaml.safe_load((ROOT / "config.yml").read_text("utf-8")) or {}
    cfg.setdefault("年齡下限", 6)
    cfg.setdefault("年齡上限", 8)
    cfg.setdefault("價格上限", 1000)
    cfg.setdefault("低價門檻", 500)
    cfg.setdefault("往後看幾天", 60)
    cfg.setdefault("長期展覽天數", 45)
    cfg.setdefault("常用地區", ["臺北市", "新北市", "基隆市", "桃園市"])
    cfg["常用地區"] = [norm(c) for c in cfg["常用地區"]]
    cfg.setdefault("額外排除關鍵字", [])
    cfg.setdefault("來源", {})
    return cfg


def is_kid(e):
    """非親子專屬的來源，名稱或「對象」欄需含兒童關鍵字。"""
    return not e["kid_required"] or bool(
        re.search(KID_RE, e["title"], re.I) or re.search(KID_RE, field(e["text"], "對象|適合|適齡", 40)))


def is_on(v):
    return str(v).strip() in ("開", "on", "True", "true", "1", "是")


# ---------------- 抓取 ----------------

def fetch_all(cfg):
    raw, log = [], []
    horizon = TODAY + dt.timedelta(days=int(cfg["往後看幾天"]))
    for name, fn in SOURCES.items():
        if not is_on(cfg["來源"].get(name, "開")):
            log.append({"source": name, "status": "關閉", "fetched": 0, "kept": 0})
            continue
        t0 = time.time()
        try:
            items = fn()
            kept = 0
            for e in items:
                # 只留還沒結束、在期間內、判斷得出縣市的場次
                e["sessions"] = [s for s in e["sessions"]
                                 if s["end"] >= TODAY and s["start"] <= horizon and s["city"]]
                if e["sessions"] and is_kid(e):
                    e["text"] = e["text"][:500]
                    raw.append(e)
                    kept += 1
            log.append({"source": name, "status": "成功", "fetched": len(items), "kept": kept,
                        "seconds": round(time.time() - t0, 1)})
        except Exception as ex:  # noqa: BLE001
            log.append({"source": name, "status": f"失敗：{type(ex).__name__} {str(ex)[:120]}",
                        "fetched": 0, "kept": 0, "seconds": round(time.time() - t0, 1)})
        print(log[-1], flush=True)
    news = []
    if is_on(cfg["來源"].get("新聞線索", "開")):
        try:
            news = fetch_news()
            log.append({"source": "新聞線索", "status": "成功", "fetched": len(news), "kept": len(news)})
        except Exception as ex:  # noqa: BLE001
            log.append({"source": "新聞線索", "status": f"失敗：{ex}", "fetched": 0, "kept": 0})
    return raw, log, news


# ---------------- 篩選與整理 ----------------

def excluded_match(ev, exc):
    key = ev["key"]
    if ev["uid"] in exc["uids"] or key in exc["keys"]:
        return True
    t = title_key(ev["title"])
    return any(p and p in t for p in exc["series"])


def load_exclusions():
    ex = load_json("excluded.json", {"items": [], "series": []})
    return ex, {
        "uids": {i.get("uid") for i in ex["items"]},
        "keys": {i.get("key") for i in ex["items"]},
        "series": [title_key(s["pattern"]) for s in ex["series"]],
    }


def process(raw, cfg):
    lo, hi = int(cfg["年齡下限"]), int(cfg["年齡上限"])
    pmax, plow = int(cfg["價格上限"]), int(cfg["低價門檻"])
    words = EXCLUDE_WORDS + [norm(w) for w in cfg["額外排除關鍵字"]]
    stats = {"原始": len(raw), "排除字": 0, "非兒童": 0, "年齡不符": 0, "超過價格": 0, "已排除": 0}

    groups = {}
    for e in raw:
        title = e["title"]
        if any(w in title for w in words):
            stats["排除字"] += 1
            continue
        if not is_kid(e):
            stats["非兒童"] += 1
            continue
        age = tuple(e["age"]) if e["age"] else None
        if age and (age[1] < lo or age[0] > hi):
            stats["年齡不符"] += 1
            continue
        if e["price"] is not None and e["price"] > pmax:
            stats["超過價格"] += 1
            continue
        tier = 1 if e["gov"] else 4 if e["price"] is None else 2 if e["price"] <= plow else 3
        e = dict(e, age=age, tier=tier)
        for s in e["sessions"]:
            for k in ("start", "end"):
                if isinstance(s[k], str):
                    s[k] = dt.date.fromisoformat(s[k])
        city = e["sessions"][0]["city"]
        groups.setdefault((title_key(title), city), []).append(e)

    # 去重：完整名稱（去標點、去「第N場」）＋縣市相同才合併，場次取聯集
    events = []
    for (key, city), es in groups.items():
        es.sort(key=lambda x: (x["tier"], x["price"] is None))
        main = dict(es[0])
        sess = {}
        for x in es:
            for s in x["sessions"]:
                sess.setdefault((s["start"], s["end"]), s)
        main["sessions"] = sorted(sess.values(), key=lambda s: (s["start"], s["end"]))
        main["sources"] = sorted({x["source"] for x in es})
        main["key"] = key
        for f in ("reg_start", "reg_end", "age", "url", "org"):
            if not main.get(f):
                main[f] = next((x[f] for x in es if x.get(f)), main.get(f))
        events.append(main)

    ex_raw, exc = load_exclusions()
    kept = []
    for e in events:
        if excluded_match(e, exc):
            stats["已排除"] += 1
        else:
            kept.append(e)

    seen = load_json("seen.json", {})
    init = seen.setdefault("_init", TODAY.isoformat())  # 第一次執行抓到的不算「新增」
    sat = TODAY + dt.timedelta(days=(5 - TODAY.weekday()) % 7)
    if TODAY.weekday() == 6:
        sat = TODAY - dt.timedelta(days=1)
    sun = sat + dt.timedelta(days=1)
    long_days = int(cfg["長期展覽天數"])
    home = set(cfg["常用地區"])

    out = []
    for e in kept:
        ss = e["sessions"]
        start, end = min(s["start"] for s in ss), max(s["end"] for s in ss)
        nxt = next(s for s in ss if s["end"] >= TODAY)
        nxt_day = max(nxt["start"], TODAY)
        first = seen.get(e["uid"]) or seen.get(e["key"]) or TODAY.isoformat()
        seen[e["uid"]] = seen[e["key"]] = first
        reg_s, reg_e = _d(e["reg_start"]), _d(e["reg_end"])
        reg_status = ""
        if reg_s and reg_s > TODAY:
            reg_status = "即將開放報名"
        elif (reg_e and reg_e >= TODAY) or (reg_s and not reg_e):
            reg_status = "報名中"
        elif reg_e and reg_e < TODAY:
            reg_status = "報名已截止"
        out.append({
            "uid": e["uid"], "key": e["key"], "title": e["title"], "url": e["url"],
            "tier": e["tier"], "sources": e["sources"], "org": e["org"],
            "city": nxt["city"], "region": CITY_REGION.get(nxt["city"], ""),
            "home": nxt["city"] in home, "venue": nxt["venue"][:60],
            "next": nxt_day.isoformat(), "start": start.isoformat(), "end": end.isoformat(),
            "dates": sorted({max(s["start"], TODAY).isoformat() for s in ss})[:12],
            "long": (end - start).days > long_days,
            "weekend": any(s["start"] <= sun and s["end"] >= sat for s in ss),
            "new": first > init and first >= (TODAY - dt.timedelta(days=6)).isoformat(),
            "first_seen": first,
            "price": e["price"], "price_label": _price_label(e["price"], e["gov"]),
            "age": list(e["age"]) if e["age"] else None, "age_label": age_label(e["age"]),
            "reg_start": reg_s.isoformat() if reg_s else None,
            "reg_end": reg_e.isoformat() if reg_e else None, "reg_status": reg_status,
        })
    out.sort(key=lambda x: (x["tier"], x["long"], x["next"], x["title"]))
    for i, e in enumerate(out, 1):
        e["no"] = i
    stats["收錄"] = len(out)
    save_json("seen.json", seen)
    return out, stats, ex_raw


def _d(v):
    if not v:
        return None
    return v if isinstance(v, dt.date) else dt.date.fromisoformat(str(v)[:10])


def _price_label(p, gov):
    if p is None:
        return "未標示" + ("（公家活動，多為免費）" if gov else "")
    return "免費" if p == 0 else f"{p:,} 元"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-fetch", action="store_true")
    args = ap.parse_args()
    cfg = load_config()
    if args.no_fetch:
        raw = load_json("raw.json", [])
        log = load_json("runlog.json", {}).get("sources", [])
        news = load_json("news.json", [])
    else:
        raw, log, news = fetch_all(cfg)
        old_news = {n["link"]: n for n in load_json("news.json", [])}
        for n in news:
            old_news.setdefault(n["link"], dict(n, first_seen=TODAY.isoformat()))
        cutoff = (TODAY - dt.timedelta(days=30)).isoformat()
        news = sorted((n for n in old_news.values() if n.get("first_seen", "") >= cutoff),
                      key=lambda n: n.get("date", ""), reverse=True)[:80]
        save_json("raw.json", raw)
        save_json("news.json", news)
    events, stats, ex = process(json.loads(json.dumps(raw, default=str)), cfg)
    now = dt.datetime.now(TZ).strftime("%Y-%m-%d %H:%M")
    save_json("events.json", {
        "generated": now, "today": TODAY.isoformat(),
        "config": {k: cfg[k] for k in ("年齡下限", "年齡上限", "價格上限", "低價門檻",
                                       "往後看幾天", "長期展覽天數", "常用地區")},
        "regions": REGIONS, "tiers": TIERS, "stats": stats,
        "excluded": {"items": len(ex["items"]), "series": [s["pattern"] for s in ex["series"]]},
        "sources": log, "events": events,
    })
    save_json("runlog.json", {"time": now, "sources": log, "stats": stats})
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
