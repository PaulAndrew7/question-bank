import { ICONS } from "./icons.js";

export const SITE_NAME = "Question Bank";

export function setTitle(part) {
  document.title = part ? `${part} - ${SITE_NAME}` : SITE_NAME;
}

/** Create an element. Text always goes through textContent / text nodes, never innerHTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name]; // static markup from icons.js
  return svg;
}

/** Wrap occurrences of `query` (already lower-cased) in <mark>. Returns an array of nodes/strings. */
export function highlight(text, query) {
  if (!query) return [text];
  const out = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (let j = lower.indexOf(query); j !== -1; j = lower.indexOf(query, i)) {
    if (j > i) out.push(text.slice(i, j));
    out.push(h("mark", null, text.slice(j, j + query.length)));
    i = j + query.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/** Inline text: `backtick` spans become <code>. */
export function inline(text, query) {
  return text.split(/(`[^`\n]+`)/).filter(Boolean).flatMap((seg) =>
    /^`[^`]+`$/.test(seg) ? [h("code", { translate: "no" }, highlight(seg.slice(1, -1), query))] : highlight(seg, query));
}

/** Question text: ``` fenced lines become <pre>, blank-line separated paragraphs become <p>. */
export function rich(text, query) {
  const frag = document.createDocumentFragment();
  text.split(/(?:^|\n)```(?:\n|$)/).forEach((part, i) => {
    if (i % 2) {
      frag.append(h("pre", { translate: "no" }, h("code", null, highlight(part, query))));
    } else {
      for (const para of part.split(/\n{2,}/)) {
        if (para.trim()) frag.append(h("p", null, inline(para.trim(), query)));
      }
    }
  });
  return frag;
}

/** Option text; multi-line options are code (SQL, snippets) so they keep their layout in mono. */
export function optionText(text, query) {
  return text.includes("\n")
    ? h("span", { class: "opt-text is-code", translate: "no" }, highlight(text, query))
    : h("span", { class: "opt-text" }, inline(text, query));
}

/** "Why" block under a question. Explanations can hold small tables or code, so they use rich(). */
export function explainBlock(text, query) {
  return h("div", { class: "explain rich" }, h("span", { class: "explain-label" }, "Why"), rich(text, query));
}

/** Read a message to screen readers. The live region sits outside #app, so re-renders don't replace it. */
export function announce(text) {
  const el = document.getElementById("announcer");
  el.textContent = "";
  requestAnimationFrame(() => { el.textContent = text; }); // a fresh change, so a repeated message is read again
}

/** "smooth" unless the user asked for reduced motion. */
export const scrollBehavior = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

export const letter = (i) => String.fromCharCode(65 + i);
export const pad = (n) => String(n).padStart(2, "0");

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
