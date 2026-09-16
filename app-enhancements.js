(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const language = () => localStorage.getItem("littleapi:language") || document.documentElement.lang || "es";
  const text = (es, en) => language().toLowerCase().startsWith("en") ? en : es;
  const html = value => String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const formatDate = value => value ? new Date(value).toLocaleString(language().startsWith("en") ? "en-US" : "es-EC") : "—";

  function refreshEnhancementLanguage() {
    const list = $("#api-usage-list");
    const count = list ? list.querySelectorAll(".api-usage-card").length : 0;
    const countNode = $(".usage-api-count");
    const hint = $(".usage-scroll-hint");
    if (countNode) countNode.textContent = text(`${count} API${count === 1 ? "" : "s"} en la lista`, `${count} API${count === 1 ? "" : "s"} in the list`);
    if (hint) hint.textContent = count > 3 ? text("Desplázate dentro del panel para ver las demás.", "Scroll inside this panel to see the rest.") : "";
    const title = $(".query-help-title");
    const intro = $(".query-help-intro");
    const full = $(".query-full-label");
    const where = $(".query-where-label");
    const before = $(".query-tip-before");
    const andWord = $(".query-tip-and");
    if (title) title.textContent = text("Ejemplos listos para usar", "Ready-to-use examples");
    if (intro) intro.textContent = text("Pulsa un ejemplo para copiarlo al campo de consulta. LittleAPI reconoce los nombres de tus columnas y los traduce automáticamente para Google.", "Click an example to place it in the query field. LittleAPI recognizes your column names and maps them automatically for Google.");
    if (full) full.textContent = text("Consultas completas", "Full queries");
    if (where) where.textContent = text("Sólo condición WHERE", "WHERE condition only");
    if (before) before.textContent = text("Puedes combinar", "You can combine");
    if (andWord) andWord.textContent = text("y", "and");

    const section = $("#platform-tools");
    if (section) {
      $(".platform-eyebrow", section).textContent = text("SEGURIDAD Y ACTIVIDAD", "SECURITY & ACTIVITY");
      $(".platform-title", section).textContent = text("Controla lo que ocurre en tus APIs", "Control what happens in your APIs");
      $(".platform-intro", section).textContent = text("Revisa peticiones, limita orígenes o IP y envía eventos mediante webhooks firmados.", "Inspect requests, restrict origins or IPs, and send events through signed webhooks.");
      const selectLabel = $(".platform-api-label", section); if (selectLabel) selectLabel.textContent = text("API a administrar", "API to manage");
      section.querySelectorAll("[data-platform-tab]").forEach(button => {
        const names = { logs:["Actividad","Activity"], security:["Seguridad","Security"], webhooks:["Webhooks","Webhooks"] };
        button.textContent = text(...names[button.dataset.platformTab]);
      });
      const map = {
        "logs-heading":["Registro de actividad","Activity log"], "logs-help":["Consulta las peticiones, cambios y entregas de webhooks de esta API.","Inspect requests, changes, and webhook deliveries for this API."],
        "logs-refresh":["Actualizar","Refresh"], "security-heading":["Restricciones de acceso","Access restrictions"], "security-help":["Deja una lista vacía para no restringir por ese criterio.","Leave a list empty to avoid restricting by that criterion."],
        "origins-label":["Orígenes web permitidos (uno por línea)","Allowed web origins (one per line)"], "ips-label":["IP o CIDR permitidos (uno por línea)","Allowed IP or CIDR (one per line)"],
        "request-log-label":["Guardar registro de peticiones","Store request logs"], "audit-log-label":["Guardar auditoría de cambios","Store change audit log"], "security-save":["Guardar seguridad","Save security"],
        "webhooks-heading":["Webhooks firmados","Signed webhooks"], "webhooks-help":["LittleAPI enviará un POST HTTPS cuando ocurra uno de los eventos seleccionados.","LittleAPI sends an HTTPS POST when one of the selected events occurs."],
        "webhook-url-label":["URL de destino HTTPS","HTTPS destination URL"], "webhook-create":["Crear webhook","Create webhook"], "webhook-secret-title":["Guarda este secreto ahora","Save this secret now"],
        "webhook-secret-help":["Sólo se muestra una vez. Úsalo para verificar X-LittleAPI-Signature.","It is shown only once. Use it to verify X-LittleAPI-Signature."], "no-webhooks":["Aún no hay webhooks para esta API.","No webhooks for this API yet."],
      };
      Object.entries(map).forEach(([key, values]) => { const node = $(`[data-platform-i18n="${key}"]`, section); if (node) node.textContent = text(...values); });
      refreshEventLabels(section);
    }
  }

  function enhanceUsageList() {
    const list = $("#api-usage-list");
    if (!list || list.dataset.enhanced === "true") return;
    list.dataset.enhanced = "true";
    const heading = list.closest(".usage-section")?.querySelector(".section-heading");
    const toolbar = document.createElement("div");
    toolbar.className = "usage-list-toolbar";
    toolbar.innerHTML = '<strong class="usage-api-count"></strong><span class="usage-scroll-hint"></span>';
    heading?.insertAdjacentElement("afterend", toolbar);
    new MutationObserver(refreshEnhancementLanguage).observe(list, { childList: true, subtree: true });
    refreshEnhancementLanguage();
  }

  const queryExamples = [
    "SELECT * LIMIT 100",
    "SELECT Name, Status WHERE Status = 'ACTIVE'",
    "SELECT * WHERE Name CONTAINS 'ana'",
    "SELECT Name, Total WHERE Total > 100 ORDER BY Total DESC",
    "SELECT Product, SUM(Total) GROUP BY Product",
    "SELECT Issue, COUNT(Issue) GROUP BY Issue",
    "SELECT Name, Date WHERE Date >= date '2026-01-01' ORDER BY Date",
    "SELECT * ORDER BY Date DESC LIMIT 50 OFFSET 50"
  ];
  const whereExamples = [
    "Status = 'ACTIVE'", "Quantity > 10", "Name CONTAINS 'ana'",
    "Status = 'ACTIVE' AND City = 'Quito'", "Status = 'ACTIVE' OR Status = 'PENDING'", "Date >= date '2026-01-01'"
  ];

  function enhanceQueryPanel() {
    const panel = document.querySelector('[data-panel="query"]');
    if (!panel || panel.dataset.enhanced === "true") return;
    panel.dataset.enhanced = "true";
    const help = document.createElement("div");
    help.className = "query-help";
    help.innerHTML = `
      <div class="query-help-head"><div><h3 class="query-help-title"></h3><p class="query-help-intro"></p></div></div>
      <div class="query-example-group"><span class="query-example-label query-full-label"></span><div class="query-example-list" data-query-examples></div></div>
      <div class="query-example-group"><span class="query-example-label query-where-label"></span><div class="query-example-list" data-where-examples></div></div>
      <p class="query-tip"><span class="query-tip-before"></span> <code>SELECT</code>, <code>WHERE</code>, <code>AND</code>, <code>OR</code>, <code>CONTAINS</code>, <code>ORDER BY</code>, <code>GROUP BY</code>, <code>SUM</code>, <code>COUNT</code>, <code>AVG</code>, <code>MIN</code>, <code>MAX</code>, <code>LIMIT</code> <span class="query-tip-and"></span> <code>OFFSET</code>.</p>`;
    panel.insertBefore(help, panel.firstChild);
    const queryList = help.querySelector("[data-query-examples]");
    queryExamples.forEach(query => {
      const button = document.createElement("button"); button.type = "button"; button.className = "query-example"; button.textContent = query;
      button.onclick = () => { const field = $("#custom-query"); if (field) { field.value = query; field.focus(); } };
      queryList.appendChild(button);
    });
    const whereList = help.querySelector("[data-where-examples]");
    whereExamples.forEach(query => {
      const button = document.createElement("button"); button.type = "button"; button.className = "query-example"; button.textContent = query;
      button.onclick = () => { const field = $("#advanced-where"); if (field) { field.value = query; field.focus(); } };
      whereList.appendChild(button);
    });
    refreshEnhancementLanguage();
  }

  const webhookEvents = [
    ["row.created","Fila creada","Row created"], ["row.updated","Fila actualizada","Row updated"], ["row.deleted","Fila eliminada","Row deleted"],
    ["sheet.created","Pestaña creada","Sheet created"], ["sheet.renamed","Pestaña renombrada","Sheet renamed"], ["sheet.deleted","Pestaña eliminada","Sheet deleted"],
    ["sheet.formatted","Formato aplicado","Sheet formatted"], ["sheet.cleared","Rango vaciado","Range cleared"], ["sheet.batch","Batch ejecutado","Batch executed"], ["sheet.copied","Pestaña copiada","Sheet copied"],
    ["drive.created","Drive: creado/subido","Drive: created/uploaded"], ["drive.updated","Drive: actualizado","Drive: updated"], ["drive.deleted","Drive: eliminado","Drive: deleted"],
    ["*","Todos los eventos","All events"]
  ];
  let platformApiId = "";
  let platformLoading = false;

  function apiOptions() {
    try { return Array.isArray(apisCache) ? apisCache.filter(api => api && api.enabled !== false) : []; } catch (_) { return []; }
  }
  function selectedPlatformApi() { return apiOptions().find(api => api.api_id === platformApiId) || null; }
  function platformMessage(message, kind = "") {
    const node = $("#platform-message"); if (!node) return;
    node.textContent = message || ""; node.className = `form-message ${kind}`.trim();
  }
  async function accountCall(path, options) {
    if (typeof ownerApiRequest !== "function") throw new Error(text("La cuenta todavía se está cargando.", "The account is still loading."));
    return ownerApiRequest(path, options);
  }

  function refreshEventLabels(section = $("#platform-tools")) {
    if (!section) return;
    section.querySelectorAll("[data-webhook-event-label]").forEach(label => {
      const event = webhookEvents.find(item => item[0] === label.dataset.webhookEventLabel);
      if (event) label.textContent = text(event[1], event[2]);
    });
  }

  function platformMarkup() {
    const eventHtml = webhookEvents.map(([event, es, en], index) => `<label class="event-option"><input type="checkbox" value="${event}" ${index < 3 ? "checked" : ""}><span data-webhook-event-label="${event}">${html(text(es,en))}</span><code>${event}</code></label>`).join("");
    return `<section class="platform-tools" id="platform-tools" aria-labelledby="platform-title">
      <div class="platform-heading"><div><p class="eyebrow platform-eyebrow"></p><h2 class="platform-title" id="platform-title"></h2><p class="platform-intro"></p></div>
        <label class="platform-api-picker"><span class="platform-api-label"></span><select id="platform-api-select"></select></label>
      </div>
      <div class="platform-tabs" role="tablist"><button type="button" class="active" data-platform-tab="logs"></button><button type="button" data-platform-tab="security"></button><button type="button" data-platform-tab="webhooks"></button></div>

      <section class="platform-pane" data-platform-pane="logs">
        <div class="platform-pane-head"><div><h3 data-platform-i18n="logs-heading"></h3><p data-platform-i18n="logs-help"></p></div><div class="platform-actions"><select id="platform-log-type"><option value="requests">Requests</option><option value="audit">Audit</option><option value="webhooks">Webhooks</option></select><button type="button" class="action-button" id="platform-refresh-logs" data-platform-i18n="logs-refresh"></button></div></div>
        <div class="platform-table-wrap"><table class="platform-table"><thead id="platform-logs-head"></thead><tbody id="platform-logs-body"></tbody></table></div>
      </section>

      <section class="platform-pane hidden" data-platform-pane="security">
        <div class="platform-pane-head"><div><h3 data-platform-i18n="security-heading"></h3><p data-platform-i18n="security-help"></p></div></div>
        <div class="security-grid"><label><span data-platform-i18n="origins-label"></span><textarea id="platform-origins" rows="6" placeholder="https://myapp.com\nhttps://admin.myapp.com"></textarea><small>CORS · https://domain.com</small></label><label><span data-platform-i18n="ips-label"></span><textarea id="platform-ips" rows="6" placeholder="203.0.113.25\n198.51.100.0/24"></textarea><small>IPv4, IPv4/CIDR or exact IPv6</small></label></div>
        <div class="security-toggles"><label><input type="checkbox" id="platform-request-log" checked><span data-platform-i18n="request-log-label"></span></label><label><input type="checkbox" id="platform-audit-log" checked><span data-platform-i18n="audit-log-label"></span></label></div>
        <button type="button" class="button" id="platform-save-security" data-platform-i18n="security-save"></button>
      </section>

      <section class="platform-pane hidden" data-platform-pane="webhooks">
        <div class="platform-pane-head"><div><h3 data-platform-i18n="webhooks-heading"></h3><p data-platform-i18n="webhooks-help"></p></div></div>
        <div class="webhook-create"><label><span data-platform-i18n="webhook-url-label"></span><input id="platform-webhook-url" placeholder="https://example.com/webhooks/littleapi"></label><div class="event-grid" id="platform-event-grid">${eventHtml}</div><button type="button" class="button" id="platform-create-webhook" data-platform-i18n="webhook-create"></button></div>
        <div class="webhook-secret hidden" id="platform-webhook-secret"><strong data-platform-i18n="webhook-secret-title"></strong><code id="platform-webhook-secret-value"></code><button type="button" class="action-button" id="platform-copy-webhook-secret">Copy</button><p data-platform-i18n="webhook-secret-help"></p></div>
        <div class="webhook-list" id="platform-webhook-list"></div>
      </section>
      <p class="form-message" id="platform-message" role="status" aria-live="polite"></p>
    </section>`;
  }

  function refreshApiSelector() {
    const select = $("#platform-api-select"); if (!select) return;
    const apis = apiOptions();
    const remembered = localStorage.getItem("littleapi:platform-api") || "";
    if (!platformApiId || !apis.some(api => api.api_id === platformApiId)) platformApiId = apis.some(api => api.api_id === remembered) ? remembered : (apis[0]?.api_id || "");
    const signature = apis.map(api => `${api.api_id}:${api.name}`).join("|");
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.innerHTML = apis.length ? apis.map(api => `<option value="${html(api.api_id)}">${html(api.name || api.api_id)} · ${html(api.resource_type || "sheet")}</option>`).join("") : `<option value="">${html(text("No tienes APIs activas", "No active APIs"))}</option>`;
    }
    select.value = platformApiId;
  }

  function switchPlatformTab(tab) {
    const section = $("#platform-tools"); if (!section) return;
    section.querySelectorAll("[data-platform-tab]").forEach(button => button.classList.toggle("active", button.dataset.platformTab === tab));
    section.querySelectorAll("[data-platform-pane]").forEach(pane => pane.classList.toggle("hidden", pane.dataset.platformPane !== tab));
    if (!platformApiId) return;
    if (tab === "logs") loadPlatformLogs();
    if (tab === "security") loadPlatformSecurity();
    if (tab === "webhooks") loadPlatformWebhooks();
  }

  async function loadPlatformLogs() {
    if (!platformApiId || platformLoading) return;
    const type = $("#platform-log-type")?.value || "requests";
    platformLoading = true; platformMessage(text("Cargando actividad…", "Loading activity…"));
    try {
      const result = await accountCall(`/account/logs?api_id=${encodeURIComponent(platformApiId)}&type=${encodeURIComponent(type)}&limit=100`);
      renderPlatformLogs(type, result.data || []); platformMessage("");
    } catch (error) { platformMessage(String(error.message || error), "error"); }
    finally { platformLoading = false; }
  }

  function renderPlatformLogs(type, rows) {
    const head = $("#platform-logs-head"), body = $("#platform-logs-body"); if (!head || !body) return;
    if (type === "requests") {
      head.innerHTML = `<tr><th>${html(text("Fecha","Time"))}</th><th>HTTP</th><th>${html(text("Ruta","Path"))}</th><th>${html(text("Duración","Duration"))}</th><th>IP</th></tr>`;
      body.innerHTML = rows.map(row => `<tr><td>${html(formatDate(row.created_at))}</td><td><span class="status-code s${Math.floor(Number(row.status||0)/100)}">${html(row.method)} ${html(row.status)}</span></td><td><code>${html(row.path)}${row.query_string ? `?${html(row.query_string)}` : ""}</code></td><td>${html(row.duration_ms)} ms</td><td><code>${html(row.client_ip || "—")}</code></td></tr>`).join("");
    } else if (type === "audit") {
      head.innerHTML = `<tr><th>${html(text("Fecha","Time"))}</th><th>${html(text("Acción","Action"))}</th><th>${html(text("Actor","Actor"))}</th><th>${html(text("Recurso","Resource"))}</th></tr>`;
      body.innerHTML = rows.map(row => `<tr><td>${html(formatDate(row.created_at))}</td><td><code>${html(row.action)}</code></td><td>${html(row.actor_type)}</td><td><code>${html(row.resource || "—")}</code></td></tr>`).join("");
    } else {
      head.innerHTML = `<tr><th>${html(text("Fecha","Time"))}</th><th>${html(text("Evento","Event"))}</th><th>HTTP</th><th>${html(text("Intentos","Attempts"))}</th><th>${html(text("Resultado","Result"))}</th></tr>`;
      body.innerHTML = rows.map(row => `<tr><td>${html(formatDate(row.created_at))}</td><td><code>${html(row.event)}</code></td><td>${html(row.status_code ?? "—")}</td><td>${html(row.attempt)}</td><td>${row.success ? "✓" : html(row.error || "—")}</td></tr>`).join("");
    }
    if (!rows.length) body.innerHTML = `<tr><td colspan="5" class="empty-table">${html(text("Todavía no hay actividad registrada.", "No activity recorded yet."))}</td></tr>`;
  }

  async function loadPlatformSecurity() {
    if (!platformApiId) return;
    platformMessage(text("Cargando seguridad…", "Loading security…"));
    try {
      const data = await accountCall(`/account/security?api_id=${encodeURIComponent(platformApiId)}`);
      $("#platform-origins").value = (data.allowed_origins || []).join("\n");
      $("#platform-ips").value = (data.allowed_ips || []).join("\n");
      $("#platform-request-log").checked = data.request_logging !== false;
      $("#platform-audit-log").checked = data.audit_logging !== false;
      platformMessage("");
    } catch (error) { platformMessage(String(error.message || error), "error"); }
  }

  async function savePlatformSecurity() {
    if (!platformApiId) return;
    const split = value => String(value || "").split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
    platformMessage(text("Guardando seguridad…", "Saving security…"));
    try {
      await accountCall("/account/security", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ api_id:platformApiId, allowed_origins:split($("#platform-origins").value), allowed_ips:split($("#platform-ips").value), request_logging:$("#platform-request-log").checked, audit_logging:$("#platform-audit-log").checked }) });
      platformMessage(text("Configuración guardada. Las reglas se aplican automáticamente a esta API.", "Settings saved. Rules now apply automatically to this API."), "success");
    } catch (error) { platformMessage(String(error.message || error), "error"); }
  }

  async function loadPlatformWebhooks() {
    if (!platformApiId) return;
    platformMessage(text("Cargando webhooks…", "Loading webhooks…"));
    try {
      const data = await accountCall(`/account/webhooks?api_id=${encodeURIComponent(platformApiId)}`);
      renderWebhooks(data.data || []); platformMessage("");
    } catch (error) { platformMessage(String(error.message || error), "error"); }
  }

  function renderWebhooks(rows) {
    const list = $("#platform-webhook-list"); if (!list) return;
    if (!rows.length) { list.innerHTML = `<p class="muted" data-platform-i18n="no-webhooks">${html(text("Aún no hay webhooks para esta API.", "No webhooks for this API yet."))}</p>`; return; }
    list.innerHTML = rows.map(row => `<article class="webhook-card" data-webhook-id="${html(row.id)}"><div class="webhook-card-main"><div class="webhook-card-title"><span class="webhook-dot ${row.enabled ? "enabled" : ""}"></span><strong>${html(row.url)}</strong></div><div class="webhook-events">${(row.events||[]).map(event => `<code>${html(event)}</code>`).join("")}</div><small>${html(text("Última entrega", "Last delivery"))}: ${html(formatDate(row.last_delivery_at))} · HTTP ${html(row.last_status ?? "—")} · ${html(text("fallos", "failures"))}: ${html(row.failure_count || 0)}</small></div><div class="webhook-card-actions"><button type="button" class="text-button" data-webhook-test>${html(text("Probar", "Test"))}</button><button type="button" class="text-button" data-webhook-toggle data-enabled="${row.enabled ? "true" : "false"}">${html(row.enabled ? text("Pausar", "Pause") : text("Activar", "Enable"))}</button><button type="button" class="danger-link" data-webhook-delete>${html(text("Eliminar", "Delete"))}</button></div></article>`).join("");
  }

  async function createPlatformWebhook() {
    if (!platformApiId) return;
    const url = $("#platform-webhook-url").value.trim();
    const events = Array.from($("#platform-event-grid").querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    if (!url) return platformMessage(text("Escribe la URL HTTPS que recibirá los eventos.", "Enter the HTTPS URL that will receive events."), "error");
    if (!events.length) return platformMessage(text("Selecciona al menos un evento.", "Select at least one event."), "error");
    platformMessage(text("Creando webhook…", "Creating webhook…"));
    try {
      const data = await accountCall("/account/webhooks", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({api_id:platformApiId,url,events}) });
      $("#platform-webhook-secret-value").textContent = data.secret || ""; $("#platform-webhook-secret").classList.remove("hidden"); $("#platform-webhook-url").value = "";
      platformMessage(text("Webhook creado. Guarda el secreto antes de salir de esta pantalla.", "Webhook created. Save the secret before leaving this screen."), "success");
      await loadPlatformWebhooks();
    } catch (error) { platformMessage(String(error.message || error), "error"); }
  }

  async function webhookAction(button) {
    const card = button.closest("[data-webhook-id]"); if (!card || !platformApiId) return;
    const id = card.dataset.webhookId;
    try {
      if (button.hasAttribute("data-webhook-test")) {
        await accountCall("/account/webhooks/test", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({api_id:platformApiId,id}) });
        platformMessage(text("Prueba enviada. Revisa el registro de Webhooks en unos segundos.", "Test queued. Check Webhook logs in a few seconds."), "success");
      } else if (button.hasAttribute("data-webhook-toggle")) {
        const enabled = button.dataset.enabled !== "true";
        await accountCall("/account/webhooks", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({api_id:platformApiId,id,enabled}) }); await loadPlatformWebhooks();
      } else if (button.hasAttribute("data-webhook-delete")) {
        if (!confirm(text("¿Eliminar este webhook?", "Delete this webhook?"))) return;
        await accountCall("/account/webhooks", { method:"DELETE", headers:{"Content-Type":"application/json"}, body:JSON.stringify({api_id:platformApiId,id}) }); await loadPlatformWebhooks();
      }
    } catch (error) { platformMessage(String(error.message || error), "error"); }
  }

  function bindPlatformEvents(section) {
    if (section.dataset.bound === "true") return; section.dataset.bound = "true";
    section.addEventListener("click", event => {
      const tab = event.target.closest("[data-platform-tab]"); if (tab) return switchPlatformTab(tab.dataset.platformTab);
      if (event.target.closest("#platform-refresh-logs")) return loadPlatformLogs();
      if (event.target.closest("#platform-save-security")) return savePlatformSecurity();
      if (event.target.closest("#platform-create-webhook")) return createPlatformWebhook();
      if (event.target.closest("#platform-copy-webhook-secret")) return navigator.clipboard.writeText($("#platform-webhook-secret-value")?.textContent || "");
      const webhookButton = event.target.closest("[data-webhook-test],[data-webhook-toggle],[data-webhook-delete]"); if (webhookButton) return webhookAction(webhookButton);
    });
    $("#platform-api-select", section).addEventListener("change", event => { platformApiId = event.target.value; localStorage.setItem("littleapi:platform-api", platformApiId); $("#platform-webhook-secret").classList.add("hidden"); const active = section.querySelector("[data-platform-tab].active")?.dataset.platformTab || "logs"; switchPlatformTab(active); });
    $("#platform-log-type", section).addEventListener("change", loadPlatformLogs);
  }

  function enhancePlatformPanel() {
    const dashboard = $("#dashboard"); if (!dashboard) return;
    let section = $("#platform-tools");
    if (!section) {
      const account = dashboard.querySelector(".account-api-panel");
      if (!account) return;
      account.insertAdjacentHTML("afterend", platformMarkup()); section = $("#platform-tools"); bindPlatformEvents(section); refreshEnhancementLanguage();
    }
    const before = platformApiId; refreshApiSelector();
    if (!before && platformApiId && !section.dataset.initialLoaded) { section.dataset.initialLoaded = "true"; loadPlatformLogs(); }
  }

  function bindLanguageRefresh() {
    const select = $("#language-select");
    if (!select || select.dataset.enhancementBound === "true") return;
    select.dataset.enhancementBound = "true";
    select.addEventListener("change", () => setTimeout(() => { refreshEnhancementLanguage(); refreshApiSelector(); refreshAdminEntryLanguage(); }, 0));
  }

  let adminEntryChecking = false;
  let adminEntryRole = "";
  let adminEntryFailures = 0;

  function refreshAdminEntryLanguage() {
    const link = $("#admin-console-link");
    if (!link) return;
    link.textContent = text("Administración", "Admin");
    link.title = text("Abrir la consola privada de LittleAPI", "Open the private LittleAPI console");
  }

  function insertAdminEntry(actions, role) {
    if (!actions || $("#admin-console-link", actions)) return;
    const link = document.createElement("a");
    link.id = "admin-console-link";
    link.className = "action-button";
    link.href = "admin/";
    link.dataset.adminRole = role || "admin";
    const signOut = $("#sign-out", actions);
    if (signOut) actions.insertBefore(link, signOut); else actions.appendChild(link);
    refreshAdminEntryLanguage();
  }

  async function enhanceAdminEntry() {
    const actions = $("#dashboard .dashboard-actions");
    if (!actions || $("#admin-console-link", actions) || adminEntryChecking) return;
    if (adminEntryRole) { insertAdminEntry(actions, adminEntryRole); return; }
    if (adminEntryFailures >= 4) return;
    if (!sb) { setTimeout(enhanceAdminEntry, 500); return; }
    adminEntryChecking = true;
    try {
      let sessionResult = await sb.auth.getSession();
      let accessToken = sessionResult?.data?.session?.access_token;
      if (!accessToken) return;
      const adminBase = String(cfg.url || "").replace(/\/$/, "") + "/functions/v1/littleapi-admin/me";
      let response = await fetch(adminBase, { headers: { apikey: cfg.publishableKey, Authorization: "Bearer " + accessToken } });
      if (!response.ok && (response.status === 401 || response.status === 403)) {
        const refreshed = await sb.auth.refreshSession();
        accessToken = refreshed?.data?.session?.access_token || "";
        if (accessToken) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          response = await fetch(adminBase, { headers: { apikey: cfg.publishableKey, Authorization: "Bearer " + accessToken } });
        }
      }
      if (!response.ok) {
        adminEntryFailures += 1;
        if (adminEntryFailures < 4) setTimeout(enhanceAdminEntry, adminEntryFailures * 1500);
        return;
      }
      const info = await response.json().catch(() => ({}));
      if (!info?.user || !info?.role) return;
      adminEntryRole = info.role;
      adminEntryFailures = 0;
      insertAdminEntry(actions, adminEntryRole);
    } catch (_) {
      adminEntryFailures += 1;
      if (adminEntryFailures < 4) setTimeout(enhanceAdminEntry, adminEntryFailures * 1500);
    } finally {
      adminEntryChecking = false;
    }
  }

  function apply() { enhanceUsageList(); enhanceQueryPanel(); enhancePlatformPanel(); bindLanguageRefresh(); refreshApiSelector(); enhanceAdminEntry(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  new MutationObserver(apply).observe(document.documentElement, { childList:true, subtree:true });
  window.addEventListener("littleapi:language-change", () => setTimeout(() => { refreshEnhancementLanguage(); refreshApiSelector(); }, 0));
})();
