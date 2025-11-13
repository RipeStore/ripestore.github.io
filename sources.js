// Import utility functions from utils.js
import { $ } from './utils.js';

// Constants for local storage
const KEY = 'ripe_sources';
const DEFAULTS = ['RipeStore'];

/**
 * Retrieves the list of sources from local storage.
 * @returns {string[]} An array of source URLs.
 */
function get() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || DEFAULTS;
  } catch (_) {
    return DEFAULTS;
  }
}

/**
 * Saves the list of sources to local storage.
 * @param {string[]} arr - The array of source URLs to save.
 */
function set(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr));
}

// Variable to track the currently selected source
let selected = null;

/**
 * Renders the list of sources in the UI.
 */
function render() {
  const box = $('#sourceList');
  box.innerHTML = '';
  get().forEach(url => {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('div');
    lab.className = 'label';
    lab.textContent = 'Source';
    const val = document.createElement('div');
    val.className = 'value ellipsis';
    val.textContent = url;
    const hint = document.createElement('div');
    hint.className = 'small';
    hint.textContent = '';
    hint.style.color = 'var(--text-dim)';
    row.appendChild(lab);
    row.appendChild(val);
    row.appendChild(hint);

    // Event listener for selecting and removing sources
    row.addEventListener('click', () => {
      const list = get();
      if (selected === url) {
        set(list.filter(x => x !== url));
        selected = null;
        render();
        return;
      }
      selected = url;
      Array.from(document.querySelectorAll('#sourceList .row')).forEach(r => r.classList.remove('selected'));
      Array.from(document.querySelectorAll('#sourceList .row .small')).forEach(h => h.textContent = '');
      row.classList.add('selected');
      hint.textContent = 'Tap again to remove';
      hint.style.color = 'crimson';
    });
    box.appendChild(row);
  });
}

// Event listener for the "Add" button
$('#addBtn').addEventListener('click', () => {
  const v = $('#newSource').value.trim();
  if (!v) return;
  const list = get();
  if (!list.includes(v)) {
    list.push(v);
    set(list);
    render();
  }
  $('#newSource').value = '';
  selected = null;
});

// Event listener to deselect a source when clicking outside the list
document.addEventListener('click', (e) => {
  if (!e.target.closest('#sourceList')) {
    selected = null;
    Array.from(document.querySelectorAll('#sourceList .row')).forEach(r => r.classList.remove('selected'));
    Array.from(document.querySelectorAll('#sourceList .row .small')).forEach(h => h.textContent = '');
  }
});

// Initial render of the source list
render();
