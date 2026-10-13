"""Fetch all quiz reports for a course offering and save them as JSON.

Auth headers are read from "quiz page request.txt" (a browser "Copy as cURL (cmd)"
export), so refresh that file when the token expires and re-run.

Usage:
    python fetch_reports.py            # fetch everything
    python fetch_reports.py --probe    # dump raw responses of the first page/quiz only
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"
API = "https://lumen-api.u-next.com/api"
COURSE_OFFERING_ID = "RcrEuNWG4550kRFsef"
PAGE_LIMIT = 10


def load_headers():
    text = (ROOT / "quiz page request.txt").read_text(encoding="utf-8")
    headers = {}
    for name, value in re.findall(r'-H \^"([^:]+): (.*?)\^"', text):
        if name.lower() in ("accept-encoding", "connection", "te", "priority"):
            continue  # let urllib handle transport-level headers
        headers[name] = value
    return headers


HEADERS = load_headers()


def get(url, retries=3):
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:500]
            if e.code in (401, 403):
                sys.exit(f"Auth failed ({e.code}) for {url}: {body}\n"
                         "Token likely expired - re-copy the cURL into 'quiz page request.txt'.")
            if attempt == retries - 1:
                raise RuntimeError(f"HTTP {e.code} for {url}: {body}")
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 * (attempt + 1))


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def list_page(page_no):
    return get(f"{API}/quizservice/learnerquizzes?courseOfferingId={COURSE_OFFERING_ID}"
               f"&publishStatus=published&limit={PAGE_LIMIT}&pageNo={page_no}&sortBy=newestFirst")


def safe_name(s):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", s).strip(" .")[:120]


def main():
    if "--probe" in sys.argv:
        save(OUT / "probe_page1.json", list_page(1))
        print("saved", OUT / "probe_page1.json")
        return

    # 1. Collect every quiz across all pages
    quizzes, page_no = [], 1
    while True:
        data = list_page(page_no)
        batch = data.get("quizzes") or []
        quizzes.extend(batch)
        total = data.get("totalCount", 0)
        print(f"page {page_no}: {len(batch)} quizzes ({len(quizzes)}/{total})")
        if not batch or len(quizzes) >= total:
            break
        page_no += 1
    save(OUT / "quiz_list.json", quizzes)

    # 2. For each quiz, get its attempts, then the report for each attempt
    index, failures = [], []
    for i, q in enumerate(quizzes, 1):
        quiz_id, title = q["quizId"], q.get("title", "")
        detail = get(f"{API}/quizservice/learnerquizzes/{quiz_id}")
        folder = OUT / "reports" / f"{i:02d} - {safe_name(title)}"
        save(folder / "quiz.json", detail)

        attempts = detail.get("attemptsData") or []
        if not attempts and (detail.get("learnerAttemptData") or {}).get("attemptId"):
            attempts = [{"attemptId": detail["learnerAttemptData"]["attemptId"], "attemptNumber": 1}]
        if not attempts:
            print(f"[{i}] {title}: no attempts, skipped")
            index.append({"quizId": quiz_id, "title": title, "attempts": []})
            continue

        entry = {"quizId": quiz_id, "title": title, "attempts": []}
        for a in attempts:
            attempt_id, num = a["attemptId"], a.get("attemptNumber", 1)
            try:
                report = get(f"{API}/evaluationservice/quiz/learner/report"
                             f"?attemptId={attempt_id}&quizId={quiz_id}")
            except Exception as e:
                failures.append({"quizId": quiz_id, "title": title, "attemptId": attempt_id, "error": str(e)})
                print(f"[{i}] {title} attempt {num}: FAILED - {e}")
                continue
            path = folder / f"report_attempt_{num}.json"
            save(path, report)
            entry["attempts"].append({"attemptNumber": num, "attemptId": attempt_id,
                                      "file": str(path.relative_to(OUT))})
            print(f"[{i}] {title} attempt {num}: saved")
        index.append(entry)

    save(OUT / "index.json", index)
    if failures:
        save(OUT / "failures.json", failures)
    n = sum(len(e["attempts"]) for e in index)
    print(f"\nDone: {n} reports from {len(quizzes)} quizzes, {len(failures)} failures -> {OUT}")


if __name__ == "__main__":
    main()
