import { $ } from './utils.js';

const KEY = 'ripe_sources';
const ORIGIN_KEY = 'ripe_source_origins';
const DEFAULTS = ['RipeStore'];

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
export function setSources(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr));
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
export function addSource(url, type = 'manual') {
  url = url.trim();
  if (!url) return false;
  const list = getSources();
  if (!list.includes(url)) {
    list.push(url);
    setSources(list);
    
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
export function removeSource(url) {
  const list = getSources();
  const newList = list.filter(x => x !== url);
  if (newList.length !== list.length) {
    setSources(newList);
    const origins = getOrigins();
    delete origins[url];
    setOrigins(origins);
    return true;
  }
  return false;
}
