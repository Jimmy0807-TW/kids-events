"""處理「排除／恢復」的 GitHub Issue，更新 data/excluded.json。

支援的寫法（標題或內文皆可）：
  排除 12 15            依目前編號排除這幾場
  排除系列 週末故事屋     名稱含這段文字的活動都排除
  恢復 小丑魚            名稱含這段文字的已排除活動恢復
  恢復系列 週末故事屋
網頁上的按鈕會自動填好內文（動作、uid、key）。
"""
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build import load_json, save_json  # noqa: E402
from common import TODAY, norm, title_key  # noqa: E402


def parse(title, body):
    kv = {}
    for line in (body or "").splitlines():
        m = re.match(r"\s*([^:：]{1,8})\s*[:：]\s*(.+)$", line)
        if m:
            kv[m.group(1).strip()] = m.group(2).strip()
    title = norm(title)
    action = kv.get("動作", "")
    if not action:
        if title.startswith("排除系列"):
            action, kv["系列文字"] = "排除系列", title[4:].strip()
        elif title.startswith("恢復系列"):
            action, kv["系列文字"] = "恢復", title[4:].strip()
        elif title.startswith("恢復"):
            action, kv["文字"] = "恢復", title[2:].strip()
        elif title.startswith("排除"):
            action = "排除這場"
    return action, kv, title


def main():
    ev = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text("utf-8"))
    issue = ev["issue"]
    action, kv, title = parse(issue["title"], issue.get("body"))
    exc = load_json("excluded.json", {"items": [], "series": []})
    events = load_json("events.json", {"events": []})["events"]
    msgs = []
    today = TODAY.isoformat()

    if action == "排除這場":
        targets = []
        if kv.get("uid") or kv.get("key"):
            targets.append({"uid": kv.get("uid"), "key": kv.get("key"), "title": kv.get("名稱", ""),
                            "date": kv.get("日期", "")})
        else:
            for n in map(int, re.findall(r"\d+", title)):
                e = next((x for x in events if x["no"] == n), None)
                if e:
                    targets.append({"uid": e["uid"], "key": e["key"], "title": e["title"], "date": e["next"]})
                else:
                    msgs.append(f"找不到 #{n}（編號可能已因更新而改變）")
        for t in targets:
            if not any(i.get("uid") == t["uid"] or (t["key"] and i.get("key") == t["key"])
                       for i in exc["items"]):
                exc["items"].append(dict(t, excluded_on=today))
            msgs.append(f"已排除：{t['title'] or t['key']}")
    elif action == "排除系列":
        p = kv.get("系列文字", "").strip()
        if len(title_key(p)) < 2:
            msgs.append("系列文字太短（至少 2 個字），沒有排除。")
        else:
            if not any(s["pattern"] == p for s in exc["series"]):
                exc["series"].append({"pattern": p, "excluded_on": today})
            hit = [e["title"] for e in events if title_key(p) in title_key(e["title"])]
            msgs.append(f"已排除系列「{p}」，目前清單中有 {len(hit)} 筆符合：" +
                        "、".join(h[:20] for h in hit[:10]))
    elif action == "恢復":
        before_i, before_s = len(exc["items"]), len(exc["series"])
        key, uid, p, txt = kv.get("key"), kv.get("uid"), kv.get("系列文字"), kv.get("文字")
        if p:
            exc["series"] = [s for s in exc["series"] if s["pattern"] != p]
        if key or uid:
            exc["items"] = [i for i in exc["items"] if not (i.get("key") == key or i.get("uid") == uid)]
        if txt:
            k = title_key(txt)
            exc["items"] = [i for i in exc["items"] if k not in title_key(i.get("title", ""))]
            exc["series"] = [s for s in exc["series"]
                             if not (k in title_key(s["pattern"]) or title_key(s["pattern"]) in k)]
        msgs.append(f"已恢復 {before_i - len(exc['items'])} 場、{before_s - len(exc['series'])} 個系列。")
    else:
        msgs.append("看不懂這個指令。請用「排除 12」「排除系列 文字」「恢復 文字」。")

    save_json("excluded.json", exc)
    reply = "\n".join(msgs) + f"\n\n（{dt.datetime.now().strftime('%H:%M')} 處理完成，網頁約 1 分鐘後更新）"
    print(reply)
    out = os.environ.get("REPLY_FILE")
    if out:
        Path(out).write_text(reply, "utf-8")


if __name__ == "__main__":
    main()
