import { $ } from '../core/utils.js';
import { fetchRepo } from '../core/repo.js';

const KEY = 'ripe_sources';
const DEFAULTS = ['RipeStore']; 

function get() {
  try { return JSON.parse(localStorage.getItem(KEY)) || DEFAULTS; }
  catch (_) { return DEFAULTS; }
}

function set(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr));
}

let selected = null;

function render() {
  const box = $('#sourceList');
  box.innerHTML = '';
  get().forEach(url => {
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

    // Validate repo status
    if (selected !== url) {
        fetchRepo(url).catch(() => {
            val.style.color = '#ff453a';
        });
    }

    row.onclick = (e) => {
        e.stopPropagation();
        const list = get();
        if (selected === url) {
            set(list.filter(x => x !== url));
            selected = null;
            render();
            return;
        }
        selected = url;
        render();
    };
    
    box.appendChild(row);
  });
}

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

document.addEventListener('click', () => {
  if (selected) {
    selected = null;
    render();
  }
});

render();
