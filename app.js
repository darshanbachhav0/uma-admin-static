// UMA Admin Web (Vanilla JS, Firebase compat v10).
// Hardened: custom-claims authz, no secondary app, user ops via backend API.
(function(){
  const cfg = window.umaConfig && window.umaConfig.firebase;
  const API_BASE = (window.umaConfig && window.umaConfig.apiBase) || ''; // e.g. https://uma-admin-api.onrender.com

  if(!cfg){ console.error("Missing window.umaConfig.firebase"); }

  // Init Firebase
  const app = firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db   = firebase.database();
  const storage = firebase.storage();

  // Force "start logged out" (no persisted session)
  auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
    .then(() => { if (auth.currentUser) return auth.signOut(); })
    .catch((e)=> console.warn('setPersistence failed', e));

  // ---------- Common UI ----------
  const authCard  = $('#authCard');
  const eventsView= $('#eventsView');
  const usersView = $('#usersView');
  const noAccess  = $('#noAccess');
  const whoEl     = $('#who');

  const email = $('#email'); const password = $('#password');
  const btnShowEvents = $('#btnShowEvents');
  const btnShowUsers  = $('#btnShowUsers');
  const btnLogout     = $('#btnLogout');

  $('#btnLogin').addEventListener('click', login);
  btnLogout.addEventListener('click', logout);
  btnShowEvents.addEventListener('click', ()=> showSection('events'));
  btnShowUsers.addEventListener('click',  ()=> { showSection('users'); subscribeUsers(true); });

  function $(sel){ return document.querySelector(sel); }
  function el(html){ const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function toast(msg){ const m = el(`<div class="toast card">${msg}</div>`); document.body.appendChild(m); setTimeout(()=>m.remove(),2500); }
  function fmtDate(ts){ if(!ts) return '—'; const d=new Date(ts); return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }

  // navbar visibility
  function setNavVisibility(loggedIn, admin) {
    [btnShowEvents, btnShowUsers, btnLogout].forEach(b =>
      b.classList.toggle('hidden', !(loggedIn && admin))
    );
  }
  setNavVisibility(false, false);

  // ---------- Auth flow ----------
  let currentUser = null;
  let isAdmin = false;

  function login(){
    const em = email.value.trim(), pw = password.value;
    $('#authMsg').textContent = '';
    if(!em || !pw){ $('#authMsg').textContent = 'Email y contraseña requeridos'; return; }
    auth.signInWithEmailAndPassword(em, pw).catch(err => {
      $('#authMsg').textContent = err.message || 'Error de autenticación';
    });
  }
  function logout(){ auth.signOut(); setNavVisibility(false,false); }

  auth.onAuthStateChanged(async (user) => {
    currentUser = user || null;
    whoEl.textContent = user ? (user.email || '') : '';
    isAdmin = false;

    if (!user) { showSection('auth'); setNavVisibility(false,false); return; }

    // Trust only the ID token's custom claims (set via backend)
    const token = await user.getIdTokenResult(true);
    isAdmin = !!token.claims.admin;

    if (!isAdmin) { showSection('noaccess'); setNavVisibility(true,false); return; }

    setNavVisibility(true,true);
    showSection('events');
    subscribeEvents(true);
  });

  function showSection(which){
    [authCard, eventsView, usersView, noAccess].forEach(s=>s.classList.add('hidden'));
    if(which==='auth')    authCard.classList.remove('hidden');
    if(which==='events')  eventsView.classList.remove('hidden');
    if(which==='users')   usersView.classList.remove('hidden');
    if(which==='noaccess')noAccess.classList.remove('hidden');
  }

  // ---------- Small API helper (admin ID token) ----------
  async function api(path, opts = {}) {
    if(!API_BASE) throw new Error('API_BASE not configured (window.umaConfig.apiBase)');
    const idToken = await auth.currentUser.getIdToken(true);
    const headers = Object.assign({'Content-Type':'application/json','Authorization':`Bearer ${idToken}`}, opts.headers||{});
    const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(data && data.error || `HTTP ${res.status}`);
    return data;
  }

  // ---------- EVENTS ----------
  const listEl = $('#eventsList');
  const emptyEl = $('#emptyEvents');
  $('#btnNewEvent').addEventListener('click', ()=> openEventDialog());
  $('#btnRefresh').addEventListener('click', ()=> subscribeEvents(true));

  const eventDialog = $('#eventDialog');
  const btnSaveEvent = $('#btnSaveEvent');
  const btnDeleteEvent = $('#btnDeleteEvent');
  const btnDlgClose = $('#dlgClose');
  btnDlgClose.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); closeDialog(eventDialog); });
  wireDialogCloseUX(eventDialog); // backdrop click + Esc

  const evTitle = $('#evTitle');
  const evDesc  = $('#evDesc');
  const evDate  = $('#evDate');
  const evTime  = $('#evTime');
  const evLocation = $('#evLocation');
  const evTags  = $('#evTags');
  const evStatus= $('#evStatus');
  const evImage = $('#evImage');
  const evPreview= $('#evPreview');

  let currentEventId = null;
  let currentImageFile = null;
  const EVENTS_PATH = 'events';
  let eventsRef = null;

  evImage.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    currentImageFile = file || null;
    if(file){
      const url = URL.createObjectURL(file);
      evPreview.src = url; evPreview.classList.remove('hidden');
    } else {
      evPreview.classList.add('hidden'); evPreview.removeAttribute('src');
    }
  });

  btnSaveEvent.addEventListener('click', saveEvent);
  btnDeleteEvent.addEventListener('click', deleteEvent);

  function subscribeEvents(force=false){
    if(eventsRef) eventsRef.off();
    eventsRef = db.ref(EVENTS_PATH);
    if(force){ listEl.innerHTML=''; emptyEl.classList.add('hidden'); }
    eventsRef.on('value', (snap)=>{
      const data = snap.val() || {};
      const items = Object.entries(data).map(([id,ev])=>({id, ...ev}))
        .sort((a,b)=> (b.startAt||0) - (a.startAt||0));
      renderEvents(items);
    });
  }

  function renderEvents(items){
    listEl.innerHTML = '';
    if(!items.length){ emptyEl.classList.remove('hidden'); return; }
    emptyEl.classList.add('hidden');
    items.forEach(ev=>{
      const card = el(`
        <div class="event-card">
          <img src="${ev.imageUrl || ''}" alt="cover" onerror="this.src=''; this.style.display='none'"/>
          <div class="pad">
            <div class="event-meta">
              <span class="pill">${ev.status || 'upcoming'}</span>
              <span class="pill">${fmtDate(ev.startAt)}</span>
              <span class="pill">${(ev.location||'').substring(0,40)}</span>
            </div>
            <h3 style="margin:.3rem 0 0.4rem">${ev.title || '(Sin título)'}</h3>
            <div class="event-meta">${(ev.tags||[]).map(t=>`<span class="pill">${t}</span>`).join('')}</div>
            <div style="display:flex; gap:8px; margin-top:10px">
              <button data-act="edit" class="btn ghost">Editar</button>
              <button data-act="regs" class="btn ghost">Inscritos</button>
              <button data-act="del"  class="btn danger">Eliminar</button>
            </div>
          </div>
        </div>
      `);
      card.querySelector('[data-act="edit"]').addEventListener('click', ()=> openEventDialog(ev));
      card.querySelector('[data-act="regs"]').addEventListener('click', ()=> openRegs(ev.id));
      card.querySelector('[data-act="del"]').addEventListener('click', ()=> confirmDelete(ev.id));
      listEl.appendChild(card);
    });
  }

  function openEventDialog(ev){
    currentEventId = ev && ev.id || null;
    currentImageFile = null;
    $('#dlgTitle').textContent = currentEventId ? 'Editar evento' : 'Crear evento';
    btnDeleteEvent.classList.toggle('hidden', !currentEventId);
    evTitle.value = (ev && ev.title) || '';
    evDesc.value  = (ev && ev.description) || '';
    evLocation.value = (ev && ev.location) || '';
    evTags.value  = (ev && (ev.tags||[]).join(',')) || '';
    evStatus.value= (ev && ev.status) || 'upcoming';
    evPreview.classList.add('hidden'); evPreview.removeAttribute('src');
    if(ev && ev.startAt){
      const d=new Date(ev.startAt);
      evDate.value=d.toISOString().slice(0,10);
      const hh=String(d.getHours()).padStart(2,'0'), mm=String(d.getMinutes()).padStart(2,'0');
      evTime.value=`${hh}:${mm}`;
    } else { evDate.value=''; evTime.value=''; }
    eventDialog.showModal();
  }

  async function saveEvent(){
    if(!currentUser || !isAdmin) return;
    const title = evTitle.value.trim(); if(!title){ toast('Título requerido'); return; }
    const desc = evDesc.value.trim();
    const loc  = evLocation.value.trim();
    const tags = evTags.value.split(',').map(s=>s.trim()).filter(Boolean);
    const status = evStatus.value || 'upcoming';

    let startAt = 0;
    if(evDate.value && evTime.value){
      const ts = Date.parse(`${evDate.value}T${evTime.value}:00`);
      if(!isNaN(ts)) startAt = ts;
    }

    const evId = currentEventId || db.ref('events').push().key;
    if(!evId){ toast('No se pudo generar ID'); return; }

    try{
      let createdBy = currentUser.uid;
      let createdAt = Date.now();
      if(currentEventId){
        const cb = await db.ref('events').child(evId).child('createdBy').get();
        if(cb.exists()) createdBy = cb.val();
        const ca = await db.ref('events').child(evId).child('createdAt').get();
        if(ca.exists()) createdAt = ca.val();
      }

      let imageUrl = '';
      if(currentImageFile){
        const ref = storage.ref(`event_images/${evId}.jpg`);
        await ref.put(currentImageFile); imageUrl = await ref.getDownloadURL();
      } else if(currentEventId){
        const s = await db.ref('events').child(evId).child('imageUrl').get();
        imageUrl = s.val() || '';
      }

      await db.ref('events').child(evId).set({
        id: evId, title, description: desc, location: loc, tags, status,
        startAt, imageUrl, createdBy, createdAt
      });

      toast('Evento guardado'); closeDialog(eventDialog);
    }catch(e){ console.error(e); toast('Error guardando evento'); }
  }

  function confirmDelete(id){ if(confirm('¿Eliminar este evento?')) deleteEvent(id); }

  async function deleteEvent(id = currentEventId){
    if(!id) return;
    try{
      await db.ref('events').child(id).remove();
      try{ await storage.ref(`event_images/${id}.jpg`).delete(); }catch(_){}
      toast('Evento eliminado'); closeDialog(eventDialog);
    }catch(e){ console.error(e); toast('Error eliminando'); }
  }

  // ---------- Registrations dialog ----------
  const regDialog = $('#regDialog');
  const btnRegClose = $('#dlgRegClose');
  btnRegClose.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); closeDialog(regDialog); });
  wireDialogCloseUX(regDialog);

  async function openRegs(eventId){
    try{
      const snap = await db.ref('events').child(eventId).child('registrations').get();
      const regs = snap.val() || {};
      const items = Object.values(regs);
      const tbody = document.querySelector('#regTable tbody');
      tbody.innerHTML = items.map(r=>`<tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.code)}</td>
        <td>${esc(r.dni)}</td>
        <td>${esc(r.facultyName)}</td>
        <td>${esc(r.specialtyName)}</td>
        <td>${esc(r.semester)}</td>
        <td>${esc(r.mode)}</td>
        <td>${esc(r.email)}</td>
        <td>${esc(r.phone)}</td>
        <td>${r.registeredAt ? new Date(r.registeredAt).toLocaleString() : '—'}</td>
      </tr>`).join('');
      regDialog.showModal();
    }catch(e){ console.error(e); toast('No se pudo cargar inscritos'); }
  }

  // ---------- USERS ----------
  const usrEmail = $('#usrEmail');
  const usrCode  = $('#usrCode');
  const usrSearch= $('#usrSearch');
  const userMsg  = $('#userMsg');
  const usersTableBody = document.querySelector('#usersTable tbody');
  const emptyUsers = $('#emptyUsers');

  $('#btnAddUser').addEventListener('click', addUser);
  $('#btnReloadUsers').addEventListener('click', ()=> subscribeUsers(true));
  usrSearch.addEventListener('input', ()=> renderUsers(cachedUsers));

  let usersRef = null;
  let cachedUsers = [];

  function subscribeUsers(force=false){
    if(usersRef) usersRef.off();
    usersRef = db.ref('users');
    if(force) { usersTableBody.innerHTML=''; emptyUsers.classList.add('hidden'); }
    usersRef.on('value', (snap)=>{
      const data = snap.val() || {};
      cachedUsers = Object.entries(data).map(([uid, val]) => ({ uid, ...(val||{}) }));
      renderUsers(cachedUsers);
    });
  }

  function renderUsers(all){
    const q = (usrSearch.value||'').toLowerCase().trim();
    const items = all.filter(u =>
      !q || (String(u.stCode||'').toLowerCase().includes(q) || String(u.dni||'').toLowerCase().includes(q))
    ).sort((a,b)=> String(a.stCode||'').localeCompare(String(b.stCode||'')));

    usersTableBody.innerHTML = items.map(u => `
      <tr>
        <td title="${u.uid}">${u.uid.slice(0,10)}…</td>
        <td>${esc(u.stCode||'')}</td>
        <td>${esc(u.dni||'')}</td>
        <td style="text-align:right">
          <button class="btn danger" data-del="${u.uid}">Eliminar</button>
        </td>
      </tr>
    `).join('');

    emptyUsers.classList.toggle('hidden', items.length>0);

    usersTableBody.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const uid = btn.getAttribute('data-del');
        if(!confirm('¿Eliminar este usuario? Esto borrará su cuenta y su nodo en /users.')) return;
        try{
          // Server-side delete (admin token)
          await api(`/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
          toast('Usuario eliminado');
        }catch(err){
          console.error(err);
          toast('No se pudo eliminar (revisa permisos del backend).');
        }
      });
    });
  }

  async function addUser(){
    const email = usrEmail.value.trim();
    const code  = usrCode.value.trim();
    userMsg.textContent = '';
    if(!email || !code){ userMsg.textContent = 'Email y stCode requeridos.'; return; }

    try{
      // Create via backend; sends password reset link
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, displayName: '', stCode: code, role: 'student' })
      });

      usrEmail.value = ''; usrCode.value = '';
      userMsg.textContent = 'Usuario creado. Se envió enlace de restablecer contraseña.';
      toast('Usuario creado');
    }catch(e){
      console.error(e);
      userMsg.textContent = e.message || 'Error creando usuario';
    }
  }

  // ---------- Dialog helpers ----------
  function wireDialogCloseUX(dialogEl){
    dialogEl.addEventListener('click', (e)=>{
      const card = dialogEl.querySelector('.card');
      if(!card) return;
      const r = card.getBoundingClientRect();
      const inBox = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if(!inBox) closeDialog(dialogEl);
    });
    dialogEl.addEventListener('cancel', ()=> closeDialog(dialogEl));
  }
  function closeDialog(d){
    try { if(d.open) d.close('close'); else d.removeAttribute('open'); } catch(_) { d.removeAttribute('open'); }
  }

  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
})();
