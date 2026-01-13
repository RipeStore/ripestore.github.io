import { $, cdnify } from '../core/utils.js';

/**
 * Removes the splash screen with a fade-out effect.
 */
export function removeSplash() {
  const splash = $('#splash');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 600);
  }
}

/**
 * Builds a standard App Card element.
 */
export function buildAppCard(app) {
  const card = document.createElement('a');
  card.className = 'app-item';
  
  const ver = app._isVersion ? app.version : app.currentVersion;
  const verParam = ver ? `&version=${encodeURIComponent(ver)}` : '';
  card.href = `app?bundle=${app.bundle}&name=${encodeURIComponent(app.name)}&repo=${app.source}${verParam}`;
  
  const icon = document.createElement('img');
  icon.src = cdnify(app.icon);
  icon.loading = 'lazy';
  icon.className = 'app-icon';

  if (app.allIcons && app.allIcons.length > 1) {
    icon.dataset.idx = 0;
    icon.onerror = () => {
      let idx = parseInt(icon.dataset.idx || '0') + 1;
      if (idx < app.allIcons.length) {
        if (app.allIcons[idx] !== icon.src) {
          icon.dataset.idx = idx;
          icon.src = cdnify(app.allIcons[idx]);
        }
      } else {
        icon.onerror = null;
      }
    };
  }

  const meta = document.createElement('div');
  meta.className = 'app-meta';
  
  const title = document.createElement('div');
  title.className = 'app-name';
  title.textContent = app.name;
  
  const sub = document.createElement('div');
  sub.className = 'app-sub';
  
  const subtitle = app.subtitle || app.dev || '';
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

/**
 * Renders a standardized error message into a container.
 */
export function renderError(container, title, msg) {
  if (!container) return;
  container.innerHTML = `
    <div class="error-container">
      <div class="error-icon">⚠️</div>
      <h2 class="error-title">${title}</h2>
      <p class="error-text">${msg}</p>
      <a href="./" class="btn-primary" style="display:inline-flex; text-decoration:none;">Go Back Home</a>
    </div>
  `;
}

/**
 * Returns the source display label.
 */
export function getSourceLabel(v) {
  if (v.repoName) return v.repoName;
  const src = v.source;
  if (!src) return 'Unknown';
  if (src.includes('ripestore/repos/main/')) {
    const parts = src.split('/');
    const file = parts[parts.length - 1];
    return file.replace('.json', '');
  }
  if (src.includes('://')) {
    try { return new URL(src).hostname; } catch(e) { return src; }
  }
  return src;
}
