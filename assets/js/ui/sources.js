import { $, fetchJSON, showToast } from '../core/utils.js';
import { fetchRepo } from '../core/repo.js';
import { getSources, setSources, getOrigins, setOrigins, addSource as coreAddSource, removeSource } from '../core/sources.js';

const SUGGESTIONS_URL = 'https://raw.githubusercontent.com/RipeStore/repos/refs/heads/main/ipa-repos.json';

let allSuggestions = [];

let selected = null;

function render() {
  const box = $('#sourceList');
  box.innerHTML = '';
  getSources().forEach(url => {
    const row = document.createElement('div');
    row.className = 'info-row';
    row.style.cursor = 'pointer';
    
    const val = document.createElement('div');
    val.className = 'val';
    val.textContent = url;
    val.style.wordBreak = 'break-all';
    
    // Simple remove logic
    if (selected === url) {
        val.style.color = '#ff453a';
        val.textContent = "Tap again to remove: " + url;
    }

    row.appendChild(val);

    // Validate repo status and update name
    if (selected !== url) {
        fetchRepo(url).catch(() => {
            val.style.color = '#ff453a';
        }).then(res => {
            if (res && res.data && res.data.name) {
                // If not selected/removing, show name
                if (selected !== url) {
                   val.innerHTML = `<span style="font-weight:600">${res.data.name}</span><br><span style="font-size:12px;opacity:0.7">${url}</span>`;
                }
            }
        });
    }

    row.onclick = (e) => {
        e.stopPropagation();
        if (selected === url) {
            removeSource(url);
            selected = null;
            render();
            return;
        }
        selected = url;
        render();
    };
    
    box.appendChild(row);
  });

  renderSuggestions();
}

function renderSuggestions() {
  const list = getSources();
  
  // Add RipeStore to suggestions if not installed
  const suggestions = [...allSuggestions];
  if (!list.includes('RipeStore') && !suggestions.some(s => s.name === 'RipeStore')) {
      suggestions.unshift({ name: 'RipeStore', url: 'https://raw.githubusercontent.com/ripestore/repos/main/RipeStore.json' });
  }

  const available = suggestions.filter(r => !list.includes(r.name));
  available.sort((a, b) => a.name.localeCompare(b.name));

  const section = $('#suggestedSection');
  const container = $('#suggestedList');

  if (!section || !container) return;

  if (available.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = '';

  available.forEach(r => {
    const chip = document.createElement('div');
    chip.style.cssText = `
      background: var(--bg-secondary);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--separator);
      color: var(--text-primary);
      transition: background 0.2s;
    `;
    chip.textContent = r.name;
    chip.onclick = () => addSourceWrapper(r.name, 'suggested');
    
    // Hover effect simulation
    chip.onmouseover = () => { chip.style.background = 'var(--separator)'; };
    chip.onmouseout = () => { chip.style.background = 'var(--bg-secondary)'; };

    container.appendChild(chip);
  });
}

function addSourceWrapper(v, type = 'manual') {
  if (coreAddSource(v, type)) {
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
      suggestionNames.add('RipeStore'); // Protect RipeStore

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
          setSources(newList);
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

const updateBtn = $('#updateBtn');
if (updateBtn) {
  updateBtn.addEventListener('click', async () => {
    const originalText = updateBtn.textContent;
    updateBtn.textContent = 'Updating...';
    updateBtn.disabled = true;
    updateBtn.style.opacity = '0.5';
    
    const list = getSources();
    await Promise.allSettled(list.map(url => fetchRepo(url, true)));
    
    render();
    
    updateBtn.textContent = originalText;
    updateBtn.disabled = false;
    updateBtn.style.opacity = '1';
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

// --- Export / Import Logic ---

function resolveSourcesToUrls() {
  const list = getSources();
  const suggestions = [...allSuggestions];
  if (!suggestions.some(s => s.name === 'RipeStore')) {
    suggestions.push({ name: 'RipeStore', url: 'https://raw.githubusercontent.com/ripestore/repos/main/RipeStore.json' });
  }

  return list.map(src => {
    if (src.includes('://')) return src;
    const found = suggestions.find(s => s.name === src);
    if (found) return found.url;
    // Fallback to internal structure
    return `https://raw.githubusercontent.com/ripestore/repos/main/${src}.json`;
  });
}

function processImport(text) {
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
  lines.forEach(line => {
    line = line.trim();
    if (line && (line.startsWith('http') || line.indexOf('.') > 0)) {
       if (coreAddSource(line, 'manual')) count++;
    }
  });
  
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

if (closeIo) closeIo.onclick = () => ioModal.style.display = 'none';
if (ioModal) {
    window.addEventListener('click', (e) => {
        if (e.target === ioModal) ioModal.style.display = 'none';
    });
}

function showIoOption(label, onClick) {
    const item = document.createElement('div');
    item.className = 'list-menu-item';
    item.textContent = label;
    item.style.cursor = 'pointer';
    item.onclick = () => {
        ioModal.style.display = 'none';
        onClick();
    };
    ioList.appendChild(item);
}

if (exportMenuBtn) {
  exportMenuBtn.onclick = () => {
      ioTitle.textContent = 'Export Sources';
      ioList.innerHTML = '';
      
      showIoOption('Save to File', () => {
        const list = resolveSourcesToUrls();
        const blob = new Blob([list.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ripestore-sources.txt';
        a.click();
        URL.revokeObjectURL(url);
      });
      
      showIoOption('Copy to Clipboard', async () => {
        const list = resolveSourcesToUrls();
        try {
            await navigator.clipboard.writeText(list.join('\n'));
            showToast('Copied to clipboard!');
        } catch(e) {
            showToast('Failed to copy: ' + e.message);
        }
      });
      
      ioModal.style.display = 'flex';
  };
}

if (importMenuBtn) {
  importMenuBtn.onclick = () => {
      ioTitle.textContent = 'Import Sources';
      ioList.innerHTML = '';
      
      showIoOption('Import from File', () => {
          importFileInput.click();
      });
      
      showIoOption('Paste from Clipboard', async () => {
        try {
            const text = await navigator.clipboard.readText();
            processImport(text);
        } catch (e) {
            showToast('Failed to read clipboard: ' + e.message);
        }
      });
      
      ioModal.style.display = 'flex';
  };
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
