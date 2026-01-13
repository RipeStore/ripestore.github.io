// Fuse.js options for fuzzy searching
const fuseOpts = {
  includeScore: true,
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 2,
  useExtendedSearch: true,
  keys: [
    { name: 'name', weight: 1.5 },
    { name: 'subtitle', weight: 0.5 },
    { name: 'desc', weight: 0.4 },
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
      // Don't flatten versions. Treat the app as a single entity.
      allApps.push(app);
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
  
  const scored = raw.map(r => {
    const item = r.item;
    const nameLower = (item.name || '').toLowerCase();
    const descLower = (item.desc || '').toLowerCase();
    const subLower = (item.subtitle || '').toLowerCase();
    const bundleLower = (item.bundle || '').toLowerCase();
    
    // Base relevance from Fuse (1 is best for our 'rel', r.score is 0 best)
    let rel = 1 - (r.score ?? 1);

    // Manual Boosts - PRIORITIZE SEQUENCE MATCHES
    // We use large numbers to ensure these always outrank fuzzy-only matches.
    
    if (nameLower === qLower) {
        rel += 100.0; // Exact Name match (Highest priority)
    } else if (nameLower.startsWith(qLower)) {
        rel += 50.0; // Name starts with query
    } else if (nameLower.includes(qLower)) {
        rel += 20.0; // Name contains the exact sequence anywhere
        
        // Extra boost if it matches at a word boundary (e.g., "The Hot Tub" for query "hot tub")
        if (nameLower.includes(' ' + qLower)) {
            rel += 10.0;
        }
    } else {
        // Check if all words of query are present in name in any order
        const qWords = qLower.split(/\s+/).filter(w => w.length > 1);
        if (qWords.length > 1) {
            const allMatch = qWords.every(w => nameLower.includes(w));
            if (allMatch) {
                rel += 5.0;
            }
        }
    }

    if (subLower.includes(qLower)) {
        rel += 2.0; // Subtitle Contains
    }
    if (bundleLower === qLower) {
        rel += 10.0; // Exact Bundle ID
    }

    return { item, rel };
  }).sort((a, b) => b.rel - a.rel).slice(0, limit).map(r => r.item);
  
  return scored;
}
