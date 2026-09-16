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

  function language() {
    return localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  }

  function text(es, en) {
    return language() === 'es' ? es : en;
  }

  function spreadsheetIdFromCard(card) {
    const link = card.querySelector('a[href*="docs.google.com/spreadsheets/d/"]');
    const match = link?.href?.match(/\/spreadsheets\/d\/([^/]+)/i);
    return match ? match[1] : '';
  }

  async function grantSpreadsheet(spreadsheetId) {
    if (!spreadsheetId) return;
    localStorage.setItem(PENDING_KEY, JSON.stringify({ spreadsheetId, startedAt: Date.now() }));

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
      alert(result.error.message || String(result.error));
    }
  }

  function injectButtons() {
    document.querySelectorAll('.project-card').forEach(card => {
      if (card.querySelector('[data-google-file-grant]')) return;
      const spreadsheetId = spreadsheetIdFromCard(card);
      const apiBox = card.querySelector('.project-api');
      if (!spreadsheetId || !apiBox || !apiBox.querySelector('code')) return;

      const actions = card.querySelector('.project-actions');
      if (!actions) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-button';
      button.dataset.googleFileGrant = spreadsheetId;
      button.textContent = text('Autorizar hoja para API', 'Authorize sheet for API');
      button.title = text(
        'Concede a LittleAPI acceso de edición únicamente a esta hoja mediante drive.file.',
        'Grant LittleAPI edit access only to this spreadsheet using drive.file.'
      );
      button.addEventListener('click', () => grantSpreadsheet(spreadsheetId));
      actions.appendChild(button);
    });
  }

  function showReturnNotice() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    let pending;
    try { pending = JSON.parse(raw); } catch (_) { pending = null; }
    if (!pending?.spreadsheetId) { localStorage.removeItem(PENDING_KEY); return; }

    const notice = document.querySelector('#setup-notice');
    if (notice) {
      notice.textContent = text(
        'Google devolvió el acceso a la hoja. LittleAPI está actualizando la autorización del backend; ya puedes volver a probar la API.',
        'Google returned spreadsheet access. LittleAPI is updating backend authorization; you can retry the API now.'
      );
      notice.classList.remove('hidden', 'error');
      notice.classList.add('success');
    }
    setTimeout(() => localStorage.removeItem(PENDING_KEY), 15000);
  }

  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectButtons();
  setTimeout(showReturnNotice, 1200);
  window.addEventListener('littleapi:language-change', injectButtons);
})();
