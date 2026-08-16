export const DEFAULTS = {
  SOURCE_NAME: 'RipeStore',
  SOURCE_URL: 'https://raw.githubusercontent.com/ripestore/repos/main/RipeStore.json',
  DEFAULT_SOURCES: ['RipeStore', 'AltMaker'],
  DEFAULT_REPOS: [
    { name: 'RipeStore', url: 'https://raw.githubusercontent.com/ripestore/repos/main/RipeStore.json' },
    { name: 'AltMaker', url: 'https://raw.githubusercontent.com/ripestore/repos/main/AltMaker.json' }
  ],
  INTERNAL_REPO_BASE: 'https://raw.githubusercontent.com/ripestore/repos/main/',
  SUGGESTIONS_URL: 'https://raw.githubusercontent.com/RipeStore/repos/refs/heads/main/ipa-repos.json',
  MASTER_CACHE_KEY: 'ripe_master_cache_v4',
  CACHE_DURATION: 15 * 60 * 1000 // 15 minutes
};
