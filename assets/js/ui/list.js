import { $, qs, parseDateString, cdnify } from '../core/utils.js';
import { streamRepos } from '../core/repo.js';
import { removeSplash, buildAppCard, renderError } from './components.js';

async function loadList() {
  const type = qs('type'); // 'featured' or 'news'
  if (!type) {
    $('#list-title').textContent = 'Unknown List';
    return;
  }
  
  $('#list-title').textContent = type === 'featured' ? 'Featured' : 'Latest News';
  
  const splashStatus = $('#splash-status');
  const splash = $('#splash');

  let initialized = false;
  let showTimeout = setTimeout(() => {
    if (!initialized) finishLoading();
  }, 4000);

  const finishLoading = () => {
    if (initialized) return;
    initialized = true;
    clearTimeout(showTimeout);
    removeSplash();
  };

  await streamRepos(
    (data) => {
      if (data.currentRepo && splashStatus) {
        splashStatus.textContent = `Loading ${data.currentRepo}...`;
      }
      
      if (data.apps && type === 'featured') {
        renderFeatured(data.apps, data.featured);
      } else if (data.news && type === 'news') {
        renderNews(data.news, data.apps);
      }

      if (data.progress === 1) {
          if ((type === 'featured' && (!data.featured || data.featured.length === 0)) ||
              (type === 'news' && (!data.news || data.news.length === 0))) {
            renderError($('main'), 'List Empty', `No ${type} items were found in your sources.`);
          }
          finishLoading();
      }
    },
    () => {
      finishLoading();
    }
  );
}

function renderFeatured(apps, ids) {
  const grid = $('#list-grid');
  grid.innerHTML = '';
  
  if (!ids.length) {
    grid.innerHTML = 'No featured apps found.';
    return;
  }
  
  const uniqueFeatured = [];
  const seenFeatured = new Set();
  ids.forEach(f => {
    const key = typeof f === 'string' ? f : `${f.id}|${f.source}`;
    if (!seenFeatured.has(key)) {
      seenFeatured.add(key);
      uniqueFeatured.push(f);
    }
  });

  const featuredApps = uniqueFeatured.map(f => {
    if (typeof f === 'string') return apps.find(a => a.bundle === f);
    return apps.find(a => a.bundle === f.id && a.source === f.source);
  }).filter(Boolean);

  if (!featuredApps.length) {
    grid.innerHTML = 'No featured apps found.';
    return;
  }

  featuredApps.forEach(a => {
    grid.appendChild(buildAppCard(a));
  });
}

function renderNews(news, allApps = []) {
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
      if (n.appID) {
        const app = allApps.find(a => a.bundle === n.appID);
        const nameParam = app ? `&name=${encodeURIComponent(app.name)}` : '';
        location.href = `app?bundle=${n.appID}${nameParam}&repo=${n.source}`;
      }
      else if (n.url) location.href = n.url;
    };
    
    if (n.image) {
      const img = document.createElement('img');
      img.src = n.image;
      img.onerror = () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'news-placeholder';
        img.replaceWith(placeholder);
      };
      card.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'news-placeholder';
      card.appendChild(placeholder);
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
