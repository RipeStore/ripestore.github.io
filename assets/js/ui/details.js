import { $, qs, fetchJSON, formatDate, semverCompare, formatByteCount, linkify, showToast, cdnify, fetchMapping, setupModal } from '../core/utils.js';
import { normalizeRepo, fetchRepo } from '../core/repo.js';
import { initCarousel } from '../core/carousel.js';
import { getSources } from '../core/sources.js';
import { getDominantColor, ensureContrast } from '../core/color.js';
import { removeSplash, getSourceLabel, renderError } from './components.js';

async function init() {
  const bundle = qs('bundle');
  const repo = qs('repo');
  const nameParam = qs('name');
  const versionParam = qs('version');
  
  if (!bundle || !repo) {
    renderError($('main'), 'Missing Information', 'The link you followed is incomplete. Please try searching for the app instead.');
    removeSplash();
    return;
  }

  let app = null;

  // 1. Fast path: Fetch primary repo
  try {
    const primary = await fetchRepo(repo);
    const norm = normalizeRepo(primary.data, primary.url);
    
    // Find by bundle AND name if available, otherwise just bundle
    app = norm.apps.find(a => {
      const matchBundle = a.bundle === bundle;
      if (!nameParam) return matchBundle;
      return matchBundle && a.name.toLowerCase() === nameParam.toLowerCase();
    });
    
    if (app) {
      // Sort versions initially
      sortVersions(app);
      render(app, versionParam);
      removeSplash();
      return;
    }
  } catch (e) {
    console.error('Primary repo fetch failed', e);
    renderError($('main'), 'Connection Error', `Failed to load the repository: ${repo}. Please check your internet connection or the source URL.`);
    removeSplash();
    return;
  }

  // 2. Fallback: Search in other repos if not found in primary
  if (!app) {
    renderError($('main'), 'App Not Found', `The app with bundle ID "<strong>${bundle}</strong>" could not be found in the specified repository.`);
    removeSplash();
  }
}

function sortVersions(app) {
  if (!app.versions) return;
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
}

function render(app, initialVersion) {
  // Apply tint color logic
  let currentBaseAccent = app.tintColor;
  
  const updateAccent = () => {
      if (!currentBaseAccent) {
           document.documentElement.style.removeProperty('--accent');
           return;
      }
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const adjusted = ensureContrast(currentBaseAccent, isDark);
      document.documentElement.style.setProperty('--accent', adjusted);
  };
  
  window.matchMedia('(prefers-color-scheme: dark)').onchange = updateAccent;
  
  if (currentBaseAccent) {
      updateAccent();
  } else {
      document.documentElement.style.removeProperty('--accent');
      // Extract from hidden image to avoid CORS issues on display image
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = cdnify(app.icon);
      img.onload = async () => {
          try {
              const col = await getDominantColor(img);
              currentBaseAccent = col;
              updateAccent();
          } catch(e) {}
      };
  }

  // Hero
  const heroIcon = $('#hero-icon');
  const heroTitle = $('#hero-title');
  const heroSub = $('#hero-subtitle');
  
  heroIcon.src = cdnify(app.icon);
  if (app.allIcons && app.allIcons.length > 1) {
      heroIcon.dataset.idx = 0;
      heroIcon.onerror = () => {
          let idx = parseInt(heroIcon.dataset.idx || '0') + 1;
          if (idx < app.allIcons.length) {
              if (app.allIcons[idx] !== heroIcon.src) {
                  heroIcon.dataset.idx = idx;
                  heroIcon.src = cdnify(app.allIcons[idx]);
              }
          } else {
             heroIcon.onerror = null;
          }
      };
  }

  heroTitle.textContent = app.name;
  document.title = app.name;
  heroSub.textContent = app.subtitle || app.dev || 'Utility';
  
  // Versions Dropdown
  const verSel = $('#version-select');
  const currentVal = verSel.value;
  verSel.innerHTML = '';

  app.versions.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.version;
    opt.textContent = `${v.version} (${formatDate(v.date)})`;
    opt.dataset.url = v.url;
    opt.dataset.notes = v.notes;
    opt.dataset.size = v.size || '';
    opt.dataset.minOS = v.minOS || '';
    opt.dataset.source = v.source || '';
    verSel.appendChild(opt);
  });
  
  // Set initial selection
  if (currentVal && Array.from(verSel.options).some(o => o.value === currentVal)) {
    verSel.value = currentVal;
  } else if (initialVersion) {
    const found = Array.from(verSel.options).find(o => o.value === initialVersion);
    if (found) verSel.value = initialVersion;
  }
  
  // Event listener (remove old one to avoid dupe if re-rendering? actually replacing innerHTML clears old option listeners, but not the select listener)
  // To avoid duplicate listeners on the select element, we can set onclick or check a flag. 
  // Easier: clone and replace, or just ensure we don't add it multiple times.
  // Since render is called multiple times, we should use a named function or check.
  if (!verSel.dataset.listening) {
    verSel.addEventListener('change', () => updateVersionUI(verSel, app));
    verSel.dataset.listening = 'true';
  }
  updateVersionUI(verSel, app); 
  
  // Description - Render immediately
  const descEl = $('#app-desc');
  descEl.innerHTML = linkify(app.desc || "No description.");
  
  // Info grid (Metadata) - Render immediately
  const devName = app.dev || 'Unknown';
  const devEl = $('#meta-provider');
  if (app.dev) {
    devEl.innerHTML = `<a href="./?q=${encodeURIComponent('provider:' + app.dev)}" class="accent" style="text-decoration:none">${devName}</a>`;
  } else {
    devEl.textContent = devName;
  }

  $('#meta-cat').textContent = app.category || 'Utility';
  $('#meta-source-name').textContent = app.repoName || getSourceLabel(app.versions[0] || { source: app.source });

  // HEAVY items: Screenshots, "More" buttons calculations, Modals -> Defer
  requestAnimationFrame(() => {
     renderHeavy(app);
  });
}

function renderHeavy(app) {
  // Reset visibility
  $('#perm-section').classList.add('hidden');
  $('#ent-section').classList.add('hidden');

  // Screenshots
  const shotContainer = $('#screenshots-scroll');
  const shots = app.screenshots?.iphone?.length ? app.screenshots.iphone : (app.screenshots?.ipad || []);
  
  // Only render screenshots if not already populated to avoid flickering/resetting scroll
  if (shots.length && shotContainer.children.length === 0) {
    $('#screenshots-section').classList.remove('hidden');
    shotContainer.innerHTML = '';
    
    // Find first non-video image to determine aspect ratio
    let firstImageIdx = -1;
    for (let i = 0; i < shots.length; i++) {
        if (!getVideoId(shots[i])) {
            firstImageIdx = i;
            break;
        }
    }
    
    // If no images (only videos), default to 16:9
    if (firstImageIdx === -1) {
        shotContainer.style.setProperty('--screenshot-ratio', 16/9);
    }

    shotContainer.scrollLeft = 0; // Reset scroll position

    shots.forEach((s, idx) => {
      const videoData = getVideoId(s);
      if (videoData) {
          const iframe = document.createElement('iframe');
          iframe.src = videoData.embedUrl;
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
          iframe.allowFullscreen = true;
          iframe.classList.add('screenshot-video');
          shotContainer.appendChild(iframe);
          // Trigger scroll check immediately if first item is video
          if (idx === 0) shotContainer.dispatchEvent(new Event('scroll'));
          return;
      }
    
      const img = document.createElement('img');
      img.loading = 'lazy'; 
      
      img.onerror = () => {
        img.remove();
        if (shotContainer.children.length === 0) {
          $('#screenshots-section').classList.add('hidden');
        } else {
          shotContainer.dispatchEvent(new Event('scroll'));
        }
      };

      if (idx === firstImageIdx) {
        img.onload = () => {
          const ratio = img.naturalWidth / img.naturalHeight;
          shotContainer.style.setProperty('--screenshot-ratio', ratio);
          shotContainer.dispatchEvent(new Event('scroll'));
        };
      }
      img.src = cdnify(s);
      shotContainer.appendChild(img);
    });
    const wrapper = $('#screenshots-section .carousel-container');
    if (wrapper) initCarousel(wrapper);
  }
  
  // Handle "more" button for Description
  const descEl = $('#app-desc');
  const moreBtn = $('#desc-more-btn');
  if (descEl.scrollHeight > descEl.clientHeight) {
      moreBtn.classList.remove('hidden');
      moreBtn.onclick = () => {
        const isClamped = descEl.classList.toggle('desc-clamped');
        moreBtn.textContent = isClamped ? 'more' : 'less';
      };
  } else {
      moreBtn.classList.add('hidden');
  }

  // Permissions Modal Setup
  if (app.permissions && Array.isArray(app.permissions) && app.permissions.length > 0) {
    $('#perm-section').classList.remove('hidden');
    $('#perm-btn').onclick = async () => {
      $('#perm-modal').classList.add('flex');
      const list = $('#perm-list');
      list.innerHTML = '<div class="p-20 text-center">Loading...</div>';
      try {
        const privPairs = await fetchMapping('assets/data/privacy.json');
        const fullMap = {};
        privPairs.forEach(({ key, val }) => {
          if (!fullMap[val]) fullMap[val] = [];
          if (!fullMap[val].includes(key)) fullMap[val].push(key);
        });

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
        console.error('Failed to render permissions', e);
        list.innerHTML = '';
        app.permissions.forEach(p => {
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${p.name}</strong><p>${p.text || ''}</p>`;
          list.appendChild(row);
        });
      }
    };
    $('#close-perm').onclick = () => $('#perm-modal').classList.remove('flex');
  } else {
    $('#perm-section').classList.add('hidden');
  }

  // Entitlements Modal Setup
  if (app.entitlements && Array.isArray(app.entitlements) && app.entitlements.length > 0) {
    $('#ent-section').classList.remove('hidden');
    $('#ent-btn').onclick = async () => {
      $('#ent-modal').classList.add('flex');
      const list = $('#ent-list');
      list.innerHTML = '<div class="p-20 text-center">Loading...</div>';
      try {
        const entPairs = await fetchMapping('assets/data/entitlements.json');
        const fullMap = {};
        entPairs.forEach(({ key, val }) => {
          if (!fullMap[val]) fullMap[val] = [];
          if (!fullMap[val].includes(key)) fullMap[val].push(key);
        });

        list.innerHTML = '';
        app.entitlements.forEach(e => {
          const names = fullMap[e.name];
          const displayName = names ? names.join(' / ') : e.name;
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${displayName}</strong><p>${e.text || ''}</p>`;
          list.appendChild(row);
        });
      } catch (e) {
        console.error('Failed to render entitlements', e);
        list.innerHTML = '';
        app.entitlements.forEach(e => {
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${e.name}</strong><p>${e.text || ''}</p>`;
          list.appendChild(row);
        });
      }
    };
    $('#close-ent').onclick = () => $('#ent-modal').classList.remove('flex');
  } else {
    $('#ent-section').classList.add('hidden');
  }

  // Actions Modal Setup
  const actionsBtn = $('#btn-more-actions');
  const actionsModal = $('#actions-modal');
  const actionsList = $('#actions-list');
  const closeActions = $('#close-actions');

  // Custom Actions Logic
  const getCustomActions = () => {
      try { return JSON.parse(localStorage.getItem('custom_actions')) || []; }
      catch { return []; }
  };
  const setCustomActions = (arr) => localStorage.setItem('custom_actions', JSON.stringify(arr));

  const getHiddenDefaults = () => {
      try { return JSON.parse(localStorage.getItem('hidden_default_actions')) || []; }
      catch { return []; }
  };
  const setHiddenDefaults = (arr) => localStorage.setItem('hidden_default_actions', JSON.stringify(arr));

  let cachedDefaults = null;

  const renderActionsList = async () => {
      const ipaUrl = $('#hero-get').href;
      actionsList.innerHTML = '';
      
      // Custom Actions
      const customs = getCustomActions();
      customs.forEach(c => {
          const item = document.createElement('a');
          item.className = 'list-menu-item';
          item.textContent = c.title;
          item.href = c.url.replace('<ipaurl>', ipaUrl);
          item.onclick = () => actionsModal.classList.remove('flex');
          item.style.color = 'var(--text-primary)';
          actionsList.appendChild(item);
      });

      // Default Actions
      try {
        if (!cachedDefaults) {
            cachedDefaults = await fetchJSON('assets/data/actions.json');
        }
        const hidden = getHiddenDefaults();
        cachedDefaults.forEach(a => {
          if (hidden.includes(a.title)) return;
          const item = document.createElement('a');
          item.className = 'list-menu-item';
          item.textContent = a.title;
          item.href = a.url.replace('<ipaurl>', ipaUrl);
          item.onclick = () => actionsModal.classList.remove('flex');
          actionsList.appendChild(item);
        });
      } catch (e) {
        console.error('Failed to load actions', e);
      }

      // Edit Button
      const editBtn = document.createElement('div');
      editBtn.className = 'list-menu-item';
      editBtn.textContent = 'Edit Alternatives';
      editBtn.style.color = 'var(--text-secondary)';
      editBtn.style.cursor = 'pointer';
      editBtn.onclick = (e) => {
          e.stopPropagation();
          renderEditMode();
      };
      actionsList.appendChild(editBtn);
  };

  const renderEditMode = async () => {
      actionsList.innerHTML = '';
      
      const listWrapper = document.createElement('div');
      const formWrapper = document.createElement('div');
      const doneWrapper = document.createElement('div');
      
      actionsList.appendChild(listWrapper);
      actionsList.appendChild(formWrapper);
      actionsList.appendChild(doneWrapper);

      // Ensure defaults are loaded
      if (!cachedDefaults) {
          try { cachedDefaults = await fetchJSON('assets/data/actions.json'); }
          catch { cachedDefaults = []; }
      }

      const refreshList = () => {
          listWrapper.innerHTML = '';
          const customs = getCustomActions();
          const hidden = getHiddenDefaults();
          const defaults = cachedDefaults || [];
          
          const allItems = [
              ...customs.map((c, i) => ({ ...c, type: 'custom', idx: i })),
              ...defaults.map(d => ({ ...d, type: 'default' })).filter(d => !hidden.includes(d.title))
          ];

          if (allItems.length === 0) {
              const empty = document.createElement('div');
              empty.style.padding = '16px';
              empty.style.textAlign = 'center';
              empty.style.color = 'var(--text-secondary)';
              empty.textContent = 'No alternatives visible.';
              listWrapper.appendChild(empty);
          }

      allItems.forEach((item) => {
              const row = document.createElement('div');
              row.className = 'edit-row';
              
              const name = document.createElement('span');
              name.textContent = item.title;
              name.className = 'flex-1';
              if (item.type === 'custom') name.classList.add('bold');
              
              const del = document.createElement('button');
              del.textContent = 'Delete';
              del.className = 'red bold';
              del.onclick = () => {
                  if (item.type === 'custom') {
                      const current = getCustomActions();
                      current.splice(item.idx, 1);
                      setCustomActions(current);
                  } else {
                      const currentHidden = getHiddenDefaults();
                      if (!currentHidden.includes(item.title)) {
                          currentHidden.push(item.title);
                          setHiddenDefaults(currentHidden);
                      }
                  }
                  refreshList();
              };
              
              row.appendChild(name);
              row.appendChild(del);
              listWrapper.appendChild(row);
          });

          // Reset Button (if any defaults hidden)
          if (hidden.length > 0) {
              const resetBtn = document.createElement('div');
              resetBtn.className = 'reset-btn';
              resetBtn.textContent = 'Reset Default Alternatives';
              resetBtn.onclick = () => {
                  setHiddenDefaults([]);
                  refreshList();
              };
              listWrapper.appendChild(resetBtn);
          }
      };

      // Add New Form (Rendered once)
      formWrapper.className = 'edit-form';
      formWrapper.innerHTML = `
        <div class="mb-8 bold text-small">Add New</div>
        <input id="new-act-title" placeholder="Title" class="edit-input">
        <input id="new-act-url" placeholder="URL (<ipaurl> as placeholder)" class="edit-input">
        <div class="mb-8 text-secondary text-tiny">Use <code>&lt;ipaurl&gt;</code> to insert the IPA link.</div>
        <button id="add-act-btn" class="btn-primary w-full">Add</button>
      `;
      
      const addBtn = formWrapper.querySelector('#add-act-btn');
      const titleInp = formWrapper.querySelector('#new-act-title');
      const urlInp = formWrapper.querySelector('#new-act-url');

      addBtn.onclick = () => {
          const t = titleInp.value.trim();
          const u = urlInp.value.trim();
          if (t && u) {
              const current = getCustomActions();
              current.push({ title: t, url: u });
              setCustomActions(current);
              titleInp.value = '';
              urlInp.value = '';
              refreshList();
          }
      };

      // Done Button (Rendered once)
      const doneBtn = document.createElement('div');
      doneBtn.className = 'list-menu-item';
      doneBtn.textContent = 'Done';
      doneBtn.style.fontWeight = '600';
      doneBtn.style.cursor = 'pointer';
      doneBtn.onclick = renderActionsList;
      doneWrapper.appendChild(doneBtn);

      refreshList();
  };

  if (actionsBtn && actionsModal && !actionsBtn.dataset.setup) {
    actionsBtn.dataset.setup = 'true';
    actionsBtn.onclick = async () => {
      await renderActionsList();
      actionsModal.classList.add('flex');
    };
    
    setupModal(actionsModal, closeActions);
    setupModal($('#perm-modal'), $('#close-perm'));
    setupModal($('#ent-modal'), $('#close-ent'));
  }
  
  // Share setup
  const shareBtn = $('#btn-share');
  if (shareBtn && !shareBtn.dataset.setup) {
      shareBtn.dataset.setup = 'true';
      shareBtn.onclick = async () => {
        const verSel = $('#version-select');
        const selectedVersion = verSel.value;
        const shareUrl = new URL(window.location.href);
        if (selectedVersion) shareUrl.searchParams.set('version', selectedVersion);
        
        const shareText = `${app.name}${app.subtitle ? ' - ' + app.subtitle : ''}`;

        if (navigator.share) {
            try { await navigator.share({ title: app.name, text: shareText, url: shareUrl.toString() }); }
            catch (err) {}
        } else {
            try { await navigator.clipboard.writeText(shareUrl.toString()); showToast('Link copied to clipboard!'); }
            catch (err) {}
        }
      };
  }
}

function getVideoId(url) {
  if (!url) return null;
  // YouTube
  let m = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
  if (m) return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${m[1]}` };
  
  // Vimeo
  m = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)(?:$|\/|\?)/);
  if (m) return { type: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  
  // Dailymotion
  m = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  if (m) return { type: 'dailymotion', embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}` };
  
  return null;
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
    whatsNewText.innerHTML = linkify(notes);
    
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