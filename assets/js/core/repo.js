import { fetchJSON, semverCompare, parseDateString } from './utils.js';
import { getSources } from './sources.js';

const CACHE_PREFIX = 'repo_cache_';
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

/**
 * Fetches and merges all configured repositories.
 */
export async function fetchAllRepos() {
  const sources = getSources();
  let allApps = [];
  let allNews = [];
  let featuredIds = [];

  const results = await Promise.allSettled(sources.map(src => fetchRepo(src)));

  results.forEach(res => {
    if (res.status === 'fulfilled') {
      const out = res.value;
      const normalized = normalizeRepo(out.data, out.url);
      
      if (normalized.news) allNews = allNews.concat(normalized.news);
      if (normalized.featured) featuredIds = featuredIds.concat(normalized.featured);
      
      allApps = allApps.concat(normalized.apps);
    }
  });

  const mergedApps = mergeByBundle(allApps);
  
  const appBundles = new Set(mergedApps.map(a => a.bundle));

  // Deduplicate news
  const seenNews = new Set();
  const uniqueNews = [];
  allNews.forEach(n => {
    // Filter out news for missing apps
    if (n.appID && !appBundles.has(n.appID)) return;

    // Create a signature for the news item
    // If identifier exists, use it. Otherwise use appID+Date or Title+Date
    let sig = n.identifier;
    if (!sig) {
        const key = n.appID || n.title || 'unknown';
        const date = n.date || 'nodate';
        sig = `${key}|${date}`;
    }
    
    if (!seenNews.has(sig)) {
      seenNews.add(sig);
      uniqueNews.push(n);
    }
  });

  return {
    apps: mergedApps,
    news: uniqueNews,
    featured: featuredIds
  };
}

/**
 * Fetches a repository JSON.
 * @param {string} src - The source URL or identifier.
 * @param {boolean} [force=false] - Whether to bypass the cache and force a network request.
 */
export async function fetchRepo(src, force = false) {
  const cacheKey = CACHE_PREFIX + src;
  const now = Date.now();

  if (!force) {
    try {
      const cachedStr = localStorage.getItem(cacheKey);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (now - cached.timestamp < CACHE_DURATION) {
          return cached.data;
        }
      }
    } catch (e) {
      console.warn('Failed to read from cache', e);
    }
  }

  // If it doesn't have a protocol, assume it's a relative path in our github repo structure
  const url = src.includes('://') ? src : `https://raw.githubusercontent.com/ripestore/repos/main/${src}.json`;
  try {
    const data = await fetchJSON(url);
    const result = { data, url };
    
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: now,
        data: result
      }));
    } catch (e) {
      console.warn('Cache storage failed, possibly full. Clearing old cache...', e);
      // Optional: Clear all repo caches and try again, or just ignore
      try {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
        });
        localStorage.setItem(cacheKey, JSON.stringify({
          timestamp: now,
          data: result
        }));
      } catch (retryErr) {
        console.error('Cache write failed even after clear', retryErr);
      }
    }

    return result;
  } catch (err) {
    console.error(`Failed to fetch repo: ${url}`, err);
    throw err;
  }
}

/**
 * Normalizes repository data.
 */
export function normalizeRepo(data, sourceUrl) {
  const apps = [];
  const news = [];
  const featured = [];
  const repoName = data.name || null;

  const push = (o) => {
    if (o && (o.bundleIdentifier || o.bundleID || o.bundle || o.id)) apps.push(toUnified(o, sourceUrl, repoName));
  };

  if (Array.isArray(data)) {
    data.forEach(push);
  } else if (data && Array.isArray(data.apps)) { // AltStore-like
    data.apps.forEach(push);
    if (Array.isArray(data.news)) {
      data.news.forEach(n => {
        news.push({
          title: n.title,
          caption: n.caption,
          date: n.date,
          image: n.imageURL,
          url: n.url,
          appID: n.appID,
          identifier: n.identifier,
          notify: n.notify,
          source: sourceUrl,
          tintColor: n.tintColor,
          repoName: repoName
        });
      });
    }
    if (Array.isArray(data.featuredApps)) {
       data.featuredApps.forEach(id => featured.push(id));
    }
  } else if (data && typeof data === 'object') { // Scarlet-like
    Object.keys(data).forEach(k => {
      if (/^(meta|info|news)$/i.test(k)) return;
      const v = data[k];
      if (Array.isArray(v)) v.forEach(o => push({ ...o, category: o.category || k }));
    });
  }
  
  return { apps, news, featured, repoName };
}

function parseScreenshots(val) {
  const result = { iphone: [], ipad: [] };
  if (!val) return result;
  const add = (dest, item) => {
    if (typeof item === 'string') dest.push(item);
    else if (item && item.url) dest.push(item.url);
  };
  if (Array.isArray(val)) {
    val.forEach(v => add(result.iphone, v));
  } else if (typeof val === 'object') {
    if (val.iphone && Array.isArray(val.iphone)) val.iphone.forEach(v => add(result.iphone, v));
    if (val.ipad && Array.isArray(val.ipad)) val.ipad.forEach(v => add(result.ipad, v));
  }
  return result;
}

function parsePermissions(val) {
  const perms = [];
  if (!val) return perms;
  const privacy = val.privacy || val;
  if (Array.isArray(privacy)) {
    privacy.forEach(p => {
      if (p.name) perms.push({ name: p.name, text: p.usageDescription || p.description || "" });
    });
  } else if (typeof privacy === 'object') {
    Object.entries(privacy).forEach(([k, v]) => {
      if (typeof v === 'string') perms.push({ name: k, text: v });
    });
  }
  return perms;
}

function toUnified(o, sourceUrl, repoName) {
  const bundle = (o.bundleIdentifier || o.bundleID || o.bundle || o.id || "").trim();
  const icon = o.iconURL || o.icon || o.image || "";
  const name = o.name || o.title || bundle || "Unknown";
  const dev = o.developerName || o.dev || o.developer || "";
  const desc = o.localizedDescription || o.description || o.subtitle || "";
  const subtitle = o.subtitle || "";
  const category = o.category || "";
  const tintColor = o.tintColor || null;
  const size = o.size || null;
  const minOS = o.minOSVersion || null;
  
  const screenshots = parseScreenshots(o.screenshots || o.screenshotURLs);
  const permissions = parsePermissions(o.appPermissions || o.permissions);

  let versions = [];
  if (Array.isArray(o.versions) && o.versions.length) {
    versions = o.versions.map(v => ({
      version: v.version || v.build || v.tag || "",
      date: v.fullDate || v.versionDate || v.date || v.published || "",
      notes: v.localizedDescription || v.changelog || v.notes || "",
      url: v.downloadURL || v.down || v.url || v.ipa || v.download || "",
      size: v.size || null,
      minOS: v.minOSVersion || null,
      source: sourceUrl,
      repoName: repoName
    })).filter(v => v.url);
  }
  if (!versions.length) {
    const url = o.downloadURL || o.down || o.url || o.ipa || o.download || "";
    const version = o.version || o.latest || "";
    if (url) versions = [{
      version,
      date: "",
      notes: "",
      url,
      size: size,
      minOS: minOS,
      source: sourceUrl,
      repoName: repoName
    }];
  }
  const currentVersion = (versions[0] && versions[0].version) || o.version || o.latest || "";
  const currentDescription = subtitle || o.localizedDescription || o.description || "";

  return {
    name, bundle, icon, dev, desc, subtitle, category,
    tintColor, size, minOS, screenshots, permissions, versions,
    source: sourceUrl,
    repoName,
    currentVersion,
    currentDescription,
    allIcons: icon ? [icon] : []
  };
}

/**
 * Merges apps from different sources by their bundle ID.
 */
export function mergeByBundle(apps) {
  const bundles = new Map();
  const noBundleApps = [];

  const merge = (acc, a) => {
      // Determine if 'a' is newer than 'acc'
      const verA = a.currentVersion || (a.versions && a.versions[0] && a.versions[0].version);
      const verAcc = acc.currentVersion || (acc.versions && acc.versions[0] && acc.versions[0].version);
      const dateA = parseDateString(a.versions && a.versions[0] && a.versions[0].date);
      const dateAcc = parseDateString(acc.versions && acc.versions[0] && acc.versions[0].date);
      
      let useA = false;
      if (dateA && dateAcc) {
          useA = dateA > dateAcc;
      } else if (verA && verAcc) {
          useA = semverCompare(verA, verAcc) > 0;
      }
      
      if (useA) {
          acc.name = a.name || acc.name;
          acc.dev = a.dev || acc.dev;
          acc.desc = a.desc || acc.desc;
          acc.subtitle = a.subtitle || acc.subtitle;
          acc.tintColor = a.tintColor || acc.tintColor;
          if (a.icon) acc.icon = a.icon;
      } else {
          acc.name = acc.name || a.name;
          acc.dev = acc.dev || a.dev;
          acc.desc = acc.desc || a.desc;
          acc.subtitle = acc.subtitle || a.subtitle;
          acc.tintColor = acc.tintColor || a.tintColor;
          if (!acc.icon && a.icon) acc.icon = a.icon;
      }
      
      // Merge icons list
      if (!acc.allIcons) acc.allIcons = acc.icon ? [acc.icon] : [];
      if (a.icon && !acc.allIcons.includes(a.icon)) {
        acc.allIcons.push(a.icon);
      }

      // Intelligent screenshot merge
      const accHas = (acc.screenshots?.iphone?.length > 0) || (acc.screenshots?.ipad?.length > 0);
      const aHas = (a.screenshots?.iphone?.length > 0) || (a.screenshots?.ipad?.length > 0);
      if (!accHas && aHas) {
        acc.screenshots = a.screenshots;
      } else if (accHas && aHas && useA) {
          // If both have screenshots, but 'a' is newer, maybe we should prefer 'a'?
          // For now, let's just stick to the existing logic or maybe prefer 'a' if 'useA' is true
          acc.screenshots = a.screenshots;
      } else {
         acc.screenshots = acc.screenshots || a.screenshots;
      }

      acc.permissions = acc.permissions || a.permissions;
      if (useA && a.permissions && a.permissions.length > 0) {
          acc.permissions = a.permissions;
      }
      
      const seen = new Set(acc.versions.map(v => `${v.version}|${v.url}`));
      for (const v of (a.versions || [])) {
        const id = `${v.version}|${v.url}`;
        if (!seen.has(id)) {
          acc.versions.push(v);
          seen.add(id);
        }
      }
      
      acc.seenSources.add(a.source);
  };

  for (const a of apps) {
    if (!a.bundle) {
      noBundleApps.push(a);
      continue;
    }

    if (!bundles.has(a.bundle)) {
      bundles.set(a.bundle, []);
    }

    const buckets = bundles.get(a.bundle);
    let placed = false;

    // Find a bucket that doesn't have this source yet
    for (const bucket of buckets) {
      if (!bucket.seenSources.has(a.source)) {
        merge(bucket, a);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const newEntry = { ...a, versions: [...(a.versions || [])] };
      newEntry.seenSources = new Set([a.source]);
      if (!newEntry.allIcons) newEntry.allIcons = newEntry.icon ? [newEntry.icon] : [];
      buckets.push(newEntry);
    }
  }

  const result = [...noBundleApps];
  for (const group of bundles.values()) {
    result.push(...group);
  }

  for (const v of result) {
    if (v.seenSources) delete v.seenSources;
    if (Array.isArray(v.versions)) {
      v.versions.sort((x, y) => {
        const dx = parseDateString(x.date);
        const dy = parseDateString(y.date);
        if (dx && dy) return dy - dx;
        if (dx) return -1;
        if (dy) return 1;
        return semverCompare(y.version, x.version);
      });
      if (v.versions.length > 0) {
        v.currentVersion = v.versions[0].version;
      }
    }
  }
  return result;
}
