/**
 * A shorthand for document.querySelector.
 */
export const $ = (q, el = document) => el.querySelector(q);

/**
 * A shorthand for document.querySelectorAll.
 */
export const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

/**
 * Gets a query string parameter from the URL.
 */
export function qs(k) {
  try {
    return new URLSearchParams(location.search).get(k);
  } catch (e) {
    return null;
  }
}

/**
 * Fetches and parses JSON from a URL.
 */
export async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {}
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("Invalid JSON payload");
  return JSON.parse(m[0]);
}

/**
 * Converts URLs in text to clickable anchor tags.
 */
export function linkify(text) {
  if (!text) return "";
  // Escape HTML first
  const div = document.createElement('div');
  div.textContent = text;
  const escaped = div.innerHTML;
  // Replace URLs
  return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" class="accent" target="_blank" rel="noopener noreferrer">$1</a>');
}

/**
 * Truncates a string with an ellipsis.
 */
export function ellipsize(s, n = 120) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Parses a date string.
 */
export function parseDateString(s) {
  if (typeof s !== 'string' || s.trim() === '') return null;
  s = s.trim();
  let date = null;
  const fullDateMatch = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (fullDateMatch) {
    const [_, year, month, day, hour, minute, second] = fullDateMatch;
    date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)));
    if (!isNaN(date.getTime())) return date;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    date = new Date(t);
    if (!isNaN(date.getTime())) return date;
  }
  try {
    date = new Date(s);
    if (!isNaN(date.getTime())) return date;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Formats a date string or Date object.
 */
export function formatDate(s) {
  const d = (s instanceof Date) ? s : parseDateString(s);
  if (!d) return '';
  const opt = { year: 'numeric', month: 'short', day: 'numeric' };
  try {
    return d.toLocaleDateString(undefined, opt);
  } catch (e) {
    return d.toUTCString().split(' ').slice(1, 4).join(' ');
  }
}

/**
 * Compares two semantic version strings.
 */
export function semverCompare(a, b) {
  const seg = s => String(s || "").split(/[.+\-]/).map(x => isNaN(+x) ? x : +x);
  const A = seg(a), B = seg(b), n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i], y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === typeof y) {
      if (x < y) return -1;
      if (x > y) return 1;
    } else {
      return (typeof x === 'number') ? 1 : -1
    }
  }
  return 0;
}

/**
 * Formats bytes to a human-readable string.
 */
export function formatByteCount(bytes) {
  if (!bytes || isNaN(bytes)) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = parseFloat(bytes);
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

// Unregister legacy Service Workers to prevent caching issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
    }
  });
}
