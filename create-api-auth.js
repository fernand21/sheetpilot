(() => {
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const PENDING_KEY = 'littleapi:pending-api-sheet-grant';
  const MAX_AGE = 10 * 60 * 1000;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function t(es, en) {
    return (localStorage.getItem('littleapi:language') === 'es') ? es : en;
  }

  function savePending(project) {
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      projectId: project.id,
      spreadsheetId: project.spreadsheet_id,
      startedAt: Date.now()
    }));
  }

  function readPending() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!value?.projectId || Date.now() - Number(value.startedAt || 0) > MAX_AGE) {
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
  }

  async function session() {
    const result = await sb.auth.getSession();
    if (result.error) throw result.error;
    if (!result.data.session?.access_token) throw new Error('session_expired');
    return result.data.session;
  }

  async function syncBackendGoogleConnection(current) {
    if (!current?.provider_refresh_token) return;
    const response = await fetch(apiBase() + '/auth/google/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + current.access_token
      },
      body: JSON.stringify({
        provider_refresh_token: current.provider_refresh_token,
        scopes: [DRIVE_FILE_SCOPE]
      })
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
        Authorization: 'Bearer ' + current.access_token
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.message || 'google_token_refresh_failed');
    return data.access_token;
  }

  async function verifyFileAccess(project) {
    const current = await session();
    await syncBackendGoogleConnection(current).catch(() => {});
    const googleToken = await backendGoogleToken(current);
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(project.spreadsheet_id) +
      '?fields=id,name,mimeType,capabilities(canEdit)',
      { headers: { Authorization: 'Bearer ' + googleToken } }
    );
    if (!response.ok) return null;
    const file = await response.json().catch(() => ({}));
    if (!file?.id || file?.capabilities?.canEdit === false) return null;
    return { current, googleToken, file };
  }

  async function ensureSheetName(project, googleToken) {
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

  async function requestGrant(project) {
    savePending(project);
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
      localStorage.removeItem(PENDING_KEY);
      throw result.error;
    }
  }

  const originalCreateApi = typeof createApi === 'function' ? createApi : null;
  if (!originalCreateApi) return;

  createApi = async function(project) {
    try {
      const existing = typeof apiForProject === 'function' ? apiForProject(project) : null;
      if (existing) return showApiDialog(project, existing);

      const access = await verifyFileAccess(project).catch(() => null);
      if (!access) {
        notice(t(
          'Autoriza únicamente esta hoja para publicar su API.',
          'Authorize only this spreadsheet to publish its API.'
        ), 'success');
        return requestGrant(project);
      }

      await ensureSheetName(project, access.googleToken);
      return originalCreateApi(project);
    } catch (error) {
      notice(typeof friendlyError === 'function' ? friendlyError(error) : String(error?.message || error), 'error');
    }
  };

  async function resume() {
    const pending = readPending();
    if (!pending) return;
    try {
      for (let i = 0; i < 50; i += 1) {
        if (user && Array.isArray(projectsCache) && projectsCache.length >= 0) break;
        await wait(200);
      }
      const project = projectsCache.find(item => item.id === pending.projectId);
      if (!project) throw new Error('pending_project_not_found');

      const current = await session();
      await syncBackendGoogleConnection(current);

      let access = null;
      for (let i = 0; i < 6; i += 1) {
        access = await verifyFileAccess(project).catch(() => null);
        if (access) break;
        await wait(700 * (i + 1));
      }
      if (!access) throw new Error('google_file_access_not_granted');

      await ensureSheetName(project, access.googleToken);
      localStorage.removeItem(PENDING_KEY);
      await originalCreateApi(project);
    } catch (error) {
      localStorage.removeItem(PENDING_KEY);
      notice(typeof friendlyError === 'function' ? friendlyError(error) : String(error?.message || error), 'error');
    }
  }

  setTimeout(() => void resume(), 700);
})();
