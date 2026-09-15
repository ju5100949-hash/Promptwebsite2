/* ============================================================
   KAZEPROMPT — main client script
   Offline-first. localStorage cache utama, Supabase non-blocking.
   ============================================================ */

const LS = {
  prompts: 'kaze_prompts',
  users: 'kaze_users',
  saved: 'kaze_saved',
  activity: 'kaze_activity',
  ownerHash: 'kaze_owner_hash'
};

let PROMPTS = [];
let CURRENT_USER = '';
let CURRENT_VIEW = 'home';
let viewerPromptId = null;

/* ============ HELPERS ============ */
function $(s){ return document.querySelector(s); }
function $all(s){ return document.querySelectorAll(s); }

function readLS(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function writeLS(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
}

function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 1800);
}

function esc(str){
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function sha256Hex(text){
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ============ INTRO SPLASH ============ */
function initIntro(){
  const splash = $('#intro-splash');
  const video = $('#intro-video');
  const LOCK = 'kaze_intro_shown';

  // Sudah pernah tampil di sesi ini → langsung hidden
  if (sessionStorage.getItem(LOCK) === '1'){
    splash.style.display = 'none';
    return;
  }

  let done = false;
  function hideIntro(){
    if (done) return;
    done = true;
    sessionStorage.setItem(LOCK, '1');
    if (splash.classList.contains('hidden')) return;
    splash.classList.add('hidden');
    setTimeout(() => { splash.style.display = 'none'; }, 850);
  }
  window.__kazeHideIntro = hideIntro;

  // Semua event listener wajib
  video.addEventListener('ended', hideIntro);
  video.addEventListener('error', hideIntro);
  video.addEventListener('canplay', () => {
    video.play().catch(() => hideIntro());
    // safety timer lebih pendek setelah canplay
    setTimeout(hideIntro, 500);
  });
  video.addEventListener('playing', () => {
    // safety pendek setelah playing
    setTimeout(hideIntro, 500);
  });

  // Coba play manual (autoplay mungkin diblokir)
  const p = video.play();
  if (p && typeof p.catch === 'function') p.catch(() => hideIntro());

  // WATCHDOG KERAS
  setTimeout(hideIntro, 3000);
}

/* ============ USER ============ */
function getUsers(){ return readLS(LS.users, []); }
function saveUsers(list){ writeLS(LS.users, list); }

function initUser(){
  const users = getUsers();
  if (users.length === 0){
    $('#name-modal').classList.remove('hidden');
    $('#name-input').focus();
  } else {
    CURRENT_USER = users[0].name || '';
    updateNavUser();
  }
}

function updateNavUser(){
  const el = $('#nav-user');
  if (CURRENT_USER) el.textContent = CURRENT_USER;
  else el.textContent = '';
}

$('#name-submit').addEventListener('click', async () => {
  const name = $('#name-input').value.trim();
  if (!name){ toast('Nama tidak boleh kosong'); return; }
  const users = getUsers();
  if (!users.find(u => u.name === name)){
    users.push({ name, created_at: new Date().toISOString() });
    saveUsers(users);
  }
  CURRENT_USER = name;
  updateNavUser();
  $('#name-modal').classList.add('hidden');
  try { await SB.saveUser(name); } catch(e){}
  try { await logActivity('login', name); } catch(e){}
});

$('#name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#name-submit').click();
});

/* ============ PROMPTS ============ */
function normalizePrompt(p){
  return {
    id: p.id,
    title: p.title || '',
    description: p.description || '',
    author: p.author || 'unknown',
    tag: p.tag || '',
    category: p.category || '',
    difficulty: p.difficulty || 'medium',
    is_active: p.is_active !== false,
    created_at: p.created_at || new Date().toISOString()
  };
}

async function loadPrompts(){
  // 1. cache lokal dulu
  const cached = readLS(LS.prompts, null);
  if (cached && Array.isArray(cached) && cached.length){
    PROMPTS = cached.map(normalizePrompt);
    renderGrid();
  } else {
    // 2. kalau kosong, coba seed JSON
    try{
      const res = await fetch('prompts.json', { cache: 'no-store' });
      if (res.ok){
        const data = await res.json();
        PROMPTS = data.map(normalizePrompt);
        writeLS(LS.prompts, PROMPTS);
        renderGrid();
      }
    }catch(e){}
  }

  // 3. sync cloud (non-blocking)
  SB.fetchPrompts().then(list => {
    if (Array.isArray(list) && list.length){
      // merge: cloud menang kalau lebih baru, tapi sederhana: timpa kalau lokal kosong
      const localIds = new Set(PROMPTS.map(p => p.id));
      let changed = false;
      list.map(normalizePrompt).forEach(cp => {
        if (!localIds.has(cp.id)){ PROMPTS.push(cp); changed = true; }
      });
      if (changed){
        writeLS(LS.prompts, PROMPTS);
        renderGrid();
      }
    }
  }).catch(() => {});
}

function getSavedList(){
  const all = readLS(LS.saved, []);
  return all.filter(s => s.user_name === CURRENT_USER);
}
function isSaved(promptId){
  return getSavedList().some(s => s.prompt_id === promptId);
}

/* ============ RENDER GRID ============ */
function difficultyClass(d){
  if (d === 'easy') return 'diff-easy';
  if (d === 'hard') return 'diff-hard';
  return 'diff-medium';
}

function renderGrid(){
  const q = ($('#search-input').value || '').toLowerCase().trim();
  const fd = $('#filter-difficulty').value;

  let list = PROMPTS.filter(p => p.is_active !== false);

  if (CURRENT_VIEW === 'saved'){
    const savedIds = new Set(getSavedList().map(s => s.prompt_id));
    list = list.filter(p => savedIds.has(p.id));
  }

  if (fd) list = list.filter(p => p.difficulty === fd);

  if (q){
    list = list.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tag || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.author || '').toLowerCase().includes(q)
    );
  }

  // urutkan terbaru
  list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  const grid = $('#prompt-grid');
  const empty = $('#empty-state');

  if (!list.length){
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = list.map(p => {
    const saved = isSaved(p.id);
    return `
    <article class="card" data-id="${esc(p.id)}">
      <h3 class="card-title">${esc(p.title)}</h3>
      <div class="card-author">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>${esc(p.author)}</span>
      </div>
      <p class="card-desc">${esc(p.description)}</p>
      <div class="card-tags">
        ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
        ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
        <span class="tag ${difficultyClass(p.difficulty)}">${esc(p.difficulty)}</span>
      </div>
      <div class="card-actions">
        <button class="primary" data-action="copy" data-id="${esc(p.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Salin
        </button>
        <button data-action="save" data-id="${esc(p.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          ${saved ? 'Tersimpan' : 'Simpan'}
        </button>
      </div>
    </article>`;
  }).join('');

  // Attach events
  $all('.card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-action]')) return;
      openViewer(card.dataset.id);
    });
  });
  $all('[data-action="copy"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyPrompt(btn.dataset.id);
    });
  });
  $all('[data-action="save"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await toggleSave(btn.dataset.id);
    });
  });
}

/* ============ COPY / SAVE ============ */
function findPrompt(id){ return PROMPTS.find(p => p.id === id); }

async function copyPrompt(id){
  const p = findPrompt(id);
  if (!p) return;
  const text = p.description || p.title;
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); }catch(_){}
    document.body.removeChild(ta);
  }
  toast('Prompt disalin');
  try { await logActivity('copy', CURRENT_USER, id); } catch(e){}
}

async function toggleSave(id){
  const all = readLS(LS.saved, []);
  const idx = all.findIndex(s => s.user_name === CURRENT_USER && s.prompt_id === id);
  if (idx >= 0){
    all.splice(idx, 1);
    writeLS(LS.saved, all);
    toast('Dihapus dari simpanan');
    try { await SB.deleteSavedCloud(CURRENT_USER, id); } catch(e){}
    try { await logActivity('unsave', CURRENT_USER, id); } catch(e){}
  } else {
    all.push({ user_name: CURRENT_USER, prompt_id: id, created_at: new Date().toISOString() });
    writeLS(LS.saved, all);
    toast('Disimpan');
    try { await SB.saveSavedCloud(CURRENT_USER, id); } catch(e){}
    try { await logActivity('save', CURRENT_USER, id); } catch(e){}
  }
  renderGrid();
}

/* ============ VIEWER ============ */
function openViewer(id){
  const p = findPrompt(id);
  if (!p) return;
  viewerPromptId = id;
  $('#viewer-title').textContent = p.title;
  $('#viewer-author').textContent = p.author;
  $('#viewer-tags').innerHTML = `
    ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
    ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
    <span class="tag ${difficultyClass(p.difficulty)}">${esc(p.difficulty)}</span>
  `;
  $('#viewer-body').textContent = p.description;
  $('#viewer-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeViewer(){
  $('#viewer-modal').classList.add('hidden');
  document.body.style.overflow = '';
  viewerPromptId = null;
}

$('#viewer-close').addEventListener('click', closeViewer);
$('#viewer-close-2').addEventListener('click', closeViewer);
$('#viewer-modal').addEventListener('click', e => {
  if (e.target.id === 'viewer-modal') closeViewer();
});
$('#viewer-copy').addEventListener('click', () => {
  if (viewerPromptId) copyPrompt(viewerPromptId);
});

/* ============ BOTTOM NAV ============ */
$all('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $all('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    CURRENT_VIEW = tab.dataset.tab;
    if (CURRENT_VIEW === 'download'){ exportLocal(); }
    renderGrid();
  });
});

/* ============ EXPORT (client) ============ */
function exportLocal(){
  const data = PROMPTS.map(p => ({
    id: p.id, title: p.title, description: p.description, author: p.author,
    tag: p.tag, category: p.category, difficulty: p.difficulty,
    is_active: p.is_active, created_at: p.created_at
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'prompts.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('prompts.json diunduh');
  logActivity('download', CURRENT_USER, 'prompts.json');
}

/* ============ ACTIVITY ============ */
async function logActivity(type, user_name, prompt_id){
  const entry = {
    type: type || 'event',
    user_name: user_name || CURRENT_USER || 'unknown',
    prompt_id: prompt_id || null,
    created_at: new Date().toISOString()
  };
  const all = readLS(LS.activity, []);
  all.unshift(entry);
  writeLS(LS.activity, all.slice(0, 100));
  try { await SB.logActivityCloud(entry); } catch(e){}
}

/* ============ OWNER ACCESS ============ */
const OWNER_KEY = 'azeezaax';

function showOwnerModal(){
  $('#owner-modal').classList.remove('hidden');
  $('#owner-input').value = '';
  $('#owner-error').classList.add('hidden');
  setTimeout(() => $('#owner-input').focus(), 50);
}
function hideOwnerModal(){
  $('#owner-modal').classList.add('hidden');
}

$('#owner-close').addEventListener('click', hideOwnerModal);
$('#owner-modal').addEventListener('click', e => {
  if (e.target.id === 'owner-modal') hideOwnerModal();
});

$('#owner-submit').addEventListener('click', async () => {
  const val = $('#owner-input').value;
  const hash = await sha256Hex(val);
  if (val === OWNER_KEY){
    localStorage.setItem(LS.ownerHash, hash);
    sessionStorage.setItem('kaze_owner_verified', '1');
    hideOwnerModal();
    toast('Akses diberikan');
    setTimeout(() => { window.location.href = 'azee.html'; }, 400);
  } else {
    $('#owner-error').classList.remove('hidden');
    try { await logActivity('owner_fail', CURRENT_USER, null); } catch(e){}
  }
});

$('#owner-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#owner-submit').click();
});

// Trigger a: Ctrl+Shift+A
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')){
    e.preventDefault();
    showOwnerModal();
  }
});

// Trigger b: URL hash
function checkHash(){
  if (window.location.hash === '#owner-panel') showOwnerModal();
}
window.addEventListener('hashchange', checkHash);

// Trigger c: tap logo 5x < 800ms
let logoTaps = [];
$('#logo-tap').addEventListener('click', () => {
  const now = Date.now();
  logoTaps.push(now);
  logoTaps = logoTaps.filter(t => now - t < 800);
  if (logoTaps.length >= 5){
    logoTaps = [];
    showOwnerModal();
  }
});

/* ============ EVENTS ============ */
$('#search-input').addEventListener('input', renderGrid);
$('#filter-difficulty').addEventListener('change', renderGrid);

/* ============ INIT ============ */
function init(){
  initIntro();
  initUser();
  checkHash();
  loadPrompts();
}

document.addEventListener('DOMContentLoaded', init);
