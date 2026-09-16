(() => {
  const METADATA_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DISCOVERY_SCOPES = METADATA_SCOPE;
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const PENDING_API_KEY = 'littleapi:pending-api-sheet-grant';
  const PENDING_LIST_KEY = 'littleapi:pending-sheet-list';
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
    if (!result.data.session?.access_token) {
      throw new Error(text('La sesión ha caducado.', 'Your session has expired.'));
    }
    return result.data.session;
  }

  function currentProviderToken(session) {
    return session?.provider_token || (typeof providerToken !== 'undefined' ? providerToken : '') || '';
  }

  function savePendingList() {
    localStorage.setItem(PENDING_LIST_KEY, JSON.stringify({ startedAt: Date.now() }));
  }

  function readPendingList() {
    const raw = localStorage.getItem(PENDING_LIST_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (Date.now() - Number(value.startedAt || 0) > MAX_PENDING_AGE) {
        localStorage.removeItem(PENDING_LIST_KEY);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(PENDING_LIST_KEY);
      return null;
    }
  }

  async function requestMetadataPermission() {
    savePendingList();
    const result = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + '/app.html',
        scopes: DISCOVERY_SCOPES,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true'
        }
      }
    });
    if (result.error) {
      localStorage.removeItem(PENDING_LIST_KEY);
      throw result.error;
    }
  }

  async function providerScopes(accessToken) {
    if (!accessToken) return [];
    try {
      const response = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken), {
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return [];
      return String(data.scope || '').split(/\s+/).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async function ensureMetadataScope(session, options = {}) {
    const accessToken = currentProviderToken(session);
    if (!accessToken) {
      if (options.afterOAuth) throw new Error('provider_token_missing');
      setSheetMessage(text(
        'LittleAPI necesita permiso para ver únicamente los nombres de tus hojas.',
        'LittleAPI needs permission only to see your spreadsheet names.'
      ));
      await requestMetadataPermission();
      return null;
    }

    const scopes = await providerScopes(accessToken);
    if (!scopes.includes(METADATA_SCOPE)) {
      if (options.afterOAuth) {
        throw new Error(text(
          'Google no devolvió el permiso de metadatos solicitado.',
          'Google did not return the requested metadata permission.'
        ));
      }
      setSheetMessage(text(
        'Autoriza únicamente la lectura de nombres e IDs de tus hojas. LittleAPI no leerá sus celdas.',
        'Authorize only spreadsheet names and IDs. LittleAPI will not read their cells.'
      ));
      await requestMetadataPermission();
      return null;
    }

    return accessToken;
  }

  async function listAllSheets(options = {}) {
    const list = document.querySelector('#sheets-list');
    const button = document.querySelector('#authorize-google');
    if (!list || !button) return;

    button.disabled = true;
    setSheetMessage(text('Cargando tus hojas…', 'Loading your spreadsheets…'));

    try {
      const session = await currentSession();
      const accessToken = await ensureMetadataScope(session, options);
      if (!accessToken) return;

      const params = new URLSearchParams({
        q: `mimeType = '${SHEET_MIME}' and trashed = false`,
        fields: 'files(id,name,modifiedTime,webViewLink),nextPageToken',
        orderBy: 'modifiedTime desc',
        pageSize: '100',
        spaces: 'drive'
      });

      const response = await fetch('https://www.googleapis.com/drive/v3/files?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
      }

      const files = Array.isArray(data.files) ? data.files : [];
      list.innerHTML = files.map(file => {
        const id = String(file.id || '').replace(/"/g, '&quot;');
        const name = String(file.name || 'Google Sheet')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        return `<button type="button" class="sheet-option" data-metadata-sheet-id="${id}" data-metadata-sheet-name="${name}">▦ ${name}</button>`;
      }).join('');

      list.querySelectorAll('[data-metadata-sheet-id]').forEach(option => {
        option.addEventListener('click', () => void createMetadataOnlyProject(
          option.dataset.metadataSheetId,
          option.dataset.metadataSheetName
        ));
      });

      button.classList.add('hidden');
      button.disabled = false;
      setSheetMessage(files.length
        ? text(
            'Elige una hoja. Crear el proyecto no concede acceso a sus celdas.',
            'Choose a spreadsheet. Creating the project does not grant access to its cells.'
          )
        : text(
            'No se encontraron hojas de Google Sheets en esta cuenta.',
            'No Google Sheets spreadsheets were found in this account.'
          ), 'success');
    } catch (error) {
      button.disabled = false;
      button.classList.remove('hidden');
      button.textContent = text('Volver a intentar', 'Try again');
      setSheetMessage(error?.message || String(error), 'error');
    }
  }

  async function createMetadataOnlyProject(spreadsheetId, name) {
    if (!spreadsheetId || !user || !sb) return;
    const local = Array.isArray(projectsCache)
      ? projectsCache.find(project => project.spreadsheet_id === spreadsheetId)
      : null;
    if (local) {
      sheetDialog?.close();
      showNotice(text('Esta hoja ya está conectada.', 'This spreadsheet is already connected.'));
      return;
    }

    try {
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
        'Proyecto conectado. El acceso al contenido se pedirá sólo cuando crees la API.',
        'Project connected. Content access will be requested only when you create the API.'
      ));
      await projects();
    } catch (error) {
      setSheetMessage(
        typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)),
        'error'
      );
    }
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

  async function verifyFileAccess(spreadsheetId) {
    const session = await currentSession();
    await syncCurrentProviderConnection(session).catch(() => {});
    const googleToken = await backendGoogleToken(session);
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(spreadsheetId) +
      '?fields=id,name,mimeType,capabilities(canEdit)',
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
      'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(project.spreadsheet_id) +
      '?includeGridData=false&fields=sheets.properties',
      { headers: { Authorization: 'Bearer ' + googleToken } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const firstSheet = data.sheets?.[0]?.properties?.title || '';
    if (!firstSheet) throw new Error('spreadsheet_has_no_sheets');

    const update = await sb.from('projects')
      .update({ sheet_name: firstSheet })
      .eq('id', project.id)
      .eq('user_id', user.id);
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

  function readPendingApi() {
    const raw = localStorage.getItem(PENDING_API_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!value?.projectId || !value?.spreadsheetId ||
          Date.now() - Number(value.startedAt || 0) > MAX_PENDING_AGE) {
        localStorage.removeItem(PENDING_API_KEY);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(PENDING_API_KEY);
      return null;
    }
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
          mimetypes: SHEET_MIME
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

        const access = await verifyFileAccess(project.spreadsheet_id).catch(() => null);
        if (!access) {
          showNotice(text(
            'Autoriza sólo esta hoja para crear su API.',
            'Authorize only this spreadsheet to create its API.'
          ));
          return requestSheetGrant(project);
        }

        await ensureProjectSheetName(project, access.googleToken);
        return originalCreateApi(project);
      } catch (error) {
        showNotice(
          typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)),
          'error'
        );
      }
    };
  }

  async function resumePendingApiCreation() {
    const pending = readPendingApi();
    if (!pending) return;
    try {
      for (let i = 0; i < 60; i += 1) {
        if (user && Array.isArray(projectsCache) && projectsCache.length) break;
        await wait(250);
      }
      const project = Array.isArray(projectsCache)
        ? projectsCache.find(item => item.id === pending.projectId)
        : null;
      if (!project) throw new Error(text(
        'No se encontró el proyecto pendiente.',
        'The pending project could not be found.'
      ));

      const session = await currentSession();
      await syncCurrentProviderConnection(session);
      let access = null;
      for (let i = 0; i < 5; i += 1) {
        access = await verifyFileAccess(project.spreadsheet_id).catch(() => null);
        if (access) break;
        await wait(900 * (i + 1));
      }
      if (!access) throw new Error(text(
        'Google todavía no concedió acceso a esta hoja.',
        'Google has not granted access to this spreadsheet yet.'
      ));

      await ensureProjectSheetName(project, access.googleToken);
      localStorage.removeItem(PENDING_API_KEY);
      showNotice(text(
        'Hoja autorizada. Continuando con la creación de la API…',
        'Spreadsheet authorized. Continuing API creation…'
      ));
      if (originalCreateApi) await originalCreateApi(project);
    } catch (error) {
      localStorage.removeItem(PENDING_API_KEY);
      showNotice(
        typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)),
        'error'
      );
    }
  }

  function installProjectPicker() {
    const newProject = document.querySelector('#new-project');
    const connectSheet = document.querySelector('#connect-sheet');
    const authorize = document.querySelector('#authorize-google');

    const open = () => {
      const list = document.querySelector('#sheets-list');
      if (list) list.innerHTML = '';
      if (authorize) {
        authorize.classList.remove('hidden');
        authorize.disabled = false;
        authorize.textContent = text('Mostrar mis hojas', 'Show my spreadsheets');
      }
      setSheetMessage('');
      if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
      void listAllSheets();
    };

    if (newProject) newProject.onclick = open;
    if (connectSheet) connectSheet.onclick = open;
    if (authorize) authorize.onclick = () => void listAllSheets();
  }

  async function resumePendingSheetList() {
    const pending = readPendingList();
    if (!pending) return;
    localStorage.removeItem(PENDING_LIST_KEY);
    for (let i = 0; i < 60; i += 1) {
      if (user && sb) break;
      await wait(250);
    }
    if (!user || !sb) return;
    installProjectPicker();
    if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
    await listAllSheets({ afterOAuth: true });
  }

  installProjectPicker();
  setTimeout(() => void resumePendingSheetList(), 700);
  setTimeout(() => void resumePendingApiCreation(), 1100);
  window.addEventListener('littleapi:language-change', installProjectPicker);
  window.LittleAPIPermissionsFlow = { listAllSheets, resumePendingApiCreation, resumePendingSheetList };
})();
