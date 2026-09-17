(() => {
  const brandMark = document.querySelector('.brand-mark');
  if (brandMark) {
    brandMark.textContent = '';
    brandMark.setAttribute('aria-hidden', 'true');
    brandMark.style.background = 'transparent';
    brandMark.style.boxShadow = '0 0 28px rgba(34,199,168,.18)';
    brandMark.style.overflow = 'hidden';
    const icon = document.createElement('img');
    icon.src = 'littleapi-icon.svg?v=20260917-2';
    icon.alt = '';
    icon.style.width = '100%';
    icon.style.height = '100%';
    icon.style.display = 'block';
    brandMark.appendChild(icon);
  }

  const home = document.querySelector('#public-home');
  if (!home || document.querySelector('#littleapi-modern-features')) return;

  const style = document.createElement('style');
  style.id = 'littleapi-modern-features-style';
  style.textContent = `
    .modern-features{margin:38px auto 26px;max-width:1180px;padding:0 22px}.modern-features-head{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:28px;align-items:end;margin-bottom:18px}.modern-features-head h2{margin:7px 0 0;font-size:clamp(2rem,4vw,3.7rem);line-height:.98}.modern-features-head h2 span{color:var(--lime)}.modern-features-head p{margin:0;color:var(--muted);font-size:1rem;line-height:1.7}.modern-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.modern-card{min-height:220px;padding:20px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#0c241e,#081b17);position:relative;overflow:hidden}.modern-card:before{content:'';position:absolute;width:120px;height:120px;border-radius:999px;right:-50px;top:-55px;background:rgba(83,200,173,.1)}.modern-card .n{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid #2e6759;border-radius:10px;color:var(--lime);font-weight:900;overflow:hidden}.modern-card .n img{width:100%;height:100%;display:block}.modern-card h3{margin:18px 0 8px;font-size:1.05rem}.modern-card p{margin:0;color:var(--muted);font-size:.83rem;line-height:1.55}.modern-showcase{display:grid;grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr);gap:16px;margin-top:16px}.modern-panel{padding:22px;border:1px solid var(--line);border-radius:18px;background:#0a201a}.modern-panel h3{margin:0 0 8px}.modern-panel p{margin:0 0 14px;color:var(--muted);line-height:1.6}.modern-pills{display:flex;flex-wrap:wrap;gap:8px}.modern-pill{padding:7px 10px;border:1px solid #2f6659;border-radius:999px;color:#d9eee8;font-size:.74rem;font-weight:800}.modern-code{margin:0;padding:16px;border:1px solid #2b5147;border-radius:13px;background:#061411;color:#d8ff7d;overflow:auto;white-space:pre-wrap;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.modern-cta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px}.modern-cta a{font-weight:850;text-decoration:none}.modern-cta .primary{padding:11px 14px;border-radius:10px;background:var(--lime);color:#0c221d}.modern-cta .secondary{color:#bfe4da}.modern-usecases{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.modern-usecase{padding:16px;border-left:2px solid #4fc6a9;background:rgba(11,33,27,.72);border-radius:0 12px 12px 0}.modern-usecase strong{display:block;margin-bottom:6px}.modern-usecase span{color:var(--muted);font-size:.8rem;line-height:1.5}.modern-note{margin-top:13px;color:var(--muted);font-size:.76rem}
    .excel-addin{margin-top:34px;padding:clamp(22px,4vw,40px);border:1px solid #326b5d;border-radius:24px;background:radial-gradient(circle at 92% 8%,rgba(89,214,178,.16),transparent 30%),linear-gradient(145deg,#0d2b23,#081b17);box-shadow:0 22px 80px rgba(0,0,0,.2);overflow:hidden}.excel-addin-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(320px,.92fr);gap:34px;align-items:center}.excel-addin h2{margin:8px 0 12px;font-size:clamp(2rem,4.5vw,4rem);line-height:.98}.excel-addin h2 span{color:var(--lime)}.excel-addin-lead{margin:0;color:#c9e1d9;font-size:1.02rem;line-height:1.72;max-width:720px}.excel-badges{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.excel-badge{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #397465;border-radius:999px;background:rgba(6,22,18,.55);font-size:.76rem;font-weight:850;color:#e6f6f1}.excel-checks{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0 0;padding:0;list-style:none}.excel-checks li{padding:12px 13px;border:1px solid rgba(62,121,105,.58);border-radius:12px;background:rgba(5,20,16,.45);color:#cfe6df;font-size:.82rem;line-height:1.5}.excel-checks li:before{content:'✓';color:var(--lime);font-weight:950;margin-right:8px}.excel-actions{display:flex;gap:11px;align-items:center;flex-wrap:wrap;margin-top:22px}.excel-actions a{text-decoration:none;font-weight:900}.excel-actions .download{padding:12px 16px;border-radius:11px;background:var(--lime);color:#0a211b;box-shadow:0 8px 26px rgba(186,235,98,.14)}.excel-actions .docs{padding:11px 14px;border:1px solid #3b7767;border-radius:11px;color:#d7efe7}.excel-small{margin-top:11px;color:var(--muted);font-size:.74rem;line-height:1.55}.excel-demo{border:1px solid #346c5d;border-radius:18px;background:#061612;overflow:hidden;box-shadow:0 18px 55px rgba(0,0,0,.28)}.excel-demo-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid #285548;background:#0b241d}.excel-demo-head strong{font-size:.84rem}.excel-demo-head span{font-size:.7rem;color:#8fb8ac}.excel-ribbon{display:flex;gap:7px;flex-wrap:wrap;padding:12px;border-bottom:1px solid #203f36;background:#0a1c18}.excel-ribbon span{padding:7px 9px;border:1px solid #315f53;border-radius:8px;font-size:.68rem;color:#d5eae4;background:#0d2a22}.excel-ribbon span:last-child{border-color:#6f9144;color:#e7ffc0}.excel-tabs{display:flex;gap:5px;padding:10px 12px 0;overflow:hidden}.excel-tabs span{padding:6px 9px;border-radius:7px 7px 0 0;background:#102c24;border:1px solid #285044;border-bottom:0;color:#a9c7be;font-size:.7rem}.excel-tabs span:first-child{background:#174437;color:#effff9}.excel-sheet{padding:0 12px 14px}.excel-sheet table{width:100%;border-collapse:collapse;font-size:.68rem;table-layout:fixed}.excel-sheet th,.excel-sheet td{border:1px solid #24473d;padding:7px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.excel-sheet th{background:#12352c;color:#dff3ed}.excel-sheet td{color:#a8c8be}.excel-flow{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:12px;border-top:1px solid #24473d;background:#081b16}.excel-flow span{padding:8px 6px;border-radius:8px;text-align:center;background:#0f3027;border:1px solid #2d5d50;color:#bddad1;font-size:.66rem;font-weight:800}.excel-flow span:not(:last-child):after{content:' →';color:var(--lime)}
    @media(max-width:900px){.modern-features-head,.modern-showcase,.excel-addin-grid{grid-template-columns:1fr}.modern-grid{grid-template-columns:1fr 1fr}.modern-usecases{grid-template-columns:1fr}.excel-demo{max-width:680px}}
    @media(max-width:560px){.modern-features{padding:0 14px}.modern-grid{grid-template-columns:1fr}.modern-card{min-height:auto}.excel-addin{border-radius:18px}.excel-checks{grid-template-columns:1fr}.excel-flow{grid-template-columns:1fr 1fr}.excel-actions a{width:100%;text-align:center}}
  `;
  document.head.appendChild(style);

  const section = document.createElement('section');
  section.id = 'littleapi-modern-features';
  section.className = 'modern-features';
  home.insertAdjacentElement('afterend', section);

  const copy = {
    es: {
      eyebrow:'MÁS QUE JSON',
      title:'De Google Sheets a una <span>API lista para usar.</span>',
      intro:'Publica endpoints REST, controla permisos y crea widgets de datos que puedes insertar en cualquier web. La hoja sigue siendo tu fuente de verdad.',
      cards:[
        ['table','Widget embebible','Elige pestaña, columnas visibles y orden. Copia un iframe y publica una tabla o tarjetas sin exponer ninguna API key.'],
        ['02','Paginación real','Define cuántas filas ver por página, navega con Anterior/Siguiente y salta directamente a una página concreta.'],
        ['03','Búsqueda de toda la hoja','El buscador no se limita a las filas visibles: recorre la hoja completa de forma progresiva y mantiene la paginación.'],
        ['04','Permisos y claves','Separa lectura, búsqueda, creación, edición y eliminación. Crea claves adicionales con permisos distintos para cada integración.']
      ],
      widgetTitle:'Publica datos sin construir una interfaz desde cero',
      widgetText:'El generador de widgets detecta las pestañas y encabezados del libro. Tú decides qué se muestra y LittleAPI genera el código de inserción.',
      pills:['Pestaña del libro','Columnas + orden','25 filas por defecto','Salto de página','Búsqueda global','Tema claro/oscuro'],
      apiTitle:'REST cuando necesitas integrar. Widget cuando necesitas mostrar.',
      apiText:'Usa el mismo proyecto para alimentar una aplicación, una automatización o una tabla pública en tu sitio.',
      cta1:'Ver documentación de widgets →',cta2:'Comparar planes',
      uses:[['Sitios y portales','Publica catálogos, listados, inventarios o reportes vivos.'],['Apps y automatizaciones','Consume JSON desde JavaScript, Python, Postman, Make, n8n o tu backend.'],['Equipos','Entrega claves independientes con permisos de solo lectura o escritura controlada.']],
      note:'Las escrituras y operaciones privadas siguen protegidas por X-API-Key. El iframe público nunca incluye tu clave.',
      addinEyebrow:'NUEVO · COMPLEMENTO PARA EXCEL',
      addinTitle:'Trabaja en Excel. <span>Sincroniza con Google Sheets.</span>',
      addinLead:'Instala el complemento de LittleAPI y usa Excel como editor de tu libro de Google Sheets. Carga todas las pestañas, edita celdas y filas con las herramientas normales de Excel y sincroniza todo cuando estés listo.',
      badges:['Windows','Microsoft Excel','Libro completo','Todas las columnas'],
      checks:[
        'Detecta automáticamente todas las pestañas del libro de Google Sheets.',
        'Crea las hojas de Excel con los nombres originales siempre que Excel lo permita.',
        'Añade, edita o elimina filas directamente en Excel; no necesitas formularios CRUD separados.',
        'La conexión queda guardada en el libro: al volver a abrirlo, conserva API ID y vínculos de hojas.'
      ],
      download:'Descargar complemento para Excel',
      docs:'Guía de instalación y botones →',
      package:'Instalador para Windows · descarga y ejecuta el setup directamente · SHA-256 disponible en la documentación.',
      demoTitle:'LittleAPI for Excel',demoState:'Libro conectado',
      ribbon:['Configure API','Test Connection','Load Workbook','Refresh Workbook','Save / Synchronize'],
      tabs:['CARTERA','COORDENADAS','CLIENTES'],
      flow:['Configurar API','Cargar libro','Editar en Excel','Sincronizar']
    },
    en: {
      eyebrow:'MORE THAN JSON',
      title:'From Google Sheets to an <span>API ready to use.</span>',
      intro:'Publish REST endpoints, control permissions, and create live data widgets you can embed in any website. Your sheet remains the source of truth.',
      cards:[
        ['table','Embeddable widget','Choose the workbook sheet, visible columns and their order. Copy an iframe and publish a table or cards without exposing an API key.'],
        ['02','Real pagination','Choose rows per page, navigate with Previous/Next, and jump directly to any available page.'],
        ['03','Whole-sheet search','Search is not limited to visible rows: it scans the full sheet progressively while keeping paginated results.'],
        ['04','Permissions and keys','Separate read, search, create, update and delete access. Create additional keys with different permissions for each integration.']
      ],
      widgetTitle:'Publish data without building a UI from scratch',
      widgetText:'The widget generator detects workbook sheets and headers. You decide what is visible and LittleAPI generates the embed code.',
      pills:['Workbook sheet','Columns + order','25 rows by default','Page jump','Global search','Light/dark theme'],
      apiTitle:'REST when you need integration. Widget when you need display.',
      apiText:'Use the same project to power an app, an automation, or a public data table on your site.',
      cta1:'Read widget documentation →',cta2:'Compare plans',
      uses:[['Sites and portals','Publish catalogs, lists, inventories, or live reports.'],['Apps and automations','Consume JSON from JavaScript, Python, Postman, Make, n8n, or your backend.'],['Teams','Issue independent keys with read-only or controlled write permissions.']],
      note:'Writes and private operations remain protected by X-API-Key. Public iframes never include your secret key.',
      addinEyebrow:'NEW · EXCEL ADD-IN',
      addinTitle:'Work in Excel. <span>Synchronize with Google Sheets.</span>',
      addinLead:'Install the LittleAPI add-in and use Excel as the editor for your Google Sheets workbook. Load every tab, edit cells and rows with normal Excel tools, then synchronize the complete linked workbook when you are ready.',
      badges:['Windows','Microsoft Excel','Whole workbook','All columns'],
      checks:[
        'Automatically detects every tab in the connected Google Sheets workbook.',
        'Creates Excel worksheets with the original names whenever Excel allows them.',
        'Add, edit, or delete rows directly in Excel; no separate CRUD forms are required.',
        'The connection is stored in the workbook, so reopening it keeps the API ID and sheet links.'
      ],
      download:'Download Excel Add-in',
      docs:'Setup and button guide →',
      package:'Windows installer · download and run the setup directly · SHA-256 is available in the documentation.',
      demoTitle:'LittleAPI for Excel',demoState:'Workbook connected',
      ribbon:['Configure API','Test Connection','Load Workbook','Refresh Workbook','Save / Synchronize'],
      tabs:['CARTERA','COORDENADAS','CLIENTS'],
      flow:['Configure API','Load Workbook','Edit in Excel','Synchronize']
    }
  };

  function language() {
    const stored = localStorage.getItem('littleapi:language');
    if (stored === 'es' || stored === 'en') return stored;
    const selected = document.querySelector('#language-select')?.value;
    if (selected === 'es' || selected === 'en') return selected;
    return document.documentElement.lang === 'es' ? 'es' : 'en';
  }

  function render() {
    const t = copy[language()];
    section.innerHTML = `
      <div class="modern-features-head"><div><p class="eyebrow">${t.eyebrow}</p><h2>${t.title}</h2></div><p>${t.intro}</p></div>
      <div class="modern-grid">${t.cards.map(card=>`<article class="modern-card"><span class="n">${card[0] === 'table' ? '<img src="littleapi-table-icon.svg?v=20260917-1" alt="">' : card[0]}</span><h3>${card[1]}</h3><p>${card[2]}</p></article>`).join('')}</div>
      <div class="modern-showcase">
        <article class="modern-panel"><h3>${t.widgetTitle}</h3><p>${t.widgetText}</p><div class="modern-pills">${t.pills.map(p=>`<span class="modern-pill">${p}</span>`).join('')}</div><p class="modern-note">${t.note}</p></article>
        <article class="modern-panel"><h3>${t.apiTitle}</h3><p>${t.apiText}</p><pre class="modern-code">GET /api/v1/{API_ID}?sheet=Cartera&select=Nombre,Fecha,Valor\n\n&lt;iframe src="https://littleapi.online/embed.html?api={API_ID}&page_size=25..."&gt;&lt;/iframe&gt;</pre><div class="modern-cta"><a class="primary" href="docs/widgets.html">${t.cta1}</a><a class="secondary" href="pricing.html">${t.cta2}</a></div></article>
      </div>
      <div class="modern-usecases">${t.uses.map(item=>`<div class="modern-usecase"><strong>${item[0]}</strong><span>${item[1]}</span></div>`).join('')}</div>
      <section class="excel-addin" id="excel-addin">
        <div class="excel-addin-grid">
          <div>
            <p class="eyebrow">${t.addinEyebrow}</p>
            <h2>${t.addinTitle}</h2>
            <p class="excel-addin-lead">${t.addinLead}</p>
            <div class="excel-badges">${t.badges.map(item=>`<span class="excel-badge">${item}</span>`).join('')}</div>
            <ul class="excel-checks">${t.checks.map(item=>`<li>${item}</li>`).join('')}</ul>
            <div class="excel-actions">
              <a class="download" href="downloads/LittleAPI_Excel_Addin_Setup.exe" download>${t.download}</a>
              <a class="docs" href="docs/excel-addin.html">${t.docs}</a>
            </div>
            <p class="excel-small">${t.package}</p>
          </div>
          <div class="excel-demo" aria-label="LittleAPI Excel add-in workflow preview">
            <div class="excel-demo-head"><strong>${t.demoTitle}</strong><span>● ${t.demoState}</span></div>
            <div class="excel-ribbon">${t.ribbon.map(item=>`<span>${item}</span>`).join('')}</div>
            <div class="excel-tabs">${t.tabs.map(item=>`<span>${item}</span>`).join('')}</div>
            <div class="excel-sheet"><table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Total</th></tr></thead><tbody><tr><td>1001</td><td>Andrea</td><td>ACTIVE</td><td>128.50</td></tr><tr><td>1002</td><td>Daniel</td><td>ACTIVE</td><td>96.20</td></tr><tr><td>1003</td><td>Lucía</td><td>PENDING</td><td>210.00</td></tr></tbody></table></div>
            <div class="excel-flow">${t.flow.map(item=>`<span>${item}</span>`).join('')}</div>
          </div>
        </div>
      </section>`;
  }

  render();
  window.addEventListener('littleapi:language-change', render);
})();
