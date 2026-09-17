(() => {
  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;
  const PERMISSIONS = [
    ['read', 'Leer filas', 'Read rows'],
    ['search', 'Buscar', 'Search'],
    ['create', 'Agregar filas', 'Add rows'],
    ['update', 'Editar filas', 'Edit rows'],
    ['delete', 'Eliminar filas', 'Delete rows']
  ];

  function ensureStyles() {
    if (document.querySelector('#littleapi-api-permissions-styles')) return;
    const style = document.createElement('style');
    style.id = 'littleapi-api-permissions-styles';
    style.textContent = `
      .api-permissions-panel{margin:22px 0 8px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#0a211b}
      .api-permissions-panel h3{margin:0 0 6px;font-size:1.05rem}
      .api-permissions-panel>p{margin:0 0 14px;color:var(--muted);font-size:.82rem}
      .api-permission-public{display:flex!important;align-items:flex-start;gap:10px;margin:0 0 14px!important;padding:12px;border:1px solid #31584e;border-radius:10px;background:#0c2821}
      .api-permission-public input,.api-permission-item input{width:18px;height:18px;flex:0 0 auto;margin:2px 0 0;accent-color:var(--teal)}
      .api-permission-public strong{display:block;font-size:.88rem}.api-permission-public small{display:block;margin-top:2px;color:var(--muted);font-size:.74rem;line-height:1.35}
      .api-permission-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .api-permission-item{display:flex!important;align-items:center;gap:9px;margin:0!important;padding:10px 11px;border:1px solid #274f45;border-radius:9px;background:#081c17;font-size:.8rem;font-weight:760}
      .api-permission-item:has(input:checked){border-color:#3f806e;background:#0d2b24}
      .api-permission-actions{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}.api-permission-actions .form-message{margin:0;min-height:0}
      @media(max-width:560px){.api-permission-grid{grid-template-columns:1fr}.api-permission-actions .button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyles();
    const dialog = document.querySelector('#api-dialog');
    if (!dialog) return null;
    let panel = dialog.querySelector('#api-permissions-panel');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'api-permissions-panel';
    panel.className = 'api-permissions-panel';
    const exampleTitle = Array.from(dialog.querySelectorAll('h3')).find(node => /javascript/i.test(node.textContent || ''));
    if (exampleTitle) dialog.insertBefore(panel, exampleTitle);
    else dialog.appendChild(panel);
    return panel;
  }

  function render(api) {
    const panel = ensurePanel();
    if (!panel || !api) return;
    const permissions = api.permissions || {};
    panel.innerHTML = `
      <h3>${text('Permisos de esta API', 'API permissions')}</h3>
      <p>${text('Controla qué operaciones permite este endpoint. Los cambios se aplican de inmediato.', 'Control which operations this endpoint allows. Changes apply immediately.')}</p>
      <label class="api-permission-public">
        <input type="checkbox" id="api-public-read-setting" ${api.public_read === true ? 'checked' : ''}>
        <span><strong>${text('Lectura pública', 'Public read')}</strong><small>${text('Si la desactivas, las lecturas también requerirán X-API-Key.', 'If disabled, reads will also require X-API-Key.')}</small></span>
      </label>
      <div class="api-permission-grid">
        ${PERMISSIONS.map(([key, es, en]) => `<label class="api-permission-item"><input type="checkbox" data-api-permission="${key}" ${permissions[key] !== false ? 'checked' : ''}><span>${text(es, en)}</span></label>`).join('')}
      </div>
      <div class="api-permission-actions">
        <button type="button" class="button" id="save-api-permissions">${text('Guardar permisos', 'Save permissions')}</button>
        <span class="form-message" id="api-permissions-message" role="status" aria-live="polite"></span>
      </div>`;

    panel.querySelector('#save-api-permissions')?.addEventListener('click', () => void save(api));
  }

  async function save(api) {
    if (!api || !sb || !user) return;
    const panel = document.querySelector('#api-permissions-panel');
    const button = panel?.querySelector('#save-api-permissions');
    const status = panel?.querySelector('#api-permissions-message');
    if (!panel || !button) return;

    const previous = {
      public_read: api.public_read === true,
      permissions: { ...(api.permissions || {}) }
    };
    const nextPermissions = { ...(api.permissions || {}) };
    panel.querySelectorAll('[data-api-permission]').forEach(input => {
      nextPermissions[input.dataset.apiPermission] = input.checked;
    });
    const nextPublicRead = panel.querySelector('#api-public-read-setting')?.checked === true;

    button.disabled = true;
    const oldLabel = button.textContent;
    button.textContent = text('Guardando…', 'Saving…');
    if (status) { status.textContent = ''; status.className = 'form-message'; }

    try {
      const endpointUpdate = await sb.from('api_endpoints')
        .update({ public_read: nextPublicRead, permissions: nextPermissions })
        .eq('id', api.id)
        .eq('user_id', user.id)
        .select('id')
        .single();
      if (endpointUpdate.error) throw endpointUpdate.error;

      const catalogUpdate = await sb.from('api_public_catalog')
        .update({ public_read: nextPublicRead, permissions: nextPermissions })
        .eq('api_id', api.api_id)
        .eq('user_id', user.id);
      if (catalogUpdate.error) {
        await sb.from('api_endpoints')
          .update(previous)
          .eq('id', api.id)
          .eq('user_id', user.id);
        throw catalogUpdate.error;
      }

      api.public_read = nextPublicRead;
      api.permissions = nextPermissions;
      const cached = Array.isArray(apisCache) ? apisCache.find(item => item.id === api.id) : null;
      if (cached) {
        cached.public_read = nextPublicRead;
        cached.permissions = { ...nextPermissions };
      }
      if (typeof renderProjects === 'function' && Array.isArray(projectsCache)) renderProjects(projectsCache);
      if (status) {
        status.textContent = text('Permisos guardados.', 'Permissions saved.');
        status.className = 'form-message success';
      }
    } catch (error) {
      if (status) {
        status.textContent = typeof friendlyError === 'function' ? friendlyError(error) : (error?.message || String(error));
        status.className = 'form-message error';
      }
    } finally {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }

  const originalShowApiDialog = typeof showApiDialog === 'function' ? showApiDialog : null;
  if (originalShowApiDialog) {
    showApiDialog = async function(project, api, secret) {
      const result = await originalShowApiDialog(project, api, secret);
      render(api);
      return result;
    };
  }

  window.addEventListener('littleapi:language-change', () => {
    if (typeof dialogApi !== 'undefined' && dialogApi) render(dialogApi);
  });
})();
