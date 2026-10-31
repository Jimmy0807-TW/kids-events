"""LINE 推播：每週週報＋報名提醒。用「群發給所有好友」，不需要伺服器。

需要在 GitHub 的 Settings → Secrets → Actions 新增 LINE_CHANNEL_ACCESS_TOKEN。
沒有設定時只會印出訊息內容，不會送出。
python scraper/line_push.py            依設定判斷今天要不要送
python scraper/line_push.py --preview  只印出週報內容
"""
import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from build import is_on, load_config, load_json, save_json  # noqa: E402
from common import TODAY  # noqa: E402

WD = "一二三四五六日"
LIMIT = 4800  # LINE 單則文字上限 5000 字


def md(iso):
    d = dt.date.fromisoformat(iso)
    return f"{d.month}/{d.day}（{WD[d.weekday()]}）"


def line(e, with_city=False):
    t = e["title"] if len(e["title"]) <= 30 else e["title"][:29] + "…"
    city = f"{e['city']}｜" if with_city else ""
    price = e["price_label"].split("（")[0]
    return f"#{e['no']} {t}\n　{md(e['next'])} {city}{e['venue'][:14]}｜{price}"


def weekly(data, cfg):
    L = cfg.get("LINE", {})
    ev = data["events"]
    home = [e for e in ev if e["home"]]
    wk = [e for e in home if e["weekend"] and not e["long"]][: int(L.get("週末活動筆數", 10))]
    new = [e for e in home if e["new"] and not e["weekend"]][: int(L.get("本週新增筆數", 10))]
    away = [e for e in ev if not e["home"] and e["tier"] == 1 and not e["long"]
            and (e["price"] in (0, None))][: int(L.get("外縣市精選筆數", 5))]
    soon = [e for e in home if e["reg_status"] == "即將開放報名"][:8]
    url = cfg.get("網頁網址", "")
    parts = [f"【親子活動週報】{md(TODAY.isoformat())}",
             f"常用地區共 {len(home)} 筆，這個週末 {sum(e['weekend'] for e in home)} 場。"]
    if wk:
        parts.append("🗓 這個週末\n" + "\n".join(line(e, True) for e in wk))
    if soon:
        parts.append("⏰ 即將開放報名\n" + "\n".join(
            f"#{e['no']} {e['title'][:26]}\n　{md(e['reg_start'])} 開放" for e in soon))
    if new:
        parts.append("🆕 本週新增\n" + "\n".join(line(e, True) for e in new))
    if away:
        parts.append("🚗 外縣市精選（公家、免費）\n" + "\n".join(line(e, True) for e in away))
    parts.append(f"完整清單：{url}\n討論時請用 #編號（以這次更新為準）")
    text = "\n\n".join(parts)
    return text[:LIMIT]


def reminders(data):
    tmr = (TODAY + dt.timedelta(days=1)).isoformat()
    hit = [e for e in data["events"] if e["home"] and e.get("reg_start") == tmr]
    if not hit:
        return None
    return "⏰ 明天開放報名\n\n" + "\n".join(
        f"#{e['no']} {e['title'][:30]}\n　活動 {md(e['next'])}｜{e['url']}" for e in hit[:10])


def broadcast(text):
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    if not token:
        print("（未設定 LINE_CHANNEL_ACCESS_TOKEN，只預覽不送出）\n" + text)
        return False
    r = requests.post("https://api.line.me/v2/bot/message/broadcast", timeout=30,
                      headers={"Authorization": f"Bearer {token}"},
                      json={"messages": [{"type": "text", "text": text}]})
    print("LINE", r.status_code, r.text[:200])
    r.raise_for_status()
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--force-weekly", action="store_true")
    a = ap.parse_args()
    cfg = load_config()
    data = load_json("events.json", None)
    if not data:
        return
    if a.preview:
        print(weekly(data, cfg))
        return
    st = load_json("line_state.json", {})
    L = cfg.get("LINE", {})
    due = WD[TODAY.weekday()] == str(L.get("週報星期", "四")).strip()
    if (due and st.get("weekly") != TODAY.isoformat()) or a.force_weekly:
        if broadcast(weekly(data, cfg)):
            st["weekly"] = TODAY.isoformat()
    if is_on(L.get("報名提醒", "開")) and st.get("remind") != TODAY.isoformat():
        msg = reminders(data)
        if msg and broadcast(msg):
            st["remind"] = TODAY.isoformat()
    save_json("line_state.json", st)


if __name__ == "__main__":
    main()
