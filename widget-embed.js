(() => {
  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;
  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let currentApi = null;
  let currentProject = null;

  function ensureStyles() {
    if (document.querySelector('#littleapi-widget-embed-styles')) return;
    const style = document.createElement('style');
    style.id = 'littleapi-widget-embed-styles';
    style.textContent = `
      .api-widget-panel{margin:22px 0 8px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#0a201a}
      .api-widget-panel h3{margin:0 0 6px;font-size:1.05rem}.api-widget-panel>p{margin:0 0 14px;color:var(--muted);font-size:.82rem;line-height:1.5}
      .api-widget-warning{margin:0 0 14px;padding:11px 12px;border:1px solid #745b31;border-radius:9px;background:#241d10;color:#ead7a7;font-size:.75rem;line-height:1.45}.api-widget-warning.hidden{display:none}
      .api-widget-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.api-widget-grid label{display:block!important;margin:0!important}.api-widget-grid label>span{display:block;margin:0 0 6px;font-size:.74rem;font-weight:800}.api-widget-grid input,.api-widget-grid select{width:100%}
      .api-widget-code{margin-top:12px;padding:12px;border:1px solid #2b5147;border-radius:10px;background:#071713}.api-widget-code code{display:block;max-height:120px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#d8ff7d;font-size:.7rem;line-height:1.5}
      .api-widget-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:12px}.api-widget-actions button,.api-widget-actions a{font-size:.76rem}.api-widget-actions .form-message{margin:0;min-height:0}
      @media(max-width:560px){.api-widget-grid{grid-template-columns:1fr}.api-widget-actions .button,.api-widget-actions .action-button{width:100%}}
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

  function build(api) {
    const panel = ensurePanel();
    if (!panel || !api) return;
    const enabled = canEmbed(api);
    const defaultTitle = api.name || currentProject?.name || 'LittleAPI';
    panel.innerHTML = `
      <h3>${text('Widget embebible', 'Embeddable widget')}</h3>
      <p>${text(
        'Publica los datos de lectura de esta API dentro de otra web sin exponer ninguna clave. El widget sólo usa el endpoint público.',
        'Publish this API read data inside another website without exposing any key. The widget only uses the public endpoint.'
      )}</p>
      <div class="api-widget-warning ${enabled ? 'hidden' : ''}" id="api-widget-warning">${text(
        'Activa Lectura pública y el permiso Leer para utilizar el widget. Nunca insertamos X-API-Key en el código del iframe.',
        'Enable Public read and the Read permission to use the widget. X-API-Key is never inserted in the iframe code.'
      )}</div>
      <div class="api-widget-grid">
        <label><span>${text('Título', 'Title')}</span><input id="api-widget-title" type="text" maxlength="120" value="${escapeHtml(defaultTitle)}"></label>
        <label><span>${text('Vista', 'View')}</span><select id="api-widget-view"><option value="table">${text('Tabla', 'Table')}</option><option value="cards">${text('Tarjetas', 'Cards')}</option></select></label>
        <label><span>${text('Tema', 'Theme')}</span><select id="api-widget-theme"><option value="auto">${text('Automático', 'Automatic')}</option><option value="dark">${text('Oscuro', 'Dark')}</option><option value="light">${text('Claro', 'Light')}</option></select></label>
        <label><span>${text('Filas máximas', 'Maximum rows')}</span><input id="api-widget-limit" type="number" min="1" max="100" value="10"></label>
      </div>
      <div class="api-widget-code"><code id="api-widget-code"></code></div>
      <div class="api-widget-actions">
        <button type="button" class="button" id="copy-api-widget" ${enabled ? '' : 'disabled'}>${text('Copiar iframe', 'Copy iframe')}</button>
        <a class="action-button ${enabled ? '' : 'disabled'}" id="preview-api-widget" target="_blank" rel="noopener noreferrer">${text('Abrir vista previa', 'Open preview')}</a>
        <span class="form-message" id="api-widget-message" role="status" aria-live="polite"></span>
      </div>`;

    const update = () => updateCode(api);
    ['#api-widget-title','#api-widget-view','#api-widget-theme','#api-widget-limit'].forEach(selector => panel.querySelector(selector)?.addEventListener('input', update));
    panel.querySelector('#copy-api-widget')?.addEventListener('click', () => void copyCode());
    update();
  }

  function widgetUrl(api) {
    const panel = document.querySelector('#api-widget-panel');
    const title = String(panel?.querySelector('#api-widget-title')?.value || '').trim();
    const view = panel?.querySelector('#api-widget-view')?.value || 'table';
    const theme = panel?.querySelector('#api-widget-theme')?.value || 'auto';
    const limit = Math.max(1, Math.min(100, Number(panel?.querySelector('#api-widget-limit')?.value || 10) || 10));
    const url = new URL('embed.html', location.href);
    url.searchParams.set('api', api.api_id);
    url.searchParams.set('view', view);
    url.searchParams.set('theme', theme);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lang', lang());
    if (title) url.searchParams.set('title', title);
    return url;
  }

  function updateCode(api) {
    const panel = document.querySelector('#api-widget-panel');
    if (!panel || !api) return;
    const url = widgetUrl(api);
    const title = String(panel.querySelector('#api-widget-title')?.value || 'LittleAPI').trim() || 'LittleAPI';
    const iframe = `<iframe src="${url.href}" title="${title.replace(/"/g, '&quot;')}" loading="lazy" style="width:100%;height:420px;border:0;border-radius:16px;overflow:hidden" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
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
