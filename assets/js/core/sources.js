import { $ } from './utils.js';
import { db } from './utils.js';
import { DEFAULTS as CFG } from './config.js';

const KEY = 'ripe_sources';
const ORIGIN_KEY = 'ripe_source_origins';
const DEFAULTS = [CFG.SOURCE_NAME];

/**
 * Gets the list of configured source URLs.
 */
export function getSources() {
  try { return JSON.parse(localStorage.getItem(KEY)) || DEFAULTS; }
  catch (_) { return DEFAULTS; }
}

/**
 * Sets the list of configured source URLs.
 */
export async function setSources(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr));
  try {
    await db.remove('ripe_master_cache');
    await db.remove('ripe_master_cache_v2');
    await db.remove('ripe_master_cache_v3');
  } catch (e) {}
}

/**
 * Gets the origins map (manual vs suggested).
 */
export function getOrigins() {
  try { return JSON.parse(localStorage.getItem(ORIGIN_KEY)) || {}; }
  catch (_) { return {}; }
}

/**
 * Sets the origins map.
 */
export function setOrigins(obj) {
  localStorage.setItem(ORIGIN_KEY, JSON.stringify(obj));
}

/**
 * Adds a source.
 * @param {string} url - Source URL.
 * @param {string} type - 'manual' or 'suggested'.
 * @returns {boolean} True if added, false if already exists.
 */
export async function addSource(url, type = 'manual') {
  url = url.trim();
  if (!url) return false;
  const list = getSources();
  if (!list.includes(url)) {
    list.push(url);
    await setSources(list);
    
    const origins = getOrigins();
    origins[url] = type;
    setOrigins(origins);
    return true;
  }
  return false;
}

/**
 * Removes a source.
 * @param {string} url - Source URL.
 */
export async function removeSource(url) {
  const list = getSources();
  const newList = list.filter(x => x !== url);
  if (newList.length !== list.length) {
    await setSources(newList);
    const origins = getOrigins();
    delete origins[url];
    setOrigins(origins);
    return true;
  }
  return false;
}
