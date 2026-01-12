import { $, qs, fetchJSON, ellipsize, parseDateString, formatDate, semverCompare, formatByteCount } from '../core/utils.js';
import { normalizeRepo } from '../core/repo.js';
import { initCarousel } from '../core/carousel.js';

function getConfiguredSources() {
  try { return JSON.parse(localStorage.getItem('ripe_sources')) || ['https://raw.githubusercontent.com/RipeStore/repos/refs/heads/main/RipeStore.json']; }
  catch (_) { return ['https://raw.githubusercontent.com/RipeStore/repos/refs/heads/main/RipeStore.json']; }
}

async function init() {
  const bundle = qs('bundle');
  const repo = qs('repo');
  const versionParam = qs('version');
  
  if (!bundle || !repo) {
    $('#hero').innerHTML = '<div style="padding:20px;text-align:center">App not found</div>';
    return;
  }

  // Fetch only necessary repo(s)
  // Actually we might need to check multiple if user didn't specify, but let's assume valid link
  const sources = [repo, ...getConfiguredSources()];
  const uniqueSources = [...new Set(sources)];
  
  let app = null;

  // We need to fetch and merge similarly to home, but scoped to this bundle
  // For simplicity, we just find the first full match or merge basic info
  // Realistically we want to merge versions from all sources
  
  const collected = [];
  
  for (const s of uniqueSources) {
    try {
      const d = await fetchJSON(s);
      const result = normalizeRepo(d, s);
      const found = result.apps.filter(a => a.bundle === bundle);
      collected.push(...found);
    } catch (e) { console.error(e); }
  }

  if (!collected.length) {
    $('#hero').innerHTML = 'Not Found';
    return;
  }

  // Merge
  app = collected[0]; // Base
  collected.forEach(c => {
    // simple merge logic for versions
    if (c.versions) app.versions = [...app.versions, ...c.versions];
    if (c.screenshots?.iphone?.length) app.screenshots = c.screenshots;
    // merge other fields if needed
    app.size = app.size || c.size;
    app.minOS = app.minOS || c.minOS;
  });

  // Unique versions
  const seen = new Set();
  const uniqVers = [];
  app.versions.forEach(v => {
    const k = v.version + v.url;
    if (!seen.has(k)) {
      seen.add(k);
      uniqVers.push(v);
    }
  });
  app.versions = uniqVers.sort((a, b) => semverCompare(b.version, a.version));

  render(app, versionParam);
}

function render(app, initialVersion) {
  // Hero
  const heroIcon = $('#hero-icon');
  const heroTitle = $('#hero-title');
  const heroSub = $('#hero-subtitle');
  const getBtn = $('#hero-get');
  
  heroIcon.src = app.icon;
  heroTitle.textContent = app.name;
  heroSub.textContent = app.subtitle || app.dev || 'Utility';
  
  // Versions Dropdown
  const verSel = $('#version-select');
  verSel.innerHTML = '';
  app.versions.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.version;
    opt.textContent = `${v.version} (${formatDate(v.date)})`;
    opt.dataset.url = v.url;
    opt.dataset.notes = v.notes;
    opt.dataset.size = v.size || '';
    opt.dataset.minOS = v.minOS || '';
    verSel.appendChild(opt);
  });
  
  // Set initial selection if versionParam exists
  if (initialVersion) {
    const found = Array.from(verSel.options).find(o => o.value === initialVersion);
    if (found) verSel.value = initialVersion;
  }
  
  // Event listener for version change
  verSel.addEventListener('change', () => updateVersionUI(verSel, app));
  updateVersionUI(verSel, app); // Initial
  
  // Screenshots
  const shotContainer = $('#screenshots-scroll');
  const shots = app.screenshots?.iphone?.length ? app.screenshots.iphone : (app.screenshots?.ipad || []);
  if (shots.length) {
    $('#screenshots-section').style.display = 'block';
    shotContainer.innerHTML = '';
    shots.forEach((s, idx) => {
      const img = document.createElement('img');
      if (idx === 0) {
        img.onload = () => {
          const ratio = img.naturalWidth / img.naturalHeight;
          shotContainer.style.setProperty('--screenshot-ratio', ratio);
          // Update carousel buttons by triggering scroll listener
          shotContainer.dispatchEvent(new Event('scroll'));
        };
      }
      img.src = s;
      shotContainer.appendChild(img);
    });
    // Init carousel
    const wrapper = $('#screenshots-section .carousel-container');
    if (wrapper) initCarousel(wrapper);
  }

  // Description
  const descEl = $('#app-desc');
  descEl.textContent = app.desc || "No description.";
  
  // Handle "more" button
  const moreBtn = $('#desc-more-btn');
  // Wait for layout to determine if clamping is needed
  requestAnimationFrame(() => {
    if (descEl.scrollHeight > descEl.clientHeight) {
      moreBtn.style.display = 'inline-block';
      moreBtn.onclick = () => {
        const isClamped = descEl.classList.toggle('desc-clamped');
        moreBtn.textContent = isClamped ? 'more' : 'less';
      };
    } else {
      moreBtn.style.display = 'none';
    }
  });
  
  // Info grid (Metadata)
  $('#meta-provider').textContent = app.dev || 'Unknown';
  $('#meta-cat').textContent = app.category || 'Utility';
  
  // Permissions Modal
  if (app.permissions?.length) {
    $('#perm-section').style.display = 'flex';
    $('#perm-btn').onclick = async () => {
      $('#perm-modal').style.display = 'flex';
      const list = $('#perm-list');
      list.innerHTML = '<div style="padding:20px;text-align:center">Loading...</div>';
      
      try {
        // Specialized fetcher to handle duplicate keys in flat-ish JSONs
        const fetchMapping = async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res.ok) return [];
          const text = await res.text();
          const pairs = [];
          const regex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
          let m;
          while ((m = regex.exec(text)) !== null) {
            pairs.push({ key: m[1], val: m[2] });
          }
          return pairs;
        };

        const [entPairs, privPairs] = await Promise.all([
          fetchMapping('assets/data/entitlements.json'),
          fetchMapping('assets/data/privacy.json')
        ]);

        // Map: identifier (val) -> Array of friendly names (keys)
        const fullMap = {};
        const addMapping = (pairs) => {
          pairs.forEach(({ key, val }) => {
            if (!fullMap[val]) fullMap[val] = [];
            if (!fullMap[val].includes(key)) fullMap[val].push(key);
          });
        };

        addMapping(entPairs);
        addMapping(privPairs);

        list.innerHTML = '';
        app.permissions.forEach(p => {
          const names = fullMap[p.name];
          const displayName = names ? names.join(' / ') : p.name;
          
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${displayName}</strong><p>${p.text || ''}</p>`;
          list.appendChild(row);
        });
      } catch (e) {
        console.error('Failed to load permission maps', e);
        // Fallback to raw names
        list.innerHTML = '';
        app.permissions.forEach(p => {
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${p.name}</strong><p>${p.text || ''}</p>`;
          list.appendChild(row);
        });
      }
    };
    $('#close-perm').onclick = () => $('#perm-modal').style.display = 'none';
  }

  // Actions Modal
  const actionsBtn = $('#btn-more-actions');
  const actionsModal = $('#actions-modal');
  const actionsList = $('#actions-list');
  const closeActions = $('#close-actions');

  if (actionsBtn && actionsModal) {
    actionsBtn.onclick = async () => {
      const ipaUrl = $('#hero-get').href;
      try {
        const actions = await fetchJSON('assets/data/actions.json');
        actionsList.innerHTML = '';
        actions.forEach(a => {
          const item = document.createElement('a');
          item.className = 'list-menu-item';
          item.textContent = a.title;
          item.href = a.url.replace('<ipaurl>', ipaUrl);
          item.onclick = () => actionsModal.style.display = 'none';
          actionsList.appendChild(item);
        });
        actionsModal.style.display = 'flex';
      } catch (e) {
        console.error('Failed to load actions', e);
      }
    };
    closeActions.onclick = () => actionsModal.style.display = 'none';
    window.addEventListener('click', (e) => {
      if (e.target === actionsModal) actionsModal.style.display = 'none';
      if (e.target === $('#perm-modal')) $('#perm-modal').style.display = 'none';
    });
  }

  // Share functionality
  const shareBtn = $('#btn-share');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      const verSel = $('#version-select');
      const selectedVersion = verSel.value;
      const shareUrl = new URL(window.location.href);
      if (selectedVersion) {
        shareUrl.searchParams.set('version', selectedVersion);
      }
      
      if (navigator.share) {
        try {
          await navigator.share({
            title: app.name,
            text: `Check out ${app.name} on RipeStore!`,
            url: shareUrl.toString()
          });
        } catch (err) {
          if (err.name !== 'AbortError') console.error('Error sharing:', err);
        }
      } else {
        try {
          await navigator.clipboard.writeText(shareUrl.toString());
          alert('Link copied to clipboard!');
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      }
    };
  }
}

function updateVersionUI(sel, app) {
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  
  const url = opt.dataset.url;
  const notes = opt.dataset.notes;
  const size = opt.dataset.size || app.size;
  const minOS = opt.dataset.minOS || app.minOS;
  
  $('#hero-get').href = url;
  
  const whatsNew = $('#whats-new');
  const whatsNewText = $('#whats-new-text');
  const whatsNewMoreBtn = $('#whats-new-more-btn');
  
  if (notes && notes.length > 5) {
    whatsNew.style.display = 'block';
    whatsNewText.textContent = notes;
    
    // Reset state
    whatsNewText.classList.add('desc-clamped');
    whatsNewMoreBtn.textContent = 'more';
    
    // Check if expansion is needed
    requestAnimationFrame(() => {
      if (whatsNewText.scrollHeight > whatsNewText.clientHeight) {
        whatsNewMoreBtn.style.display = 'inline-block';
        whatsNewMoreBtn.onclick = () => {
          const isClamped = whatsNewText.classList.toggle('desc-clamped');
          whatsNewMoreBtn.textContent = isClamped ? 'more' : 'less';
        };
      } else {
        whatsNewMoreBtn.style.display = 'none';
      }
    });
  } else {
    whatsNew.style.display = 'none';
  }

  // Update Metadata
  $('#meta-size').textContent = formatByteCount(size);
  $('#meta-min-os').textContent = minOS ? `iOS ${minOS} or later` : 'Unknown';
}

init();