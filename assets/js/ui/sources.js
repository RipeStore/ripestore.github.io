import { $, fetchJSON, showToast, setupModal, cdnify, db } from '../core/utils.js';
import { fetchRepo } from '../core/repo.js';
import { getSources, setSources, getOrigins, setOrigins, addSource as coreAddSource, removeSource } from '../core/sources.js';
import { removeSplash } from './components.js';
import { DEFAULTS as CFG } from '../core/config.js';

const SUGGESTIONS_URL = CFG.SUGGESTIONS_URL;

let allSuggestions = [];

let selected = null;

function render() {
  const box = $('#sourceList');
  if (!box) return;
  
  const sources = getSources();
  
  // If box is empty, do a full render. 
  // Otherwise, we just want to update states if we're just selecting.
  if (box.children.length !== sources.length) {
    box.innerHTML = '';
    sources.forEach(url => {
      const row = document.createElement('div');
      row.className = 'info-row clickable';
      row.dataset.url = url;
      
      const val = document.createElement('div');
      val.className = 'val break-all';
      
      row.appendChild(val);
      updateRowContent(row, url);

      row.onclick = async (e) => {
          e.stopPropagation();
          const url = row.dataset.url;
          if (selected === url) {
              await removeSource(url);
              selected = null;
              render(); // Full render on removal is fine
              return;
          }
          
          // Deselect old
          const old = box.querySelector(`[data-url="${selected}"]`);
          selected = url;
          if (old) updateRowContent(old, old.dataset.url);
          
          // Select new
          updateRowContent(row, url);
      };
      
      box.appendChild(row);
    });
  } else {
    // Just refresh contents to reflect selection
    Array.from(box.children).forEach(row => {
        updateRowContent(row, row.dataset.url);
    });
  }

  renderSuggestions();
}

function updateRowContent(row, url) {
    const val = row.querySelector('.val');
    if (!val) return;

    const renderState = (name) => {
        if (selected === url) {
            val.classList.add('accent');
            val.innerHTML = `<span class="repo-name">Tap again to remove</span><br><span class="url-sublabel">${name ? name + ' - ' : ''}${url}</span>`;
        } else {
            val.classList.remove('accent');
            if (name) {
                val.innerHTML = `<span class="repo-name">${name}</span><br><span class="url-sublabel">${url}</span>`;
            } else {
                val.innerHTML = `<span class="repo-name" style="visibility:hidden">Unknown</span><br><span class="url-sublabel">${url}</span>`;
            }
        }
    };

    // Show loading or cached name
    if (!val.innerHTML.includes('<br>')) {
        renderState('');
    }
    
    fetchRepo(url).then(res => {
        const name = (res && res.data && res.data.name) ? res.data.name : '';
        renderState(name);
    }).catch(() => {
        if (selected !== url) val.classList.add('accent');
        renderState('');
    });
}

function renderSuggestions() {
  const list = getSources();
  
  // Add default repos to suggestions if not installed
  const suggestions = [...allSuggestions];
  const defaultRepos = CFG.DEFAULT_REPOS || [{ name: CFG.SOURCE_NAME, url: CFG.SOURCE_URL }];
  defaultRepos.forEach(def => {
    if (!list.includes(def.name) && !suggestions.some(s => s.name === def.name)) {
      suggestions.unshift(def);
    }
  });

  const available = suggestions.filter(r => !list.includes(r.name));
  available.sort((a, b) => a.name.localeCompare(b.name));

  const section = $('#suggestedSection');
  const container = $('#suggestedList');

  if (!section || !container) return;

  if (available.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = '';

  available.forEach(r => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = r.name;
    chip.onclick = () => addSourceWrapper(r.name, 'suggested');
    
    container.appendChild(chip);
  });
}

async function addSourceWrapper(v, type = 'manual') {
  if (await coreAddSource(v, type)) {
    render();
  }
}

async function initSuggestions() {
  try {
    const data = await fetchJSON(SUGGESTIONS_URL + '?t=' + Date.now());

    if (Array.isArray(data)) {
      allSuggestions = data;
      
      // Auto-removal logic for 'suggested' sources that are no longer in the list
      const list = getSources();
      const origins = getOrigins();
      const suggestionNames = new Set(data.map(d => d.name));
      const defaultSources = CFG.DEFAULT_SOURCES || [CFG.SOURCE_NAME];
      defaultSources.forEach(s => suggestionNames.add(s)); // Protect default sources (RipeStore, AltMaker)

      let changed = false;
      const newList = list.filter(src => {
        if (origins[src] === 'suggested' && !suggestionNames.has(src)) {
            delete origins[src];
            changed = true;
            return false;
        }
        return true;
      });

      if (changed) {
          await setSources(newList);
          setOrigins(origins);
          render();
      }

      renderSuggestions();
    }
  } catch (e) {
    console.warn('Failed to load suggestions', e);
  }
}

$('#addBtn').addEventListener('click', () => {
  const input = $('#newSource');
  addSourceWrapper(input.value);
  input.value = '';
  selected = null;
});

$('#newSource').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addSourceWrapper(e.target.value);
    e.target.value = '';
    selected = null;
  }
});

const STATUS_LABELS = { checking: '', updated: 'Updated', current: 'Up to date', failed: 'Failed' };

function setRowStatus(url, state, detail = '') {
  const row = $('#sourceList')?.querySelector(`[data-url="${CSS.escape(url)}"]`);
  if (!row) return;
  let badge = row.querySelector('.src-status');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'src-status';
    row.appendChild(badge);
  }
  badge.dataset.state = state;
  badge.textContent = STATUS_LABELS[state];
  badge.title = detail;
}

const updateBtn = $('#updateBtn');
if (updateBtn) {
  const setBtnBusy = (label) => {
    updateBtn.innerHTML = `<span class="btn-spinner"></span>${label}`;
  };

  updateBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const list = getSources();
    if (!list.length) {
      showToast('No sources to update.');
      return;
    }

    updateBtn.disabled = true;
    updateBtn.classList.add('disabled-btn');
    let done = 0;
    const counts = { updated: 0, current: 0, failed: 0 };
    setBtnBusy(`Checking 0/${list.length}`);
    list.forEach(url => setRowStatus(url, 'checking'));

    await Promise.all(list.map(async url => {
      let state;
      let detail = '';
      try {
        const res = await fetchRepo(url, true);
        if (res.failed) {
          state = 'failed';
          detail = `Showing cached copy: ${res.error?.message || 'network error'}`;
        } else {
          state = res.changed ? 'updated' : 'current';
        }
      } catch (err) {
        state = 'failed';
        detail = err?.message || 'network error';
      }
      counts[state]++;
      setRowStatus(url, state, detail);
      setBtnBusy(`Checking ${++done}/${list.length}`);
    }));

    // Rebuild the merged snapshot on the next page view even if hashes matched, so a snapshot
    // assembled from an older payload can never outlive a manual update.
    await db.remove(CFG.MASTER_CACHE_KEY);
    if (counts.updated > 0) localStorage.setItem('ripe_sources_changed', Date.now().toString());

    render();

    const parts = [];
    if (counts.updated) parts.push(`${counts.updated} updated`);
    if (counts.current) parts.push(`${counts.current} up to date`);
    if (counts.failed) parts.push(`${counts.failed} failed`);
    showToast(counts.updated || counts.failed ? parts.join(' · ') : 'All sources are up to date', 3000);

    updateBtn.textContent = 'Update';
    updateBtn.disabled = false;
    updateBtn.classList.remove('disabled-btn');
  });
}

document.addEventListener('click', () => {
  if (selected) {
    selected = null;
    render();
  }
});

render();
initSuggestions();

removeSplash();

// --- Export / Import Logic ---

function resolveSourcesToUrls() {
  const list = getSources();
  const defaultRepos = CFG.DEFAULT_REPOS || [{ name: CFG.SOURCE_NAME, url: CFG.SOURCE_URL }];
  // Defaults first so their configured URL wins over a same-named remote suggestion
  const suggestions = [...defaultRepos, ...allSuggestions];

  return list.map(src => {
    if (src.includes('://')) return src;
    const found = suggestions.find(s => s.name === src);
    if (found) return found.url;
    // Fallback to internal structure
    return `${CFG.INTERNAL_REPO_BASE}${src}.json`;
  });
}

async function processImport(text) {
  if (!text) return;
  text = text.trim();
  
  // Try Base64 Decode
  try {
    const decoded = atob(text);
    // basic check if it looks like a url list or just junk
    if (decoded.includes('http') || decoded.includes('.')) {
      text = decoded;
    }
  } catch (e) {
    // Not base64, proceed as raw text
  }
  
  const lines = text.split(/[\n\r\s,]+/);
  let count = 0;
  for (let line of lines) {
    line = line.trim();
    if (line && (line.startsWith('http') || line.indexOf('.') > 0)) {
       if (await coreAddSource(line, 'manual')) count++;
    }
  }
  
  if (count > 0) {
    showToast(`Imported ${count} new source(s).`);
    render();
  } else {
    showToast('No valid new sources found.');
  }
}

// Export
const exportMenuBtn = $('#exportMenuBtn');
const importMenuBtn = $('#importMenuBtn');
const ioModal = $('#io-modal');
const ioTitle = $('#io-title');
const ioList = $('#io-list');
const closeIo = $('#close-io');
const importFileInput = $('#importFileInput');

setupModal(ioModal, closeIo);

const IO_ICONS = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'
};

function openIoMenu(title, options) {
    ioTitle.textContent = title;
    ioList.innerHTML = '';
    const menu = document.createElement('div');
    menu.className = 'actions-menu';
    options.forEach(({ label, icon, onClick }) => {
        const item = document.createElement('div');
        item.className = 'action-item clickable';
        item.setAttribute('role', 'button');
        item.innerHTML = `
          <span class="action-label">
            <svg class="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IO_ICONS[icon]}</svg>
            <span></span>
          </span>
          <svg class="action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        `;
        item.querySelector('.action-label > span').textContent = label;
        item.onclick = () => {
            ioModal.classList.remove('flex');
            onClick();
        };
        menu.appendChild(item);
    });
    ioList.appendChild(menu);
    ioModal.classList.add('flex');
}

if (exportMenuBtn) {
  exportMenuBtn.onclick = () => openIoMenu('Export Sources', [
    {
      label: 'Save to File',
      icon: 'file',
      onClick: () => {
        const list = resolveSourcesToUrls();
        const blob = new Blob([list.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ripestore-sources.txt';
        a.click();
        URL.revokeObjectURL(url);
      }
    },
    {
      label: 'Copy to Clipboard',
      icon: 'clipboard',
      onClick: async () => {
        const list = resolveSourcesToUrls();
        try {
            await navigator.clipboard.writeText(list.join('\n'));
            showToast('Copied to clipboard!');
        } catch(e) {
            showToast('Failed to copy: ' + e.message);
        }
      }
    }
  ]);
}

if (importMenuBtn) {
  importMenuBtn.onclick = () => openIoMenu('Import Sources', [
    {
      label: 'Import from File',
      icon: 'file',
      onClick: () => importFileInput.click()
    },
    {
      label: 'Paste from Clipboard',
      icon: 'clipboard',
      onClick: async () => {
        try {
            const text = await navigator.clipboard.readText();
            await processImport(text);
        } catch (e) {
            showToast('Failed to read clipboard: ' + e.message);
        }
      }
    }
  ]);
}

if (importFileInput) {
  importFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => processImport(ev.target.result);
    reader.readAsText(file);
    importFileInput.value = ''; // reset
  };
}
