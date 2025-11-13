// Import utility functions and modules
import { $, fetchJSON, normalizeRepo, ellipsize, semverCompare, parseDateString } from './utils.js';
import { fetchRepo } from './repo-loader.js';
import { initSearch, addApps, searchApps } from './search.js';

// Constants
const KEY = 'ripe_sources'; // Key for local storage
const DEFAULTS = ['RipeStore']; // Default repository source
const BATCH = 20; // Number of apps to load incrementally

// Application state
const state = {
  allMerged: [], // All apps from all sources, merged by bundle ID
  list: [], // Apps currently displayed
  rendered: 0, // Number of apps rendered on the screen
  q: '', // Search query
  sort: '' // Sort order
};

/**
 * Displays a skeleton loading indicator.
 * @param {number} count - The number of skeleton loaders to show.
 */
function showSkeleton(count = 6) {
  const c = $('#grid');
  c.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const sk = document.createElement('div');
    sk.className = 'app-skeleton';
    c.appendChild(sk);
  }
  state.rendered = 0;
}

/**
 * Retrieves the list of sources from local storage.
 * @returns {string[]} An array of source URLs.
 */
function getSources() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || DEFAULTS;
  } catch (_) {
    return DEFAULTS;
  }
}

/**
 * Merges apps from different sources by their bundle ID.
 * @param {Array} apps - An array of app objects.
 * @returns {Array} An array of merged app objects.
 */
function mergeByBundle(apps) {
  const map = new Map();
  for (const a of apps) {
    const b = (a.bundle || '').trim();
    if (!b) { // Keep separate when no bundle ID
      const key = Symbol('nobundle'); // Ensure uniqueness
      map.set(key, a);
      continue;
    }
    if (!map.has(b)) {
      map.set(b, { ...a, versions: [...(a.versions || [])] });
    } else {
      const acc = map.get(b);
      // Merge properties
      acc.name = acc.name || a.name;
      acc.icon = acc.icon || a.icon;
      acc.dev = acc.dev || a.dev;
      acc.desc = acc.desc || a.desc;
      // Merge versions, avoiding duplicates
      const seen = new Set(acc.versions.map(v => `${v.version}|${v.url}`));
      for (const v of (a.versions || [])) {
        const id = `${v.version}|${v.url}`;
        if (!seen.has(id)) {
          acc.versions.push(v);
          seen.add(id);
        }
      }
      map.set(b, acc);
    }
  }

  // Sort versions by date or version number
  for (const v of map.values()) {
    if (Array.isArray(v.versions)) {
      v.versions.sort((x, y) => {
        const dx = x.date ? new Date(x.date) : null;
        const dy = y.date ? new Date(y.date) : null;
        if (dx && dy) return dy - dx;
        if (dx) return -1;
        if (dy) return 1;
        return semverCompare(y.version, x.version);
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Sorts an array of apps based on the selected sort mode.
 * @param {Array} apps - The array of apps to sort.
 * @param {string} mode - The sorting mode.
 * @returns {Array} The sorted array of apps.
 */
function sortApps(apps, mode) {
  const byNameAsc = (a, b) => a.name.localeCompare(b.name);
  const byNameDesc = (a, b) => b.name.localeCompare(a.name);
  const getLatestDate = (app) => {
    const dateStr = app.versions?.[0]?.date;
    return parseDateString(dateStr);
  };

  const byVerDesc = (a, b) => {
    const dateA = getLatestDate(a);
    const dateB = getLatestDate(b);
    if (dateA && dateB) return dateB.getTime() - dateA.getTime();
    if (dateA) return -1;
    if (dateB) return 1;
    return a.name.localeCompare(b.name);
  };

  const byVerAsc = (a, b) => {
    const dateA = getLatestDate(a);
    const dateB = getLatestDate(b);
    if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    if (dateA) return 1;
    if (dateB) return -1;
    return a.name.localeCompare(b.name);
  };

  switch (mode) {
    case 'name-desc': return apps.sort(byNameDesc);
    case 'version-desc': return apps.sort(byVerDesc);
    case 'version-asc': return apps.sort(byVerAsc);
    default: return apps.sort(byNameAsc);
  }
}

/**
 * Loads all apps from all sources.
 */
async function loadAll() {
  const sources = getSources();
  state.allMerged = [];
  $('#grid').innerHTML = '';
  showSkeleton(12);

  const promises = sources.map(src => (async () => {
    try {
      const out = await fetchRepo(src);
      const apps = normalizeRepo(out.data, out.url);
      addApps(apps);
      state.allMerged = state.allMerged.concat(apps);
      if (!state.q || state.q.trim() === '') {
        renderAppsIncrementally(apps);
      }
      return { src, ok: true };
    } catch (err) {
      return { src, ok: false, err: String(err) };
    }
  })());

  await Promise.allSettled(promises);
  const merged = mergeByBundle(state.allMerged);
  state.allMerged = merged;
  initSearch(state.allMerged);
  filterAndPrepare();
}

/**
 * Filters and prepares the list of apps to be displayed based on search and sort state.
 */
function filterAndPrepare() {
  const q = state.q.trim();
  let appsToProcess = [];

  if (q) {
    // When searching, flatten all versions from all merged apps
    const allIndividualVersions = [];
    state.allMerged.forEach(app => {
      if (app.versions && app.versions.length) {
        app.versions.forEach(v => {
          allIndividualVersions.push({ ...app, ...v, _isVersion: true });
        });
      } else {
        allIndividualVersions.push({ ...app, _isVersion: true });
      }
    });
    appsToProcess = searchApps(q, allIndividualVersions);
  } else {
    appsToProcess = state.allMerged;
  }

  // Filter out apps without a date if sorting by version date
  if (state.sort === 'version-desc' || state.sort === 'version-asc') {
    appsToProcess = appsToProcess.filter(app => {
      const dateStr = app.date;
      return parseDateString(dateStr) !== null;
    });
  }

  state.list = appsToProcess;
  sortApps(state.list, state.sort);

  state.rendered = 0;
  $('#grid').innerHTML = '';
  appendBatch();
}

/**
 * Renders a batch of apps incrementally.
 * @param {Array} apps - The array of apps to render.
 */
function renderAppsIncrementally(apps) {
  if (!Array.isArray(apps) || apps.length === 0) return;
  const grid = $('#grid');
  apps.forEach(a => {
    grid.appendChild(buildCard(a));
    state.rendered++;
  });
}

/**
 * Appends the next batch of apps to the grid.
 */
function appendBatch() {
  const grid = $('#grid');
  const next = Math.min(state.rendered + BATCH, state.list.length);
  for (let i = state.rendered; i < next; i++) {
    const a = state.list[i];
    grid.appendChild(buildCard(a));
  }
  state.rendered = next;
}

/**
 * Builds an app card element.
 * @param {object} a - The app object.
 * @returns {HTMLElement} The app card element.
 */
function buildCard(a) {
  const card = document.createElement('a');
  card.className = 'card no-underline';
  const versionLabel = a._verEntry ? a._verEntry.version : (a.versions?.[0]?.version || '');
  const link = makeLink(a, versionLabel);
  card.href = link;
  card.setAttribute('role', 'listitem');

  const icon = document.createElement('div');
  icon.className = 'icon-wrap';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = (a.name || a.bundle) + ' icon';
  img.src = a.icon || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  icon.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const title = document.createElement('div');
  title.className = 'title ellipsis';
  title.textContent = a.name || a.bundle;
  const sub = document.createElement('div');
  sub.className = 'sub ellipsis';
  sub.textContent = a.dev || a.bundle;
  const ver = document.createElement('div');
  ver.className = 'small ellipsis';
  ver.textContent = versionLabel ? `Version ${ellipsize(versionLabel, 48)}` : '';
  const snippet = document.createElement('div');
  snippet.className = 'desc-snippet ellipsis';

  const notes = a._verEntry?.notes || a.desc || '';
  snippet.textContent = ellipsize(notes, 120);

  meta.appendChild(title);
  meta.appendChild(sub);
  meta.appendChild(ver);
  meta.appendChild(snippet);

  const right = document.createElement('div');
  right.className = 'right';
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.textContent = 'View';
  right.appendChild(pill);

  card.appendChild(icon);
  card.appendChild(meta);
  card.appendChild(right);
  return card;
}

/**
 * Creates a link to the app details page.
 * @param {object} a - The app object.
 * @param {string} version - The app version.
 * @returns {string} The URL for the app details page.
 */
function makeLink(a, version) {
  const params = new URLSearchParams();
  params.set('bundle', a.bundle);
  if (version) params.set('version', version);
  params.set('repo', a.source);
  return 'app?' + params.toString();
}

// Event listener for the search input
document.getElementById('search').addEventListener('input', e => {
  state.q = e.target.value;
  debounce(filterAndPrepare, 220)();
});

// Event listener for the sort dropdown
document.getElementById('sort').addEventListener('change', e => {
  state.sort = e.target.value;
  filterAndPrepare();
});

// Infinite scroll functionality
let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 400);
    if (nearBottom) appendBatch();
    ticking = false;
  });
});

/**
 * Debounces a function to limit the rate at which it gets called.
 * @param {Function} fn - The function to debounce.
 * @param {number} ms - The debounce timeout in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(fn, ms = 200) {
  let id;
  return (...a) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), ms);
  };
}

// Initial load of all apps
loadAll();
