import { h, icon, rich, optionText, explainBlock, letter, pad, shuffle, setTitle, scrollBehavior, announce } from "./dom.js";
import { store } from "./store.js";

const LENGTHS = [10, 20, 30, "all"];
const SECONDS_PER_QUESTION = 60;
// Options like "Both A and B" only make sense in their original order.
const ORDER_LOCKED = /\b(all|none) (of )?the above\b|\bboth [a-d] and [a-d]\b/i;

const DEFAULT_SETUP = { by: "topic", topics: [], quizzes: [], length: 20, feedback: "end", timed: false };

let data = null;
let app = null;
let view = null; // "setup" | "run" | "results"
let timerId = 0;
let ui = { overview: false, confirm: null, filter: null };

export function leaveTest() {
  clearInterval(timerId);
  timerId = 0;
  view = null;
}

export function renderTest(appEl, d, args) {
  app = appEl;
  data = d;
  ui = { overview: false, confirm: null, filter: null };
  if (args[0] === "run") {
    if (!activeTest()) return location.replace("#/test");
    view = "run";
    renderRunner();
  } else if (args[0] === "results") {
    if (!lastResult()) return location.replace("#/test");
    view = "results";
    renderResults();
  } else {
    view = "setup";
    renderSetup();
  }
}

/* ---------- state ---------- */

function loadSetup() {
  const s = { ...DEFAULT_SETUP, ...store.get("setup", {}) };
  s.topics = s.topics.filter((id) => data.topicName[id]);
  s.quizzes = s.quizzes.filter((id) => data.quizById[id]);
  return s;
}

/** The stored test, with questions that no longer exist in the data removed. */
function activeTest() {
  const t = store.get("test", null);
  if (!t || !Array.isArray(t.items)) return null;
  t.items = t.items.filter((it) => data.byId.has(it.id));
  if (!t.items.length) {
    store.set("test", undefined);
    return null;
  }
  t.pos = Math.min(Math.max(0, t.pos || 0), t.items.length - 1);
  t.answers = t.answers || {};
  return t;
}

function lastResult() {
  const r = store.get("result", null);
  if (!r || !Array.isArray(r.items)) return null;
  r.items = r.items.filter((it) => data.byId.has(it.id));
  return r.items.length ? r : null;
}

function poolFor(setup) {
  const chosen = new Set(setup.by === "topic" ? setup.topics : setup.quizzes);
  return data.questions.filter((q) =>
    setup.by === "topic" ? chosen.has(q.topic) : q.quizzes.some((z) => chosen.has(z)));
}

function scopeLabel(setup) {
  const ids = setup.by === "topic" ? setup.topics : setup.quizzes;
  const total = setup.by === "topic" ? data.topics.length : data.quizzes.length;
  if (ids.length === total) return setup.by === "topic" ? "All topics" : "All quizzes";
  const names = ids.map((id) => (setup.by === "topic" ? data.topicName[id] : data.quizById[id].kicker));
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function makeTest(questions, opts) {
  const items = questions.map((q) => ({
    id: q.id,
    order: q.options.some((o) => ORDER_LOCKED.test(o)) ? q.options.map((_, i) => i) : shuffle(q.options.map((_, i) => i)),
  }));
  const now = Date.now();
  return {
    label: opts.label,
    feedback: opts.feedback,
    timed: opts.timed,
    started: now,
    deadline: opts.timed ? now + items.length * SECONDS_PER_QUESTION * 1000 : null,
    items,
    answers: {},
    pos: 0,
  };
}

function startTest(test) {
  store.set("test", test);
  location.hash = "#/test/run";
}

/** Starting a new test while one is unfinished would overwrite it, so ask next to the button first. */
function askReplace(rerender) {
  ui.confirm = "replace";
  rerender();
  app.querySelector(".confirm .btn.primary")?.focus();
}

function replaceConfirm(unfinished, start, cancel) {
  const answered = Object.keys(unfinished.answers).length;
  return h("div", { class: "confirm", role: "alertdialog", "aria-label": "Replace unfinished test", "aria-describedby": "replace-msg" },
    h("p", { id: "replace-msg" }, `This discards your unfinished test (${answered} of ${unfinished.items.length} answered).`),
    h("button", { class: "btn primary small", type: "button", onclick: start }, "Start new test"),
    h("button", { class: "btn ghost small", type: "button", onclick: () => { ui.confirm = null; cancel(); } }, "Cancel"));
}

/* ---------- setup ---------- */

function renderSetup() {
  setTitle("Mock test");
  const setup = loadSetup();
  const resume = activeTest();

  const save = () => store.set("setup", setup);
  const lengthRow = h("div", { class: "choice-row", role: "radiogroup", "aria-label": "Number of questions" });
  const startBtn = h("button", { class: "btn primary", type: "button" });
  const note = h("p", { class: "note", "aria-live": "polite" });
  const avail = h("span", { class: "hint" });

  function refresh() {
    const pool = poolFor(setup);
    const n = setup.length === "all" ? pool.length : Math.min(setup.length, pool.length);
    avail.textContent = pool.length ? `${pool.length} questions available` : "";
    lengthRow.replaceChildren(...LENGTHS.map((len) => {
      const input = h("input", {
        type: "radio", name: "length", value: String(len),
        checked: setup.length === len,
        disabled: len !== "all" && pool.length > 0 && len > pool.length && setup.length !== len,
      });
      input.addEventListener("change", () => { setup.length = len; save(); refresh(); });
      return h("label", { class: "choice" }, input, len === "all" ? `All${pool.length ? ` (${pool.length})` : ""}` : String(len));
    }));
    startBtn.disabled = n === 0;
    startBtn.textContent = n ? `Start ${n} ${n === 1 ? "question" : "questions"}` : "Start test";
    note.textContent = pool.length ? "" : `Pick at least one ${setup.by === "topic" ? "topic" : "quiz"} to start.`;
  }

  const begin = () => {
    const pool = poolFor(setup);
    const n = setup.length === "all" ? pool.length : Math.min(setup.length, pool.length);
    if (!n) return;
    startTest(makeTest(shuffle(pool).slice(0, n), { label: scopeLabel(setup), feedback: setup.feedback, timed: setup.timed }));
  };
  startBtn.addEventListener("click", () => (resume ? askReplace(renderSetup) : begin()));

  /* cover */
  const groups = setup.by === "topic"
    ? data.topics.map((t) => ({ id: t.id, name: t.name, count: t.count }))
    : data.quizzes.map((z) => ({ id: z.id, name: z.name, kicker: z.kicker, count: z.count }));
  const selected = () => (setup.by === "topic" ? setup.topics : setup.quizzes);
  const setSelected = (ids) => { if (setup.by === "topic") setup.topics = ids; else setup.quizzes = ids; };

  const boxes = groups.map((g) => {
    const input = h("input", { type: "checkbox", value: g.id, checked: selected().includes(g.id) });
    input.addEventListener("change", () => {
      const ids = new Set(selected());
      if (input.checked) ids.add(g.id); else ids.delete(g.id);
      setSelected(groups.map((x) => x.id).filter((id) => ids.has(id)));
      save();
      refresh();
    });
    return h("label", { class: "chip" }, input,
      h("span", { class: "box" }, icon("check")),
      h("span", null, g.kicker && h("span", { class: "c-kicker" }, g.kicker), g.name),
      h("span", { class: "count" }, g.count));
  });
  const setAll = (on) => {
    setSelected(on ? groups.map((g) => g.id) : []);
    for (const label of boxes) label.querySelector("input").checked = on;
    save();
    refresh();
  };

  const byButton = (by, label) => h("button", {
    type: "button", "aria-pressed": String(setup.by === by),
    onclick: () => { if (setup.by !== by) { setup.by = by; save(); renderSetup(); app.querySelector(`[data-by="${by}"]`)?.focus(); } },
    "data-by": by,
  }, label);

  /* feedback + timer */
  const feedbackCard = (value, title, sub) => {
    const input = h("input", { type: "radio", name: "feedback", value, checked: setup.feedback === value });
    input.addEventListener("change", () => { setup.feedback = value; save(); });
    return h("label", { class: "choice" }, input, h("span", null, title), h("span", { class: "sub" }, sub));
  };
  const timed = h("input", { type: "checkbox", checked: setup.timed });
  timed.addEventListener("change", () => { setup.timed = timed.checked; save(); });

  const history = store.get("history", []);

  app.replaceChildren(h("div", { class: "page" },
    h("header", { class: "page-head" },
      h("h1", null, "Mock test"),
      h("p", null, "Choose what to cover and how long it should be. Questions and answer options are shuffled every time.")),

    resume && h("div", { class: "notice", role: "status" }, ui.confirm === "discard"
      ? [
        h("p", null, "Discard the unfinished test? Its answers will be lost."),
        h("div", { class: "actions" },
          h("button", { class: "btn small", type: "button", onclick: () => { store.set("test", undefined); ui.confirm = null; renderSetup(); } }, "Discard test"),
          h("button", { class: "btn primary small", type: "button", onclick: () => { ui.confirm = null; renderSetup(); app.querySelector(".notice .btn:not(.primary)")?.focus(); } }, "Keep it")),
      ]
      : [
        h("p", null, `You have an unfinished test: ${Object.keys(resume.answers).length} of ${resume.items.length} answered.`),
        h("div", { class: "actions" },
          h("button", { class: "btn primary small", type: "button", onclick: () => { location.hash = "#/test/run"; } }, "Resume"),
          h("button", { class: "btn small", type: "button", onclick: () => { ui.confirm = "discard"; renderSetup(); app.querySelector(".notice .btn.primary")?.focus(); } }, "Discard")),
      ]),

    h("section", { class: "step", "aria-labelledby": "cover-h" },
      h("div", { class: "step-head" }, h("h2", { id: "cover-h" }, "What to cover"), avail),
      h("div", { class: "step-tools" },
        h("div", { class: "seg", role: "group", "aria-label": "Choose by" }, byButton("topic", "Topics"), byButton("quiz", "Quizzes")),
        h("span", { class: "spacer" }),
        h("button", { class: "link-btn", type: "button", onclick: () => setAll(true) }, "Select all"),
        h("button", { class: "link-btn", type: "button", onclick: () => setAll(false) }, "Clear")),
      h("div", { class: "chips" }, boxes)),

    h("section", { class: "step", "aria-labelledby": "len-h" },
      h("div", { class: "step-head" }, h("h2", { id: "len-h" }, "Number of questions")),
      lengthRow),

    h("section", { class: "step", "aria-labelledby": "fb-h" },
      h("div", { class: "step-head" }, h("h2", { id: "fb-h" }, "When to show answers")),
      h("div", { class: "choice-cards", role: "radiogroup", "aria-labelledby": "fb-h" },
        feedbackCard("end", "At the end", "Score and a full review after you submit."),
        feedbackCard("instant", "After each question", "See the right answer as soon as you pick."))),

    h("section", { class: "step", "aria-labelledby": "time-h" },
      h("div", { class: "step-head" }, h("h2", { id: "time-h" }, "Time limit")),
      h("label", { class: "switch" }, timed, h("span", { class: "track" }), "One minute per question, submitted automatically when time runs out")),

    h("div", { class: "start-row" }, startBtn, note),
    ui.confirm === "replace" && replaceConfirm(resume, begin, () => { renderSetup(); app.querySelector(".start-row .btn")?.focus(); }),

    history.length > 0 && h("section", { class: "history", "aria-labelledby": "hist-h" },
      h("h2", { id: "hist-h" }, "Recent results"),
      history.map((r) => h("div", { class: "hist-row" },
        h("span", { class: "when" }, new Date(r.when).toLocaleDateString(undefined, { day: "numeric", month: "short" })),
        h("span", { class: "what", title: r.label }, r.label),
        h("span", { class: "score" }, `${r.score}/${r.total}`))))));
  refresh();
}

/* ---------- runner ---------- */

function renderRunner() {
  const test = activeTest();
  if (!test) return location.replace("#/test");
  const item = test.items[test.pos];
  const q = data.byId.get(item.id);
  const total = test.items.length;
  const answered = Object.keys(test.answers).length;
  const chosen = test.answers[q.id];
  const instant = test.feedback === "instant";
  const locked = instant && chosen != null;
  const last = test.pos === total - 1;
  const animate = ui.lastPos !== test.pos;
  ui.lastPos = test.pos;
  setTitle(`Question ${test.pos + 1} of ${total}`);

  const save = () => store.set("test", test);
  const goTo = (pos) => { test.pos = pos; ui.confirm = null; save(); renderRunner(); window.scrollTo(0, 0); };

  const verdict = (orig) => (orig === q.answer ? "Correct." : `Not quite. The answer is ${letter(item.order.indexOf(q.answer))}.`);
  const pick = (orig) => {
    if (locked) return;
    const hadFocus = document.activeElement?.classList.contains("run-opt");
    test.answers[q.id] = orig;
    save();
    renderRunner();
    if (instant) announce(verdict(orig));
    if (hadFocus) (app.querySelector('.run-opt[aria-checked="true"]:not(:disabled)') || app.querySelector("[data-next]"))?.focus();
    // On a small screen the verdict can land below the fold; bring it up.
    app.querySelector(".feedback")?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  };
  const askConfirm = (kind) => { ui.confirm = kind; ui.focusConfirm = true; renderRunner(); };

  /* head */
  const timer = h("span", { class: "timer", role: "timer", "aria-label": "Time left" });
  const head = h("div", { class: "run-head" },
    h("div", { class: "run-meta" },
      h("h1", { class: "run-pos" }, `Question ${test.pos + 1} of ${total}`),
      h("span", { class: "run-topic" }, data.topicName[q.topic])),
    h("div", { class: "run-tools" },
      test.deadline && timer,
      h("button", {
        class: "btn ghost small", type: "button", "aria-expanded": String(ui.overview),
        onclick: () => { ui.overview = !ui.overview; renderRunner(); },
      }, icon("squares-four"), h("span", null, `${answered}/${total}`, h("span", { class: "long" }, " answered"))),
      h("button", { class: "btn ghost small", type: "button", onclick: () => askConfirm("end") }, "End test")));

  /* overview grid */
  const overview = ui.overview && h("div", { class: "overview" },
    h("div", { class: "overview-grid" }, test.items.map((it, i) => {
      const a = test.answers[it.id];
      const state = a == null ? "" : instant ? (a === data.byId.get(it.id).answer ? "right" : "wrong") : "answered";
      return h("button", {
        class: state ? `ov ${state}` : "ov", type: "button", "aria-current": String(i === test.pos),
        "aria-label": `Question ${i + 1}${state ? `, ${state}` : ""}`,
        onclick: () => goTo(i),
      }, i + 1);
    })),
    h("p", { class: "overview-legend" }, "Jump to any question. Filled squares are answered."));

  /* confirm bar */
  const unanswered = total - answered;
  const confirm = ui.confirm && h("div", { class: "confirm", role: "alertdialog", "aria-label": "Confirm submit", "aria-describedby": "confirm-msg" },
    h("p", { id: "confirm-msg" }, ui.confirm === "end"
      ? (unanswered ? `End now? ${unanswered} unanswered ${unanswered === 1 ? "question counts" : "questions count"} as skipped.` : "End the test and see your score?")
      : `${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still unanswered. Submit anyway?`),
    h("button", { class: "btn primary small", type: "button", onclick: () => finish(test) }, "Submit"),
    ui.confirm === "end" && h("button", { class: "btn small", type: "button", onclick: () => { store.set("test", undefined); location.hash = "#/test"; } }, "Discard test"),
    h("button", { class: "btn ghost small", type: "button", onclick: () => { ui.confirm = null; renderRunner(); } }, "Keep going"));

  /* question + options */
  const opts = h("div", { class: "run-opts", role: "radiogroup", "aria-label": "Answer options" },
    item.order.map((orig, k) => {
      let cls = "run-opt";
      let mark = h("span");
      if (locked && orig === q.answer) { cls += " is-right"; mark = icon("check"); }
      else if (locked && orig === chosen) { cls += " is-wrong"; mark = icon("x"); }
      return h("button", {
        class: cls, type: "button", role: "radio", "aria-checked": String(orig === chosen),
        disabled: locked, onclick: () => pick(orig),
      }, h("span", { class: "key" }, letter(k)), h("span", { class: "rich" }, optionText(q.options[orig])), mark);
    }));

  // Re-rendered on every pick, so it can't be a live region itself; pick() announces the verdict.
  const feedback = locked && h("div", { class: "feedback" },
    h("p", { class: chosen === q.answer ? "verdict right" : "verdict wrong" }, verdict(chosen)),
    whyBlock(q, chosen === q.answer));

  const next = () => {
    if (!last) return goTo(test.pos + 1);
    if (unanswered) askConfirm("submit"); else finish(test);
  };

  // "End test" asks up top, next to its button; the last question's Submit asks down by the footer.
  app.replaceChildren(h("div", { class: "runner" },
    head, overview, ui.confirm === "end" && confirm,
    h("article", { class: animate ? "run-q enter" : "run-q", "aria-label": `Question ${test.pos + 1}` },
      h("div", { class: "q-text rich" }, rich(q.text)), opts, feedback),
    ui.confirm === "submit" && confirm,
    h("div", { class: "run-foot" },
      h("button", { class: "btn", type: "button", disabled: test.pos === 0, onclick: () => goTo(test.pos - 1) }, icon("arrow-left"), "Previous"),
      h("span", { class: "grow" }),
      h("span", { class: "keys-hint" }, h("kbd", null, "1"), "–", h("kbd", null, `${q.options.length}`), " to answer, ", h("kbd", null, "Enter"), " for next"),
      h("button", { class: "btn primary", type: "button", onclick: next, "data-next": "" },
        last ? "Submit" : "Next", !last && icon("arrow-right")))));

  if (ui.focusConfirm) {
    ui.focusConfirm = false;
    confirm.querySelector(".btn.primary").focus(); // also scrolls it into view
  }

  keyHandlers = { pick: (k) => item.order[k] != null && pick(item.order[k]), next, prev: () => test.pos > 0 && goTo(test.pos - 1) };

  if (test.deadline) {
    const tick = () => {
      const left = Math.max(0, Math.round((test.deadline - Date.now()) / 1000));
      timer.replaceChildren(icon("timer"), `${Math.floor(left / 60)}:${pad(left % 60)}`);
      timer.classList.toggle("low", left <= 60);
      if (left === 0) finish(test);
    };
    clearInterval(timerId);
    tick();
    timerId = setInterval(tick, 1000);
  }
}

let keyHandlers = null;
document.addEventListener("keydown", (e) => {
  if (view !== "run" || !keyHandlers || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const key = e.key.toLowerCase();
  if (/^[1-9]$/.test(key)) keyHandlers.pick(Number(key) - 1);
  else if (/^[a-f]$/.test(key)) keyHandlers.pick(key.charCodeAt(0) - 97);
  else if (key === "enter" && tag !== "BUTTON" && tag !== "A") keyHandlers.next();
  else if (key === "arrowright") keyHandlers.next();
  else if (key === "arrowleft") keyHandlers.prev();
  else return;
  e.preventDefault();
});

function finish(test) {
  clearInterval(timerId);
  const score = test.items.filter((it) => test.answers[it.id] === data.byId.get(it.id).answer).length;
  const result = { ...test, finished: Date.now(), score };
  store.set("result", result);
  store.set("test", undefined);
  const history = store.get("history", []);
  history.unshift({ when: result.finished, label: test.label, score, total: test.items.length });
  store.set("history", history.slice(0, 8));
  location.hash = "#/test/results";
}

/* ---------- results ---------- */

function renderResults() {
  const r = lastResult();
  const rows = r.items.map((it) => {
    const q = data.byId.get(it.id);
    const chosen = r.answers[it.id];
    return { it, q, chosen, status: chosen == null ? "skipped" : chosen === q.answer ? "right" : "wrong" };
  });
  const total = rows.length;
  const score = rows.filter((x) => x.status === "right").length;
  const wrong = rows.filter((x) => x.status === "wrong").length;
  const skipped = total - score - wrong;
  const missed = rows.filter((x) => x.status !== "right").map((x) => x.q);
  const minutes = Math.max(1, Math.round((r.finished - r.started) / 60000));
  setTitle(`Result ${score}/${total}`);

  if (!ui.filter) ui.filter = wrong ? "wrong" : "all";

  const byTopic = new Map();
  for (const x of rows) {
    const t = byTopic.get(x.q.topic) || { right: 0, total: 0 };
    t.total += 1;
    if (x.status === "right") t.right += 1;
    byTopic.set(x.q.topic, t);
  }
  const topicRows = [...byTopic.entries()].sort((a, b) => a[1].right / a[1].total - b[1].right / b[1].total);

  const filters = [["all", "All", total], ["wrong", "Wrong", wrong], ["skipped", "Skipped", skipped]];
  const shown = rows.filter((x) => ui.filter === "all" || x.status === ui.filter);

  const retry = () => startTest(makeTest(shuffle(missed), { label: `Retry: ${r.label}`, feedback: r.feedback, timed: r.timed }));
  // Reachable mid-test with the back button, so a retry must not silently replace that test.
  const unfinished = activeTest();

  app.replaceChildren(h("div", { class: "page" },
    h("section", { class: "score-block", "aria-labelledby": "result-h" },
      h("h1", { id: "result-h", class: "sr-only" }, "Test result"),
      h("p", { class: "score" }, h("span", { class: "big" }, score), h("span", { class: "of" }, `/ ${total}`)),
      h("p", { class: "score-sub" }, `${Math.round((score / total) * 100)}% correct. ${wrong} wrong, ${skipped} skipped.`),
      h("p", { class: "score-scope" }, `${r.label}, ${minutes} min`),
      h("div", { class: "score-actions" },
        missed.length > 0 && h("button", {
          class: "btn primary", type: "button", onclick: () => (unfinished ? askReplace(renderResults) : retry()),
        }, icon("arrow-counter-clockwise"), `Retry ${missed.length} missed`),
        h("a", { class: missed.length ? "btn" : "btn primary", href: "#/test" }, "New test")),
      ui.confirm === "replace" && replaceConfirm(unfinished, retry, () => { renderResults(); app.querySelector(".score-actions .btn")?.focus(); })),

    topicRows.length > 1 && h("section", { class: "breakdown", "aria-labelledby": "bd-h" },
      h("h2", { id: "bd-h" }, "By topic"),
      h("div", { class: "bd-rows" }, topicRows.map(([id, t]) => h("div", { class: "bd-row" },
        h("span", null, data.topicName[id]),
        h("span", { class: t.right === t.total ? "v full" : "v" }, `${t.right} of ${t.total}`))))),

    h("section", { class: "review", "aria-labelledby": "rv-h" },
      h("div", { class: "review-head" },
        h("h2", { id: "rv-h" }, "Review"),
        h("div", { class: "seg", role: "group", "aria-label": "Filter review" }, filters.map(([id, label, n]) =>
          h("button", { type: "button", "aria-pressed": String(ui.filter === id), onclick: () => { ui.filter = id; renderResults(); } },
            label, h("span", { class: "n" }, n))))),
      shown.length
        ? h("ol", { class: "qlist" }, shown.map((x) => reviewItem(x, rows.indexOf(x))))
        : h("div", { class: "empty" }, h("p", null, ui.filter === "wrong" ? "Nothing wrong. Every answered question was correct." : "Nothing skipped.")))));
}

/** Written feedback for this outcome (a skip gets the "wrong" note), else the quiz's own explanation. */
function whyBlock(q, right) {
  if (q.feedback) return explainBlock(q.feedback[right ? "right" : "wrong"]);
  return q.explain && explainBlock(q.explain);
}

function reviewItem({ it, q, chosen, status }, i) {
  return h("li", { class: "q" },
    h("div", { class: "q-num", "aria-hidden": "true" }, pad(i + 1)),
    h("div", { class: "q-body" },
      h("div", { class: "q-text rich" }, rich(q.text)),
      h("ol", { class: "opts" }, it.order.map((orig, k) => {
        const right = orig === q.answer;
        const mine = orig === chosen;
        const cls = right ? "opt is-correct" : mine ? "opt is-wrong" : "opt";
        return h("li", { class: cls },
          h("span", { class: "key" }, letter(k)),
          h("span", { class: "rich" }, optionText(q.options[orig]), mine && h("span", { class: "yours" }, "your answer")),
          right ? icon("check") : mine ? icon("x") : h("span"),
          right && h("span", { class: "sr-only" }, "(correct answer)"));
      })),
      status === "skipped" && h("p", { class: "tag-skipped" }, "Skipped"),
      whyBlock(q, status === "right"),
      h("p", { class: "q-src" }, data.topicName[q.topic])));
}
