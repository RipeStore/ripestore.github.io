// Import utility functions
import { $, qs, fetchJSON, normalizeRepo, semverCompare, ellipsize, parseDateString, formatDate } from './utils.js';

/**
 * Retrieves the configured sources from local storage.
 * @returns {string[]} An array of source URLs.
 */
function getConfiguredSources() {
  try {
    const raw = localStorage.getItem('ripe_sources');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Error parsing sources from local storage", e);
  }
  return ['https://raw.githubusercontent.com/RipeStore/repos/refs/heads/main/RipeStore.json'];
}

/**
 * Filters a list of versions to only include those for a specific app.
 * @param {Array} list - The list of versions.
 * @param {object} app - The app object to filter by.
 * @returns {Array} The filtered list of versions.
 */
function onlyAppVersions(list, app) {
  return (list || []).filter(v => v && (v.bundle === app.bundle || v.bundleId === app.bundle || v.bundleId === app.bundleId || !v.bundle));
}

/**
 * Initializes the app details page.
 */
async function start() {
  const bundle = qs('bundle');
  const versionParam = qs('version');
  const repo = qs('repo');
  const hero = $('#hero');
  const vSel = $('#versionSelect');
  const dl = $('#downloadBtn');

  // Show an error if the bundle or repo is missing
  if (!bundle || !repo) {
    hero.innerHTML = `<div class="meta"><div class="hero-title">No app selected</div><div class="hero-sub">Open from Home or use a shared link.</div></div>`;
    return;
  }

  try {
    const configured = getConfiguredSources() || [];
    const repoParam = repo ? repo : null;
    const sources = Array.from(new Set([...(repoParam ? [repoParam] : []), ...configured]));
    const collectedApps = [];

    // Fetch app data from all sources
    for (const s of sources) {
      try {
        const d = await fetchJSON(s);
        const arr = normalizeRepo(d, s);
        for (const a of arr) {
          if (a.bundle === bundle) {
            collectedApps.push(a);
          }
        }
      } catch (e) {
        console.error(`Failed to fetch or process repo: ${s}`, e);
      }
    }

    // Show an error if the app is not found
    if (!collectedApps.length) {
      hero.innerHTML = `<div class="meta"><div class="hero-title">Not found</div><div class="hero-sub">This bundle isn’t in that repo.</div></div>`;
      return;
    }

    // Merge app data from different sources
    const merged = {
      name: '',
      bundle: bundle,
      icon: '',
      dev: '',
      desc: '',
      versions: [],
      source: repoParam || (collectedApps[0] && collectedApps[0].source)
    };
    const seen = new Set();
    for (const a of collectedApps) {
      merged.name = merged.name || a.name;
      merged.icon = merged.icon || a.icon;
      merged.dev = merged.dev || a.dev;
      merged.desc = merged.desc || a.desc;
      for (const v of (a.versions || [])) {
        const key = `${v.version}||${v.url}`;
        if (!seen.has(key) && v.url) {
          merged.versions.push(v);
          seen.add(key);
        }
      }
    }

    // Sort versions and build the UI
    merged.versions.sort((x, y) => semverCompare(y.version, x.version));
    const app = merged;

    // Build the hero section
    const icon = document.createElement('div');
    icon.className = 'icon-wrap';
    const img = document.createElement('img');
    img.alt = `${app.name} icon`;
    img.src = app.icon || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    icon.appendChild(img);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'hero-title ellipsis';
    title.textContent = app.name || app.bundle;
    const sub = document.createElement('div');
    sub.className = 'hero-sub ellipsis';
    sub.textContent = app.dev || app.bundle;
    const bid = document.createElement('div');
    bid.className = 'bundle-id ellipsis';
    bid.textContent = app.bundle;
    meta.appendChild(title);
    meta.appendChild(sub);
    meta.appendChild(bid);
    hero.innerHTML = '';
    hero.appendChild(icon);
    hero.appendChild(meta);

    // Populate the version selector
    let versions = onlyAppVersions(app.versions, app);
    versions.sort((a, b) => {
      const da = parseDateString(a.date),
        db = parseDateString(b.date);
      if (da && db) {
        return db - da;
      }
      return semverCompare(b.version, a.version);
    });

    vSel.innerHTML = '';
    versions.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.version || '';
      opt.dataset.url = v.url || '';
      opt.dataset.notes = v.notes || '';
      opt.dataset.versionDate = v.versionDate || '';
      opt.dataset.date = v.date || '';
      const pretty = v.version ? v.version : 'latest';
      const prettyDate = formatDate(v.date);
      opt.textContent = pretty + (prettyDate ? (' — ' + prettyDate) : '');
      vSel.appendChild(opt);
    });

    // Set the selected version
    if (versionParam) {
      const found = Array.from(vSel.options).find(o => o.value === versionParam);
      if (found) vSel.value = versionParam;
      else if (vSel.options.length) vSel.selectedIndex = 0; // newest
    } else if (vSel.options.length) {
      vSel.selectedIndex = 0; // newest
    }

    /**
     * Updates the UI based on the selected version.
     */
    function updateUIForVersion() {
      const opt = vSel.options[vSel.selectedIndex];
      const url = opt?.dataset?.url || '#';
      const notes = opt?.dataset?.notes || '';
      dl.href = url || '#';
      const dateStr = opt?.dataset?.versionDate || opt?.dataset?.date || '';
      const params = new URLSearchParams();
      params.set('bundle', app.bundle);
      if (opt?.value) params.set('version', opt.value);
      params.set('repo', repo);
      const shareUrl = location.origin + location.pathname.replace(/[^/]+$/, '') + 'app.html?' + params.toString();
      const descEl = $('#desc');
      descEl.textContent = notes ? ellipsize(notes, 1000) : (app.desc ? ellipsize(app.desc, 1000) : '');
      const upd = $('#updatedDate');
      if (upd) {
        upd.textContent = dateStr ? ('Updated: ' + formatDate(dateStr)) : '';
      }
    }

    updateUIForVersion();
    vSel.addEventListener('change', updateUIForVersion);

  } catch (e) {
    hero.innerHTML = `<div class="meta"><div class="hero-title">Error</div><div class="hero-sub">Unable to load app details.</div></div>`;
    console.warn(e);
  }
}

// Start the page initialization
start();
