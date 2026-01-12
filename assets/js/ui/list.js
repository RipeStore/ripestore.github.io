import { $, qs, parseDateString } from '../core/utils.js';
import { fetchAllRepos } from '../core/repo.js';

async function loadList() {
  const type = qs('type'); // 'featured' or 'news'
  if (!type) {
    $('#list-title').textContent = 'Unknown List';
    return;
  }
  
  $('#list-title').textContent = type === 'featured' ? 'Featured' : 'Latest News';
  $('#list-grid').innerHTML = 'Loading...';

  const { apps, news, featured } = await fetchAllRepos();

  if (type === 'featured') {
    renderFeatured(apps, featured);
  } else if (type === 'news') {
    renderNews(news);
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

  const seenBundles = new Set();
  const filteredNews = news.filter(n => {
    if (n.appID) {
      if (seenBundles.has(n.appID)) return false;
      seenBundles.add(n.appID);
    }
    return true;
  });

  // Use a different grid layout for news? Or just stack them.
  // We can reuse .news-card but remove the fixed width/flex
  // We need a wrapper to make them full width or grid
  
  filteredNews.forEach(n => {
    const card = document.createElement('div');
    card.className = 'news-card list-view';
    
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
    caption.textContent = n.caption;
    
    content.appendChild(title);
    content.appendChild(caption);
    card.appendChild(content);
    
    grid.appendChild(card);
  });
}

loadList();
