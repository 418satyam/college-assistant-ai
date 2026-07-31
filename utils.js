/**
 * utils.js
 * ------------------------------------------------------------------
 * Reusable, dependency-free helper functions shared across the app:
 * HTML sanitization, lightweight markdown rendering, storage helpers,
 * id/date formatting, and small DOM utilities.
 * ------------------------------------------------------------------
 */

/* ---------------------------------------------------------------- */
/*  Security: HTML escaping & sanitization                          */
/* ---------------------------------------------------------------- */

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
};

/** Escapes a raw string so it is safe to inject as text content. */
export function escapeHTML(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"'/]/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Renders a constrained, safe subset of Markdown to HTML.
 * Supports: **bold**, *italic*, `inline code`, ```code blocks```,
 * [links](url), bullet/numbered lists, and paragraphs.
 * All text content is escaped first, so no raw HTML can leak through.
 */
export function renderMarkdown(rawText) {
  if (!rawText) return "";

  // 1. Escape everything first — nothing after this point is raw HTML.
  let text = escapeHTML(rawText);

  // 2. Fenced code blocks ```...```
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code.trim());
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
  });

  // 3. Inline code `...`
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // 4. Bold **...** and italics *...*
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // 5. Links [label](https://safe-url) — restrict to http(s)/mailto to prevent javascript: URIs
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // 6. Lists — group consecutive bullet/numbered lines
  const lines = text.split("\n");
  const out = [];
  let listBuffer = [];
  let listType = null;

  const flushList = () => {
    if (listBuffer.length) {
      const tag = listType === "ol" ? "ol" : "ul";
      out.push(`<${tag}>${listBuffer.map((li) => `<li>${li}</li>`).join("")}</${tag}>`);
      listBuffer = [];
      listType = null;
    }
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*•]\s+(.*)/);
    const numberMatch = line.match(/^\s*\d+[.)]\s+(.*)/);

    if (bulletMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listBuffer.push(bulletMatch[1]);
    } else if (numberMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listBuffer.push(numberMatch[1]);
    } else {
      flushList();
      if (line.trim() === "") continue;
      out.push(`<p>${line}</p>`);
    }
  }
  flushList();

  let html = out.join("");

  // 7. Restore code blocks as <pre><code>
  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, idx) => {
    return `<pre><code>${codeBlocks[Number(idx)]}</code></pre>`;
  });

  return html || `<p>${text}</p>`;
}

/* ---------------------------------------------------------------- */
/*  IDs, timestamps, formatting                                     */
/* ---------------------------------------------------------------- */

/** Generates a RFC4122-ish unique id using crypto when available. */
export function generateId(prefix = "id") {
  if (window.crypto && window.crypto.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Formats a Date (or timestamp) as a short local time, e.g. "2:45 PM". */
export function formatTime(input) {
  const date = input instanceof Date ? input : new Date(input);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Formats a Date as a relative/short label for history lists. */
export function formatRelativeDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return formatTime(date);
  if (isYesterday) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Truncates a string to a max length, adding an ellipsis if needed. */
export function truncate(str, maxLen = 42) {
  if (!str) return "";
  return str.length > maxLen ? `${str.slice(0, maxLen).trim()}…` : str;
}

/* ---------------------------------------------------------------- */
/*  Local storage helpers (namespaced, JSON-safe, fail gracefully)  */
/* ---------------------------------------------------------------- */

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[storage] Failed to read "${key}":`, err);
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`[storage] Failed to write "${key}":`, err);
      return false;
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      console.warn(`[storage] Failed to remove "${key}":`, err);
    }
  },
};

/* ---------------------------------------------------------------- */
/*  Small DOM / interaction helpers                                 */
/* ---------------------------------------------------------------- */

/** Debounces a function by the given delay (ms). */
export function debounce(fn, delay = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Auto-grows a <textarea> up to a max height as the user types. */
export function autoGrowTextarea(el, maxHeight = 160) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
}

/** Adds a Material-style ripple effect to a click event on a button. */
export function spawnRipple(evt, el) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "ripple-circle";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${(evt.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
  ripple.style.top = `${(evt.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
  el.classList.add("ripple");
  el.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
}

/** Copies text to the clipboard, with a legacy fallback. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (err) {
      console.warn("[clipboard] Copy failed:", err);
      return false;
    }
  }
}

/** Triggers a browser download of the given text content as a file. */
export function downloadTextFile(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
