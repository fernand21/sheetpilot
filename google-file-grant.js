(() => {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!window.supabase || !cfg.url || !cfg.publishableKey) return;

  const projectRef = (() => {
    try { return new URL(cfg.url).hostname.split('.')[0]; }
    catch (_) { return 'littleapi'; }
  })();
  const authStorageKey = `sb-${projectRef}-auth-token`;
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: {
      storageKey: authStorageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const PENDING_KEY = 'littleapi:pending-file-grant';
  const MAX_PENDING_AGE = 10 * 60 * 1000;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const apiBase = () => cfg.apiBase || String(cfg.url || '').replace(/\/$/, '') + '/functions/v1/sheetpilot-api';

  function language() {
    return localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  }

  function text(es, en) {
    return language() === 'es' ? es : en;
  }

  function showNotice(message, kind = 'success') {
    const notice = document.querySelector('#setup-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.classList.remove('hidden', 'error', 'success');
    notice.classList.add(kind);
  }

  function spreadsheetIdFromCard(card) {
    const link = card?.querySelector('a[href*="docs.google.com/spreadsheets/d/"]');
    const match = link?.href?.match(/\/spreadsheets\/d\/([^/]+)/i);
    return match ? match[1] : '';
  }

  function readPending() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!value?.spreadsheetId || Date.now() - Number(value.startedAt || 0) > MAX_PENDING_AGE) {
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
  }

  function savePending(value) {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...value, startedAt: Date.now() }));
  }

  async function currentSession(timeoutMs = 12000) {
    const started = Date.now();
    do {
      const result = await client.auth.getSession();
      if (result.data.session?.access_token) return result.data.session;
      await wait(300);
    } while (Date.now() - started < timeoutMs);
    throw new Error(text('La sesión de LittleAPI no está disponible.', 'The LittleAPI session is not available.'));
  }

  async function syncBackendConnection(session) {
    if (!session?.access_token) throw new Error('missing_session');
    if (!session.provider_refresh_token) return;
    const response = await fetch(apiBase() + '/auth/google/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({
        provider_refresh_token: session.provider_refresh_token,
        scopes: [DRIVE_FILE_SCOPE],
      }),
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
        Authorization: 'Bearer ' + session.access_token,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.message || 'google_token_refresh_failed');
    return data.access_token;
  }

  async function verifySpreadsheetAccess(spreadsheetId, attempts = 3) {
    const session = await currentSession();
    await syncBackendConnection(session);

    let lastStatus = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const token = await backendGoogleToken(session);
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(spreadsheetId) +
        '?fields=id,name,mimeType,capabilities(canEdit)',
        { headers: { Authorization: 'Bearer ' + token } }
      );
      lastStatus = response.status;
      if (response.ok) {
        const file = await response.json().catch(() => ({}));
        if (file?.id && file?.capabilities?.canEdit !== false) return file;
      }
      if (attempt + 1 < attempts) await wait(900 * (attempt + 1));
    }
    const error = new Error('google_file_grant_required');
    error.status = lastStatus;
    throw error;
  }

  async function grantSpreadsheet(spreadsheetId, context = {}) {
    if (!spreadsheetId) return;
    savePending({ spreadsheetId, projectId: context.projectId || '', resumeCreate: context.resumeCreate === true });

    const result = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + '/app.html',
        scopes: DRIVE_FILE_SCOPE,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
          trigger_onepick: 'true',
          allow_multiple: 'false',
          file_ids: spreadsheetId,
          mimetypes: SHEET_MIME,
        },
      },
    });

    if (result.error) {
      localStorage.removeItem(PENDING_KEY);
      showNotice(result.error.message || String(result.error), 'error');
    }
  }

  function findCreateButton(projectId) {
    return [...document.querySelectorAll('button[data-api-project]')]
      .find(button => button.dataset.apiProject === projectId && !button.closest('.project-card')?.querySelector('.project-api code')) || null;
  }

  async function resumeCreation(pending) {
    const started = Date.now();
    let button = null;
    while (!button && Date.now() - started < 12000) {
      button = findCreateButton(pending.projectId);
      if (!button) await wait(300);
    }
    if (!button) throw new Error(text('No se encontró el proyecto para continuar creando la API.', 'The project could not be found to continue API creation.'));

    button.dataset.googleGrantBypass = '1';
    button.click();
  }

  async function completePendingGrant() {
    const pending = readPending();
    if (!pending) return;

    try {
      showNotice(text('Verificando el acceso de edición a la hoja…', 'Verifying edit access to the spreadsheet…'));
      await verifySpreadsheetAccess(pending.spreadsheetId, 5);
      localStorage.removeItem(PENDING_KEY);
      showNotice(text(
        'Hoja autorizada correctamente. LittleAPI ya puede editarla desde la API.',
        'Spreadsheet authorized. LittleAPI can now edit it from the API.'
      ));
      if (pending.resumeCreate && pending.projectId) await resumeCreation(pending);
    } catch (error) {
      localStorage.removeItem(PENDING_KEY);
      showNotice(text(
        'Google inició la autorización, pero el backend todavía no puede editar esta hoja. Vuelve a intentarlo desde Crear API.',
        'Google started authorization, but the backend still cannot edit this spreadsheet. Try again from Create API.'
      ), 'error');
      console.warn('LittleAPI file grant verification failed', error);
    }
  }

  async function handleCreateApiClick(event, button, card) {
    if (button.dataset.googleGrantBypass === '1') {
      delete button.dataset.googleGrantBypass;
      return;
    }

    const spreadsheetId = spreadsheetIdFromCard(card);
    if (!spreadsheetId) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = text('Verificando acceso…', 'Checking access…');

    try {
      await verifySpreadsheetAccess(spreadsheetId, 1);
      button.disabled = false;
      button.textContent = originalText;
      button.dataset.googleGrantBypass = '1';
      button.click();
    } catch (_) {
      button.disabled = false;
      button.textContent = originalText;
      showNotice(text(
        'Antes de crear la API, autoriza esta hoja para que LittleAPI pueda leerla y editarla mediante drive.file.',
        'Before creating the API, authorize this spreadsheet so LittleAPI can read and edit it through drive.file.'
      ));
      await grantSpreadsheet(spreadsheetId, { projectId: button.dataset.apiProject, resumeCreate: true });
    }
  }

  function injectRecoveryButtons() {
    document.querySelectorAll('.project-card').forEach(card => {
      if (card.querySelector('[data-google-file-grant]')) return;
      const spreadsheetId = spreadsheetIdFromCard(card);
      const apiBox = card.querySelector('.project-api');
      if (!spreadsheetId || !apiBox?.querySelector('code')) return;

      const actions = card.querySelector('.project-actions');
      if (!actions) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-button';
      button.dataset.googleFileGrant = spreadsheetId;
      button.textContent = text('Reautorizar hoja', 'Reauthorize sheet');
      button.title = text(
        'Renueva el acceso de edición únicamente para esta hoja.',
        'Renew edit access only for this spreadsheet.'
      );
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        grantSpreadsheet(spreadsheetId, { resumeCreate: false });
      });
      actions.appendChild(button);
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-api-project]');
    if (!button) return;
    const card = button.closest('.project-card');
    if (!card || card.querySelector('.project-api code')) return;
    void handleCreateApiClick(event, button, card);
  }, true);

  // Only project-card changes matter here. Observing the whole document caused
  // unnecessary rescans whenever logs, counters, dialogs or other UI changed.
  const projectsGrid = document.querySelector('#projects-grid');
  if (projectsGrid) {
    new MutationObserver(injectRecoveryButtons).observe(projectsGrid, { childList: true, subtree: true });
  }
  injectRecoveryButtons();
  setTimeout(() => void completePendingGrant(), 800);
  window.addEventListener('littleapi:language-change', injectRecoveryButtons);
})();
