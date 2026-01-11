import { fetchJSON, semverCompare, parseDateString } from './utils.js';

const cache = new Map();

/**
 * Fetches a repository JSON.
 */
export async function fetchRepo(src) {
  if (cache.has(src)) {
    return cache.get(src);
  }
  // If it doesn't have a protocol, assume it's a relative path in our github repo structure
  const url = src.includes('://') ? src : `https://raw.githubusercontent.com/ripestore/repos/main/${src}.json`;
  try {
    const data = await fetchJSON(url);
    const result = { data, url };
    cache.set(src, result);
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
  const push = (o) => {
    if (o && (o.bundleIdentifier || o.bundleID || o.bundle || o.id)) apps.push(toUnified(o, sourceUrl));
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
          source: sourceUrl
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
  
  return { apps, news, featured };
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

function toUnified(o, sourceUrl) {
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
      minOS: v.minOSVersion || null
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
      minOS: minOS
    }];
  }
  const currentVersion = (versions[0] && versions[0].version) || o.version || o.latest || "";
  const currentDescription = subtitle || o.localizedDescription || o.description || "";

  return {
    name, bundle, icon, dev, desc, subtitle, category,
    tintColor, size, minOS, screenshots, permissions, versions,
    source: sourceUrl,
    currentVersion,
    currentDescription
  };
}

/**
 * Merges apps from different sources by their bundle ID.
 */
export function mergeByBundle(apps) {
  const map = new Map();
  for (const a of apps) {
    const b = a.bundle;
    if (!b) {
      const key = Symbol('nobundle');
      map.set(key, a);
      continue;
    }
    if (!map.has(b)) {
      map.set(b, { ...a, versions: [...(a.versions || [])] });
    } else {
      const acc = map.get(b);
      acc.name = acc.name || a.name;
      acc.icon = acc.icon || a.icon;
      acc.dev = acc.dev || a.dev;
      acc.desc = acc.desc || a.desc;
      acc.subtitle = acc.subtitle || a.subtitle;
      acc.screenshots = acc.screenshots || a.screenshots;
      acc.permissions = acc.permissions || a.permissions;
      acc.tintColor = acc.tintColor || a.tintColor;
      
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

  for (const v of map.values()) {
    if (Array.isArray(v.versions)) {
      v.versions.sort((x, y) => {
        const dx = parseDateString(x.date);
        const dy = parseDateString(y.date);
        if (dx && dy) return dy - dx;
        if (dx) return -1;
        if (dy) return 1;
        return semverCompare(y.version, x.version);
      });
      // Update currentVersion to the latest one after sorting
      if (v.versions.length > 0) {
        v.currentVersion = v.versions[0].version;
      }
    }
  }
  return Array.from(map.values());
}
