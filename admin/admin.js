(() => {
  const cfg = window.SUPABASE_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sb = window.supabase?.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const base = String(cfg.url || "").replace(/\/$/, "") + "/functions/v1/littleapi-admin";
  const priceByPlan = { inicial: 3, pro: 7, business: 25 };
  const state = { me: null, summary: null, users: [], sales: [], apis: [], logs: [], audit: [], webhooks: [], deliveries: [], view: "overview" };

  const i18n = {
    es: { navOverview:"Resumen",navSales:"Ventas",navUsers:"Usuarios",navApis:"APIs",navActivity:"Actividad",navWebhooks:"Webhooks",language:"Idioma",signOut:"Cerrar sesión",loginTitle:"LittleAPI Admin",loginText:"Esta consola está reservada para cuentas administradoras autorizadas.",loginGoogle:"Entrar con Google",deniedTitle:"Acceso no autorizado",deniedText:"La sesión es válida, pero esta cuenta no tiene permisos de administración.",platformTitle:"Estado de la plataforma",billingTitle:"Ventas y suscripciones",salesTitle:"Ventas registradas",salesHint:"Los Hosted Buttons actuales no confirman automáticamente una venta en Supabase. Aquí puedes registrar una venta confirmada; luego conectaremos el webhook de PayPal.",date:"Fecha",account:"Cuenta",plan:"Plan",amount:"Importe",status:"Estado",registerSale:"Registrar venta",customerEmail:"Correo del cliente",notes:"Notas",activatePlan:"Activar/renovar el plan al confirmar",saveSale:"Guardar venta",usersTitle:"Usuarios y planes",user:"Usuario",projects:"Proyectos",lastAccess:"Último acceso",apisTitle:"APIs publicadas",owner:"Propietario",type:"Tipo",requestsMonth:"Requests mes",monthlyLimit:"Límite mensual",publicRead:"Lectura pública",enabled:"Activa",requestsTitle:"Peticiones recientes",auditTitle:"Cambios registrados",action:"Acción",actor:"Actor",webhooksTitle:"Configurados",deliveriesTitle:"Entregas recientes" },
    en: { navOverview:"Overview",navSales:"Sales",navUsers:"Users",navApis:"APIs",navActivity:"Activity",navWebhooks:"Webhooks",language:"Language",signOut:"Sign out",loginTitle:"LittleAPI Admin",loginText:"This console is reserved for authorized administrator accounts.",loginGoogle:"Continue with Google",deniedTitle:"Access denied",deniedText:"The session is valid, but this account does not have administrator access.",platformTitle:"Platform status",billingTitle:"Sales and subscriptions",salesTitle:"Recorded sales",salesHint:"The current Hosted Buttons do not automatically confirm a sale in Supabase. You can record confirmed sales here; PayPal webhook automation can be connected later.",date:"Date",account:"Account",plan:"Plan",amount:"Amount",status:"Status",registerSale:"Record sale",customerEmail:"Customer email",notes:"Notes",activatePlan:"Activate/renew plan when confirmed",saveSale:"Save sale",usersTitle:"Users and plans",user:"User",projects:"Projects",lastAccess:"Last access",apisTitle:"Published APIs",owner:"Owner",type:"Type",requestsMonth:"Requests this month",monthlyLimit:"Monthly limit",publicRead:"Public read",enabled:"Enabled",requestsTitle:"Recent requests",auditTitle:"Audit trail",action:"Action",actor:"Actor",webhooksTitle:"Configured",deliveriesTitle:"Recent deliveries" }
  };
  let lang = localStorage.getItem("littleapi:language") === "en" ? "en" : "es";
  function t(key, fallback = key) { return i18n[lang]?.[key] || fallback; }
  function applyLanguage() { document.documentElement.lang = lang; $("#language-select").value = lang; $$('[data-i18n]').forEach(n => { const key = n.dataset.i18n; if (i18n[lang]?.[key]) n.textContent = i18n[lang][key]; }); updateViewHeader(); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function number(v) { return Number(v || 0).toLocaleString(lang === "en" ? "en-US" : "es-EC"); }
  function money(v) { return new Intl.NumberFormat(lang === "en" ? "en-US" : "es-EC", { style:"currency", currency:"USD" }).format(Number(v || 0)); }
  function date(v) { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(lang === "en" ? "en-US" : "es-EC", { dateStyle:"medium", timeStyle:"short" }); }
  function badge(value, kind = "") { return `<span class="badge ${kind}">${esc(value)}</span>`; }
  function statusKind(status) { const s = String(status || "").toLowerCase(); return ["completed","active","200","201","204","true"].includes(s) ? "ok" : ["pending","past_due","429"].includes(s) ? "warn" : ["failed","canceled","refunded","403","401","500","false"].includes(s) ? "danger" : ""; }
  function setStatus(selector, text, kind = "") { const n = $(selector); if (!n) return; n.textContent = text || ""; n.className = n.className.replace(/\s(error|success)$/g, "") + (kind ? ` ${kind}` : ""); }

  async function session() { const { data } = await sb.auth.getSession(); return data.session; }
  async function call(path = "", options = {}) {
    const current = await session();
    if (!current?.access_token) throw Object.assign(new Error("session_required"), { code:"session_required" });
    const headers = new Headers(options.headers || {});
    headers.set("apikey", cfg.publishableKey);
    headers.set("Authorization", "Bearer " + current.access_token);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(base + (path ? "/" + path.replace(/^\//, "") : ""), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${response.status}`), { code:data.error || "request_failed", status:response.status, data });
    return data;
  }

  async function signIn() {
    setStatus("#login-status", lang === "en" ? "Opening Google…" : "Abriendo Google…");
    await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: location.origin + location.pathname } });
  }
  async function signOut() { await sb.auth.signOut(); location.reload(); }

  function showLogin() { $("#login-panel").classList.remove("hidden"); $("#denied-panel").classList.add("hidden"); $("#admin-app").classList.add("hidden"); $("#admin-nav").classList.add("hidden"); $("#sign-out").classList.add("hidden"); }
  function showDenied() { $("#login-panel").classList.add("hidden"); $("#denied-panel").classList.remove("hidden"); $("#admin-app").classList.add("hidden"); $("#admin-nav").classList.add("hidden"); $("#sign-out").classList.remove("hidden"); }
  function showApp() { $("#login-panel").classList.add("hidden"); $("#denied-panel").classList.add("hidden"); $("#admin-app").classList.remove("hidden"); $("#admin-nav").classList.remove("hidden"); $("#sign-out").classList.remove("hidden"); $("#admin-identity").textContent = `${state.me.user.email || "Admin"} · ${state.me.role}`; }

  const viewText = {
    overview:{es:["CONTROL CENTER","Resumen","Estado general de LittleAPI."],en:["CONTROL CENTER","Overview","LittleAPI platform at a glance."]},
    sales:{es:["BILLING","Ventas","Pagos confirmados y renovaciones."],en:["BILLING","Sales","Confirmed payments and renewals."]},
    users:{es:["ACCOUNTS","Usuarios","Planes, actividad y capacidad por cuenta."],en:["ACCOUNTS","Users","Plans, activity and capacity by account."]},
    apis:{es:["ENDPOINTS","APIs","Control de endpoints, límites y acceso público."],en:["ENDPOINTS","APIs","Endpoint status, quotas and public access."]},
    activity:{es:["OBSERVABILITY","Actividad","Requests y cambios importantes de la plataforma."],en:["OBSERVABILITY","Activity","Requests and important platform changes."]},
    webhooks:{es:["EVENTS","Webhooks","Estado de webhooks y entregas recientes."],en:["EVENTS","Webhooks","Webhook configuration and recent deliveries."]}
  };
  function updateViewHeader() { const row = viewText[state.view]?.[lang] || viewText.overview[lang]; if (!row || !$("#view-title")) return; $("#view-eyebrow").textContent = row[0]; $("#view-title").textContent = row[1]; $("#view-subtitle").textContent = row[2]; }
  async function setView(view) { state.view = view; $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view)); $$('[data-view-panel]').forEach(p => p.classList.toggle("hidden", p.dataset.viewPanel !== view)); updateViewHeader(); await loadView(view); }

  function renderSummary() {
    const s = state.summary || {};
    const metrics = [
      [lang === "en" ? "Users" : "Usuarios", number(s.users), `${number(s.active_paid_accounts)} ${lang === "en" ? "paid" : "de pago"}`],
      ["APIs", number(s.apis), `${number(s.sheet_apis)} Sheets · ${number(s.drive_apis)} Drive`],
      [lang === "en" ? "Requests this month" : "Requests este mes", number(s.requests_this_month), "UTC"],
      [lang === "en" ? "Revenue this month" : "Ingresos este mes", money(s.revenue_usd_this_month), `${number(s.sales_this_month)} ${lang === "en" ? "sales" : "ventas"}`],
      [lang === "en" ? "Lifetime revenue" : "Ingresos acumulados", money(s.revenue_usd_total), `${number(s.sales_total)} ${lang === "en" ? "confirmed" : "confirmadas"}`],
      [lang === "en" ? "Projects" : "Proyectos", number(s.projects), "Google"],
      [lang === "en" ? "Errors 24h" : "Errores 24 h", number(s.errors_24h), s.errors_24h ? "review" : "OK"],
      ["Webhooks", number(s.enabled_webhooks), `${number(s.webhook_failures)} ${lang === "en" ? "failed deliveries" : "entregas fallidas"}`]
    ];
    $("#summary-cards").innerHTML = metrics.map(([label,value,sub]) => `<article class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`).join("");
    $("#platform-status").innerHTML = [
      ["LittleAPI API", badge("ONLINE","ok")],
      [lang === "en" ? "Active endpoints" : "Endpoints activos", `<strong>${number(s.apis)}</strong>`],
      [lang === "en" ? "Errors in last 24h" : "Errores últimas 24 h", badge(number(s.errors_24h), s.errors_24h ? "warn" : "ok")],
      [lang === "en" ? "Webhook failures" : "Fallos de webhook", badge(number(s.webhook_failures), s.webhook_failures ? "warn" : "ok")]
    ].map(([a,b]) => `<div class="status-row"><span>${a}</span>${b}</div>`).join("");
    $("#billing-summary").innerHTML = [
      [lang === "en" ? "Paid accounts" : "Cuentas de pago", `<strong>${number(s.active_paid_accounts)}</strong>`],
      [lang === "en" ? "Sales this month" : "Ventas este mes", `<strong>${number(s.sales_this_month)}</strong>`],
      [lang === "en" ? "Revenue this month" : "Ingresos este mes", `<strong>${money(s.revenue_usd_this_month)}</strong>`],
      [lang === "en" ? "Lifetime revenue" : "Ingresos acumulados", `<strong>${money(s.revenue_usd_total)}</strong>`]
    ].map(([a,b]) => `<div class="status-row"><span>${a}</span>${b}</div>`).join("");
  }

  function renderSales() { $("#sales-table").innerHTML = state.sales.map(s => `<tr><td>${date(s.paid_at || s.created_at)}</td><td>${esc(s.account_email || s.customer_email || "—")}</td><td>${badge(s.plan)}</td><td>${money(s.amount)}</td><td>${badge(s.status,statusKind(s.status))}</td><td><code>${esc(s.provider_payment_id || "—")}</code></td></tr>`).join("") || `<tr><td colspan="6">${lang === "en" ? "No sales recorded yet." : "Aún no hay ventas registradas."}</td></tr>`; }
  function renderUsers() {
    const q = String($("#user-search").value || "").toLowerCase();
    const rows = state.users.filter(u => !q || `${u.email} ${u.name}`.toLowerCase().includes(q));
    $("#users-table").innerHTML = rows.map(u => `<tr data-user="${esc(u.id)}"><td><strong>${esc(u.name || "—")}</strong><br><small>${esc(u.email || "")}</small></td><td><select class="user-plan"><option value="free" ${u.plan==='free'?'selected':''}>Free</option><option value="inicial" ${u.plan==='inicial'?'selected':''}>Inicial</option><option value="pro" ${u.plan==='pro'?'selected':''}>Pro</option><option value="business" ${u.plan==='business'?'selected':''}>Business</option><option value="unlimited" ${u.plan==='unlimited'?'selected':''}>Unlimited</option></select></td><td>${badge(u.subscription_status,statusKind(u.subscription_status))}</td><td>${number(u.api_count)}</td><td>${number(u.project_count)}</td><td>${date(u.last_sign_in_at)}</td><td><button class="save-user-plan">${lang === "en" ? "Save" : "Guardar"}</button></td></tr>`).join("");
  }
  function renderApis() { $("#apis-table").innerHTML = state.apis.map(a => `<tr data-api="${esc(a.api_id)}"><td><strong>${esc(a.name)}</strong><br><code>${esc(a.api_id)}</code></td><td>${esc(a.owner_email || "—")}</td><td>${badge(a.resource_type)}</td><td>${number(a.requests_this_month)}</td><td><input class="api-limit" type="number" value="${Number(a.monthly_request_limit || 0)}"></td><td><select class="api-public"><option value="true" ${a.public_read?'selected':''}>Yes</option><option value="false" ${!a.public_read?'selected':''}>No</option></select></td><td><select class="api-enabled"><option value="true" ${a.enabled?'selected':''}>Yes</option><option value="false" ${!a.enabled?'selected':''}>No</option></select></td><td><button class="save-api">${lang === "en" ? "Save" : "Guardar"}</button></td></tr>`).join(""); }
  function renderActivity() { $("#logs-table").innerHTML = state.logs.map(l => `<tr><td>${date(l.created_at)}</td><td><code>${esc(l.api_id)}</code></td><td>${esc(l.method)}</td><td>${badge(l.status,statusKind(l.status))}</td><td>${number(l.duration_ms)}</td><td><code>${esc(l.client_ip || "—")}</code></td></tr>`).join(""); $("#audit-table").innerHTML = state.audit.map(a => `<tr><td>${date(a.created_at)}</td><td><code>${esc(a.api_id)}</code></td><td>${esc(a.action)}</td><td>${esc(a.actor_type)}</td></tr>`).join(""); }
  function renderWebhooks() { $("#webhooks-table").innerHTML = state.webhooks.map(w => `<tr><td><code>${esc(w.api_id)}</code></td><td>${esc(w.url)}</td><td>${esc((w.events || []).join(", "))}</td><td>${badge(w.enabled ? "enabled" : "disabled",w.enabled?"ok":"")}</td><td>${number(w.failure_count)}</td></tr>`).join("") || `<tr><td colspan="5">—</td></tr>`; $("#deliveries-table").innerHTML = state.deliveries.map(d => `<tr><td>${date(d.delivered_at || d.created_at)}</td><td><code>${esc(d.api_id)}</code></td><td>${esc(d.event)}</td><td>${esc(d.status_code || "—")}</td><td>${badge(d.success ? "success" : "failed",d.success?"ok":"danger")}</td></tr>`).join("") || `<tr><td colspan="5">—</td></tr>`; }

  async function loadView(view) {
    setStatus("#global-status", lang === "en" ? "Loading…" : "Cargando…");
    try {
      if (view === "overview") { state.summary = await call("summary"); renderSummary(); }
      if (view === "sales") { state.sales = (await call("sales")).sales || []; renderSales(); }
      if (view === "users") { state.users = (await call("users")).users || []; renderUsers(); }
      if (view === "apis") { state.apis = (await call("apis")).apis || []; renderApis(); }
      if (view === "activity") { const [logs,audit] = await Promise.all([call("logs"),call("audit")]); state.logs = logs.logs || []; state.audit = audit.audit || []; renderActivity(); }
      if (view === "webhooks") { const data = await call("webhooks"); state.webhooks = data.webhooks || []; state.deliveries = data.deliveries || []; renderWebhooks(); }
      setStatus("#global-status", lang === "en" ? "Updated." : "Actualizado.", "success");
    } catch (error) { setStatus("#global-status", error.message || String(error), "error"); }
  }

  async function saveUserPlan(row) { const userId = row.dataset.user, plan = $(".user-plan", row).value; try { await call(`users/${encodeURIComponent(userId)}/plan`, { method:"PATCH", body:JSON.stringify({ plan, status:"active", source:"admin" }) }); setStatus("#global-status", lang === "en" ? "Plan updated." : "Plan actualizado.", "success"); await loadView("users"); } catch (e) { setStatus("#global-status", e.message, "error"); } }
  async function saveApi(row) { const apiId = row.dataset.api; try { await call(`apis/${encodeURIComponent(apiId)}`, { method:"PATCH", body:JSON.stringify({ monthly_request_limit:Number($(".api-limit",row).value), public_read:$(".api-public",row).value === "true", enabled:$(".api-enabled",row).value === "true" }) }); setStatus("#global-status", lang === "en" ? "API updated." : "API actualizada.", "success"); await loadView("apis"); } catch (e) { setStatus("#global-status", e.message, "error"); } }
  async function saveSale(event) { event.preventDefault(); const body = { customer_email:$("#sale-email").value.trim(), plan:$("#sale-plan").value, amount:Number($("#sale-amount").value), status:$("#sale-status").value, provider:"paypal", provider_payment_id:$("#sale-payment-id").value.trim(), notes:$("#sale-notes").value.trim(), activate_plan:$("#sale-activate").checked }; setStatus("#sale-status-message", lang === "en" ? "Saving…" : "Guardando…"); try { const result = await call("sales", { method:"POST", body:JSON.stringify(body) }); setStatus("#sale-status-message", result.activation ? (lang === "en" ? "Sale saved and plan activated." : "Venta guardada y plan activado.") : (lang === "en" ? "Sale saved." : "Venta guardada."), "success"); $("#sale-form").reset(); $("#sale-plan").value = "inicial"; $("#sale-amount").value = "3"; $("#sale-activate").checked = true; await loadView("sales"); } catch (e) { setStatus("#sale-status-message", e.message, "error"); } }

  async function init() {
    applyLanguage();
    if (!cfg.url || !cfg.publishableKey || !sb) return setStatus("#login-status", "Supabase configuration missing.", "error");
    const current = await session();
    if (!current) return showLogin();
    try { state.me = await call("me"); showApp(); await setView("overview"); }
    catch (error) { if (error.code === "admin_required" || error.status === 403) showDenied(); else { showLogin(); setStatus("#login-status", error.message, "error"); } }
  }

  $("#login-google").addEventListener("click", signIn);
  $("#sign-out").addEventListener("click", signOut);
  $("#denied-sign-out").addEventListener("click", signOut);
  $("#language-select").addEventListener("change", e => { lang = e.target.value === "en" ? "en" : "es"; localStorage.setItem("littleapi:language", lang); applyLanguage(); if (!$("#admin-app").classList.contains("hidden")) loadView(state.view); });
  $("#admin-nav").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
  $("#refresh-view").addEventListener("click", () => loadView(state.view));
  $("#sale-plan").addEventListener("change", e => { $("#sale-amount").value = String(priceByPlan[e.target.value] || 0); });
  $("#sale-form").addEventListener("submit", saveSale);
  $("#user-search").addEventListener("input", renderUsers);
  $("#users-table").addEventListener("click", e => { const b = e.target.closest(".save-user-plan"); if (b) saveUserPlan(b.closest("tr")); });
  $("#apis-table").addEventListener("click", e => { const b = e.target.closest(".save-api"); if (b) saveApi(b.closest("tr")); });
  sb.auth.onAuthStateChange((_event, next) => { if (!next) showLogin(); });
  init();
})();
