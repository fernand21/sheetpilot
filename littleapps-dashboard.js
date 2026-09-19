(() => {
  const grid = document.querySelector('#projects-grid');
  if (!grid) return;

  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;
  let apps = [];
  let loading = false;
  let refreshTimer = 0;

  function apiForProjectId(projectId) {
    try { return Array.isArray(apisCache) ? apisCache.find(api => String(api.project_id) === String(projectId) && api.enabled !== false) : null; }
    catch (_) { return null; }
  }

  function appForApi(apiId) {
    return apps.find(app => app.api_id === apiId) || null;
  }

  function decorate() {
    grid.querySelectorAll('.project-card').forEach(card => {
      const apiButton = card.querySelector('[data-api-project]');
      if (!apiButton) return;
      const projectId = apiButton.dataset.apiProject;
      const api = apiForProjectId(projectId);
      const old = card.querySelector('[data-littleapp-actions]');
      if (!api) { old?.remove(); return; }

      const app = appForApi(api.api_id);
      let box = old;
      if (!box) {
        box = document.createElement('div');
        box.dataset.littleappActions = 'true';
        box.style.display = 'contents';
        const actions = card.querySelector('.project-actions');
        actions?.appendChild(box);
      }
      if (!box) return;

      const builderLabel = app ? text('✎ Editar app', '✎ Edit app') : text('✦ Crear app', '✦ Create app');
      const open = app?.published
        ? '<a class="action-button" data-littleapp-open target="_blank" rel="noreferrer" href="littleapp-v3.html?v=20260919-19&app=' + encodeURIComponent(app.slug) + '">' + text('▶ Abrir app', '▶ Open app') + '</a>'
        : '';
      const remove = app
        ? '<button class="action-button" type="button" data-littleapp-delete style="color:#b8443b;border-color:#e2aaa5">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" style="vertical-align:-3px;margin-right:5px"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>' +
          text('Eliminar app', 'Delete app') + '</button>'
        : '';
      box.innerHTML = '<a class="button" data-littleapp-builder href="app-builder.html?v=20260919-19&api=' + encodeURIComponent(api.api_id) + '">' + builderLabel + '</a>' + open + remove;

      const deleteButton = box.querySelector('[data-littleapp-delete]');
      if (deleteButton && app) {
        deleteButton.onclick = async () => {
          const ok = confirm(text(
            '¿Eliminar esta LittleApp? Se borrará su configuración publicada, pero NO la API ni la hoja de Google.',
            'Delete this LittleApp? Its published configuration will be removed, but NOT the API or Google Sheet.'
          ));
          if (!ok) return;
          deleteButton.disabled = true;
          try {
            const iconPath = app?.config?.appIcon?.path;
            if (iconPath) {
              try { await sb.storage.from('littleapp-icons').remove([iconPath]); } catch (_) {}
            }
            const result = await sb.from('littleapps').delete().eq('id', app.id);
            if (result.error) throw result.error;
            apps = apps.filter(item => item.id !== app.id);
            decorate();
          } catch (error) {
            console.error('LittleApp delete failed', error);
            alert(text('No se pudo eliminar la app.', 'Could not delete the app.'));
            deleteButton.disabled = false;
          }
        };
      }
    });
  }

  async function loadApps() {
    if (loading || typeof sb === 'undefined' || typeof user === 'undefined' || !user) return;
    loading = true;
    try {
      const result = await sb.from('littleapps').select('id,api_id,name,slug,published,updated_at,config').order('updated_at', { ascending: false });
      if (!result.error) apps = result.data || [];
      decorate();
    } catch (error) {
      console.warn('LittleApps dashboard load failed', error);
    } finally {
      loading = false;
    }
  }

  function schedule() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      decorate();
      void loadApps();
    }, 120);
  }

  new MutationObserver(schedule).observe(grid, { childList: true });
  window.addEventListener('littleapi:language-change', decorate);
  setTimeout(() => void loadApps(), 900);
})();