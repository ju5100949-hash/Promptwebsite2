/* ============================================================
   supabase.js — dual Supabase client via pure fetch (NO SDK)
   SB1 = primary, SB2 = mirror
   ============================================================ */

const SB = (function(){
  const SB1 = {
    url: 'https://mzggbkhvfrpazdmdgvcu.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16Z2dia2h2ZnJwYXpkbWRndmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMzUzOTMsImV4cCI6MjEwMTcxMTM5M30.uoMDzcnmM3yFyCOR0aKxBMcf5H8iD_lpEIrW4ysQqQA'
  };
  const SB2 = {
    url: 'https://dgpzbeupgzmqxnqsdnfv.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRncHpiZXVwZ3ptcXhucXNkbmZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzOTU3NzAsImV4cCI6MjA5OTk3MTc3MH0.tm9MDxrKBvlPL_p5EER7mFpto1wMcWRwAYxPK0nAn9Q'
  };

  function headers(extra){
    return Object.assign({
      'apikey': '',
      'Authorization': '',
      'Content-Type': 'application/json'
    }, extra || {});
  }

  function req(cfg, method, path, body, extraHeaders){
    const url = cfg.url + '/rest/v1/' + path;
    const h = {
      'apikey': cfg.key,
      'Authorization': 'Bearer ' + cfg.key,
      'Content-Type': 'application/json'
    };
    if (extraHeaders) Object.assign(h, extraHeaders);

    const opts = { method, headers: h };
    if (body !== undefined) opts.body = JSON.stringify(body);

    return fetch(url, opts).then(async res => {
      const text = await res.text();
      if (!res.ok) throw new Error(text || res.statusText);
      if (!text) return null;
      try { return JSON.parse(text); } catch(e){ return text; }
    });
  }

  /* ---- core ---- */
  function select(cfg, table, query){
    const qs = query || 'select=*';
    return req(cfg, 'GET', table + '?' + qs);
  }
  function insert(cfg, table, rows){
    return req(cfg, 'POST', table, rows, { 'Prefer': 'return=representation' });
  }
  function update(cfg, table, query, patch){
    return req(cfg, 'PATCH', table + '?' + query, patch, { 'Prefer': 'return=representation' });
  }
  function remove(cfg, table, query){
    return req(cfg, 'DELETE', table + '?' + query, undefined, { 'Prefer': 'return=representation' });
  }
  function upsert(cfg, table, rows, onConflict){
    const q = onConflict ? ('?on_conflict=' + onConflict) : '';
    return req(cfg, 'POST', table + q, rows, {
      'Prefer': 'resolution=merge-duplicates,return=representation'
    });
  }

  function dualUpsert(table, rows, onConflict){
    return Promise.allSettled([
      upsert(SB1, table, rows, onConflict),
      upsert(SB2, table, rows, onConflict)
    ]);
  }
  function dualDelete(table, query){
    return Promise.allSettled([
      remove(SB1, table, query),
      remove(SB2, table, query)
    ]);
  }

  /* ---- public API ---- */
  async function fetchPrompts(){
    // coba SB1 → fallback SB2
    try{
      const r = await select(SB1, 'prompts', 'select=*&order=created_at.desc');
      if (Array.isArray(r)) return r;
    }catch(e){}
    try{
      const r = await select(SB2, 'prompts', 'select=*&order=created_at.desc');
      if (Array.isArray(r)) return r;
    }catch(e){}
    return [];
  }

  async function fetchSaved(){
    try{
      const r = await select(SB1, 'saved', 'select=*');
      if (Array.isArray(r)) return r;
    }catch(e){}
    try{
      const r = await select(SB2, 'saved', 'select=*');
      if (Array.isArray(r)) return r;
    }catch(e){}
    return [];
  }

  async function saveUser(name){
    const row = { name, created_at: new Date().toISOString() };
    return dualUpsert('users', [row], 'name');
  }

  async function savePromptCloud(prompt){
    const row = {
      id: prompt.id,
      title: prompt.title,
      description: prompt.description,
      author: prompt.author,
      tag: prompt.tag,
      category: prompt.category,
      difficulty: prompt.difficulty,
      is_active: prompt.is_active,
      created_at: prompt.created_at
    };
    return dualUpsert('prompts', [row], 'id');
  }

  async function deletePromptCloud(id){
    return dualDelete('prompts', 'id=eq.' + encodeURIComponent(id));
  }

  async function saveSavedCloud(user_name, prompt_id){
    const row = {
      user_name,
      prompt_id,
      created_at: new Date().toISOString()
    };
    return dualUpsert('saved', [row], 'user_name,prompt_id');
  }

  async function deleteSavedCloud(user_name, prompt_id){
    const q = 'user_name=eq.' + encodeURIComponent(user_name) +
              '&prompt_id=eq.' + encodeURIComponent(prompt_id);
    return dualDelete('saved', q);
  }

  async function logActivityCloud(entry){
    // SB2 saja, fire & forget
    try{
      await insert(SB2, 'activity', [{
        type: entry.type,
        user_name: entry.user_name,
        prompt_id: entry.prompt_id,
        created_at: entry.created_at
      }]);
    }catch(e){}
  }

  return {
    SB1, SB2,
    select: (cfg, table, q) => select(cfg, table, q),
    insert: (cfg, table, rows) => insert(cfg, table, rows),
    update: (cfg, table, q, p) => update(cfg, table, q, p),
    remove: (cfg, table, q) => remove(cfg, table, q),
    upsert: (cfg, table, rows, oc) => upsert(cfg, table, rows, oc),
    dualUpsert,
    dualDelete,
    fetchPrompts,
    fetchSaved,
    saveUser,
    savePromptCloud,
    deletePromptCloud,
    saveSavedCloud,
    deleteSavedCloud,
    logActivityCloud
  };
})();
