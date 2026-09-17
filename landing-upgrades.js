(() => {
  const home = document.querySelector('#public-home');
  if (!home || document.querySelector('#littleapi-modern-features')) return;

  const style = document.createElement('style');
  style.id = 'littleapi-modern-features-style';
  style.textContent = `
    .modern-features{margin:38px auto 26px;max-width:1180px;padding:0 22px}.modern-features-head{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:28px;align-items:end;margin-bottom:18px}.modern-features-head h2{margin:7px 0 0;font-size:clamp(2rem,4vw,3.7rem);line-height:.98}.modern-features-head h2 span{color:var(--lime)}.modern-features-head p{margin:0;color:var(--muted);font-size:1rem;line-height:1.7}.modern-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.modern-card{min-height:220px;padding:20px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#0c241e,#081b17);position:relative;overflow:hidden}.modern-card:before{content:'';position:absolute;width:120px;height:120px;border-radius:999px;right:-50px;top:-55px;background:rgba(83,200,173,.1)}.modern-card .n{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid #2e6759;border-radius:10px;color:var(--lime);font-weight:900}.modern-card h3{margin:18px 0 8px;font-size:1.05rem}.modern-card p{margin:0;color:var(--muted);font-size:.83rem;line-height:1.55}.modern-showcase{display:grid;grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr);gap:16px;margin-top:16px}.modern-panel{padding:22px;border:1px solid var(--line);border-radius:18px;background:#0a201a}.modern-panel h3{margin:0 0 8px}.modern-panel p{margin:0 0 14px;color:var(--muted);line-height:1.6}.modern-pills{display:flex;flex-wrap:wrap;gap:8px}.modern-pill{padding:7px 10px;border:1px solid #2f6659;border-radius:999px;color:#d9eee8;font-size:.74rem;font-weight:800}.modern-code{margin:0;padding:16px;border:1px solid #2b5147;border-radius:13px;background:#061411;color:#d8ff7d;overflow:auto;white-space:pre-wrap;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.modern-cta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px}.modern-cta a{font-weight:850;text-decoration:none}.modern-cta .primary{padding:11px 14px;border-radius:10px;background:var(--lime);color:#0c221d}.modern-cta .secondary{color:#bfe4da}.modern-usecases{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.modern-usecase{padding:16px;border-left:2px solid #4fc6a9;background:rgba(11,33,27,.72);border-radius:0 12px 12px 0}.modern-usecase strong{display:block;margin-bottom:6px}.modern-usecase span{color:var(--muted);font-size:.8rem;line-height:1.5}.modern-note{margin-top:13px;color:var(--muted);font-size:.76rem}
    @media(max-width:900px){.modern-features-head,.modern-showcase{grid-template-columns:1fr}.modern-grid{grid-template-columns:1fr 1fr}.modern-usecases{grid-template-columns:1fr}}
    @media(max-width:560px){.modern-features{padding:0 14px}.modern-grid{grid-template-columns:1fr}.modern-card{min-height:auto}}
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
        ['01','Widget embebible','Elige pestaña, columnas visibles y orden. Copia un iframe y publica una tabla o tarjetas sin exponer ninguna API key.'],
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
      note:'Las escrituras y operaciones privadas siguen protegidas por X-API-Key. El iframe público nunca incluye tu clave.'
    },
    en: {
      eyebrow:'MORE THAN JSON',
      title:'From Google Sheets to an <span>API ready to use.</span>',
      intro:'Publish REST endpoints, control permissions, and create live data widgets you can embed in any website. Your sheet remains the source of truth.',
      cards:[
        ['01','Embeddable widget','Choose the workbook sheet, visible columns and their order. Copy an iframe and publish a table or cards without exposing an API key.'],
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
      note:'Writes and private operations remain protected by X-API-Key. Public iframes never include your secret key.'
    }
  };

  function render() {
    const language = localStorage.getItem('littleapi:language') === 'es' ? 'es' : 'en';
    const t = copy[language];
    section.innerHTML = `
      <div class="modern-features-head"><div><p class="eyebrow">${t.eyebrow}</p><h2>${t.title}</h2></div><p>${t.intro}</p></div>
      <div class="modern-grid">${t.cards.map(card=>`<article class="modern-card"><span class="n">${card[0]}</span><h3>${card[1]}</h3><p>${card[2]}</p></article>`).join('')}</div>
      <div class="modern-showcase">
        <article class="modern-panel"><h3>${t.widgetTitle}</h3><p>${t.widgetText}</p><div class="modern-pills">${t.pills.map(p=>`<span class="modern-pill">${p}</span>`).join('')}</div><p class="modern-note">${t.note}</p></article>
        <article class="modern-panel"><h3>${t.apiTitle}</h3><p>${t.apiText}</p><pre class="modern-code">GET /api/v1/{API_ID}?sheet=Cartera&select=Nombre,Fecha,Valor

&lt;iframe src="https://littleapi.online/embed.html?api={API_ID}&page_size=25..."&gt;&lt;/iframe&gt;</pre><div class="modern-cta"><a class="primary" href="docs/widgets.html">${t.cta1}</a><a class="secondary" href="pricing.html">${t.cta2}</a></div></article>
      </div>
      <div class="modern-usecases">${t.uses.map(item=>`<div class="modern-usecase"><strong>${item[0]}</strong><span>${item[1]}</span></div>`).join('')}</div>`;
  }

  render();
  window.addEventListener('littleapi:language-change', render);
})();