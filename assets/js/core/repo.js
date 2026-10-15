import { fetchJSON, semverCompare, parseDateString, db, hashString, cdnify } from './utils.js';
import { getSources } from './sources.js';
import { DEFAULTS as CFG } from './config.js';

const CACHE_PREFIX = 'repo_cache_';
const NORM_PREFIX = 'norm_cache_';
const CACHE_DURATION = CFG.CACHE_DURATION;
const MASTER_CACHE_KEY = CFG.MASTER_CACHE_KEY;

function sameSources(master, sources) {
  return !!master && JSON.stringify(master.sources) === JSON.stringify(sources);
}

function isMasterFresh(master, sources, now) {
  return sameSources(master, sources) && (now - (master.timestamp || 0)) < CACHE_DURATION;
}

/**
 * Returns the normalized form of a fetched repo, reusing the cached copy only when
 * it was produced from the exact same payload (same content hash and resolved URL).
 */
async function loadNormalized(src, { data, url, hash }) {
  const key = NORM_PREFIX + src;
  const cached = await db.get(key);
  if (cached && hash !== undefined && cached.hash === hash && cached.url === url) {
    return { normalized: cached, changed: false };
  }
  const normalized = { ...normalizeRepo(data, url), hash, url };
  await db.set(key, normalized);
  return { normalized, changed: true };
}

function buildMerged(allApps, allNews, featured) {
  const apps = mergeByBundle(allApps);
  const appBundles = new Set(apps.map(a => a.bundle));
  const seenNews = new Set();
  const news = [];
  allNews.forEach(n => {
    if (n.appID && !appBundles.has(n.appID)) return;
    const sig = n.identifier || `${n.appID || n.title || 'unknown'}|${n.date || 'nodate'}`;
    if (!seenNews.has(sig)) {
      seenNews.add(sig);
      news.push(n);
    }
  });
  return { apps, news, featured };
}

/**
 * Fetches and merges all configured repositories.
 */
export async function fetchAllRepos() {
  const sources = getSources();
  const now = Date.now();
  
  const master = await db.get(MASTER_CACHE_KEY);
  if (isMasterFresh(master, sources, now)) return master.data;

  const results = await Promise.allSettled(sources.map(src => fetchRepo(src)));
  let anyChanged = !sameSources(master, sources);
  
  const allApps = [];
  let allNews = [];
  let featuredIds = [];

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled') continue;
    const { normalized, changed } = await loadNormalized(sources[i], res.value);
    if (changed) anyChanged = true;
    if (normalized.news) allNews = allNews.concat(normalized.news);
    if (normalized.featured) featuredIds = featuredIds.concat(normalized.featured);
    allApps.push(...normalized.apps);
  }

  if (!anyChanged && master) {
    master.timestamp = now;
    await db.set(MASTER_CACHE_KEY, master);
    return master.data;
  }

  const finalData = buildMerged(allApps, allNews, featuredIds);
  await db.set(MASTER_CACHE_KEY, { sources, data: finalData, timestamp: now });
  return finalData;
}

/**
 * Streams repository data as it loads.
 */
export async function streamRepos(onUpdate, onComplete) {
  try {
    const sources = getSources();
    if (!sources || sources.length === 0) {
      onUpdate({ apps: [], news: [], featured: [], progress: 1 });
      if (onComplete) onComplete();
      return;
    }
    
    const master = await db.get(MASTER_CACHE_KEY);
    if (isMasterFresh(master, sources, Date.now())) {
      onUpdate({ ...master.data, progress: 1 });
      if (onComplete) onComplete();
      return;
    }

    const total = sources.length;
    const allApps = [];
    let allNews = [];
    let featuredIds = [];
    let loadedCount = 0;
    let anyLoaded = false;
    let lastUpdateTime = 0;
    const UPDATE_THROTTLE = 500; 

    // The final (progress === 1) update is emitted once after the loop, because consumers
    // treat progress 1 as "data complete" and must receive the fully merged payload with it.
    const handleResult = async (res, src) => {
      loadedCount++;
      const isLast = loadedCount === total;
      if (res.status !== 'fulfilled') {
        if (!isLast) onUpdate({ progress: loadedCount / total });
        return;
      }
      anyLoaded = true;
      const { normalized } = await loadNormalized(src, res.value);
      if (normalized.news) allNews = allNews.concat(normalized.news);
      if (normalized.featured) featuredIds = featuredIds.concat(normalized.featured);
      allApps.push(...normalized.apps);
      if (isLast) return;

      const progress = loadedCount / total;
      const currentRepo = normalized.repoName || src;
      const now = Date.now();
      if (now - lastUpdateTime > UPDATE_THROTTLE) {
        lastUpdateTime = now;
        onUpdate({ ...buildMerged(allApps, allNews, featuredIds), progress, currentRepo });
      } else {
        onUpdate({ progress, currentRepo });
      }
    };

    const CHUNK_SIZE = 8;
    for (let i = 0; i < sources.length; i += CHUNK_SIZE) {
      const chunk = sources.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(chunk.map(src => fetchRepo(src)));
      for (let j = 0; j < results.length; j++) {
        await handleResult(results[j], chunk[j]);
      }
    }

    const finalData = buildMerged(allApps, allNews, featuredIds);
    if (anyLoaded) {
      await db.set(MASTER_CACHE_KEY, { sources, data: finalData, timestamp: Date.now() });
    }
    onUpdate({ ...finalData, progress: 1 });

    if (onComplete) onComplete();
  } catch (err) {
    console.error('streamRepos error', err);
    if (onComplete) onComplete();
  }
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
  return response.text();
}

function withCacheBuster(url, now) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${now}`;
}

/**
 * Fetches a repository JSON and checks for changes using content hashing.
 * Resolves to { data, url, hash, changed } where `changed` means the payload differs from
 * the previously cached one. When the network fails but a cached copy exists, resolves to the
 * cached copy with `failed: true` and `error` set instead of rejecting.
 * `force` bypasses the 15-minute freshness window and every HTTP cache layer we can reach.
 */
export async function fetchRepo(src, force = false) {
  const cacheKey = CACHE_PREFIX + src;
  const now = Date.now();
  const defaultRepo = (CFG.DEFAULT_REPOS || []).find(r => r.name === src);
  const url = src.includes('://') ? src : (defaultRepo ? defaultRepo.url : `${CFG.INTERNAL_REPO_BASE}${src}.json`);
  const stored = await db.get(cacheKey);
  // A cached copy downloaded from a different URL (e.g. a default repo that moved) is only
  // usable as an offline fallback, never as the current payload.
  const cached = stored && stored.data && stored.data.url === url ? stored : null;
  const fromCache = (extra) => ({ ...cached.data, hash: cached.hash, changed: false, ...extra });

  if (!force && cached && (now - (cached.timestamp || 0)) < CACHE_DURATION) {
    return fromCache();
  }

  let text = null;

  try {
    if (force) {
      // raw.githubusercontent.com and similar CDNs ignore `cache: 'reload'` at the edge and keep
      // serving their copy for minutes; a unique query string forces an origin fetch.
      try {
        text = await fetchText(withCacheBuster(url, now), { cache: 'reload' });
      } catch (_) {
        text = await fetchText(url, { cache: 'reload' });
      }
    } else {
      text = await fetchText(url, { cache: 'no-cache' });
    }
  } catch (directErr) {
    // jsDelivr fallback for GitHub raw URLs (kept only for the current cache window)
    const cdnUrl = cdnify(url);
    try {
      if (cdnUrl === url) throw directErr;
      try {
        text = await fetchText(withCacheBuster(cdnUrl, now), { cache: 'no-cache' });
      } catch (_) {
        text = await fetchText(cdnUrl, { cache: 'no-cache' });
      }
    } catch (_) {
      if (cached) return fromCache({ failed: true, error: directErr });
      if (stored) return { ...stored.data, hash: stored.hash, changed: false, failed: true, error: directErr };
      throw directErr;
    }
  }

  const hash = hashString(text);

  if (cached && cached.hash === hash) {
    cached.timestamp = now;
    await db.set(cacheKey, cached);
    return fromCache();
  }

  let data;
  try {
    try {
      data = JSON.parse(text);
    } catch (_) {
      const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!m) throw new Error("Invalid JSON payload");
      data = JSON.parse(m[0]);
    }
  } catch (err) {
    if (cached) return fromCache({ failed: true, error: err });
    throw err;
  }

  const result = { data, url };
  await db.set(cacheKey, { timestamp: now, hash, data: result });
  // The merged snapshot was built from the old payload; drop it so every page re-merges.
  await db.remove(MASTER_CACHE_KEY);
  
  return { ...result, hash, changed: true };
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
    if (o && (o.bundleIdentifier || o.bundleID || o.bundle || o.id)) {
      if (o.marketplaceID && typeof o.marketplaceID === 'string' && o.marketplaceID.trim() !== "") return;
      apps.push(toUnified(o, sourceUrl, repoName));
    }
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
          image: cdnify(n.imageURL),
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
       data.featuredApps.forEach(id => featured.push({ id, source: sourceUrl }));
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
    if (typeof item === 'string') dest.push(cdnify(item));
    else if (item && item.url) dest.push(cdnify(item.url));
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
  if (!val) return null;
  const privacy = (val && typeof val === 'object' && !Array.isArray(val) && val.privacy) ? val.privacy : val;
  if (!privacy) return null;

  const perms = [];
  if (Array.isArray(privacy)) {
    if (privacy.length === 0) return null;
    privacy.forEach(p => {
      if (p && p.name) perms.push({ name: p.name, text: p.usageDescription || p.description || "" });
    });
  } else if (privacy && typeof privacy === 'object') {
    const entries = Object.entries(privacy);
    if (entries.length === 0) return null;
    entries.forEach(([k, v]) => {
      if (typeof v === 'string') perms.push({ name: k, text: v });
    });
  }
  return perms.length > 0 ? perms : null;
}

function parseEntitlements(val) {
  if (!val) return null;
  const data = (val && typeof val === 'object' && !Array.isArray(val) && val.entitlements) ? val.entitlements : val;
  if (!data) return null;

  const ents = [];
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    data.forEach(e => {
      if (typeof e === 'string') ents.push({ name: e, text: "" });
      else if (e && e.name) ents.push({ name: e.name, text: e.usageDescription || e.description || "" });
    });
  } else if (data && typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return null;
    entries.forEach(([k, v]) => {
      ents.push({ name: k, text: typeof v === 'string' ? v : "" });
    });
  }
  return ents.length > 0 ? ents : null;
}

function toUnified(o, sourceUrl, repoName) {
  const bundle = (o.bundleIdentifier || o.bundleID || o.bundle || o.id || "").trim();
  const icon = cdnify(o.iconURL || o.icon || o.image || "");
  let name = o.name || o.title || bundle || "Unknown";
  if (!name || name.trim() === "") name = "Unknown";
  if (bundle.endsWith("Beta")) name += " (BETA)";
  const dev = o.developerName || o.dev || o.developer || "";
  const desc = o.localizedDescription || o.description || o.subtitle || "";
  const subtitle = o.subtitle || "";
  const category = o.category || "";
  const tintColor = o.tintColor || null;
  const size = o.size || null;
  const minOS = o.minOSVersion || null;
  
  const screenshots = parseScreenshots(o.screenshots || o.screenshotURLs);
  const appPerms = o.appPermissions || o.permissions;
  const permissions = parsePermissions(appPerms);
  const entitlements = parseEntitlements(o.entitlements);

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
    tintColor, size, minOS, screenshots, permissions, entitlements, versions,
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

  for (const a of apps) {
    if (!a.bundle) {
      noBundleApps.push(a);
      continue;
    }

    if (!bundles.has(a.bundle)) {
      bundles.set(a.bundle, new Map());
    }

    const sourceMap = bundles.get(a.bundle);
    
    // Treat multiple instances of a same bundleid in the same repo as same app
    if (!sourceMap.has(a.source)) {
      const newEntry = { ...a, versions: [...(a.versions || [])] };
      if (!newEntry.allIcons) newEntry.allIcons = newEntry.icon ? [newEntry.icon] : [];
      sourceMap.set(a.source, newEntry);
    } else {
      const existing = sourceMap.get(a.source);
      if (a.versions && a.versions.length) {
         existing.versions.push(...a.versions);
      }
      if (a.icon && !existing.allIcons.includes(a.icon)) {
         existing.allIcons.push(a.icon);
      }
    }
  }

  // Second pass: Cross-bucket inheritance for icons/screenshots within the same bundle ID
  for (const sourceMap of bundles.values()) {
    const buckets = Array.from(sourceMap.values());
    if (buckets.length > 1) {
      // Find best icon and screenshots among all buckets for this bundle
      let bestIcon = null;
      let bestScreenshots = null;
      const combinedIcons = new Set();
      
      for (const b of buckets) {
        if (!bestIcon && b.icon) bestIcon = b.icon;
        if (!bestScreenshots && (b.screenshots?.iphone?.length || b.screenshots?.ipad?.length)) {
          bestScreenshots = b.screenshots;
        }
        if (b.allIcons) b.allIcons.forEach(i => combinedIcons.add(i));
      }
      
      const sharedIcons = [...combinedIcons];
      
      if (bestIcon || bestScreenshots || sharedIcons.length > 0) {
        for (const b of buckets) {
          if (!b.icon) b.icon = bestIcon;
          if (!b.screenshots || !(b.screenshots.iphone?.length || b.screenshots.ipad?.length)) {
            b.screenshots = bestScreenshots;
          }
          // Merge all icons from same bundle ID for fallbacks
          b.allIcons = sharedIcons;
        }
      }
    }
  }

  const result = [...noBundleApps];
  for (const sourceMap of bundles.values()) {
    result.push(...sourceMap.values());
  }

  for (const v of result) {
    if (Array.isArray(v.versions)) {
      v.versions.sort((x, y) => {
        // Prioritize semantic versioning first
        const sv = semverCompare(y.version, x.version);
        if (sv !== 0) return sv;
        
        // Fallback to date if versions are identical
        const dx = parseDateString(x.date);
        const dy = parseDateString(y.date);
        if (dx && dy) return dy - dx;
        if (dx) return -1;
        if (dy) return 1;
        return 0;
      });
      
      // Deduplicate versions by version string to avoid identical dropdown items
      const uniqueVers = [];
      const seenVers = new Set();
      for (const ver of v.versions) {
         const k = ver.version + ver.url;
         if (!seenVers.has(k)) {
            seenVers.add(k);
            uniqueVers.push(ver);
         }
      }
      v.versions = uniqueVers;
      
      if (v.versions.length > 0) {
        v.currentVersion = v.versions[0].version;
      }
    }
  }
  return result;
}