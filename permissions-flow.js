(() => {
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const PENDING_PICK_KEY = 'littleapi:pending-project-pick';
  const PENDING_API_KEY = 'littleapi:pending-api-sheet-grant';
  const MAX_PENDING_AGE = 10 * 60 * 1000;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;

  function setSheetMessage(value, kind = '') {
    const node = document.querySelector('#sheet-message');
    if (!node) return;
    node.textContent = value || '';
    node.classList.toggle('success', kind === 'success');
    node.classList.toggle('error', kind === 'error');
  }

  function showNotice(value, kind = 'success') {
    const node = document.querySelector('#setup-notice');
    if (!node) return;
    node.textContent = value || '';
    node.classList.toggle('hidden', !value);
    node.classList.toggle('success', kind === 'success');
    node.classList.toggle('error', kind === 'error');
  }

  async function currentSession() {
    if (!sb) throw new Error('supabase_not_ready');
    const result = await sb.auth.getSession();
    if (result.error) throw result.error;
    if (!result.data.session?.access_token) throw new Error(text('La sesión ha caducado.', 'Your session has expired.'));
    return result.data.session;
  }

  async function backendGoogleToken(session) {
    const response = await fetch(apiBase() + '/auth/google/access-token', {
      headers: {
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + session.access_token
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.message || 'google_token_refresh_failed');
    return data.access_token;
  }

  async function googleTokenForDrive() {
    const session = await currentSession();
    if (session.provider_token) return session.provider_token;
    if (typeof providerToken !== 'undefined' && providerToken) return providerToken;
    return backendGoogleToken(session);
  }

  async function listAuthorizedSheets(token) {
    const params = new URLSearchParams({
      q: `mimeType = '${SHEET_MIME}' and trashed = false`,
      fields: 'files(id,name,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      spaces: 'drive'
    });
    const response = await fetch('https://www.googleapis.com/drive/v3/files?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    return Array.isArray(data.files) ? data.files : [];
  }

  async function syncCurrentProviderConnection(session) {
    if (!session?.provider_refresh_token || !session?.access_token) return;
    const response = await fetch(apiBase() + '/auth/google/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        provider_refresh_token: session.provider_refresh_token,
        scopes: [DRIVE_FILE_SCOPE]
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'google_connection_sync_failed');
    }
  }

  function savePendingPick(beforeIds) {
    localStorage.setItem(PENDING_PICK_KEY, JSON.stringify({
      beforeIds: Array.from(beforeIds || []),
      startedAt: Date.now()
    }));
  }

  function readPending(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (Date.now() - Number(value.startedAt || 0) > MAX_PENDING_AGE) {
        localStorage.removeItem(key);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(key);
      return null;
    }
  }

  async function requestProjectPicker() {
    try {
      const token = await googleTokenForDrive();
      const before = await listAuthorizedSheets(token).catch(() => []);
      savePendingPick(before.map(file => file.id));

      setSheetMessage(text(
        'Abriendo el selector seguro de Google…',
        'Opening Google’s secure file picker…'
      ));

      const result = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: location.origin + '/app.html',
          scopes: DRIVE_FILE_SCOPE,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: 'true',
            trigger_onepick: 'true',
            allow_multiple: 'false',
            mimetypes: SHEET_MIME,
            ...(user?.email ? { login_hint: user.email } : {})
          }
        }
      });
      if (result.error) {
        localStorage.removeItem(PENDING_PICK_KEY);
        throw result.error;
      }
    } catch (error) {
      setSheetMessage(typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)), 'error');
    }
  }

  async function createProject(spreadsheetId, name) {
    if (!spreadsheetId || !user || !sb) return;
    const local = Array.isArray(projectsCache) ? projectsCache.find(p => p.spreadsheet_id === spreadsheetId) : null;
    if (local) {
      sheetDialog?.close();
      showNotice(text('Esta hoja ya está conectada.', 'This spreadsheet is already connected.'));
      return;
    }

    const existing = await sb.from('projects')
      .select('id,name,spreadsheet_id,sheet_name')
      .eq('user_id', user.id)
      .eq('spreadsheet_id', spreadsheetId)
      .limit(1);
    if (existing.error) throw existing.error;
    if (existing.data?.[0]) {
      sheetDialog?.close();
      await projects();
      showNotice(text('Esta hoja ya está conectada.', 'This spreadsheet is already connected.'));
      return;
    }

    const result = await sb.from('projects').insert({
      user_id: user.id,
      name: name || 'Google Sheet',
      spreadsheet_id: spreadsheetId,
      sheet_name: ''
    }).select().single();
    if (result.error) throw result.error;

    sheetDialog?.close();
    showNotice(text(
      'Proyecto conectado. LittleAPI sólo tiene acceso al archivo que elegiste.',
      'Project connected. LittleAPI only has access to the file you selected.'
    ));
    await projects();
  }

  function renderAuthorizedFallback(files) {
    const list = document.querySelector('#sheets-list');
    const button = document.querySelector('#authorize-google');
    if (!list || !button) return;
    list.innerHTML = files.map(file => {
      const id = String(file.id || '').replace(/"/g, '&quot;');
      const name = String(file.name || 'Google Sheet')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<button type="button" class="sheet-option" data-safe-sheet-id="${id}" data-safe-sheet-name="${name}">▦ ${name}</button>`;
    }).join('');
    list.querySelectorAll('[data-safe-sheet-id]').forEach(option => {
      option.addEventListener('click', () => void createProject(option.dataset.safeSheetId, option.dataset.safeSheetName));
    });
    button.classList.remove('hidden');
    button.disabled = false;
    button.textContent = text('Elegir otra hoja en Google', 'Choose another spreadsheet in Google');
    setSheetMessage(text(
      'Selecciona la hoja que elegiste en Google o abre el selector para otra hoja.',
      'Select the spreadsheet you chose in Google, or open the picker for another spreadsheet.'
    ));
  }

  async function resumePendingProjectPick() {
    const pending = readPending(PENDING_PICK_KEY);
    if (!pending) return;

    try {
      for (let i = 0; i < 40; i += 1) {
        if (user) break;
        await wait(250);
      }
      const session = await currentSession();
      await syncCurrentProviderConnection(session).catch(() => {});

      const pickedFromUrl = new URL(location.href).searchParams.get('picked_file_ids');
      const pickedId = pickedFromUrl ? pickedFromUrl.split(',').map(v => v.trim()).filter(Boolean)[0] : '';

      let token = session.provider_token || '';
      if (!token) token = await backendGoogleToken(session);
      const files = await listAuthorizedSheets(token);
      const beforeIds = new Set(Array.isArray(pending.beforeIds) ? pending.beforeIds : []);
      let selected = pickedId ? files.find(file => file.id === pickedId) : null;
      if (!selected) selected = files.find(file => !beforeIds.has(file.id)) || null;

      localStorage.removeItem(PENDING_PICK_KEY);
      if (pickedFromUrl) {
        const clean = new URL(location.href);
        clean.searchParams.delete('picked_file_ids');
        history.replaceState({}, '', clean.pathname + clean.search + clean.hash);
      }

      if (selected) {
        await createProject(selected.id, selected.name);
        return;
      }

      if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
      renderAuthorizedFallback(files);
    } catch (error) {
      localStorage.removeItem(PENDING_PICK_KEY);
      if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
      setSheetMessage(typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)), 'error');
    }
  }

  async function verifyFileAccess(spreadsheetId) {
    const session = await currentSession();
    await syncCurrentProviderConnection(session).catch(() => {});
    const googleToken = await backendGoogleToken(session);
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(spreadsheetId) + '?fields=id,name,mimeType,capabilities(canEdit)',
      { headers: { Authorization: 'Bearer ' + googleToken } }
    );
    if (!response.ok) return null;
    const file = await response.json().catch(() => ({}));
    if (!file?.id || file?.capabilities?.canEdit === false) return null;
    return { file, session, googleToken };
  }

  async function ensureProjectSheetName(project, googleToken) {
    if (project.sheet_name) return project;
    const response = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(project.spreadsheet_id) + '?includeGridData=false&fields=sheets.properties',
      { headers: { Authorization: 'Bearer ' + googleToken } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const firstSheet = data.sheets?.[0]?.properties?.title || '';
    if (!firstSheet) throw new Error('spreadsheet_has_no_sheets');
    const update = await sb.from('projects').update({ sheet_name: firstSheet }).eq('id', project.id).eq('user_id', user.id);
    if (update.error) throw update.error;
    project.sheet_name = firstSheet;
    return project;
  }

  function savePendingApi(project) {
    localStorage.setItem(PENDING_API_KEY, JSON.stringify({
      projectId: project.id,
      spreadsheetId: project.spreadsheet_id,
      startedAt: Date.now()
    }));
  }

  async function requestSheetGrant(project) {
    savePendingApi(project);
    const result = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + '/app.html',
        scopes: DRIVE_FILE_SCOPE,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
          trigger_onepick: 'true',
          allow_multiple: 'false',
          file_ids: project.spreadsheet_id,
          mimetypes: SHEET_MIME,
          ...(user?.email ? { login_hint: user.email } : {})
        }
      }
    });
    if (result.error) {
      localStorage.removeItem(PENDING_API_KEY);
      throw result.error;
    }
  }

  const originalCreateApi = typeof createApi === 'function' ? createApi : null;
  if (originalCreateApi) {
    createApi = async function(project) {
      try {
        const existing = typeof apiForProject === 'function' ? apiForProject(project) : null;
        if (existing) return showApiDialog(project, existing);
        let access = await verifyFileAccess(project.spreadsheet_id).catch(() => null);
        if (!access) {
          showNotice(text('Autoriza sólo esta hoja para crear su API.', 'Authorize only this spreadsheet to create its API.'));
          return requestSheetGrant(project);
        }
        await ensureProjectSheetName(project, access.googleToken);
        return originalCreateApi(project);
      } catch (error) {
        showNotice(typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)), 'error');
      }
    };
  }

  async function resumePendingApiCreation() {
    const pending = readPending(PENDING_API_KEY);
    if (!pending) return;
    try {
      for (let i = 0; i < 40; i += 1) {
        if (user && Array.isArray(projectsCache)) break;
        await wait(250);
      }
      const project = Array.isArray(projectsCache) ? projectsCache.find(item => item.id === pending.projectId) : null;
      if (!project) throw new Error(text('No se encontró el proyecto pendiente.', 'The pending project could not be found.'));
      const session = await currentSession();
      await syncCurrentProviderConnection(session);
      let access = null;
      for (let i = 0; i < 5; i += 1) {
        access = await verifyFileAccess(project.spreadsheet_id).catch(() => null);
        if (access) break;
        await wait(700 * (i + 1));
      }
      if (!access) throw new Error(text('Google no concedió acceso a esta hoja.', 'Google did not grant access to this spreadsheet.'));
      await ensureProjectSheetName(project, access.googleToken);
      localStorage.removeItem(PENDING_API_KEY);
      if (originalCreateApi) await originalCreateApi(project);
    } catch (error) {
      localStorage.removeItem(PENDING_API_KEY);
      showNotice(typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)), 'error');
    }
  }

  function installProjectPicker() {
    const newProject = document.querySelector('#new-project');
    const connectSheet = document.querySelector('#connect-sheet');
    const authorize = document.querySelector('#authorize-google');

    const openPicker = () => {
      if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
      const list = document.querySelector('#sheets-list');
      if (list) list.innerHTML = '';
      if (authorize) {
        authorize.classList.remove('hidden');
        authorize.disabled = true;
        authorize.textContent = text('Abriendo Google…', 'Opening Google…');
      }
      setSheetMessage(text(
        'Google mostrará todas tus hojas. LittleAPI sólo recibirá acceso a la que selecciones.',
        'Google will show all your spreadsheets. LittleAPI will only receive access to the one you select.'
      ));
      void requestProjectPicker();
    };

    if (newProject) newProject.onclick = openPicker;
    if (connectSheet) connectSheet.onclick = openPicker;
    if (authorize) {
      authorize.disabled = false;
      authorize.onclick = () => void requestProjectPicker();
    }
  }

  // Remove the restricted metadata experiment from older builds.
  localStorage.removeItem('littleapi:pending-sheet-list');
  installProjectPicker();
  setTimeout(() => void resumePendingProjectPick(), 600);
  setTimeout(() => void resumePendingApiCreation(), 900);
  window.addEventListener('littleapi:language-change', installProjectPicker);
})();
