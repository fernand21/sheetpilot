(() => {
  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;
  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const PERMISSIONS = [
    ['read', 'Leer', 'Read'],
    ['search', 'Buscar', 'Search'],
    ['create', 'Agregar', 'Add'],
    ['update', 'Editar', 'Edit'],
    ['delete', 'Eliminar', 'Delete']
  ];

  let currentApi = null;
  let loadingApiId = '';

  function ensureStyles() {
    if (document.querySelector('#littleapi-api-keys-styles')) return;
    const style = document.createElement('style');
    style.id = 'littleapi-api-keys-styles';
    style.textContent = `
      .api-keys-panel{margin:22px 0 8px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#091d18}
      .api-keys-panel h3{margin:0 0 6px;font-size:1.05rem}.api-keys-panel>p{margin:0 0 15px;color:var(--muted);font-size:.82rem;line-height:1.5}
      .api-key-create{display:grid;gap:12px;padding:14px;border:1px solid #2a5549;border-radius:11px;background:#0b241e}
      .api-key-create>label>span{display:block;margin-bottom:6px;font-size:.78rem;font-weight:800}.api-key-create input[type=text],.api-key-create input[type=datetime-local]{width:100%}
      .api-key-create-permissions{display:flex;gap:7px;flex-wrap:wrap}.api-key-create-permissions label{display:flex!important;align-items:center;gap:6px;margin:0!important;padding:8px 9px;border:1px solid #2a5147;border-radius:8px;background:#081c17;font-size:.74rem;font-weight:760}.api-key-create-permissions input{accent-color:var(--teal)}
      .api-key-create-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.api-key-create-actions .form-message{margin:0;min-height:0}
      .api-key-secret-once{margin:14px 0;padding:14px;border:1px solid rgba(216,255,125,.35);border-radius:10px;background:rgba(216,255,125,.06)}.api-key-secret-once.hidden{display:none}.api-key-secret-once strong{display:block;color:#e9ffc0}.api-key-secret-once p{margin:5px 0 9px;color:var(--muted);font-size:.75rem}.api-key-secret-row{display:flex;gap:8px;align-items:center}.api-key-secret-row code{flex:1;min-width:0;padding:10px;border-radius:8px;background:#06130f;color:var(--lime);overflow:auto;white-space:nowrap}
      .api-keys-list{display:grid;gap:9px;margin-top:14px}.api-key-card{padding:13px;border:1px solid #274f45;border-radius:10px;background:#081c17}.api-key-card.disabled{opacity:.68}.api-key-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.api-key-card-head strong{display:block}.api-key-card-head code{display:block;margin-top:4px;color:#9bbab1;font-size:.7rem}.api-key-state{font-size:.68rem;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.api-key-state.on{color:var(--lime)}.api-key-state.off{color:#d7a59d}
      .api-key-badges{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0}.api-key-badge{padding:3px 7px;border-radius:999px;background:#12372e;color:#bfe0d5;font-size:.64rem;font-weight:760}.api-key-badge.off{background:#241d1a;color:#8f9a96;text-decoration:line-through}
      .api-key-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:.68rem}.api-key-card-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}.api-key-card-actions button{font-size:.72rem;padding:7px 10px}
      .api-keys-empty{padding:14px;border:1px dashed #31584e;border-radius:10px;color:var(--muted);font-size:.78rem;text-align:center}
      @media(max-width:560px){.api-key-create-actions .button{width:100%}.api-key-secret-row{align-items:stretch;flex-direction:column}.api-key-card-head{flex-direction:column}.api-key-card-actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function panel() {
    ensureStyles();
    const dialog = document.querySelector('#api-dialog');
    if (!dialog) return null;
    let node = dialog.querySelector('#api-keys-panel');
    if (node) return node;
    node = document.createElement('section');
    node.id = 'api-keys-panel';
    node.className = 'api-keys-panel';
    const permissions = dialog.querySelector('#api-permissions-panel');
    if (permissions) permissions.insertAdjacentElement('afterend', node);
    else {
      const exampleTitle = Array.from(dialog.querySelectorAll('h3')).find(item => /javascript/i.test(item.textContent || ''));
      if (exampleTitle) dialog.insertBefore(node, exampleTitle);
      else dialog.appendChild(node);
    }
    return node;
  }

  function formatDate(value) {
    if (!value) return text('Nunca', 'Never');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(lang() === 'es' ? 'es-EC' : 'en-US');
  }

  function permissionBadges(permissions) {
    return PERMISSIONS.map(([key, es, en]) => {
      const enabled = permissions?.[key] !== false;
      return `<span class="api-key-badge ${enabled ? '' : 'off'}">${escapeHtml(text(es, en))}</span>`;
    }).join('');
  }

  function shell(api) {
    const node = panel();
    if (!node || !api) return null;
    node.innerHTML = `
      <h3>${text('Claves de API adicionales', 'Additional API keys')}</h3>
      <p>${text(
        'La clave de administración principal de arriba sigue funcionando. Crea claves separadas para aplicaciones o automatizaciones y limita exactamente lo que puede hacer cada una.',
        'The primary administration key above keeps working. Create separate keys for apps or automations and limit exactly what each one can do.'
      )}</p>
      <div class="api-key-create">
        <label><span>${text('Nombre de la clave', 'Key name')}</span><input id="additional-api-key-name" type="text" maxlength="80" placeholder="${text('Ej. Automatización de inventario', 'e.g. Inventory automation')}"></label>
        <div>
          <span style="display:block;margin-bottom:7px;font-size:.78rem;font-weight:800">${text('Permisos', 'Permissions')}</span>
          <div class="api-key-create-permissions">
            ${PERMISSIONS.map(([key, es, en]) => `<label><input type="checkbox" data-new-key-permission="${key}" ${(key === 'read' || key === 'search') ? 'checked' : ''}><span>${escapeHtml(text(es, en))}</span></label>`).join('')}
          </div>
        </div>
        <label><span>${text('Expira (opcional)', 'Expires (optional)')}</span><input id="additional-api-key-expiry" type="datetime-local"></label>
        <div class="api-key-create-actions">
          <button type="button" class="button" id="create-additional-api-key">${text('Crear clave', 'Create key')}</button>
          <span class="form-message" id="additional-api-key-message" role="status" aria-live="polite"></span>
        </div>
      </div>
      <div class="api-key-secret-once hidden" id="additional-api-key-secret">
        <strong>${text('Copia esta clave ahora', 'Copy this key now')}</strong>
        <p>${text('Por seguridad no volveremos a mostrar el valor completo.', 'For security, the full value will not be shown again.')}</p>
        <div class="api-key-secret-row"><code id="additional-api-key-secret-value"></code><button type="button" class="action-button" id="copy-additional-api-key">${text('Copiar', 'Copy')}</button></div>
      </div>
      <div class="api-keys-list" id="additional-api-keys-list"><div class="api-keys-empty">${text('Cargando claves…', 'Loading keys…')}</div></div>`;

    node.querySelector('#create-additional-api-key')?.addEventListener('click', () => void createKey(api));
    node.querySelector('#copy-additional-api-key')?.addEventListener('click', () => void copySecret());
    return node;
  }

  async function apiKeysRequest(apiId, options = {}) {
    if (typeof ownerApiRequest !== 'function') throw new Error(text('La cuenta todavía se está cargando.', 'The account is still loading.'));
    const query = options.id ? `?api_id=${encodeURIComponent(apiId)}&id=${encodeURIComponent(options.id)}` : `?api_id=${encodeURIComponent(apiId)}`;
    return ownerApiRequest('/auth/api-keys' + query, options.request || undefined);
  }

  async function loadKeys(api) {
    const list = document.querySelector('#additional-api-keys-list');
    if (!list || !api) return;
    loadingApiId = api.api_id;
    try {
      const result = await apiKeysRequest(api.api_id);
      if (loadingApiId !== api.api_id || currentApi?.api_id !== api.api_id) return;
      renderList(api, Array.isArray(result?.data) ? result.data : []);
    } catch (error) {
      list.innerHTML = `<div class="api-keys-empty">${escapeHtml(typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)))}</div>`;
    }
  }

  function renderList(api, keys) {
    const list = document.querySelector('#additional-api-keys-list');
    if (!list || currentApi?.api_id !== api.api_id) return;
    if (!keys.length) {
      list.innerHTML = `<div class="api-keys-empty">${text('Aún no has creado claves adicionales para esta API.', 'No additional keys have been created for this API yet.')}</div>`;
      return;
    }
    list.innerHTML = keys.map(key => `
      <article class="api-key-card ${key.enabled === false ? 'disabled' : ''}" data-additional-key-id="${escapeHtml(key.id)}">
        <div class="api-key-card-head">
          <div><strong>${escapeHtml(key.name)}</strong><code>${escapeHtml(key.key_prefix || '')}••••••••</code></div>
          <span class="api-key-state ${key.enabled === false ? 'off' : 'on'}">${key.enabled === false ? text('Desactivada', 'Disabled') : text('Activa', 'Active')}</span>
        </div>
        <div class="api-key-badges">${permissionBadges(key.permissions)}</div>
        <div class="api-key-meta">
          <span>${text('Último uso', 'Last used')}: ${escapeHtml(formatDate(key.last_used_at))}</span>
          <span>${text('Expira', 'Expires')}: ${escapeHtml(formatDate(key.expires_at))}</span>
        </div>
        <div class="api-key-card-actions">
          <button type="button" class="action-button" data-toggle-additional-key="${escapeHtml(key.id)}" data-enabled="${key.enabled === false ? 'false' : 'true'}">${key.enabled === false ? text('Activar', 'Enable') : text('Desactivar', 'Disable')}</button>
          <button type="button" class="danger-button" data-revoke-additional-key="${escapeHtml(key.id)}">${text('Revocar', 'Revoke')}</button>
        </div>
      </article>`).join('');

    list.querySelectorAll('[data-toggle-additional-key]').forEach(button => button.addEventListener('click', () => void toggleKey(api, button)));
    list.querySelectorAll('[data-revoke-additional-key]').forEach(button => button.addEventListener('click', () => void revokeKey(api, button)));
  }

  async function createKey(api) {
    const node = document.querySelector('#api-keys-panel');
    const nameInput = node?.querySelector('#additional-api-key-name');
    const expiryInput = node?.querySelector('#additional-api-key-expiry');
    const button = node?.querySelector('#create-additional-api-key');
    const status = node?.querySelector('#additional-api-key-message');
    const name = String(nameInput?.value || '').trim();
    if (!name) {
      if (status) { status.textContent = text('Escribe un nombre para la clave.', 'Enter a name for the key.'); status.className = 'form-message error'; }
      nameInput?.focus();
      return;
    }
    const permissions = {};
    node?.querySelectorAll('[data-new-key-permission]').forEach(input => { permissions[input.dataset.newKeyPermission] = input.checked; });
    const expiresAt = expiryInput?.value ? new Date(expiryInput.value).toISOString() : null;
    if (button) { button.disabled = true; button.textContent = text('Creando…', 'Creating…'); }
    if (status) { status.textContent = ''; status.className = 'form-message'; }
    try {
      const result = await apiKeysRequest(api.api_id, { request: {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_id: api.api_id, name, permissions, expires_at: expiresAt })
      }});
      const secret = document.querySelector('#additional-api-key-secret');
      const value = document.querySelector('#additional-api-key-secret-value');
      if (value) value.textContent = result.api_key || '';
      secret?.classList.toggle('hidden', !result.api_key);
      if (nameInput) nameInput.value = '';
      if (expiryInput) expiryInput.value = '';
      if (status) { status.textContent = text('Clave creada.', 'Key created.'); status.className = 'form-message success'; }
      await loadKeys(api);
    } catch (error) {
      if (status) { status.textContent = typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)); status.className = 'form-message error'; }
    } finally {
      if (button) { button.disabled = false; button.textContent = text('Crear clave', 'Create key'); }
    }
  }

  async function copySecret() {
    const value = document.querySelector('#additional-api-key-secret-value')?.textContent || '';
    const button = document.querySelector('#copy-additional-api-key');
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (button) { const old = button.textContent; button.textContent = text('Copiada', 'Copied'); setTimeout(() => { button.textContent = old; }, 1300); }
    } catch (_) {
      const range = document.createRange();
      const node = document.querySelector('#additional-api-key-secret-value');
      if (node) { range.selectNodeContents(node); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    }
  }

  async function toggleKey(api, button) {
    const id = button.dataset.toggleAdditionalKey;
    const enabled = button.dataset.enabled !== 'true';
    button.disabled = true;
    try {
      await apiKeysRequest(api.api_id, { id, request: {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_id: api.api_id, id, enabled })
      }});
      await loadKeys(api);
    } catch (error) {
      const status = document.querySelector('#additional-api-key-message');
      if (status) { status.textContent = typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)); status.className = 'form-message error'; }
      button.disabled = false;
    }
  }

  async function revokeKey(api, button) {
    const id = button.dataset.revokeAdditionalKey;
    if (!confirm(text('¿Revocar esta clave? Dejará de funcionar inmediatamente.', 'Revoke this key? It will stop working immediately.'))) return;
    button.disabled = true;
    try {
      await apiKeysRequest(api.api_id, { id, request: { method: 'DELETE' } });
      await loadKeys(api);
    } catch (error) {
      const status = document.querySelector('#additional-api-key-message');
      if (status) { status.textContent = typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error)); status.className = 'form-message error'; }
      button.disabled = false;
    }
  }

  function open(api) {
    if (!api) return;
    currentApi = api;
    shell(api);
    void loadKeys(api);
  }

  const originalShowApiDialog = typeof showApiDialog === 'function' ? showApiDialog : null;
  if (originalShowApiDialog) {
    showApiDialog = async function(project, api, secret) {
      const result = await originalShowApiDialog(project, api, secret);
      open(api);
      return result;
    };
  }

  window.addEventListener('littleapi:language-change', () => {
    if (currentApi && document.querySelector('#api-dialog')?.open) open(currentApi);
  });
})();
