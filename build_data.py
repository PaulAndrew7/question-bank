"""Turn the raw quiz reports in output/reports into docs/data/questions.json.

The output only contains question content (text, options, correct answer,
explanation, topic). Learner name, ids, scores and chosen answers are dropped
so the result is safe to publish.

Usage:
    python build_data.py              # build
    python build_data.py --review     # build and print every question grouped by topic
"""
import hashlib
import html
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / "output" / "reports"
OVERRIDES = ROOT / "topic_overrides.json"
OUT = ROOT / "docs" / "data" / "questions.json"

SKIP_QUIZ = re.compile(r"^Mock Assessment", re.I)

TOPICS = [
    ("linux", "Linux & Shell"),
    ("python", "Python"),
    ("web", "Web & APIs"),
    ("data", "Data Analysis"),
    ("sql", "SQL"),
    ("bigdata", "Spark & Big Data"),
    ("ml", "Machine Learning & MLOps"),
    ("cloud", "Cloud & DevOps"),
    ("genai", "GenAI & RAG"),
    ("agents", "AI Agents"),
    ("telecom", "Telecom & Networking"),
    ("practices", "SDLC & Practices"),
]
TOPIC_NAMES = dict(TOPICS)

# Display names per assessment number; the raw titles are inconsistent.
QUIZ_NAMES = {
    1: "Linux & Shell Scripting", 2: "Python Core", 3: "Python Full Stack & FastAPI",
    4: "Azure Fundamentals", 5: "Python for GenAI & Data Analysis", 6: "App Development with GenAI",
    7: "LangGraph, LangChain & RAG", 8: "Agents, LangGraph & MCP", 9: "App Development with GenAI",
    10: "Data Ingestion & Spark SQL", 11: "ML Models & Deployment", 12: "Kafka, PySpark & Optimizations",
    13: "Telecom, Docker & MLOps",
}

# Default topic per quiz, matched against the quiz title (first match wins).
QUIZ_DEFAULT = [
    (r"Linux", "linux"),
    (r"Python Core", "python"),
    (r"Full Stack", "web"),
    (r"Azure", "cloud"),
    (r"LangGraph_LangChain_RAG", "genai"),
    (r"Python for Gen AI", "data"),
    (r"App Development with Gen", "genai"),
    (r"Agents_LangGraph_MCP", "agents"),
    (r"Spark|Sprak|Kafka", "bigdata"),
    (r"ML Models", "ml"),
    (r"Telecom", "telecom"),
]

# (pattern, weight). Case-insensitive unless the pattern opts out with (?-i:...).
S, W = 3, 1  # strong, weak
KEYWORDS = {
    "linux": [
        (r"\bbash\b|\bshell\b|#!/bin|\bchmod\b|\bchown\b|\bgrep\b|\bawk\b|\bsed\b|\blinux\b|\bcrontab\b|\bcron\b", S),
        (r"\becho\b|\bsudo\b|\bwc -l\b|\bcat \S|\bls -|\bmkdir\b|\brm -|\btouch\b|\btail\b|\bhead -|\bfi\b|\bdone\b;|\bdo echo\b", S),
        (r"\$\w+|\binode\b|\bsymlink|\bpermission|\bprocess(es)?\b|\bkill\b|\bpipe\b|\bdirectory\b|\bterminal\b|\bumask\b", W),
    ],
    "python": [
        (r"\bpython\b|list comprehension|\bdict(ionary)?\b|\btuple\b|\bdecorator|\bgenerator\b|\b__init__\b|\bself\b", S),
        (r"\bdef \w+\(|\bprint\(|\brange\(|\bmutable\b|\bimmutable\b|\*args|\*\*kwargs|f-string|\bGIL\b|\bwith open\b|\bexcept\b", S),
        (r"\bclass\b|\binheritance\b|\bexception\b|\blambda\b|\bfunction\b|\bloop\b|\bslic(e|ing)\b|\bvariable\b|\bscope\b|\bset\b|\blist\b", W),
    ],
    "web": [
        (r"\bfastapi\b|\breact\b|\bpydantic\b|\buvicorn\b|\bflask\b|\bdjango\b|\bjavascript\b|\buseState\b|\buseEffect\b|\bJSX\b|\bCORS\b|\bJWT\b", S),
        (r"\bendpoint\b|\bREST\b|\bHTTP\b|\bstatus code\b|\bmiddleware\b|\bfrontend\b|\bbackend\b|\bSQLAlchemy\b|\bORM\b|\bhtml\b|\bcss\b|\bDOM\b", S),
        (r"\bcomponent\b|\bre-?renders?\b|\bAPI\b|\basync\b|\bawait\b|\bdependency injection\b|\bform\b|\broute\b|\brequest\b|\bresponse\b|\b4\d\d\b", W),
    ],
    "data": [
        (r"\bnumpy\b|\bnp\.|\bpandas\b|\bfillna\b|\bdropna\b|\bdrop_duplicates\b|\bmatplotlib\b|\bseaborn\b|\binterquartile\b|\bIQR\b|\boutliers?\b", S),
        (r"\bmedian\b|\bstandard deviation\b|\bvariance\b|\bcorrelation\b|\bhistogram\b|\bmissing values?\b|\bskew(ed)?\b|\bEDA\b|\bimput", S),
        (r"\bdf\b|\bdataframe\b|\bgroupby\b|\bmean\b|\bdistribution\b|\baxis\s*=|\btrend|\bseasonal|\bdata types?\b|\bregex\b|\bdataset\b", W),
    ],
    "sql": [
        (r"(?-i:\bSELECT\b|\bWHERE\b|\bGROUP BY\b|\bHAVING\b|\bORDER BY\b|\bJOIN\b|\bINSERT\b|\bUPDATE\b|\bDELETE FROM\b)", S),
        (r"\bRANK\(|\bDENSE_RANK\b|\bROW_NUMBER\b|\bOVER\s*\(|\bPARTITION BY\b|\bCOALESCE\b|\bLAG\(|\bLEAD\(|\bsubquery\b|\bCTE\b|\bSQL\b", S),
        (r"\bquery\b|\btable\b|\bprimary key\b|\bforeign key\b|\bindex\b|\bNULLs?\b|\bwindow function\b|\bsecond-highest\b|\bjoin\b", W),
    ],
    "bigdata": [
        (r"\bspark\b|\bpyspark\b|\bRDD\b|\bHDFS\b|\bhadoop\b|\bmapreduce\b|\bkafka\b|\bdatabricks\b|\bdelta lake\b|\bparquet\b|\bsc\.parallelize\b", S),
        (r"\bshuffle[ds]?\b|\bexecutors?\b|\bbroadcast\b|\bcreateOrReplaceTempView\b|\bwithColumn\b|\breduceByKey\b|\bconsumer group\b|\bbroker\b|\boffset\b", S),
        (r"\bpartitions?\b|\bdriver\b|\blazy\b|\bDAG\b|\bETL\b|\bingestion\b|\bstreaming\b|\bbatch\b|\bdata lake\b|\bproducer\b|\bconsumer\b|\bdata skew\b", W),
    ],
    "ml": [
        (r"\bmachine learning\b|\boverfitting\b|\bunderfitting\b|\bregression\b|\bclassification\b|\bclustering\b|\bsupervised\b|\bunsupervised\b", S),
        (r"\bprecision\b|\brecall\b|\bF1\b|\bconfusion matrix\b|\bcross-validation\b|\bhyperparameter|\bdecision tree|\brandom forest|\bk-means\b|\bKNN\b|\bSVM\b", S),
        (r"\bMLflow\b|\bMLOps\b|\bmodel registry\b|\bdrift\b|\bretrain|\bscikit|\bsklearn\b|\bneural network|\bgradient descent\b|\bROC\b|\bAUC\b", S),
        (r"\bmodel\b|\btrain(ing|ed)?\b|\baccuracy\b|\bfeatures?\b|\blabels?\b|\bepochs?\b|\bpredict", W),
    ],
    "cloud": [
        (r"\bdocker\b|\bdockerfile\b|\bcontainers?\b|\bcontaineri[sz]ed\b|\bkubernetes\b|\bk8s\b|\bpods?\b|\bdocker-compose\b|\bcompose\b", S),
        (r"\bCI/CD\b|\bGitHub Actions\b|\bpipeline deploy|\binfrastructure as code\b|\bIaC\b", S),
        (r"\bimage\b|\bvolume\b|\bport\b|\bnginx\b|\bregistry\b|\bmicroservices?\b|\benvironment variables?\b", W),
        (r"\bazure\b|\baws\b|\bVNet\b|\bsubnets?\b|\bNSG\b|\bvirtual machine\b|\bVMs?\b|\bblob\b|\bstorage account\b|\bresource group\b|\bbastion\b", S),
        (r"\bIaaS\b|\bPaaS\b|\bSaaS\b|\bavailability zone|\bregion\b|\bload balancer\b|\bapp service\b|\bEntra\b|\bactive directory\b|\bRBAC\b|\bkey vault\b", S),
        (r"\bcloud\b|\bscale set\b|\bautoscal|\bCDN\b|\bX-Cache\b|\bedge cache\b|\bdata cent(er|re)\b|\bPUE\b|\bSLA\b|\bfailover\b|\bredundan", W),
    ],
    "genai": [
        (r"\bLLMs?\b|\bGPT\b|\bprompt(s|ing)?\b|\bembeddings?\b|\bRAG\b|\bretrieval\b|\blangchain\b|\bchunk(s|ing)?\b|\bhallucinat|\btemperature\b", S),
        (r"\bfine-?tun|\bgenerative\b|\bGenAI\b|\btransformer|\bcontext window\b|\bfew-shot\b|\bzero-shot\b|\bvector (db|database|store)\b|\bcosine\b|\bFAISS\b|\bChroma\b", S),
        (r"\btokens?\b|\bvectors?\b|\battention\b|\bsemantic\b|\bsimilarity\b|\bre-?rank|\bcorpus\b|\bgrounded\b", W),
    ],
    "agents": [
        (r"\bagents?\b|\bagentic\b|\blanggraph\b|\bMCP\b|\btool calls?\b|\btool-calling\b|\bsupervisor\b|\bmulti-agent\b|\bReAct\b|\bcheckpoint", S),
        (r"\bhuman-in-the-loop\b|\bguardrails?\b|\bidempoten|\bside-effect|\binterrupt\b|\bfan(s)? out\b|\bstructured[- ]output\b|\bschema\b", S),
        (r"\btools?\b|\bnodes?\b|\bgraph\b|\bstate\b|\bworkflow\b|\brouting\b|\brouter\b|\bretry\b|\bmemory\b|\benum\b", W),
    ],
    "telecom": [
        (r"\btelecom\b|\b[2345]G\b|\bLTE\b|\bVoLTE\b|\bVoIP\b|\bgNB\b|\beNodeB\b|\bAMF\b|\bPSTN\b|\bcircuit switching\b|\bpacket switching\b|\bCDR\b", S),
        (r"\bBSS\b|\bOSS\b|\bprepaid\b|\bpostpaid\b|\btariff\b|\bNOC\b|\balarms?\b|\bFTTH\b|\bOLT\b|\bONTs?\b|\bPON\b|\bbroadband\b|\bfault management\b|\bSIM\b", S),
        (r"\bOSI\b|\bTCP\b|\bUDP\b|\blatency\b|\bjitter\b|\bpacket loss\b|\bQoS\b|\bping\b|\bDNS\b|\bIP address\b|\bbandwidth\b|\bcalls?\b|\bnetwork\b|\bprotocol\b", W),
    ],
    "practices": [
        (r"\bSDLC\b|\bwaterfall\b|\bagile\b|\bV-model\b|\bscrum\b|\bsprint\b|\brequirements? phase\b|\bmaintainability\b", S),
    ],
}
COMPILED = {t: [(re.compile(p, re.I), w) for p, w in pats] for t, pats in KEYWORDS.items()}
QUIZ_BONUS = 2


def clean(s):
    """HTML fragment -> plain text, keeping line breaks."""
    if not s:
        return ""
    # A few questions hold code as literal "\n" escapes after a markdown fence tag ("code? python\n@app...")
    s, n = re.subn(r"\s(python|javascript|js|bash|sql)\\n", "\n\n", s)
    if n:
        s = s.replace("\\n", "\n")
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p>\s*<p[^>]*>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ").replace("\r\n", "\n")
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


CODE_LINE = re.compile(r"""^\s*(?:
    (?:def|class|import|from|for|while|if|elif|else|try|except|with|return|print|echo|let|const|var|function
      |async|await|console|fi|done|do|then|case|esac|docker|kubectl|spark|df\d*|rdd\d*|sc|np|pd|result|res
      |SELECT|FROM|WHERE|GROUP|HAVING|ORDER|JOIN|LEFT|INNER|LIMIT|UNION|WITH|INSERT|UPDATE|CREATE|COUNT|AVG)\b
    | [@#{}()\[\]$] | --\w | \w+\s*(?:=|\+=|-=)\s*\S | [\w.]+\( | .*\t | .*[│├└]
    | (?:\d[\d,.]*|NULL)\s*$
)""", re.X)


def is_prose(line):
    s = line.strip()
    words = re.findall(r"[A-Za-z]{2,}", s)
    if len(re.findall(r"[=(){}\[\];<>$|]", s)) > 1:
        return False
    sentence = bool(re.match(r"[A-Z][a-z]+\b", s)) and len(words) >= 3
    if line[:1].isspace():  # indented: only a real sentence ends a code block
        return sentence
    if s.endswith("?"):  # "Output?", "Problem?"
        return True
    return sentence or bool(re.search(r"[.?!:]$", s)) and len(words) >= 2


def fence_code(text):
    """Wrap code in ``` fences so the site can render it as a code block.

    A block starts on a line that looks like code and continues until a line that reads as prose.
    """
    lines, out, block = text.split("\n"), [], []

    def flush():
        while block and not block[-1].strip():
            block.pop()
        if block:
            out.extend(["```", *block, "```"])
        block.clear()

    for i, line in enumerate(lines):
        if block:
            if line.strip() and not is_prose(line):
                block.append(line.rstrip())
                continue
            if not line.strip():
                nxt = next((l for l in lines[i + 1:] if l.strip()), "")
                if nxt and not is_prose(nxt):
                    block.append("")
                    continue
            flush()
        if line.strip() and CODE_LINE.match(line) and not is_prose(line):
            block.append(line.rstrip())
        else:
            out.append(line.strip())
    flush()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


GENERIC_FEEDBACK = re.compile(
    r"^(the key concept is|correct\b|good\b|basic\b|nice\b|well done|excellent|great\b|review\b)", re.I)
STOP = set("""about above after again also answer because been before being best better between both cannot could
does doing done each every from have having here into itself just more most much must only other over same should
such than that their them then there these they this those through under until very what when where which while
will with within would your yours using used uses value values data model system team company developer application
correct option following question""".split())


def stems(s):
    return {w[:5] for w in re.findall(r"[a-z][a-z0-9_]{3,}", s.lower()) if w not in STOP}


def explanation(q, context):
    """Best available explanation, or '' when it is boilerplate or clearly about a different question.

    Several quizzes have feedback pasted onto the wrong question, so an explanation must share
    at least one meaningful word with the question or its correct answer.
    """
    general = clean(q.get("generalFeedbackText"))
    fb = clean(q.get("correctAnswerFeedback"))
    fb = re.sub(r"^correct[.!]\s*", "", fb, flags=re.I)
    if len(fb) < 25 or GENERIC_FEEDBACK.match(fb) or re.search(r"\bunderstanding\b", fb, re.I) and len(fb) < 60:
        fb = ""
    ctx = stems(context)
    for cand in (general, fb):
        if len(cand) >= 12 and stems(cand) & ctx:
            return cand
    return ""


def quiz_default(title):
    for pat, topic in QUIZ_DEFAULT:
        if re.search(pat, title):
            return topic
    return None


def classify(text, default):
    scores = Counter()
    for topic, pats in COMPILED.items():
        for rx, w in pats:
            scores[topic] += w * len(rx.findall(text))
    if default:
        scores[default] += QUIZ_BONUS
    if not scores or max(scores.values()) == 0:
        return default or "python"
    best = max(scores.values())
    # prefer the quiz default on ties, then topic order
    for t, _ in ([(default, 0)] if default else []) + TOPICS:
        if scores[t] == best:
            return t


def parse_quiz(title):
    """'RE-MCQ Assessment-3 (Python Full Stack)' -> id 'a3-retest', kicker 'Assessment 3 retest', name, sort key."""
    if re.search(r"pre-assessment", title, re.I):
        return {"id": "pre", "kicker": "Pre-assessment", "name": "Mixed topics", "sort": 0}
    m = re.search(r"Assessment\s*-?\s*(\d+)", title)
    if not m:
        name = re.sub(r"[_\s]+", " ", title).strip()
        return {"id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"), "kicker": "Quiz", "name": name, "sort": 99}
    num = int(m.group(1))
    level = 2 if title.upper().startswith("RETEST") else 1 if re.search(r"^RE-|retest", title, re.I) else 0
    paren = re.search(r"\((.*?)\)", title)
    name = QUIZ_NAMES.get(num) or (paren.group(1).replace("_", " ").strip() if paren else title)
    kicker = f"Assessment {num}" + ("" if not level else " retest" if level == 1 else f" retest {level}")
    qid = f"a{num}" + ("" if not level else "-retest" if level == 1 else f"-retest-{level}")
    return {"id": qid, "kicker": kicker, "name": name, "sort": num + level / 10}


def main():
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    topic_overrides = overrides.get("topics", {})
    hide_explanation = set(overrides.get("hide_explanation", []))

    quizzes, questions, by_key = [], [], {}
    for folder in sorted(p for p in REPORTS.iterdir() if p.is_dir()):
        reports = sorted(folder.glob("report_attempt_*.json"))
        if not reports:
            continue
        rep = json.loads(reports[-1].read_text(encoding="utf-8"))
        title = rep.get("activityName") or folder.name
        if SKIP_QUIZ.search(title):
            continue
        quiz = {**parse_quiz(title), "count": 0}
        quizzes.append(quiz)
        default = quiz_default(title)

        for q in rep.get("learnerReport") or []:
            opts = q.get("mcqOptions") or []
            ids = [o["optionId"] for o in opts]
            expected = q.get("expectedAnswer") or []
            assert expected and expected[0] in ids, f"bad answer in {title}: {q.get('questionId')}"
            text = clean(q.get("questionDetails"))
            # Some Assessment 13 options have a course-agenda heading pasted on ("... Day 3 — Morning: OSS vs BSS")
            options = [re.sub(r"\s+Day \d+\s*[—–-]\s*(Morning|Afternoon):.*$", "", clean(o.get("optionDetails")))
                       for o in opts]
            key = re.sub(r"\s+", " ", (text + "|" + "|".join(options)).lower())
            if key in by_key:
                if quiz["id"] not in by_key[key]["quizzes"]:
                    by_key[key]["quizzes"].append(quiz["id"])
                continue
            qid = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
            topic = topic_overrides.get(qid) or classify(text + "\n" + "\n".join(options), default)
            assert topic in TOPIC_NAMES, f"unknown topic {topic!r} for {qid}"
            answer = ids.index(expected[0])
            item = {
                "id": qid,
                "text": fence_code(text),
                "options": options,
                "answer": answer,
                "explain": "" if qid in hide_explanation else fence_code(explanation(q, text + " " + options[answer])),
                "topic": topic,
                "quizzes": [quiz["id"]],
                "difficulty": int(q["difficultyLevel"]) if str(q.get("difficultyLevel", "")).isdigit() else None,
            }
            by_key[key] = item
            questions.append(item)

    assert len({q["id"] for q in questions}) == len(questions), "duplicate question ids"
    assert len({q["id"] for q in quizzes}) == len(quizzes), "duplicate quiz ids"
    for q in questions:
        assert 0 <= q["answer"] < len(q["options"])

    topic_counts = Counter(q["topic"] for q in questions)
    topics = [{"id": t, "name": n, "count": topic_counts[t]} for t, n in TOPICS if topic_counts[t]]
    quizzes.sort(key=lambda z: z["sort"])
    quiz_order = {z["id"]: i for i, z in enumerate(quizzes)}
    questions.sort(key=lambda q: quiz_order[q["quizzes"][0]])  # course order; stable within a quiz
    for z in quizzes:
        z["count"] = sum(1 for q in questions if z["id"] in q["quizzes"])
        del z["sort"]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated": date.today().isoformat(), "topics": topics,
                               "quizzes": quizzes, "questions": questions},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{len(questions)} unique questions from {len(quizzes)} quizzes -> {OUT.relative_to(ROOT)}")
    print(f"  {sum(1 for q in questions if q['explain'])} with explanations, "
          f"{sum(1 for q in questions if '```' in q['text'])} with code blocks")
    for t in topics:
        print(f"  {t['count']:4d}  {t['name']}")
    if "--review" in sys.argv:
        quiz_titles = {z["id"]: z["kicker"] for z in quizzes}
        grouped = defaultdict(list)
        for q in questions:
            grouped[q["topic"]].append(q)
        for t, n in TOPICS:
            print(f"\n===== {n}")
            for q in grouped[t]:
                one = re.sub(r"\s+", " ", q["text"])[:110]
                print(f"  {q['id']}  [{quiz_titles[q['quizzes'][0]][:14]}]  {one}")


if __name__ == "__main__":
    main()
