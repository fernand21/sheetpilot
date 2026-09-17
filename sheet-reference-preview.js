(() => {
  const lang = () => localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
  const text = (es, en) => lang() === 'es' ? es : en;

  function parseSpreadsheetId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const urlMatch = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i);
    if (urlMatch) return urlMatch[1];
    return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : '';
  }

  function ensureStyles() {
    if (document.querySelector('#littleapi-sheet-preview-styles')) return;
    const style = document.createElement('style');
    style.id = 'littleapi-sheet-preview-styles';
    style.textContent = `
      .sheet-reference-preview{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;margin-top:-8px;padding:13px 14px;border:1px solid #31584e;border-radius:11px;background:#0a241e}
      .sheet-reference-preview.invalid{border-color:rgba(255,138,122,.45);background:rgba(255,138,122,.06)}
      .sheet-reference-preview-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:rgba(34,199,168,.11);color:var(--teal);font-weight:900}
      .sheet-reference-preview.invalid .sheet-reference-preview-icon{background:rgba(255,138,122,.1);color:#ffb0a5}
      .sheet-reference-preview-main{min-width:0}.sheet-reference-preview-main strong{display:block;font-size:.84rem}.sheet-reference-preview-main code{display:block;margin-top:2px;color:#8eb4a8;font-size:.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sheet-reference-preview a{white-space:nowrap;font-size:.76rem}
      @media(max-width:560px){.sheet-reference-preview{grid-template-columns:auto 1fr}.sheet-reference-preview a{grid-column:1/-1;width:100%;justify-content:center}}
    `;
    document.head.appendChild(style);
  }

  function render(input) {
    ensureStyles();
    const form = input?.closest('.sheet-reference-form');
    if (!form) return;
    let card = form.querySelector('.sheet-reference-preview');
    const raw = String(input.value || '').trim();
    const id = parseSpreadsheetId(raw);

    if (!raw) {
      card?.remove();
      return;
    }
    if (!card) {
      card = document.createElement('div');
      card.className = 'sheet-reference-preview';
      input.closest('label')?.insertAdjacentElement('afterend', card);
    }

    if (!id) {
      card.className = 'sheet-reference-preview invalid';
      card.innerHTML = `<span class="sheet-reference-preview-icon">!</span><div class="sheet-reference-preview-main"><strong>${text('No parece una URL/ID válida de Google Sheets', 'This does not look like a valid Google Sheets URL/ID')}</strong><code>${escapeHtml(raw)}</code></div>`;
      return;
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
    card.className = 'sheet-reference-preview';
    card.innerHTML = `<span class="sheet-reference-preview-icon">✓</span><div class="sheet-reference-preview-main"><strong>${text('Google Sheet detectada', 'Google Sheet detected')}</strong><code>${escapeHtml(id)}</code></div><a class="action-button" href="${sheetUrl}" target="_blank" rel="noreferrer">${text('Comprobar hoja', 'Check sheet')} ↗</a>`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('input', event => {
    if (event.target?.id === 'littleapi-sheet-reference') render(event.target);
  });

  window.addEventListener('littleapi:language-change', () => {
    const input = document.querySelector('#littleapi-sheet-reference');
    if (input) render(input);
  });
})();
