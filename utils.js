/**
 * A shorthand for document.querySelector.
 * @param {string} q - The selector query.
 * @param {Element} [el=document] - The parent element to search within.
 * @returns {Element|null} The first matching element or null if not found.
 */
export const $ = (q, el = document) => el.querySelector(q);

/**
 * Parses a date string from various formats into a Date object.
 * @param {string} s - The date string to parse.
 * @returns {Date|null} The parsed Date object or null if parsing fails.
 */
export function parseDateString(s) {
  if (typeof s !== 'string' || s.trim() === '') return null;
  s = s.trim();

  let date = null;

  // Attempt 1: Handle YYYYMMDDHHmmss format
  const fullDateMatch = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (fullDateMatch) {
    const [_, year, month, day, hour, minute, second] = fullDateMatch;
    date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Attempt 2: Fallback to Date.parse for standard formats
  const t = Date.parse(s);
  if (!isNaN(t)) {
    date = new Date(t);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Attempt 3: Final fallback
  try {
    date = new Date(s);
    if (!isNaN(date.getTime())) {
      return date;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Formats a date string or Date object into a readable format.
 * @param {string|Date} s - The date string or Date object.
 * @returns {string} The formatted date string.
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
 * A shorthand for document.querySelectorAll.
 * @param {string} q - The selector query.
 * @param {Element} [el=document] - The parent element to search within.
 * @returns {Element[]} An array of matching elements.
 */
export const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

/**
 * Truncates a string with an ellipsis if it exceeds a certain length.
 * @param {string} s - The string to truncate.
 * @param {number} [n=120] - The maximum length.
 * @returns {string} The truncated string.
 */
export function ellipsize(s, n = 120) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Gets a query string parameter from the URL.
 * @param {string} k - The key of the query parameter.
 * @returns {string|null} The value of the query parameter or null if not found.
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
 * @param {string} url - The URL to fetch.
 * @returns {Promise<any>} A promise that resolves with the parsed JSON data.
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
 * Normalizes repository data from different formats into a unified structure.
 * @param {object|Array} data - The repository data.
 * @param {string} sourceUrl - The URL of the repository.
 * @returns {Array} An array of normalized app objects.
 */
export function normalizeRepo(data, sourceUrl) {
  const apps = [];
  const push = (o) => {
    if (o && (o.bundleIdentifier || o.bundleID || o.bundle || o.id)) apps.push(toUnified(o, sourceUrl));
  };
  if (Array.isArray(data)) {
    data.forEach(push);
  } else if (data && Array.isArray(data.apps)) { // AltStore-like
    data.apps.forEach(push);
  } else if (data && typeof data === 'object') { // Scarlet-like
    Object.keys(data).forEach(k => {
      if (/^(meta|info)$/i.test(k)) return;
      const v = data[k];
      if (Array.isArray(v)) v.forEach(o => push({ ...o,
        category: o.category || k
      }));
    });
  }
  return apps;
}

/**
 * Converts an app object from a repository into a unified format.
 * @param {object} o - The original app object.
 * @param {string} sourceUrl - The URL of the repository.
 * @returns {object} The unified app object.
 */
function toUnified(o, sourceUrl) {
  const bundle = o.bundleIdentifier || o.bundleID || o.bundle || o.id || "";
  const icon = o.iconURL || o.icon || o.image || "";
  const name = o.name || o.title || bundle || "Unknown";
  const dev = o.developerName || o.dev || o.developer || "";
  const desc = o.localizedDescription || o.description || o.subtitle || "";
  const category = o.category || "";
  let versions = [];
  if (Array.isArray(o.versions) && o.versions.length) {
    versions = o.versions.map(v => ({
      version: v.version || v.build || v.tag || "",
      date: v.fullDate || v.versionDate || v.date || v.published || "",
      notes: v.localizedDescription || v.changelog || v.notes || "",
      url: v.downloadURL || v.down || v.url || v.ipa || v.download || ""
    })).filter(v => v.url);
  }
  if (!versions.length) {
    const url = o.downloadURL || o.down || o.url || o.ipa || o.download || "";
    const version = o.version || o.latest || "";
    if (url) versions = [{
      version,
      date: "",
      notes: "",
      url
    }];
  }
  return {
    name,
    bundle,
    icon,
    dev,
    desc,
    category,
    versions,
    source: sourceUrl
  };
}

/**
 * Compares two semantic version strings.
 * @param {string} a - The first version string.
 * @param {string} b - The second version string.
 * @returns {number} -1 if a < b, 1 if a > b, and 0 if a == b.
 */
export function semverCompare(a, b) {
  const seg = s => String(s || "").split(/[.+\-]/).map(x => isNaN(+x) ? x : +x);
  const A = seg(a),
    B = seg(b),
    n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i],
      y = B[i];
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