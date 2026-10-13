import { h, icon } from "./dom.js";
import { store } from "./store.js";
import { renderStudy } from "./study.js";
import { renderTest, leaveTest } from "./test.js";

const app = document.getElementById("app");
let data = null;

async function load() {
  const res = await fetch("data/questions.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  d.byId = new Map(d.questions.map((q) => [q.id, q]));
  d.topicName = Object.fromEntries(d.topics.map((t) => [t.id, t.name]));
  d.quizById = Object.fromEntries(d.quizzes.map((z) => [z.id, z]));
  for (const q of d.questions) {
    q.search = [q.text.replaceAll("```", ""), ...q.options, q.explain].join("\n").toLowerCase();
  }
  return d;
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const section = parts[0] === "test" ? "test" : "study";
  for (const tab of document.querySelectorAll(".tab")) {
    if (tab.dataset.tab === section) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  leaveTest();
  if (section === "test") renderTest(app, data, parts.slice(1));
  else renderStudy(app, data, parts.slice(1));
  window.scrollTo(0, 0);
}

/* ---------- Theme ---------- */
const themeBtn = document.getElementById("theme-toggle");
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");

function paintThemeButton() {
  const dark = currentTheme() === "dark";
  themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
  themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  themeBtn.title = themeBtn.getAttribute("aria-label");
}
themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("theme", next);
  paintThemeButton();
});
darkQuery.addEventListener("change", paintThemeButton);
paintThemeButton();

/* ---------- Boot ---------- */
load()
  .then((d) => {
    data = d;
    window.addEventListener("hashchange", route);
    route();
  })
  .catch((err) => {
    console.error(err);
    const local = location.protocol === "file:";
    app.replaceChildren(
      h("div", { class: "page" },
        h("div", { class: "empty" },
          h("h2", null, "The question data could not be loaded"),
          h("p", null, local
            ? "Browsers block data files when index.html is opened straight from disk. Serve the folder instead, for example with: python -m http.server -d docs"
            : "Check your connection and reload the page."),
          h("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Reload"))));
  });
