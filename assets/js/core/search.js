// Fuse.js options for fuzzy searching
const fuseOpts = {
  includeScore: true,
  threshold: 0.26,
  ignoreLocation: true,
  minMatchCharLength: 2,
  useExtendedSearch: true,
  keys: [
    { name: 'name', weight: 0.8 },
    { name: 'subtitle', weight: 0.5 },
    { name: 'desc', weight: 0.3 },
    { name: 'bundleIdentifier', weight: 0.2 }
  ]
};

// Fuse.js instance
let fuse = null;
// Array of all apps
let allApps = [];

/**
 * Initializes the search functionality with a list of apps.
 */
export function initSearch(apps) {
  allApps = (apps || []).slice();
  fuse = new Fuse(allApps, fuseOpts);
  return fuse;
}

/**
 * Adds more apps to the search index.
 */
export function addApps(apps) {
  if (!apps || !apps.length) return;
  apps.forEach(app => {
    if (app.versions && app.versions.length) {
      // Create a separate entry for each version of the app
      app.versions.forEach(v => {
        allApps.push({ ...app, ...v, _isVersion: true });
      });
    } else {
      // If there are no versions, treat the app itself as a single entry
      allApps.push({ ...app, _isVersion: true });
    }
  });
  if (!fuse) {
    fuse = new Fuse(allApps, fuseOpts);
  } else {
    fuse.setCollection(allApps);
  }
}

/**
 * Searches for apps based on a query.
 */
export function searchApps(q, appsToSearch = allApps, limit = 50) {
  q = (q || '').trim();
  const targetApps = appsToSearch || allApps;
  if (!q) return targetApps.slice(0, limit);

  // Use a different Fuse instance if searching a subset of apps
  let currentFuse = fuse;
  if (targetApps !== allApps) {
    currentFuse = new Fuse(targetApps, fuseOpts);
  }

  const raw = currentFuse.search(q, { limit: limit * 2 });
  const qLower = q.toLowerCase();
  // Score and sort the results
  const scored = raw.map(r => {
    const item = r.item;
    let rel = 1 - (r.score ?? 1);
    if (item.name && item.name.toLowerCase() === qLower) rel += 0.7;
    else if (item.name && item.name.toLowerCase().startsWith(qLower)) rel += 0.4;
    else if (item.name && item.name.toLowerCase().includes(qLower)) rel += 0.18;
    return { item, rel };
  }).sort((a, b) => b.rel - a.rel).slice(0, limit).map(r => r.item);
  return scored;
}
