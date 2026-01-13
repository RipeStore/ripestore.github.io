/**
 * Simple fast string hash.
 */
export function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

/**
 * Simple robust IndexedDB wrapper for large data storage.
 */
export const db = {
  _db: null,
  async _getDB() {
    if (this._db) return this._db;
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('RipeStoreDB', 1);
        req.onupgradeneeded = () => {
          try { req.result.createObjectStore('kv'); } catch(e) {}
        };
        req.onsuccess = () => { this._db = req.result; resolve(req.result); };
        req.onerror = () => { console.error("IDB Error", req.error); resolve(null); };
      } catch (e) {
        console.error("IDB Open Failed", e);
        resolve(null);
      }
    });
  },
  async get(k) {
    const db = await this._getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const trans = db.transaction('kv', 'readonly');
        const req = trans.objectStore('kv').get(k);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch(e) { resolve(null); }
    });
  },
  async set(k, v) {
    const db = await this._getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const trans = db.transaction('kv', 'readwrite');
        const req = trans.objectStore('kv').put(v, k);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch(e) { resolve(false); }
    });
  },
  async remove(k) {
    const db = await this._getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const trans = db.transaction('kv', 'readwrite');
        const req = trans.objectStore('kv').delete(k);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch(e) { resolve(false); }
    });
  },
  async clear() {
    const db = await this._getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const trans = db.transaction('kv', 'readwrite');
        const req = trans.objectStore('kv').clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch(e) { resolve(false); }
    });
  }
};

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
 * Fetches a key-value mapping from a JSON-like file.
 * Returns an array of { key, val } pairs.
 */
export async function fetchMapping(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return [];
    const text = await res.text();
    const pairs = [];
    const regex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      pairs.push({ key: m[1], val: m[2] });
    }
    return pairs;
  } catch (e) {
    console.error('Failed to fetch mapping', url, e);
    return [];
  }
}

/**
 * Sets up basic modal dismissal (close button and clicking outside).
 */
export function setupModal(modal, closeBtn) {
  if (!modal) return;
  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('flex');
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('flex');
  });
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
 * Parses a date string or number.
 */
export function parseDateString(s) {
  if (s === null || s === undefined) return null;
  
  // Handle numeric timestamps
  if (typeof s === 'number') {
    const date = new Date(s < 10000000000 ? s * 1000 : s);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof s !== 'string' || s.trim() === '') return null;
  s = s.trim();

  // Try parsing purely numeric strings as timestamps
  if (/^\d{10,13}$/.test(s)) {
    const num = parseInt(s);
    const date = new Date(num < 10000000000 ? num * 1000 : num);
    if (!isNaN(date.getTime())) return date;
  }

  // Handle YYYYMMDDHHMMSS or YYYYMMDD
  const pureDigits = s.replace(/[-T:Z. ]/g, '');
  if (/^\d{8}(\d{6})?$/.test(pureDigits)) {
    const year = parseInt(pureDigits.slice(0, 4));
    const month = parseInt(pureDigits.slice(4, 6)) - 1;
    const day = parseInt(pureDigits.slice(6, 8));
    const hour = pureDigits.length === 14 ? parseInt(pureDigits.slice(8, 10)) : 0;
    const min = pureDigits.length === 14 ? parseInt(pureDigits.slice(10, 12)) : 0;
    const sec = pureDigits.length === 14 ? parseInt(pureDigits.slice(12, 14)) : 0;
    const date = new Date(Date.UTC(year, month, day, hour, min, sec));
    if (!isNaN(date.getTime())) return date;
  }

  // Standard Date.parse for ISO 8601 and other common formats
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);

  // Fallback for browser-specific parsing
  try {
    const date = new Date(s);
    if (!isNaN(date.getTime())) return date;
  } catch (e) {}

  return null;
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

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds have elapsed.
 */
export function debounce(fn, ms) {
  let id;
  return (...a) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), ms);
  }
}

/**
 * Shows a toast notification.
 */
export function showToast(msg, duration = 2000) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Converts raw GitHub URLs to jsDelivr CDN URLs.
 */
export function cdnify(url) {
  if (!url || !url.startsWith('https://raw.githubusercontent.com/')) return url;
  try {
    const clean = url.replace('https://raw.githubusercontent.com/', '');
    const parts = clean.split('/');
    if (parts.length < 3) return url;
    
    const user = parts[0];
    const repo = parts[1];
    let branch = parts[2];
    let pathParts = parts.slice(3);
    
    // Special handling for refs/heads which might appear in some raw urls constructed manually
    if (branch === 'refs' && pathParts[0] === 'heads') {
        branch = pathParts[1];
        pathParts = pathParts.slice(2);
    }
    
    return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${pathParts.join('/')}`;
  } catch (e) {
    return url;
  }
}

// Unregister legacy Service Workers to prevent caching issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
    }
  });
}
