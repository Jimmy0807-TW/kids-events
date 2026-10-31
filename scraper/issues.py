"""處理「排除／恢復」的 GitHub Issue，更新 data/excluded.json。

「排除這場」只排除當時那段期間的場次；之後同名活動有新的日期，仍會重新出現。

支援的寫法（標題或內文皆可）：
  排除 12 15     依目前編號排除這幾場
  恢復 小丑魚     名稱含這段文字的已排除活動恢復
網頁上的按鈕會自動填好內文（動作、uid、key、期間）。
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
        if title.startswith("恢復"):
            action, kv["文字"] = "恢復", title[2:].strip()
        elif title.startswith("排除"):
            action = "排除這場"
    return action, kv, title


def main():
    ev = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text("utf-8"))
    issue = ev["issue"]
    action, kv, title = parse(issue["title"], issue.get("body"))
    exc = load_json("excluded.json", {"items": []})
    exc.pop("series", None)
    # 期間已過的排除紀錄不再需要
    exc["items"] = [i for i in exc["items"] if i.get("to", "9999") >= TODAY.isoformat()]
    events = load_json("events.json", {"events": []})["events"]
    msgs = []

    if action == "排除這場":
        targets = []
        if kv.get("uid") or kv.get("key"):
            e = next((x for x in events if x["uid"] == kv.get("uid") or x["key"] == kv.get("key")), {})
            rng = re.findall(r"\d{4}-\d{2}-\d{2}", kv.get("期間", ""))
            targets.append({"uid": kv.get("uid"), "key": kv.get("key"), "title": kv.get("名稱") or e.get("title", ""),
                            "from": rng[0] if rng else e.get("start", TODAY.isoformat()),
                            "to": rng[-1] if rng else e.get("end", TODAY.isoformat())})
        else:
            for n in map(int, re.findall(r"\d+", title)):
                e = next((x for x in events if x["no"] == n), None)
                if e:
                    targets.append({"uid": e["uid"], "key": e["key"], "title": e["title"],
                                    "from": e["start"], "to": e["end"]})
                else:
                    msgs.append(f"找不到 #{n}（編號可能已因更新而改變）")
        for t in targets:
            exc["items"] = [i for i in exc["items"] if not (i.get("uid") == t["uid"] and i.get("key") == t["key"])]
            exc["items"].append(dict(t, excluded_on=TODAY.isoformat()))
            msgs.append(f"已排除：{t['title'] or t['key']}（{t['from']} ～ {t['to']}）\n"
                        "之後同名活動若有這段期間以外的新日期，仍會重新出現。")
    elif action == "恢復":
        before = len(exc["items"])
        key, uid, txt = kv.get("key"), kv.get("uid"), kv.get("文字")
        if key or uid:
            exc["items"] = [i for i in exc["items"] if not (i.get("key") == key or i.get("uid") == uid)]
        if txt:
            k = title_key(txt)
            exc["items"] = [i for i in exc["items"] if k not in title_key(i.get("title", ""))]
        msgs.append(f"已恢復 {before - len(exc['items'])} 筆。")
    else:
        msgs.append("看不懂這個指令。請用「排除 12」或「恢復 文字」。")

    save_json("excluded.json", exc)
    reply = "\n".join(msgs) + f"\n\n（{dt.datetime.now().strftime('%H:%M')} 處理完成，網頁約 1 分鐘後更新）"
    print(reply)
    out = os.environ.get("REPLY_FILE")
    if out:
        Path(out).write_text(reply, "utf-8")


if __name__ == "__main__":
    main()
