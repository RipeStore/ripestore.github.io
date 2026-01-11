import { $, qs, ellipsize, parseDateString } from '../core/utils.js';
import { fetchRepo, normalizeRepo, mergeByBundle } from '../core/repo.js';

const KEY = 'ripe_sources';
const DEFAULTS = ['RipeStore'];

function getSources() {
  try { return JSON.parse(localStorage.getItem(KEY)) || DEFAULTS; }
  catch (_) { return DEFAULTS; }
}

async function loadList() {
  const type = qs('type'); // 'featured' or 'news'
  if (!type) {
    $('#list-title').textContent = 'Unknown List';
    return;
  }
  
  $('#list-title').textContent = type === 'featured' ? 'Featured' : 'Latest News';
  $('#list-grid').innerHTML = 'Loading...';

  const sources = getSources();
  let allMerged = [];
  let allNews = [];
  let featuredIds = [];

  const results = await Promise.allSettled(sources.map(src => fetchRepo(src)));
  
  results.forEach(res => {
    if (res.status === 'fulfilled') {
      const out = res.value;
      const normalized = normalizeRepo(out.data, out.url);
      if (normalized.news) allNews = allNews.concat(normalized.news);
      if (normalized.featured) featuredIds = featuredIds.concat(normalized.featured);
      allMerged = allMerged.concat(normalized.apps);
    }
  });

  allMerged = mergeByBundle(allMerged);

  if (type === 'featured') {
    renderFeatured(allMerged, featuredIds);
  } else if (type === 'news') {
    renderNews(allNews);
  }
}

function renderFeatured(apps, ids) {
  const grid = $('#list-grid');
  grid.innerHTML = '';
  
  if (!ids.length) {
    grid.innerHTML = 'No featured apps found.';
    return;
  }
  
  const uniqueIds = [...new Set(ids)];
  const featuredApps = uniqueIds.map(id => apps.find(a => a.bundle === id)).filter(Boolean);

  if (!featuredApps.length) {
    grid.innerHTML = 'No featured apps found.';
    return;
  }

  featuredApps.forEach(a => {
    const card = document.createElement('a');
    card.className = 'app-item';
    
    const ver = a.currentVersion;
    const verParam = ver ? `&version=${encodeURIComponent(ver)}` : '';
    card.href = `app?bundle=${a.bundle}&repo=${a.source}${verParam}`;
    
    const icon = document.createElement('img');
    icon.src = a.icon;
    icon.loading = 'lazy';
    
    const meta = document.createElement('div');
    meta.className = 'app-meta';
    
    const title = document.createElement('div');
    title.className = 'app-name';
    title.textContent = a.name;
    
    const sub = document.createElement('div');
    sub.className = 'app-sub';
    const subtitle = a.subtitle || a.desc || '';
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
    
    grid.appendChild(card);
  });
}

function renderNews(news) {
  const grid = $('#list-grid');
  grid.innerHTML = '';
  
  if (!news.length) {
    grid.innerHTML = 'No news found.';
    return;
  }
  
  news.sort((a, b) => {
    const da = parseDateString(a.date);
    const db = parseDateString(b.date);
    return (da && db) ? db - da : 0;
  });

  // Use a different grid layout for news? Or just stack them.
  // We can reuse .news-card but remove the fixed width/flex
  // We need a wrapper to make them full width or grid
  
  news.forEach(n => {
    const card = document.createElement('div');
    card.className = 'news-card'; // This has specific styles in style.css for .news-row .news-card
    // We need to override or use a different class if we want full width
    // Actually style.css selectors are specific: .news-row .news-card
    // So if we just use .news-card here without .news-row parent, it might look basic?
    // Let's check style.css. .news-card alone isn't styled much except inside .news-row?
    // Wait, style.css has `.news-row .news-card`.
    // I should create a generic `.news-card-full` or just inline styles for list view.
    
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.background = 'var(--bg-secondary)';
    card.style.borderRadius = '18px';
    card.style.overflow = 'hidden';
    card.style.marginBottom = '16px';
    card.style.cursor = 'pointer';
    
    card.onclick = () => {
      if (n.appID) location.href = `app?bundle=${n.appID}&repo=${n.source}`;
      else if (n.url) location.href = n.url;
    };
    
    if (n.image) {
      const img = document.createElement('img');
      img.src = n.image;
      img.style.width = '100%';
      img.style.height = '280px';
      img.style.objectFit = 'cover';
      card.appendChild(img);
    }
    
    const content = document.createElement('div');
    content.style.padding = '16px';
    
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.fontSize = '17px';
    title.style.marginBottom = '6px';
    title.textContent = n.title;
    
    const caption = document.createElement('div');
    caption.style.color = 'var(--text-secondary)';
    caption.style.fontSize = '14px';
    caption.style.whiteSpace = 'pre-wrap';
    caption.textContent = n.caption;
    
    content.appendChild(title);
    content.appendChild(caption);
    card.appendChild(content);
    
    grid.appendChild(card);
  });
}

loadList();
