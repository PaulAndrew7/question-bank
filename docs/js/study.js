import { h, icon, rich, optionText, explainBlock, letter, pad, setTitle, scrollBehavior } from "./dom.js";
import { store } from "./store.js";

let query = ""; // kept across group switches for this visit only
let searchTimer = 0;
let topObserver = null;

export function leaveStudy() {
  topObserver?.disconnect();
  topObserver = null;
}

export function renderStudy(app, data, args) {
  const mode = args[0] === "quiz" ? "quiz" : "topic";
  const groups = mode === "topic"
    ? data.topics.map((t) => ({ id: t.id, name: t.name, count: t.count }))
    : data.quizzes.map((z) => ({ id: z.id, name: z.name, kicker: z.kicker, count: z.count }));
  const groupId = groups.some((g) => g.id === args[1]) ? args[1] : "all";
  const group = groups.find((g) => g.id === groupId);
  const inGroup = groupId === "all"
    ? data.questions
    : data.questions.filter((q) => (mode === "topic" ? q.topic === groupId : q.quizzes.includes(groupId)));

  const title = group ? (group.kicker ? `${group.kicker}: ${group.name}` : group.name) : "All questions";
  setTitle(title);

  /* ----- sidebar ----- */
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Group questions by" },
    h("button", { type: "button", "aria-pressed": String(mode === "topic"), onclick: () => go("topic", "all") }, "Topics"),
    h("button", { type: "button", "aria-pressed": String(mode === "quiz"), onclick: () => go("quiz", "all") }, "Quizzes"));

  const link = (g) => h("a", {
    class: "group", href: `#/study/${mode}/${g.id}`, "aria-current": String(g.id === groupId),
  },
  h("span", null, g.kicker && h("span", { class: "g-kicker" }, g.kicker), h("span", { class: "g-name" }, g.name)),
  h("span", { class: "count" }, g.count));

  const side = h("aside", { class: "side" },
    seg,
    h("nav", { class: "groups", "aria-label": mode === "topic" ? "Topics" : "Quizzes" },
      link({ id: "all", name: "All questions", count: data.questions.length }),
      h("div", { class: "sep", role: "presentation" }),
      groups.map(link)));

  /* ----- content ----- */
  const meta = h("p", { class: "meta" });
  const list = h("ol", { class: "qlist" });
  const scopeNote = h("div");

  const input = h("input", {
    id: "study-search", name: "q", type: "search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search",
    placeholder: "Question or answer text…", value: query,
  });
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = input.value.trim().toLowerCase(); paint(); }, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) { input.value = ""; query = ""; paint(); }
    // The on-screen keyboard's Search key: apply now and close the keyboard so the results show.
    if (e.key === "Enter" && matchMedia("(pointer: coarse)").matches) {
      clearTimeout(searchTimer);
      query = input.value.trim().toLowerCase();
      paint();
      input.blur();
    }
  });

  const showOptions = h("input", { type: "checkbox", checked: store.get("showOptions", false) });
  showOptions.addEventListener("change", () => { store.set("showOptions", showOptions.checked); paint(); });

  const content = h("section", { class: "content", "aria-labelledby": "study-title" },
    h("header", { class: "content-head" }, h("h1", { id: "study-title" }, title), meta),
    h("div", { class: "toolbar" },
      h("div", { class: "field search" },
        h("label", { for: "study-search" }, "Search"),
        h("div", { class: "input-wrap" }, icon("magnifying-glass"), input)),
      h("div", { class: "switches" },
        h("label", { class: "switch" }, showOptions, h("span", { class: "track" }), "Show all options"))),
    scopeNote,
    list);

  function paint() {
    const items = query ? inGroup.filter((q) => q.search.includes(query)) : inGroup;
    const quizCount = new Set(inGroup.flatMap((q) => q.quizzes)).size;
    meta.textContent = query
      ? `${items.length} of ${inGroup.length} questions match “${query}”`
      : mode === "topic" || groupId === "all"
        ? `${inGroup.length} questions from ${quizCount} ${quizCount === 1 ? "quiz" : "quizzes"}`
        : `${inGroup.length} questions`;

    scopeNote.replaceChildren();
    if (query && groupId !== "all") {
      scopeNote.append(h("p", { class: "q-src", style: "margin:14px 0 0" },
        `Searching ${title} only. `,
        h("button", { class: "link-btn", type: "button", onclick: () => go(mode, "all") }, "Search all questions")));
    }

    if (!items.length) {
      list.replaceChildren(h("li", { class: "empty" },
        h("h2", null, "No matching questions"),
        h("p", null, "Try fewer or different words. Search looks at question text, options and explanations."),
        h("button", { class: "btn", type: "button", onclick: () => { input.value = ""; query = ""; paint(); input.focus(); } }, "Clear search")));
      return;
    }
    list.replaceChildren(...items.map((q, i) => questionItem(q, i, data, mode, showOptions.checked, query)));
  }

  // On narrow screens the group list sits above a long page; this brings it back. Hidden on desktop by CSS.
  const toolbar = content.querySelector(".toolbar");
  const toTop = h("button", {
    class: "to-top", type: "button", "aria-label": "Back to top", title: "Back to top",
    onclick: () => {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      side.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
    },
  }, icon("arrow-up"));

  app.replaceChildren(h("div", { class: "study" }, side, content, toTop));
  paint();
  const nav = side.querySelector(".groups");
  const current = nav.querySelector('[aria-current="true"]');
  if (current && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = current.offsetLeft - nav.offsetLeft - parseFloat(getComputedStyle(nav).paddingLeft);

  leaveStudy();
  topObserver = new IntersectionObserver(([e]) => {
    toTop.classList.toggle("show", !e.isIntersecting && e.boundingClientRect.top < 0);
  });
  topObserver.observe(toolbar);
}

function go(mode, id) {
  location.hash = `#/study/${mode}/${id}`;
}

function questionItem(q, i, data, mode, allOptions, query) {
  const correct = q.options[q.answer];
  const body = [h("div", { class: "q-text rich" }, rich(q.text, query))];

  if (allOptions) {
    body.push(h("ol", { class: "opts", "aria-label": "Options" }, q.options.map((o, k) => {
      const ok = k === q.answer;
      return h("li", { class: ok ? "opt is-correct" : "opt" },
        h("span", { class: "key" }, letter(k)),
        h("span", { class: "rich" }, optionText(o, query)),
        ok ? icon("check") : h("span"),
        ok ? h("span", { class: "sr-only" }, "(correct answer)") : null);
    })));
  } else {
    body.push(h("div", { class: "answer rich" }, icon("check"),
      h("span", null, h("span", { class: "sr-only" }, "Answer: "), optionText(correct, query))));
  }

  if (q.explain) body.push(explainBlock(q.explain, query));

  const sources = q.quizzes.map((z) => data.quizById[z]?.kicker).filter(Boolean).join(", ");
  body.push(h("p", { class: "q-src" }, mode === "topic" ? sources : `${data.topicName[q.topic]}  ·  ${sources}`));

  return h("li", { class: "q" },
    h("div", { class: "q-num", "aria-hidden": "true" }, pad(i + 1)),
    h("div", { class: "q-body" }, body));
}
