/* ============================================================
   azee.js — owner panel logic
   Guard + CRUD + export JSON/CSV
   ============================================================ */

const LS = {
  prompts: 'kaze_prompts',
  users: 'kaze_users',
  saved: 'kaze_saved',
  activity: 'kaze_activity',
  ownerHash: 'kaze_owner_hash'
};

let PROMPTS = [];
let editingId = null;

/* ============ GUARD ============ */
(function guard(){
  const hash = localStorage.getItem(LS.ownerHash);
  const verified = sessionStorage.getItem('kaze_owner_verified');
  if (!hash || verified !== '1'){
    window.location.replace('index.html');
  }
})();

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

/* ============ LOAD ============ */
function loadLocal(){
  const cached = readLS(LS.prompts, null);
  if (cached && Array.isArray(cached) && cached.length){
    PROMPTS = cached.map(normalizePrompt);
  } else {
    PROMPTS = [];
  }
}

async function loadCloud(){
  try{
    const list = await SB.fetchPrompts();
    if (Array.isArray(list) && list.length){
      // merge by id, cloud menang
      const map = new Map();
      PROMPTS.forEach(p => map.set(p.id, p));
      list.map(normalizePrompt).forEach(p => map.set(p.id, p));
      PROMPTS = Array.from(map.values());
      writeLS(LS.prompts, PROMPTS);
    }
  }catch(e){}
}

/* ============ RENDER ============ */
function renderManage(){
  const tbody = $('#manage-tbody');
  const list = PROMPTS.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (!list.length){
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-mute);padding:24px">Belum ada prompt.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p => `
    <tr>
      <td>${esc(p.id)}</td>
      <td>${esc(p.title)}</td>
      <td>${esc(p.author)}</td>
      <td>${esc(p.tag)}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.difficulty)}</td>
      <td>${p.is_active ? 'true' : 'false'}</td>
      <td>
        <div class="row-actions">
          <button data-edit="${esc(p.id)}">Edit</button>
          <button class="danger" data-del="${esc(p.id)}">Hapus</button>
        </div>
      </td>
    </tr>
  `).join('');

  $all('[data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  $all('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Hapus prompt ini?')) return;
    await deletePrompt(b.dataset.del);
  }));
}

function renderStats(){
  const users = readLS(LS.users, []);
  const saved = readLS(LS.saved, []);
  const activity = readLS(LS.activity, []);
  $('#st-total').textContent = PROMPTS.length;
  $('#st-active').textContent = PROMPTS.filter(p => p.is_active !== false).length;
  $('#st-users').textContent = users.length;
  $('#st-saved').textContent = saved.length;

  const list = activity.slice(0, 10);
  const el = $('#activity-list');
  if (!list.length){
    el.innerHTML = '<div style="color:var(--text-mute);font-size:12.5px">Belum ada aktivitas.</div>';
    return;
  }
  el.innerHTML = list.map(a => `
    <div class="activity-item">
      <span>${esc(a.type)} — ${esc(a.user_name || 'unknown')}${a.prompt_id ? ' ('+esc(a.prompt_id)+')' : ''}</span>
      <span class="meta">${new Date(a.created_at).toLocaleString('id-ID')}</span>
    </div>
  `).join('');
}

function renderAll(){
  renderManage();
  renderStats();
}

/* ============ CRUD ============ */
function startEdit(id){
  const p = PROMPTS.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  $('#f-id').value = p.id;
  $('#f-title').value = p.title;
  $('#f-desc').value = p.description;
  $('#f-author').value = p.author;
  $('#f-tag').value = p.tag;
  $('#f-category').value = p.category;
  $('#f-difficulty').value = p.difficulty;
  $('#f-active').value = p.is_active ? 'true' : 'false';
  $('#form-submit').textContent = 'Simpan Perubahan';
  $('#form-cancel').classList.remove('hidden');
  switchPanel('tambah');
}

function resetForm(){
  editingId = null;
  $('#f-id').value = '';
  $('#f-title').value = '';
  $('#f-desc').value = '';
  $('#f-author').value = '';
  $('#f-tag').value = '';
  $('#f-category').value = '';
  $('#f-difficulty').value = 'medium';
  $('#f-active').value = 'true';
  $('#form-submit').textContent = 'Tambah Prompt';
  $('#form-cancel').classList.add('hidden');
}

$('#form-cancel').addEventListener('click', resetForm);

$('#prompt-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#f-title').value.trim();
  const desc = $('#f-desc').value.trim();
  const author = $('#f-author').value.trim();
  if (!title || !desc || !author){ toast('Title, Description, Author wajib'); return; }

  let id = editingId;
  if (!id){
    id = 'p' + Date.now().toString(36);
  }

  const prompt = normalizePrompt({
    id,
    title,
    description: desc,
    author,
    tag: $('#f-tag').value.trim(),
    category: $('#f-category').value.trim(),
    difficulty: $('#f-difficulty').value,
    is_active: $('#f-active').value === 'true',
    created_at: (PROMPTS.find(p => p.id === id) || {}).created_at || new Date().toISOString()
  });

  const idx = PROMPTS.findIndex(p => p.id === id);
  if (idx >= 0) PROMPTS[idx] = prompt;
  else PROMPTS.push(prompt);

  writeLS(LS.prompts, PROMPTS);
  try { await SB.savePromptCloud(prompt); } catch(e){}
  try { await logActivity(editingId ? 'edit' : 'add', prompt.id); } catch(e){}

  resetForm();
  renderAll();
  toast(editingId ? 'Prompt diperbarui' : 'Prompt ditambahkan');
  switchPanel('kelola');
});

async function deletePrompt(id){
  PROMPTS = PROMPTS.filter(p => p.id !== id);
  writeLS(LS.prompts, PROMPTS);
  try { await SB.deletePromptCloud(id); } catch(e){}
  try { await logActivity('delete', id); } catch(e){}
  renderAll();
  toast('Prompt dihapus');
}

/* ============ ACTIVITY ============ */
async function logActivity(type, prompt_id){
  const entry = {
    type,
    user_name: 'owner',
    prompt_id: prompt_id || null,
    created_at: new Date().toISOString()
  };
  const all = readLS(LS.activity, []);
  all.unshift(entry);
  writeLS(LS.activity, all.slice(0, 100));
  try { await SB.logActivityCloud(entry); } catch(e){}
}

/* ============ EXPORT ============ */
$('#export-json').addEventListener('click', () => {
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
  logActivity('export_json', 'prompts.json');
});

function csvEscape(val){
  const s = String(val == null ? '' : val);
  if (/[",\r\n]/.test(s)){
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

$('#export-csv').addEventListener('click', () => {
  const headers = ['id','title','description','author','tag','category','difficulty','is_active','created_at'];
  const rows = PROMPTS.map(p => [
    p.id, p.title, p.description, p.author, p.tag, p.category,
    p.difficulty, p.is_active, p.created_at
  ].map(csvEscape).join(','));

  const csv = '\uFEFF' + headers.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'prompts.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('prompts.csv diunduh');
  logActivity('export_csv', 'prompts.csv');
});

/* ============ PANEL TABS ============ */
function switchPanel(name){
  $all('.nav-tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  $all('.panel-section').forEach(s => {
    s.classList.toggle('active', s.id === 'panel-' + name);
  });
  if (name === 'statistik') renderStats();
  if (name === 'kelola') renderManage();
}

$all('.nav-tabs button').forEach(b => {
  b.addEventListener('click', () => switchPanel(b.dataset.panel));
});

/* ============ INIT ============ */
async function init(){
  loadLocal();
  renderAll();
  await loadCloud();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
