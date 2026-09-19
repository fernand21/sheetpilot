(() => {
  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;
  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let currentApi = null;
  let currentProject = null;
  let currentColumns = [];
  let schemaLoadToken = 0;

  function columnName(number) {
    let result = '', n = Math.max(1, Number(number) || 1);
    while (n > 0) {
      const rest = (n - 1) % 26;
      result = String.fromCharCode(65 + rest) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  function sheetRange(sheet, range = '1:1') {
    return `'${String(sheet || '').replace(/'/g, "''")}'!${range}`;
  }

  function ensureStyles() {
    if (document.querySelector('#littleapi-widget-embed-styles')) return;
    const style = document.createElement('style');
    style.id = 'littleapi-widget-embed-styles';
    style.textContent = `
      .api-widget-panel{margin:22px 0 8px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#0a201a}
      .api-widget-panel h3{margin:0 0 6px;font-size:1.05rem}.api-widget-panel>p{margin:0 0 14px;color:var(--muted);font-size:.82rem;line-height:1.5}
      .api-widget-warning{margin:0 0 14px;padding:11px 12px;border:1px solid #745b31;border-radius:9px;background:#241d10;color:#ead7a7;font-size:.75rem;line-height:1.45}.api-widget-warning.hidden{display:none}
      .api-widget-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.api-widget-grid label{display:block!important;margin:0!important}.api-widget-grid label>span{display:block;margin:0 0 6px;font-size:.74rem;font-weight:800}.api-widget-grid input,.api-widget-grid select{width:100%}
      .api-widget-fields{margin-top:13px;padding:13px;border:1px solid #2b5147;border-radius:10px;background:#081b16}.api-widget-fields-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:9px}.api-widget-fields-head strong{font-size:.8rem}.api-widget-fields-head small{display:block;margin-top:3px;color:var(--muted);font-size:.68rem;line-height:1.35}.api-widget-field-actions{display:flex;gap:6px;flex-wrap:wrap}.api-widget-field-actions button{padding:6px 8px;font-size:.66rem}
      .api-widget-columns{display:grid;gap:6px;max-height:270px;overflow:auto}.api-widget-column{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:8px 9px;border:1px solid #23483e;border-radius:8px;background:#071713}.api-widget-column label{display:flex!important;align-items:center;gap:8px;margin:0!important;min-width:0}.api-widget-column input{width:16px;height:16px;accent-color:var(--teal);flex:0 0 auto}.api-widget-column-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem;font-weight:760}.api-widget-column-letter{margin-left:5px;color:var(--muted);font-family:monospace;font-size:.64rem}.api-widget-order{display:flex;gap:4px}.api-widget-order button{min-width:30px;padding:5px 7px;font-size:.68rem}.api-widget-schema-status{margin:8px 0 0;color:var(--muted);font-size:.7rem}.api-widget-schema-status.error{color:#ffb4a8}
      .api-widget-code{margin-top:12px;padding:12px;border:1px solid #2b5147;border-radius:10px;background:#071713}.api-widget-code code{display:block;max-height:135px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#d8ff7d;font-size:.7rem;line-height:1.5}
      .api-widget-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:12px}.api-widget-actions button,.api-widget-actions a{font-size:.76rem}.api-widget-actions .form-message{margin:0;min-height:0}
      @media(max-width:560px){.api-widget-grid{grid-template-columns:1fr}.api-widget-fields-head{flex-direction:column}.api-widget-actions .button,.api-widget-actions .action-button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyles();
    const dialog = document.querySelector('#api-dialog');
    if (!dialog) return null;
    let panel = dialog.querySelector('#api-widget-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'api-widget-panel';
    panel.className = 'api-widget-panel';
    const keys = dialog.querySelector('#api-keys-panel');
    const permissions = dialog.querySelector('#api-permissions-panel');
    if (keys) keys.insertAdjacentElement('afterend', panel);
    else if (permissions) permissions.insertAdjacentElement('afterend', panel);
    else {
      const exampleTitle = Array.from(dialog.querySelectorAll('h3')).find(node => /javascript/i.test(node.textContent || ''));
      if (exampleTitle) dialog.insertBefore(panel, exampleTitle);
      else dialog.appendChild(panel);
    }
    return panel;
  }

  function canEmbed(api) {
    return api?.public_read === true && api?.permissions?.read !== false;
  }

  function selectedColumns() {
    return currentColumns.filter(column => column.selected !== false);
  }

  function renderColumns(api) {
    const container = document.querySelector('#api-widget-columns');
    if (!container) return;
    if (!currentColumns.length) {
      container.innerHTML = `<div class="api-widget-schema-status">${text('No se detectaron columnas en la primera fila.', 'No columns were detected in the first row.')}</div>`;
      updateCode(api);
      return;
    }
    container.innerHTML = currentColumns.map((column, index) => `
      <div class="api-widget-column" data-widget-column="${escapeHtml(column.letter)}">
        <label>
          <input type="checkbox" data-widget-column-check="${escapeHtml(column.letter)}" ${column.selected === false ? '' : 'checked'}>
          <span class="api-widget-column-name">${escapeHtml(column.name)}<span class="api-widget-column-letter">${escapeHtml(column.letter)}</span></span>
        </label>
        <span></span>
        <span class="api-widget-order">
          <button type="button" class="action-button" data-widget-up="${index}" ${index === 0 ? 'disabled' : ''} title="${text('Subir', 'Move up')}">↑</button>
          <button type="button" class="action-button" data-widget-down="${index}" ${index === currentColumns.length - 1 ? 'disabled' : ''} title="${text('Bajar', 'Move down')}">↓</button>
        </span>
      </div>`).join('');

    container.querySelectorAll('[data-widget-column-check]').forEach(input => {
      input.addEventListener('change', () => {
        const column = currentColumns.find(item => item.letter === input.dataset.widgetColumnCheck);
        if (column) column.selected = input.checked;
        updateCode(api);
      });
    });
    container.querySelectorAll('[data-widget-up]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.widgetUp);
      if (index > 0) {
        [currentColumns[index - 1], currentColumns[index]] = [currentColumns[index], currentColumns[index - 1]];
        renderColumns(api);
      }
    }));
    container.querySelectorAll('[data-widget-down]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.widgetDown);
      if (index >= 0 && index < currentColumns.length - 1) {
        [currentColumns[index], currentColumns[index + 1]] = [currentColumns[index + 1], currentColumns[index]];
        renderColumns(api);
      }
    }));
    updateCode(api);
  }

  async function accountSheetSchema(api, sheet = '') {
    if (!api?.api_id || typeof sb === 'undefined' || typeof apiBase !== 'function') {
      throw new Error(text('La sesión de LittleAPI no está disponible.', 'The LittleAPI session is not available.'));
    }

    const sessionResult = await sb.auth.getSession();
    const session = sessionResult?.data?.session;
    if (!session?.access_token) {
      throw new Error(text('La sesión de LittleAPI ha caducado. Vuelve a iniciar sesión.', 'Your LittleAPI session has expired. Sign in again.'));
    }

    const params = new URLSearchParams({ api_id: api.api_id });
    if (sheet) params.set('sheet', sheet);

    const response = await fetch(apiBase() + '/account/sheet-schema?' + params.toString(), {
      headers: {
        apikey: cfg.publishableKey,
        Authorization: 'Bearer ' + session.access_token,
      },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        data.error === 'google_file_access_required'
          ? text(
              'Esta hoja necesita volver a autorizarse con Google. Usa Reautorizar hoja y selecciona este mismo archivo.',
              'This spreadsheet needs Google authorization again. Use Reauthorize sheet and select this same file.'
            )
          : data.error === 'google_reauthorization_required'
            ? text(
                'La conexión con Google ha caducado. Vuelve a iniciar sesión con Google.',
                'The Google connection has expired. Sign in with Google again.'
              )
            : (data.message || data.error || text('No se pudo leer la estructura de la hoja.', 'The spreadsheet schema could not be loaded.'))
      );
      error.code = data.error || '';
      throw error;
    }

    return data;
  }

  function applyHeaders(api, headers, status) {
    currentColumns = (Array.isArray(headers) ? headers : []).map((value, index) => ({
      name: String(value == null || value === '' ? columnName(index + 1) : value),
      letter: columnName(index + 1),
      selected: true,
    }));

    if (status) {
      status.textContent = currentColumns.length
        ? text(
            `${currentColumns.length} columnas encontradas. Marca las que quieres mostrar y usa ↑ ↓ para cambiar el orden.`,
            `${currentColumns.length} columns found. Select the ones to show and use ↑ ↓ to change their order.`
          )
        : text('No se encontraron encabezados en la primera fila.', 'No headers were found in the first row.');
      status.className = 'api-widget-schema-status';
    }
    renderColumns(api);
  }

  async function reauthorizeCurrentSpreadsheet() {
    if (!currentProject?.spreadsheet_id || typeof sb === 'undefined') return;
    const result = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + '/app.html',
        scopes: 'https://www.googleapis.com/auth/drive.file',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'false',
          trigger_onepick: 'true',
          allow_multiple: 'false',
          file_ids: currentProject.spreadsheet_id,
          mimetypes: 'application/vnd.google-apps.spreadsheet',
          ...(user?.email ? { login_hint: user.email } : {}),
        },
      },
    });
    if (result.error) throw result.error;
  }

  function showSchemaError(api, status, error) {
    if (!status) return;
    const message = typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error));
    status.className = 'api-widget-schema-status error';

    if (error?.code === 'google_file_access_required') {
      status.innerHTML = `<span>${escapeHtml(message)}</span> <button type="button" class="action-button" id="api-widget-reauthorize">${text('Reautorizar hoja', 'Reauthorize sheet')}</button>`;
      const button = status.querySelector('#api-widget-reauthorize');
      if (button) button.addEventListener('click', () => {
        button.disabled = true;
        void reauthorizeCurrentSpreadsheet().catch(authError => {
          button.disabled = false;
          status.textContent = typeof friendlyError === 'function' ? friendlyError(authError) : (authError?.message || String(authError));
        });
      });
    } else {
      status.textContent = message;
    }
    renderColumns(api);
  }

  async function loadColumns(api, sheet) {
    const status = document.querySelector('#api-widget-schema-status');
    const token = ++schemaLoadToken;
    if (status) { status.textContent = text('Leyendo columnas…', 'Loading columns…'); status.className = 'api-widget-schema-status'; }
    currentColumns = [];
    renderColumns(api);

    try {
      const data = await accountSheetSchema(api, sheet);
      if (token !== schemaLoadToken) return;
      applyHeaders(api, data.headers, status);
    } catch (error) {
      if (token !== schemaLoadToken) return;
      showSchemaError(api, status, error);
    }
  }

  async function loadSheets(api) {
    const select = document.querySelector('#api-widget-sheet');
    const status = document.querySelector('#api-widget-schema-status');
    if (!select) return;

    try {
      if (status) { status.textContent = text('Leyendo pestañas del libro…', 'Loading workbook sheets…'); status.className = 'api-widget-schema-status'; }
      const data = await accountSheetSchema(api);
      const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
      const preferred = data.selected_sheet || api.default_sheet || currentProject?.sheet_name || sheets[0]?.title || '';

      select.innerHTML = sheets
        .map(sheet => `<option value="${escapeHtml(sheet.title)}" ${sheet.title === preferred ? 'selected' : ''}>${escapeHtml(sheet.title)}</option>`)
        .join('');
      select.disabled = !sheets.length;

      if (!sheets.length) {
        throw new Error(text('El libro no tiene pestañas disponibles.', 'The workbook has no available sheets.'));
      }

      if (select.value === data.selected_sheet && Array.isArray(data.headers)) {
        applyHeaders(api, data.headers, status);
      } else {
        await loadColumns(api, select.value);
      }
    } catch (error) {
      select.innerHTML = `<option value="${escapeHtml(api.default_sheet || currentProject?.sheet_name || '')}">${escapeHtml(api.default_sheet || currentProject?.sheet_name || text('Pestaña predeterminada', 'Default sheet'))}</option>`;
      showSchemaError(api, status, error);
    }
  }

  function build(api) {
    const panel = ensurePanel();
    if (!panel || !api) return;
    const enabled = canEmbed(api);
    const defaultTitle = api.name || currentProject?.name || 'LittleAPI';
    currentColumns = [];
    panel.innerHTML = `
      <h3>${text('Widget embebible', 'Embeddable widget')}</h3>
      <p>${text(
        'Publica los datos de lectura de esta API dentro de otra web sin exponer ninguna clave. Puedes elegir la pestaña, las columnas visibles, su orden y cuántas filas mostrar por página.',
        'Publish this API read data inside another website without exposing any key. You can choose the sheet, visible columns, their order and how many rows appear per page.'
      )}</p>
      <div class="api-widget-warning ${enabled ? 'hidden' : ''}" id="api-widget-warning">${text(
        'Activa Lectura pública y el permiso Leer para utilizar el widget. Nunca insertamos X-API-Key en el código del iframe.',
        'Enable Public read and the Read permission to use the widget. X-API-Key is never inserted in the iframe code.'
      )}</div>
      <div class="api-widget-grid">
        <label><span>${text('Título', 'Title')}</span><input id="api-widget-title" type="text" maxlength="120" value="${escapeHtml(defaultTitle)}"></label>
        <label><span>${text('Pestaña del libro', 'Workbook sheet')}</span><select id="api-widget-sheet"><option>${text('Cargando…', 'Loading…')}</option></select></label>
        <label><span>${text('Vista', 'View')}</span><select id="api-widget-view"><option value="table">${text('Tabla', 'Table')}</option><option value="cards">${text('Tarjetas', 'Cards')}</option></select></label>
        <label><span>${text('Tema', 'Theme')}</span><select id="api-widget-theme"><option value="auto">${text('Automático', 'Automatic')}</option><option value="dark">${text('Oscuro', 'Dark')}</option><option value="light">${text('Claro', 'Light')}</option></select></label>
        <label><span>${text('Filas por página', 'Rows per page')}</span><input id="api-widget-page-size" type="number" min="1" max="100" step="1" value="25"></label>
      </div>
      <section class="api-widget-fields">
        <div class="api-widget-fields-head">
          <div><strong>${text('Columnas visibles y orden', 'Visible columns and order')}</strong><small>${text('Ejemplo: si la hoja tiene ID, Fecha, Valor, Nombre, puedes publicar Nombre, Fecha, Valor.', 'Example: if the sheet has ID, Date, Value, Name, you can publish Name, Date, Value.')}</small></div>
          <div class="api-widget-field-actions"><button type="button" class="action-button" id="api-widget-select-all">${text('Todas', 'All')}</button><button type="button" class="action-button" id="api-widget-select-none">${text('Ninguna', 'None')}</button></div>
        </div>
        <div class="api-widget-columns" id="api-widget-columns"></div>
        <p class="api-widget-schema-status" id="api-widget-schema-status"></p>
      </section>
      <div class="api-widget-code"><code id="api-widget-code"></code></div>
      <div class="api-widget-actions">
        <button type="button" class="button" id="copy-api-widget" ${enabled ? '' : 'disabled'}>${text('Copiar iframe', 'Copy iframe')}</button>
        <a class="action-button ${enabled ? '' : 'disabled'}" id="preview-api-widget" target="_blank" rel="noopener noreferrer">${text('Abrir vista previa', 'Open preview')}</a>
        <span class="form-message" id="api-widget-message" role="status" aria-live="polite"></span>
      </div>`;

    const update = () => updateCode(api);
    ['#api-widget-title','#api-widget-view','#api-widget-theme','#api-widget-page-size'].forEach(selector => panel.querySelector(selector)?.addEventListener('input', update));
    panel.querySelector('#api-widget-sheet')?.addEventListener('change', event => void loadColumns(api, event.target.value));
    panel.querySelector('#api-widget-select-all')?.addEventListener('click', () => {
      currentColumns.forEach(column => { column.selected = true; });
      renderColumns(api);
    });
    panel.querySelector('#api-widget-select-none')?.addEventListener('click', () => {
      currentColumns.forEach(column => { column.selected = false; });
      renderColumns(api);
    });
    panel.querySelector('#copy-api-widget')?.addEventListener('click', () => void copyCode());
    update();
    if (api.resource_type === 'sheet') void loadSheets(api);
    else {
      const status = panel.querySelector('#api-widget-schema-status');
      if (status) { status.textContent = text('La selección de pestañas y columnas está disponible para APIs de Google Sheets.', 'Sheet and column selection is available for Google Sheets APIs.'); status.className = 'api-widget-schema-status'; }
    }
  }

  function widgetUrl(api) {
    const panel = document.querySelector('#api-widget-panel');
    const title = String(panel?.querySelector('#api-widget-title')?.value || '').trim();
    const view = panel?.querySelector('#api-widget-view')?.value || 'table';
    const theme = panel?.querySelector('#api-widget-theme')?.value || 'auto';
    const sheet = String(panel?.querySelector('#api-widget-sheet')?.value || api.default_sheet || '').trim();
    const pageSize = Math.max(1, Math.min(100, Number(panel?.querySelector('#api-widget-page-size')?.value || 25) || 25));
    const url = new URL('embed.html', location.href);
    url.searchParams.set('api', api.api_id);
    url.searchParams.set('view', view);
    url.searchParams.set('theme', theme);
    url.searchParams.set('page_size', String(pageSize));
    url.searchParams.set('lang', lang());
    if (title) url.searchParams.set('title', title);
    if (sheet) url.searchParams.set('sheet', sheet);
    selectedColumns().forEach(column => url.searchParams.append('col', column.letter));
    currentColumns.forEach(column => url.searchParams.append('count_col', column.letter));
    return url;
  }

  function updateCode(api) {
    const panel = document.querySelector('#api-widget-panel');
    if (!panel || !api) return;
    const url = widgetUrl(api);
    const title = String(panel.querySelector('#api-widget-title')?.value || 'LittleAPI').trim() || 'LittleAPI';
    const iframe = `<iframe src="${url.href}" title="${title.replace(/"/g, '&quot;')}" loading="lazy" style="width:100%;height:520px;border:0;border-radius:16px;overflow:hidden" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    const code = panel.querySelector('#api-widget-code');
    if (code) code.textContent = iframe;
    const preview = panel.querySelector('#preview-api-widget');
    if (preview) preview.href = canEmbed(api) ? url.href : '#';
  }

  async function copyCode() {
    const code = document.querySelector('#api-widget-code')?.textContent || '';
    const button = document.querySelector('#copy-api-widget');
    const status = document.querySelector('#api-widget-message');
    if (!code || !canEmbed(currentApi)) return;
    try {
      await navigator.clipboard.writeText(code);
      if (status) { status.textContent = text('Código copiado.', 'Code copied.'); status.className = 'form-message success'; }
      if (button) { const old = button.textContent; button.textContent = text('Copiado', 'Copied'); setTimeout(() => { button.textContent = old; }, 1400); }
    } catch (_) {
      const node = document.querySelector('#api-widget-code');
      if (node) {
        const range = document.createRange(); range.selectNodeContents(node);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }
      if (status) { status.textContent = text('Seleccionado. Usa Ctrl+C.', 'Selected. Use Ctrl+C.'); status.className = 'form-message'; }
    }
  }

  function refreshAfterPermissionSave() {
    const save = document.querySelector('#save-api-permissions');
    if (!save || save.dataset.widgetHook === 'true') return;
    save.dataset.widgetHook = 'true';
    save.addEventListener('click', () => {
      setTimeout(() => {
        if (currentApi) build(currentApi);
      }, 650);
    });
  }

  const originalShowApiDialog = typeof showApiDialog === 'function' ? showApiDialog : null;
  if (originalShowApiDialog) {
    showApiDialog = async function(project, api, secret) {
      const result = await originalShowApiDialog(project, api, secret);
      currentApi = api;
      currentProject = project;
      build(api);
      refreshAfterPermissionSave();
      return result;
    };
  }

  window.addEventListener('littleapi:language-change', () => {
    if (currentApi) build(currentApi);
  });
})();
