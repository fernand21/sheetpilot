(() => {
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const APP_ID = String(cfg?.googleClientId || '').split('-')[0];
  let activePicker = null;

  const isEnglish = () => (localStorage.getItem('littleapi:language') || 'en') === 'en';
  const tr = (en, es) => isEnglish() ? en : es;

  function setPickerMessage(text, kind = '') {
    if (typeof message === 'function') {
      message('#sheet-message', text, kind);
      return;
    }
    const node = document.querySelector('#sheet-message');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('success', kind === 'success');
    node.classList.toggle('error', kind === 'error');
  }

  function cleanupPicker() {
    if (!activePicker) return;
    try { activePicker.visible = false; } catch (_) {}
    try { activePicker.remove(); } catch (_) {}
    activePicker = null;
  }

  async function waitForPickerElement() {
    if (!window.customElements) throw new Error('Custom Elements are not available in this browser.');
    await Promise.race([
      customElements.whenDefined('drive-picker'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Google Picker did not finish loading.')), 10000))
    ]);
  }

  async function openProjectPicker() {
    if (!user) return;

    if (sheetDialog && !sheetDialog.open) sheetDialog.showModal();
    const list = document.querySelector('#sheets-list');
    if (list) list.innerHTML = '';

    const authorize = document.querySelector('#authorize-google');
    if (authorize) {
      authorize.classList.remove('hidden');
      authorize.disabled = true;
      authorize.textContent = tr('Opening Google Picker…', 'Abriendo Google Picker…');
    }

    setPickerMessage(tr(
      'Choose a Google Sheet from your account. Selecting it connects only the project; it does not create an API.',
      'Elige una hoja de Google de tu cuenta. Seleccionarla sólo conecta el proyecto; no crea una API.'
    ));

    try {
      await waitForPickerElement();
      cleanupPicker();

      const picker = document.createElement('drive-picker');
      activePicker = picker;

      picker.setAttribute('client-id', cfg.googleClientId);
      picker.setAttribute('app-id', APP_ID);
      picker.setAttribute('origin', location.origin);
      picker.setAttribute('scope', DRIVE_FILE_SCOPE);
      picker.setAttribute('prompt', '');
      if (user?.email) picker.setAttribute('login-hint', user.email);

      // Keep the Picker request limited to drive.file. Do not inherit wider
      // scopes that may have been granted to this Google account in the past.
      try { picker.includeGrantedScopes = false; } catch (_) {}
      try { picker.scope = DRIVE_FILE_SCOPE; } catch (_) {}
      try { picker.prompt = ''; } catch (_) {}

      const view = document.createElement('drive-picker-docs-view');
      view.setAttribute('mime-types', SHEET_MIME);
      picker.appendChild(view);

      picker.addEventListener('picker-picked', async event => {
        const doc = event?.detail?.docs?.[0];
        cleanupPicker();
        if (!doc?.id) {
          setPickerMessage(tr('No spreadsheet was selected.', 'No se seleccionó ninguna hoja.'), 'error');
          return;
        }

        if (authorize) {
          authorize.disabled = true;
          authorize.textContent = tr('Connecting…', 'Conectando…');
        }

        try {
          // Preserve the original LittleAPI behavior: picking a spreadsheet
          // creates only the project. API creation remains a separate action.
          await createProjectFromSheet(doc.id, doc.name || 'Google Sheet');
        } catch (error) {
          setPickerMessage(
            typeof friendlyError === 'function' ? friendlyError(error) : String(error?.message || error),
            'error'
          );
        } finally {
          if (authorize) {
            authorize.disabled = false;
            authorize.textContent = tr('Choose a spreadsheet in Google', 'Elegir una hoja en Google');
          }
        }
      }, { once: true });

      picker.addEventListener('picker-canceled', () => {
        cleanupPicker();
        if (authorize) {
          authorize.disabled = false;
          authorize.textContent = tr('Choose a spreadsheet in Google', 'Elegir una hoja en Google');
        }
        setPickerMessage(tr('Selection canceled.', 'Selección cancelada.'));
      }, { once: true });

      const onPickerError = event => {
        const detail = event?.detail;
        const value = typeof detail === 'string' ? detail : (detail?.message || detail?.error || 'Google Picker error');
        cleanupPicker();
        if (authorize) {
          authorize.disabled = false;
          authorize.textContent = tr('Choose a spreadsheet in Google', 'Elegir una hoja en Google');
        }
        setPickerMessage(String(value), 'error');
      };
      picker.addEventListener('picker-error', onPickerError, { once: true });
      picker.addEventListener('picker-oauth-error', onPickerError, { once: true });

      document.body.appendChild(picker);
      picker.visible = true;
    } catch (error) {
      cleanupPicker();
      if (authorize) {
        authorize.disabled = false;
        authorize.textContent = tr('Choose a spreadsheet in Google', 'Elegir una hoja en Google');
      }
      setPickerMessage(
        typeof friendlyError === 'function' ? friendlyError(error) : String(error?.message || error),
        'error'
      );
    }
  }

  function install() {
    const newProject = document.querySelector('#new-project');
    const connectSheet = document.querySelector('#connect-sheet');
    const authorize = document.querySelector('#authorize-google');

    // app.js uses onclick properties, so replacing them here is enough. We do
    // not capture events or stop propagation, avoiding the previous UI bug.
    if (newProject) newProject.onclick = openProjectPicker;
    if (connectSheet) connectSheet.onclick = openProjectPicker;
    if (authorize) {
      authorize.onclick = openProjectPicker;
      authorize.classList.remove('hidden');
      authorize.disabled = false;
      authorize.textContent = tr('Choose a spreadsheet in Google', 'Elegir una hoja en Google');
    }
  }

  install();
  window.addEventListener('littleapi:language-change', install);
})();