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

  function language() {
    return localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  }
  function text(es, en) { return language() === 'es' ? es : en; }

  function setSheetMessage(message, kind = '') {
    const node = document.querySelector('#sheet-message');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('success', kind === 'success');
    node.classList.toggle('error', kind === 'error');
  }

  function showNotice(message, kind = 'success') {
    const node = document.querySelector('#setup-notice');
    if (!node) return;
    node.textContent = message;
    node.classList.remove('hidden', 'success', 'error');
    node.classList.add(kind);
  }

  async function session() {
    for (let i = 0; i < 40; i += 1) {
      const result = await client.auth.getSession();
      if (result.data.session?.access_token) return result.data.session;
      await wait(250);
    }
    throw new Error(text('La sesión de LittleAPI no está disponible.', 'The LittleAPI session is not available.'));
  }

  async function syncBackendConnection(current) {
    if (!current?.access_token || !current.provider_refresh_token) return;
    const response = await fetch(apiBase() + '/auth/google/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + current.access_token,
      },
      body: JSON.stringify({
        provider_refresh_token: current.provider_refresh_token,
        scopes: [DRIVE_FILE_SCOPE],
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'google_connection_sync_failed');
    }
  }

  async function backendGoogleToken(current) {
    const response = await fetch(apiBase() + '/auth/google/access-token', {
      headers: {
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + current.access_token,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.message || 'google_token_refresh_failed');
    return data.access_token;
  }

  async function authorizedSheets(current) {
    try {
      await syncBackendConnection(current);
      const token = await backendGoogleToken(current);
      const params = new URLSearchParams({
        q: `mimeType = '${SHEET_MIME}' and trashed = false`,
        fields: 'files(id,name,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: '100',
      });
      const response = await fetch('https://www.googleapis.com/drive/v3/files?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!response.ok) return [];
      const data = await response.json().catch(() => ({}));
      return Array.isArray(data.files) ? data.files : [];
    } catch (_) {
      return [];
    }
  }

  function savePending(beforeIds) {
    localStorage.setItem(PICK_KEY, JSON.stringify({ beforeIds, startedAt: Date.now() }));
  }

  function readPending() {
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

  async function startGoogleSheetPicker() {
    try {
      setSheetMessage(text('Abriendo tus hojas de Google…', 'Opening your Google Sheets…'));
      const current = await session();
      const existing = await authorizedSheets(current);
      savePending(existing.map(file => file.id));

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
      setSheetMessage(error?.message || String(error), 'error');
      showNotice(text('No se pudo abrir el selector de Google Sheets.', 'Google Sheets picker could not be opened.'), 'error');
    }
  }

  async function createProject(file) {
    if (!file?.id) return;
    const fn = window.createProjectFromSheet;
    if (typeof fn === 'function') {
      await fn(file.id, file.name || 'Google Sheet');
      return;
    }
    renderChoices([file], text('Selecciona la hoja elegida para conectarla.', 'Select the chosen spreadsheet to connect it.'));
  }

  function renderChoices(files, message) {
    const dialog = document.querySelector('#sheet-dialog');
    const list = document.querySelector('#sheets-list');
    const choose = document.querySelector('#authorize-google');
    if (!dialog || !list) return;

    list.innerHTML = (files || []).map(file =>
      `<button class="sheet-option" data-picked-sheet-id="${String(file.id || '').replace(/"/g, '&quot;')}" data-picked-sheet-name="${String(file.name || '').replace(/"/g, '&quot;')}">▦ ${String(file.name || 'Google Sheet').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</button>`
    ).join('');

    list.querySelectorAll('[data-picked-sheet-id]').forEach(button => {
      button.addEventListener('click', () => createProject({ id: button.dataset.pickedSheetId, name: button.dataset.pickedSheetName }));
    });

    if (choose) {
      choose.classList.remove('hidden');
      choose.disabled = false;
      choose.textContent = text('Elegir otra hoja en Google', 'Choose another sheet in Google');
      choose.onclick = event => {
        event.preventDefault();
        void startGoogleSheetPicker();
      };
    }
    setSheetMessage(message, 'success');
    if (!dialog.open) dialog.showModal();
  }

  async function completePendingPick() {
    const pending = readPending();
    if (!pending) return;

    try {
      const current = await session();
      await syncBackendConnection(current);
      await wait(700);
      const files = await authorizedSheets(current);
      const before = new Set(pending.beforeIds);
      const added = files.filter(file => !before.has(file.id));
      localStorage.removeItem(PICK_KEY);

      if (added.length === 1) {
        showNotice(text(
          `Hoja autorizada: ${added[0].name}. Conectándola como proyecto…`,
          `Spreadsheet authorized: ${added[0].name}. Connecting it as a project…`
        ));
        await createProject(added[0]);
        return;
      }

      if (added.length > 1) {
        renderChoices(added, text('Elige la hoja que acabas de autorizar.', 'Choose the spreadsheet you just authorized.'));
        return;
      }

      renderChoices(files, text(
        'No se detectó una hoja nueva. Puedes elegir una de las ya autorizadas o abrir Google para seleccionar otra.',
        'No new spreadsheet was detected. Choose an already authorized spreadsheet or open Google to select another one.'
      ));
    } catch (error) {
      localStorage.removeItem(PICK_KEY);
      showNotice(error?.message || String(error), 'error');
    }
  }

  function installPickerEntry() {
    const choose = document.querySelector('#authorize-google');
    if (choose) {
      choose.classList.remove('hidden');
      choose.disabled = false;
      choose.textContent = text('Elegir hoja en Google', 'Choose sheet in Google');
      choose.onclick = event => {
        event.preventDefault();
        void startGoogleSheetPicker();
      };
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest?.('#new-project, #connect-sheet');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void startGoogleSheetPicker();
  }, true);

  // The dashboard is already mounted before this file is loaded. A full-document
  // MutationObserver here was unnecessary and caused work on every dashboard update.
  installPickerEntry();
  setTimeout(() => void completePendingPick(), 1000);
  window.addEventListener('littleapi:language-change', installPickerEntry);
})();
