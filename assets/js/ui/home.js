import { $, ellipsize, parseDateString, qs, debounce } from '../core/utils.js';
import { fetchAllRepos } from '../core/repo.js';
import { initSearch, addApps, searchApps } from '../core/search.js';
import { initCarousel } from '../core/carousel.js';

const BATCH = 24;

const state = {
  allMerged: [],
  allNews: [],
  featuredIds: [],
  list: [],
  rendered: 0,
  q: '',
  sort: 'name-asc'
};

async function loadAll() {
  state.allMerged = [];
  state.allNews = [];
  state.featuredIds = [];
  
  $('#app-grid').innerHTML = '';
  showSkeleton();

  const { apps, news, featured } = await fetchAllRepos();
  
  state.allMerged = apps;
  state.allNews = news;
  state.featuredIds = featured;

  addApps(state.allMerged);
  
  renderFeatured();
  renderNews();

  initSearch(state.allMerged);

  // Check for search query param
  const urlQ = qs('q');
  if (urlQ) {
    state.q = urlQ;
    const input = $('#search-input');
    if (input) input.value = urlQ;
    $('#featured-section')?.classList.add('collapsed');
    $('#news-section')?.classList.add('collapsed');
  }

  filterAndPrepare();
}

function showSkeleton() {
  const c = $('#app-grid');
  c.innerHTML = '';
  // Simple skeleton logic
}

function renderFeatured() {
  const container = $('#featured-section');
  const grid = $('#featured-grid');
  if (!state.featuredIds.length) {
    if (container) container.style.display = 'none';
    return;
  }
  
  const uniqueIds = [...new Set(state.featuredIds)];
  const featuredApps = uniqueIds.map(id => state.allMerged.find(a => a.bundle === id)).filter(Boolean);

  if (!featuredApps.length) {
    if (container) container.style.display = 'none';
    return;
  }

  grid.innerHTML = '';
  
  // Calculate how many fit
  // Card width 320px + 16px gap = 336px. Container padding approx 40px.
  // We want to avoid scrolling, so we show N items that fit.
  // Wait, user wants more items, so we SHOULD allow scrolling.
  let limit = 12;

  featuredApps.slice(0, limit).forEach(a => {
    const card = document.createElement('a');
    card.className = 'featured-card';
    card.href = `app?bundle=${a.bundle}&repo=${a.source}`;
    
    // Background image if available (using icon as fallback blurred maybe? or just standard style)
    // For now standard style
    const icon = document.createElement('img');
    icon.src = a.icon;
    icon.className = 'featured-icon';
    
    const info = document.createElement('div');
    info.className = 'featured-info';
    
    const title = document.createElement('div');
    title.className = 'featured-title';
    title.textContent = a.name;
    
    const sub = document.createElement('div');
    sub.className = 'featured-subtitle';
    const ver = a.currentVersion;
    const subtitle = a.subtitle || a.desc || 'Featured App';
    const parts = [ver, subtitle].filter(p => p && p.trim().length > 0);
    sub.textContent = parts.join(' • ');
    
    info.appendChild(title);
    info.appendChild(sub);
    card.appendChild(icon);
    card.appendChild(info);
    
    grid.appendChild(card);
  });
  if (container) {
    container.style.display = 'block';
    // Initialize carousel buttons
    const wrapper = container.querySelector('.carousel-container');
    if (wrapper) initCarousel(wrapper);
  }
}

function renderNews() {
  const container = $('#news-section');
  const grid = $('#news-grid');
  if (!state.allNews.length) {
    if (container) container.style.display = 'none';
    return;
  }
  
  state.allNews.sort((a, b) => {
    const da = parseDateString(a.date);
    const db = parseDateString(b.date);
    return (da && db) ? db - da : 0;
  });

  const seenBundles = new Set();
  const filteredNews = state.allNews.filter(n => {
    if (n.appID) {
      if (seenBundles.has(n.appID)) return false;
      seenBundles.add(n.appID);
    }
    return true;
  });

  // Push items without images to the end
  filteredNews.sort((a, b) => {
      const hasA = !!a.image;
      const hasB = !!b.image;
      if (hasA === hasB) return 0; // Keep date order
      return hasA ? -1 : 1;
  });

  grid.innerHTML = '';
  
  // Calculate fit
  // Card width 260px + 16px gap = 276px.
  let limit = 10;

  filteredNews.slice(0, limit).forEach(n => {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.onclick = () => {
      if (n.appID) location.href = `app?bundle=${n.appID}&repo=${n.source}`;
      else if (n.url) location.href = n.url;
    };
    
    if (n.image) {
      const img = document.createElement('img');
      img.src = n.image;
      img.onerror = () => img.remove();
      card.appendChild(img);
    }
    
    const content = document.createElement('div');
    content.className = 'news-content';
    
    const title = document.createElement('div');
    title.className = 'news-title';
    title.textContent = n.title;
    if (n.tintColor) title.style.color = n.tintColor;
    
    const caption = document.createElement('div');
    caption.className = 'news-caption';
    caption.textContent = ellipsize(n.caption, 60);
    
    content.appendChild(title);
    content.appendChild(caption);
    card.appendChild(content);
    
    grid.appendChild(card);
  });
  if (container) {
    container.style.display = 'block';
    const wrapper = container.querySelector('.carousel-container');
    if (wrapper) initCarousel(wrapper);
  }
}

function filterAndPrepare() {
  const q = state.q.trim();
  let result = state.allMerged;

  if (q) {
    if (q.toLowerCase().startsWith('provider:')) {
      const provider = q.substring(9).trim().toLowerCase();
      if (provider) {
        result = state.allMerged.filter(app => (app.dev || '').toLowerCase().includes(provider));
      }
    } else {
      result = searchApps(q, state.allMerged);
    }
  }

  // Sort helper
  const getDate = (app) => {
    // Get latest version date or app date
    const dStr = (app.versions && app.versions[0] && app.versions[0].date) || app.date;
    const d = parseDateString(dStr);
    return d ? d.getTime() : 0;
  };

  if (state.sort === 'date-desc') {
    result.sort((a, b) => getDate(b) - getDate(a));
  } else if (state.sort === 'date-asc') {
    result.sort((a, b) => getDate(a) - getDate(b));
  } else if (state.sort === 'name-desc') {
    result.sort((a, b) => b.name.localeCompare(a.name));
  } else {
    // Default name-asc
    result.sort((a, b) => a.name.localeCompare(b.name));
  }

  state.list = result;
  state.rendered = 0;
  $('#app-grid').innerHTML = '';
  appendBatch();
}

function appendBatch() {
  const grid = $('#app-grid');
  const next = Math.min(state.rendered + BATCH, state.list.length);
  for (let i = state.rendered; i < next; i++) {
    grid.appendChild(buildCard(state.list[i]));
  }
  state.rendered = next;
}

function buildCard(a) {
  const card = document.createElement('a');
  card.className = 'app-item';
  
  const ver = a._isVersion ? a.version : a.currentVersion;
  const verParam = ver ? `&version=${encodeURIComponent(ver)}` : '';
  card.href = `app?bundle=${a.bundle}&repo=${a.source}${verParam}`;
  
  const icon = document.createElement('img');
  icon.src = a.icon;
  icon.loading = 'lazy';
  // Icon fallback logic
  if (a.allIcons && a.allIcons.length > 1) {
      icon.dataset.idx = 0;
      icon.onerror = () => {
          let idx = parseInt(icon.dataset.idx || '0') + 1;
          if (idx < a.allIcons.length) {
              // Try next icon
              if (a.allIcons[idx] !== icon.src) { // Prevent loop if dupes
                  icon.dataset.idx = idx;
                  icon.src = a.allIcons[idx];
              }
          } else {
             icon.onerror = null; // Stop
          }
      };
  }
  
  const meta = document.createElement('div');
  meta.className = 'app-meta';
  
  const title = document.createElement('div');
  title.className = 'app-name';
  title.textContent = a.name;
  
  const sub = document.createElement('div');
  sub.className = 'app-sub';
  
  const subtitle = a.subtitle || a.dev || '';
  
  const parts = [ver, subtitle].filter(p => p && p.trim().length > 0);
  sub.textContent = parts.join(' • ');
  
  const btn = document.createElement('button');
  btn.className = 'get-btn';
  btn.textContent = 'GET';
  
  meta.appendChild(title);
  meta.appendChild(sub);
  
  card.appendChild(icon);
  card.appendChild(meta);
  card.appendChild(btn);
  
  return card;
}

// Event Listeners
if ($('#sort-select')) {
  $('#sort-select').addEventListener('change', e => {
    state.sort = e.target.value;
    filterAndPrepare();
  });
}

$('#search-input').addEventListener('input', e => {
  state.q = e.target.value;
  
  const isSearching = state.q.trim().length > 0;
  $('#featured-section').classList.toggle('collapsed', isSearching);
  $('#news-section').classList.toggle('collapsed', isSearching);

  debounce(filterAndPrepare, 300)();
});

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 500)) {
      appendBatch();
    }
    ticking = false;
  });
});

loadAll();
