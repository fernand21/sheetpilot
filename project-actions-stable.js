(() => {
  const grid = document.querySelector('#projects-grid');
  if (!grid || grid.dataset.stableProjectActions === 'true') return;
  grid.dataset.stableProjectActions = 'true';

  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;

  function projectForButton(button) {
    const id = button?.dataset?.apiProject || button?.dataset?.removeProject || button?.dataset?.removeApi;
    if (!id || !Array.isArray(projectsCache)) return null;
    return projectsCache.find(project => project.id === id) || null;
  }

  function setBusy(button, value) {
    if (!button) return;
    if (value) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = value;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  grid.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !grid.contains(button)) return;
    if (!button.dataset.apiProject && !button.dataset.removeProject && !button.dataset.removeApi) return;

    const project = projectForButton(button);
    if (!project) return;

    // These actions are handled here intentionally so the older delegated
    // onclick cannot swallow or delay the same click.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (button.dataset.apiProject) {
      const api = typeof apiForProject === 'function' ? apiForProject(project) : null;
      if (api) {
        if (typeof showApiDialog === 'function') showApiDialog(project, api);
        return;
      }
      setBusy(button, text('Creando…', 'Creating…'));
      try {
        if (typeof createApi !== 'function') throw new Error('createApi_unavailable');
        await createApi(project);
      } catch (error) {
        console.error('LittleAPI Create API failed', error);
        if (typeof notice === 'function') notice(error?.message || String(error), 'error');
      } finally {
        // OAuth redirects may occur before this executes; restoring is harmless.
        setBusy(button, '');
      }
      return;
    }

    if (button.dataset.removeProject) {
      setBusy(button, text('Quitando…', 'Removing…'));
      try {
        if (typeof removeProject !== 'function') throw new Error('removeProject_unavailable');
        await removeProject(project);
      } catch (error) {
        console.error('LittleAPI Remove project failed', error);
        if (typeof notice === 'function') notice(error?.message || String(error), 'error');
      } finally {
        setBusy(button, '');
      }
      return;
    }

    if (button.dataset.removeApi) {
      setBusy(button, text('Eliminando…', 'Deleting…'));
      try {
        if (typeof removeApi !== 'function') throw new Error('removeApi_unavailable');
        await removeApi(project);
      } catch (error) {
        console.error('LittleAPI Remove API failed', error);
        if (typeof notice === 'function') notice(error?.message || String(error), 'error');
      } finally {
        setBusy(button, '');
      }
    }
  }, true);
})();