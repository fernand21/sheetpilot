(() => {
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
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

  function parseSpreadsheetId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const urlMatch = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i);
    if (urlMatch) return urlMatch[1];
    return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : '';
  }

  function renderReferenceForm() {
    const list = document.querySelector('#sheets-list');
    const authorize = document.querySelector('#authorize-google');
    if (!list) return;

    if (authorize) authorize.classList.add('hidden');
    list.innerHTML = `
      <div class="sheet-reference-form" style="display:grid;gap:12px;width:100%">
        <label style="display:grid;gap:6px">
          <span>${text('URL o ID de Google Sheets', 'Google Sheets URL or ID')}</span>
          <input id="littleapi-sheet-reference" type="text" autocomplete="off"
            placeholder="https://docs.google.com/spreadsheets/d/..." />
        </label>
        <label style="display:grid;gap:6px">
          <span>${text('Nombre del proyecto (opcional)', 'Project name (optional)')}</span>
          <input id="littleapi-project-name" type="text" autocomplete="off"
            placeholder="${text('Mi hoja', 'My spreadsheet')}" />
        </label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button type="button" class="button" id="littleapi-connect-reference">
            ${text('Conectar proyecto', 'Connect project')}
          </button>
          <a class="action-button" href="https://drive.google.com/drive/u/0/my-drive" target="_blank" rel="noreferrer">
            ${text('Abrir Google Drive', 'Open Google Drive')} ↗
          </a>
        </div>
      </div>`;

    setSheetMessage(text(
      'Pega el enlace de la hoja. LittleAPI no solicitará acceso a su contenido hasta que pulses Crear API.',
      'Paste the spreadsheet link. LittleAPI will not request access to its contents until you click Create API.'
    ));

    const connect = document.querySelector('#littleapi-connect-reference');
    if (connect) connect.onclick = () => void createReferenceProject();
  }

  function openProjectDialog() {
    renderReferenceForm();
    if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
    setTimeout(() => document.querySelector('#littleapi-sheet-reference')?.focus(), 0);
  }

  async function createReferenceProject() {
    const reference = document.querySelector('#littleapi-sheet-reference')?.value || '';
    const spreadsheetId = parseSpreadsheetId(reference);
    const customName = String(document.querySelector('#littleapi-project-name')?.value || '').trim();

    if (!spreadsheetId) {
      return setSheetMessage(text(
        'Pega una URL válida de Google Sheets o el ID del documento.',
        'Paste a valid Google Sheets URL or document ID.'
      ), 'error');
    }
    if (!user || !sb) return;

    const local = Array.isArray(projectsCache)
      ? projectsCache.find(project => project.spreadsheet_id === spreadsheetId)
      : null;
    if (local) {
      sheetDialog?.close();
      return showNotice(text('Esta hoja ya está conectada.', 'This spreadsheet is already connected.'));
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
        return showNotice(text('Esta hoja ya está conectada.', 'This spreadsheet is already connected.'));
      }

      const result = await sb.from('projects').insert({
        user_id: user.id,
        name: customName || 'Google Sheet',
        spreadsheet_id: spreadsheetId,
        sheet_name: ''
      }).select().single();
      if (result.error) throw result.error;

      sheetDialog?.close();
      showNotice(text(
        'Proyecto conectado sin conceder acceso a la hoja. Pulsa Crear API cuando quieras autorizarla.',
        'Project connected without granting spreadsheet access. Click Create API when you want to authorize it.'
      ));
      await projects();
    } catch (error) {
      setSheetMessage(
        typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)),
        'error'
      );
    }
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

  async function completeProjectMetadata(project, access) {
    const response = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(project.spreadsheet_id) +
      '?includeGridData=false&fields=sheets.properties',
      { headers: { Authorization: 'Bearer ' + access.googleToken } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);

    const firstSheet = data.sheets?.[0]?.properties?.title || '';
    if (!firstSheet) throw new Error('spreadsheet_has_no_sheets');

    const patch = { sheet_name: firstSheet };
    if (!project.name || project.name === 'Google Sheet') patch.name = access.file?.name || project.name || 'Google Sheet';

    const update = await sb.from('projects')
      .update(patch)
      .eq('id', project.id)
      .eq('user_id', user.id);
    if (update.error) throw update.error;

    project.sheet_name = firstSheet;
    if (patch.name) project.name = patch.name;
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
          include_granted_scopes: 'false',
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

        const access = await verifyFileAccess(project.spreadsheet_id).catch(() => null);
        if (!access) {
          showNotice(text(
            'Autoriza únicamente esta hoja para crear su API.',
            'Authorize only this spreadsheet to create its API.'
          ));
          return requestSheetGrant(project);
        }

        await completeProjectMetadata(project, access);
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
        if (user && Array.isArray(projectsCache)) break;
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
      for (let i = 0; i < 6; i += 1) {
        access = await verifyFileAccess(project.spreadsheet_id).catch(() => null);
        if (access) break;
        await wait(700 * (i + 1));
      }
      if (!access) throw new Error(text(
        'Google no concedió acceso a esta hoja.',
        'Google did not grant access to this spreadsheet.'
      ));

      await completeProjectMetadata(project, access);
      localStorage.removeItem(PENDING_API_KEY);
      if (originalCreateApi) await originalCreateApi(project);
    } catch (error) {
      localStorage.removeItem(PENDING_API_KEY);
      showNotice(
        typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)),
        'error'
      );
    }
  }

  function installStrictProjectFlow() {
    const newProject = document.querySelector('#new-project');
    const connectSheet = document.querySelector('#connect-sheet');
    const authorize = document.querySelector('#authorize-google');

    if (newProject) newProject.onclick = openProjectDialog;
    if (connectSheet) connectSheet.onclick = openProjectDialog;
    if (authorize) authorize.classList.add('hidden');
  }

  // Remove temporary state created by the discarded discovery experiments.
  localStorage.removeItem('littleapi:pending-sheet-list');
  localStorage.removeItem('littleapi:pending-project-pick');

  installStrictProjectFlow();
  setTimeout(() => void resumePendingApiCreation(), 800);
  window.addEventListener('littleapi:language-change', installStrictProjectFlow);
})();
