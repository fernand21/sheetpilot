(() => {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!window.supabase || !cfg.url || !cfg.publishableKey) return;

  const projectRef = (() => {
    try { return new URL(cfg.url).hostname.split('.')[0]; }
    catch (_) { return 'littleapi'; }
  })();
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: {
      storageKey: `sb-${projectRef}-auth-token`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const PICK_KEY = 'littleapi:pending-project-sheet-pick';
  const MAX_AGE = 10 * 60 * 1000;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const apiBase = () => cfg.apiBase || String(cfg.url || '').replace(/\/$/, '') + '/functions/v1/sheetpilot-api';
  const language = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => language() === 'es' ? es : en;

  function sheetMessage(message, kind = '') {
    const node = document.querySelector('#sheet-message');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('success', kind === 'success');
    node.classList.toggle('error', kind === 'error');
  }

  function notice(message, kind = 'success') {
    const node = document.querySelector('#setup-notice');
    if (!node) return;
    node.textContent = message || '';
    node.classList.remove('hidden', 'success', 'error');
    if (message) node.classList.add(kind);
  }

  async function currentSession() {
    for (let i = 0; i < 20; i += 1) {
      const result = await client.auth.getSession();
      if (result.data.session?.access_token) return result.data.session;
      await wait(200);
    }
    throw new Error(text('La sesión de LittleAPI no está disponible.', 'The LittleAPI session is not available.'));
  }

  async function syncConnection(session) {
    if (!session?.provider_refresh_token) return;
    const response = await fetch(apiBase() + '/auth/google/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ provider_refresh_token: session.provider_refresh_token, scopes: [DRIVE_FILE_SCOPE] }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'google_connection_sync_failed');
    }
  }

  async function serverGoogleToken(session) {
    const response = await fetch(apiBase() + '/auth/google/access-token', {
      headers: { apikey: cfg.publishableKey, Authorization: 'Bearer ' + session.access_token },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.message || 'google_token_refresh_failed');
    return data.access_token;
  }

  async function authorizedSheets(session) {
    await syncConnection(session);
    const token = await serverGoogleToken(session);
    const params = new URLSearchParams({
      q: `mimeType = '${SHEET_MIME}' and trashed = false`,
      fields: 'files(id,name,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
    });
    const response = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.files) ? data.files : [];
  }

  function storePending(ids) {
    localStorage.setItem(PICK_KEY, JSON.stringify({ beforeIds: ids, startedAt: Date.now() }));
  }

  function takePending() {
    const raw = localStorage.getItem(PICK_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value.beforeIds) || Date.now() - Number(value.startedAt || 0) > MAX_AGE) {
        localStorage.removeItem(PICK_KEY);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(PICK_KEY);
      return null;
    }
  }

  async function openGooglePicker() {
    try {
      sheetMessage(text('Abriendo Google Sheets…', 'Opening Google Sheets…'));
      const session = await currentSession();
      let existing = [];
      try { existing = await authorizedSheets(session); } catch (_) { existing = []; }
      storePending(existing.map(file => file.id));

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
            mimetypes: SHEET_MIME,
          },
        },
      });
      if (result.error) throw result.error;
    } catch (error) {
      localStorage.removeItem(PICK_KEY);
      sheetMessage(error?.message || String(error), 'error');
    }
  }

  function renderChoices(files, message) {
    const dialog = document.querySelector('#sheet-dialog');
    const list = document.querySelector('#sheets-list');
    if (!dialog || !list) return;
    list.innerHTML = (files || []).map(file =>
      `<button class="sheet-option" data-safe-sheet-id="${String(file.id || '').replace(/"/g, '&quot;')}" data-safe-sheet-name="${String(file.name || '').replace(/"/g, '&quot;')}">▦ ${String(file.name || 'Google Sheet').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</button>`
    ).join('');
    list.querySelectorAll('[data-safe-sheet-id]').forEach(button => {
      button.onclick = async () => {
        const fn = window.createProjectFromSheet;
        if (typeof fn !== 'function') {
          sheetMessage(text('El panel todavía se está cargando.', 'The workspace is still loading.'), 'error');
          return;
        }
        await fn(button.dataset.safeSheetId, button.dataset.safeSheetName || 'Google Sheet');
      };
    });
    sheetMessage(message, 'success');
    if (!dialog.open) dialog.showModal();
  }

  async function finishPickerReturn() {
    const pending = takePending();
    if (!pending) return;
    try {
      const session = await currentSession();
      await syncConnection(session);
      await wait(500);
      const files = await authorizedSheets(session);
      const before = new Set(pending.beforeIds);
      const added = files.filter(file => !before.has(file.id));
      localStorage.removeItem(PICK_KEY);

      if (added.length === 1 && typeof window.createProjectFromSheet === 'function') {
        notice(text(`Hoja autorizada: ${added[0].name}.`, `Spreadsheet authorized: ${added[0].name}.`));
        await window.createProjectFromSheet(added[0].id, added[0].name || 'Google Sheet');
        return;
      }
      renderChoices(added.length ? added : files, added.length
        ? text('Elige la hoja que acabas de autorizar.', 'Choose the spreadsheet you just authorized.')
        : text('Elige una hoja autorizada o selecciona otra en Google.', 'Choose an authorized spreadsheet or select another one in Google.'));
    } catch (error) {
      localStorage.removeItem(PICK_KEY);
      notice(error?.message || String(error), 'error');
    }
  }

  function install() {
    const button = document.querySelector('#authorize-google');
    if (!button || button.dataset.safePickerBound === 'true') return;
    button.dataset.safePickerBound = 'true';
    button.textContent = text('Elegir hoja en Google', 'Choose sheet in Google');
    button.onclick = event => {
      event.preventDefault();
      void openGooglePicker();
    };
  }

  install();
  setTimeout(() => void finishPickerReturn(), 700);
  window.addEventListener('littleapi:language-change', () => {
    const button = document.querySelector('#authorize-google');
    if (button) button.textContent = text('Elegir hoja en Google', 'Choose sheet in Google');
  });
})();
