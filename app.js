const cfg = window.SUPABASE_CONFIG || {};
const $ = (selector, root) => (root || document).querySelector(selector);
const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
const authDialog = $("#auth-dialog");
const sheetDialog = $("#sheet-dialog");
const workspaceDialog = $("#workspace-dialog");
const driveDialog = $("#drive-dialog");
const apiDialog = $("#api-dialog");
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const GOOGLE_SCOPES = SHEETS_SCOPE + " " + DRIVE_SCOPE;
const ready = () => Boolean(cfg.url && cfg.publishableKey && cfg.googleClientId && !cfg.url.includes("TU-"));
const apiBase = () => cfg.apiBase || String(cfg.url || "").replace(/\/$/, "") + "/functions/v1/sheetpilot-api";
let sb = null, user = null, token = null, tokenExpiresAt = 0, activeProject = null, activeSheet = null, activeSpreadsheet = null, loadedValues = [], loadedRange = "A1:Z200", driveParent = "root", driveParentName = "Mi Drive", projectsCache = [], apisCache = [];

function esc(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function message(selector, text, kind) {
  const node = $(selector);
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("success", kind === "success");
  node.classList.toggle("error", kind === "error");
}
function notice(text, kind) {
  const node = $("#setup-notice");
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("hidden", !text);
  node.classList.toggle("error", kind === "error");
  node.classList.toggle("success", kind === "success");
}
function friendlyError(error) {
  const text = String(error && (error.message || error.error_description) || error || "Ha ocurrido un error.");
  if (text.includes("permission denied for table projects") || text.includes("42501")) return "Supabase aún no permite acceder a proyectos. Ejecuta supabase-schema.sql en el SQL Editor y vuelve a cargar.";
  if (text.includes("insufficientPermissions") || text.includes("Insufficient Permission")) return "Google no concedió permisos suficientes. Cierra sesión, vuelve a entrar y acepta el acceso a Sheets y Drive.";
  if (text.includes("access_denied")) return "Google bloqueó el acceso. Comprueba que tu cuenta esté en Audience > Test users del proyecto SheetPilot.";
  return text;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function google() {
  if (token && Date.now() < tokenExpiresAt - 60000) return token;
  for (let i = 0; i < 50 && !window.google?.accounts?.oauth2; i++) await wait(100);
  if (!window.google?.accounts?.oauth2) throw new Error("Google está cargando; vuelve a intentarlo.");
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.googleClientId, scope: GOOGLE_SCOPES,
      callback: response => {
        if (response.error) return reject(new Error(response.error_description || response.error));
        token = response.access_token;
        tokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
        resolve(token);
      }
    });
    client.requestAccessToken({ prompt: token ? "" : "consent" });
  });
}
async function gf(url, options, retry) {
  const opts = Object.assign({}, options || {});
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", "Bearer " + await google());
  if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  opts.headers = headers;
  const response = await fetch(url, opts);
  if (response.status === 401 && retry !== false) { token = null; tokenExpiresAt = 0; return gf(url, options, false); }
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data && data.error && (data.error.message || data.error.status) || data || ("Error HTTP " + response.status));
  return data;
}
function sheetRef(range) {
  if (String(range).includes("!")) return String(range);
  return "'" + String(activeSheet || "").replace(/'/g, "''") + "'!" + String(range || "A1:Z200");
}
const valuesUrl = (id, range) => "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(range);
const getValues = range => gf(valuesUrl(activeProject.spreadsheet_id, sheetRef(range)) + "?majorDimension=ROWS");
function columnNumber(column) { let result = 0; for (const letter of String(column || "").toUpperCase()) result = result * 26 + letter.charCodeAt(0) - 64; return result; }
function columnName(number) { let result = "", n = Math.max(1, Number(number) || 1); while (n > 0) { const rest = (n - 1) % 26; result = String.fromCharCode(65 + rest) + result; n = Math.floor((n - 1) / 26); } return result; }
function parseCell(cell) { const match = String(cell || "").trim().toUpperCase().match(/^([A-Z]+)(\d+)$/); return match ? { column: columnNumber(match[1]) - 1, row: Number(match[2]) - 1 } : null; }
function parseGridRange(range) {
  let clean = String(range || "").trim();
  if (clean.includes("!")) clean = clean.split("!").pop();
  const parts = clean.split(":");
  const first = parseCell(parts[0]) || { column: 0, row: 0 };
  const last = parseCell(parts[1] || parts[0]) || first;
  return { startRowIndex: first.row, endRowIndex: last.row + 1, startColumnIndex: first.column, endColumnIndex: last.column + 1 };
}
function parseRows(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Escribe al menos un valor.");
  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length && Array.isArray(parsed[0])) return parsed;
    return [Array.isArray(parsed) ? parsed : [parsed]];
  }
  return raw.split(/\r?\n/).map(line => {
    const result = []; let current = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { current += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { result.push(current.trim()); current = ""; }
      else current += char;
    }
    result.push(current.trim()); return result;
  });
}
function csvText(rows) {
  return rows.map(row => row.map(value => { const text = String(value == null ? "" : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }).join(",")).join("\r\n");
}
function downloadBlob(blob, filename) {
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function setHeaderOptions() {
  const headers = loadedValues[0] || [];
  ["#search-column", "#stats-column"].forEach(selector => {
    const select = $(selector); if (!select) return;
    const first = selector === "#search-column" ? '<option value="">Todas</option>' : "";
    select.innerHTML = first + headers.map((header, index) => '<option value="' + index + '">' + esc(header || columnName(index + 1)) + "</option>").join("");
  });
}
function renderTable(rows, target) {
  const node = $(target); if (!node) return;
  if (!rows || !rows.length) { node.innerHTML = '<p class="muted">No hay resultados para mostrar.</p>'; return; }
  const headers = rows[0] || [], body = rows.slice(1, 201);
  node.innerHTML = '<table><thead><tr><th>#</th>' + headers.map((header, i) => "<th>" + esc(header || columnName(i + 1)) + "</th>").join("") + "</tr></thead><tbody>" + body.map((row, i) => "<tr><th>" + (i + 2) + "</th>" + headers.map((_, j) => "<td>" + esc(row && row[j] != null ? row[j] : "") + "</td>").join("") + "</tr>").join("") + "</tbody></table>" + (rows.length > 201 ? '<p class="muted">Mostrando las primeras 200 filas.</p>' : "");
}
function renderObjectTable(rows, target) {
  const node = $(target); if (!node) return;
  if (!rows || !rows.length) { node.innerHTML = '<p class="muted">La consulta no devolvió filas.</p>'; return; }
  const headers = Object.keys(rows[0]);
  node.innerHTML = '<table><thead><tr>' + headers.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" + rows.slice(0, 200).map(row => "<tr>" + headers.map(h => "<td>" + esc(row[h]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
}
async function loadValues() {
  if (!activeProject || !activeSheet) return;
  loadedRange = $("#data-range")?.value.trim() || "A1:Z200";
  message("#workspace-message", "Cargando datos…");
  try { const data = await getValues(loadedRange); loadedValues = data.values || []; setHeaderOptions(); renderTable(loadedValues, "#data-table"); message("#workspace-message", loadedValues.length ? loadedValues.length - 1 + " filas cargadas." : "La hoja no tiene datos.", "success"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
function switchTab(tab) { $$(".tab-button").forEach(button => button.classList.toggle("active", button.dataset.tab === tab)); $$("[data-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.panel !== tab)); if (tab === "stats") setHeaderOptions(); }
async function loadProjectSheets() {
  const data = await gf("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(activeProject.spreadsheet_id) + "?includeGridData=false&fields=spreadsheetId,properties,sheets.properties");
  activeSpreadsheet = data;
  const sheets = (data.sheets || []).map(item => item.properties);
  const select = $("#sheet-select");
  select.innerHTML = sheets.map(sheet => '<option value="' + esc(sheet.title) + '">' + esc(sheet.title) + "</option>").join("");
  activeSheet = sheets.some(sheet => sheet.title === activeProject.sheet_name) ? activeProject.sheet_name : sheets[0]?.title;
  if (activeSheet) select.value = activeSheet;
  $("#rename-sheet-name").value = activeSheet || "";
  const current = sheets.find(sheet => sheet.title === activeSheet) || {};
  $("#sheet-link").href = "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(activeProject.spreadsheet_id) + "/edit#gid=" + (current.sheetId || 0);
  $("#workspace-title").textContent = activeProject.name;
  $("#copy-destination").innerHTML = projectsCache.filter(project => project.id !== activeProject.id).map(project => '<option value="' + project.id + '">' + esc(project.name) + "</option>").join("");
}
async function saveActiveSheet() {
  if (!activeProject || !activeSheet) return;
  const result = await sb.from("projects").update({ sheet_name: activeSheet, updated_at: new Date().toISOString() }).eq("id", activeProject.id).eq("user_id", user.id);
  if (result.error) throw result.error;
  activeProject.sheet_name = activeSheet;
  const api = apiForProject(activeProject);
  if (api) {
    const endpoint = await sb.from("api_endpoints").update({ default_sheet: activeSheet, updated_at: new Date().toISOString() }).eq("id", api.id).eq("user_id", user.id);
    if (endpoint.error) throw endpoint.error;
    const catalog = await sb.from("api_public_catalog").update({ default_sheet: activeSheet }).eq("api_id", api.api_id).eq("user_id", user.id);
    if (catalog.error) throw catalog.error;
    api.default_sheet = activeSheet;
  }
}
async function openProject(project, tab) {
  activeProject = project; $("#workspace-title").textContent = project.name; if (!workspaceDialog.open) workspaceDialog.showModal();
  try { await loadProjectSheets(); switchTab(tab || "data"); await loadValues(); } catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
function randomToken(bytes) {
  const data = new Uint8Array(bytes); crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function hashSecret(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function apiForProject(project) { return apisCache.find(api => api.project_id === project.id && api.enabled !== false); }
function apiUrl(api) { return apiBase() + "/" + encodeURIComponent(api.api_id); }
function showApiDialog(project, api, secret) {
  if (!apiDialog || !api) return;
  $("#api-dialog-title").textContent = api.name || project.name;
  $("#api-endpoint").value = apiUrl(api);
  $("#api-key-value").textContent = secret || "";
  $("#api-key-value").classList.toggle("hidden", !secret);
  $("#api-secret-note").textContent = secret ? "Guárdala ahora: no se vuelve a mostrar. Se usará para operaciones protegidas cuando habilitemos escritura del servidor." : "Las lecturas públicas no necesitan clave. Si la perdiste, elimina esta API y crea otra.";
  $("#api-example").textContent = "fetch(" + JSON.stringify(apiUrl(api)) + ")\n  .then(response => response.json())\n  .then(rows => console.log(rows));";
  apiDialog.showModal();
}
async function createApi(project) {
  const existing = apiForProject(project);
  if (existing) return showApiDialog(project, existing);
  const name = prompt("Nombre de la API:", project.name);
  if (name === null) return;
  const apiId = randomToken(15), secret = "sp_live_" + randomToken(24), keyHash = await hashSecret(secret);
  try {
    const result = await sb.from("api_endpoints").insert({ user_id: user.id, project_id: project.id, api_id: apiId, name: name.trim() || project.name, resource_type: "sheet", spreadsheet_id: project.spreadsheet_id, default_sheet: project.sheet_name, api_key_hash: keyHash, api_key_prefix: secret.slice(0, 16), public_read: true, permissions: { read: true, search: true, create: false, update: false, delete: false } }).select().single();
    if (result.error) throw result.error;
    const catalog = await sb.from("api_public_catalog").insert({ api_id: apiId, user_id: user.id, name: result.data.name, resource_type: "sheet", spreadsheet_id: project.spreadsheet_id, default_sheet: project.sheet_name, public_read: true, permissions: { read: true, search: true }, enabled: true });
    if (catalog.error) { await sb.from("api_endpoints").delete().eq("id", result.data.id).eq("user_id", user.id); throw catalog.error; }
    apisCache.push(result.data); renderProjects(projectsCache); showApiDialog(project, result.data, secret); notice("API creada. Comparte la URL con tu aplicación.", "success");
  } catch (error) { notice(friendlyError(error), "error"); }
}
async function removeApi(project) {
  const api = apiForProject(project); if (!api || !confirm("¿Eliminar la API de " + project.name + "? La hoja no se eliminará.")) return;
  const result = await sb.from("api_endpoints").delete().eq("id", api.id).eq("user_id", user.id);
  if (result.error) return notice(friendlyError(result.error), "error");
  apisCache = apisCache.filter(item => item.id !== api.id); renderProjects(projectsCache); notice("API eliminada. La hoja original sigue en tu Drive.", "success");
}
async function copyApiUrl() {
  const input = $("#api-endpoint"); input.select();
  try { await navigator.clipboard.writeText(input.value); message("#api-message", "URL copiada.", "success"); }
  catch (_) { document.execCommand("copy"); message("#api-message", "URL copiada.", "success"); }
}
function renderProjects(data) {
  projectsCache = data || [];
  $("#project-empty").classList.toggle("hidden", projectsCache.length > 0);
  const grid = $("#projects-grid"); grid.classList.toggle("hidden", projectsCache.length === 0);
  grid.innerHTML = projectsCache.map(project => { const api = apiForProject(project); return '<article class="project-card"><p>GOOGLE SHEETS</p><h3>' + esc(project.name) + '</h3><p class="project-meta">' + esc(project.sheet_name || "Sin pestaña seleccionada") + '</p><div class="project-api">' + (api ? '<span class="api-status">● API activa</span><code>' + esc(apiUrl(api)) + '</code>' : '<span class="api-status muted">○ Sin API publicada</span>') + '</div><div class="project-actions"><button class="action-button" data-open-project="' + project.id + '">Abrir espacio</button><button class="action-button" data-api-project="' + project.id + '">' + (api ? "Ver endpoint" : "Crear API") + '</button>' + (api ? '<button class="text-button" data-remove-api="' + project.id + '">Eliminar API</button>' : '') + '<button class="action-button" data-format-project="' + project.id + '">Formatear</button><button class="text-button" data-remove-project="' + project.id + '">Quitar</button></div></article>'; }).join("");
}
async function projects() {
  if (!sb || !user) return;
  const [projectResult, apiResult] = await Promise.all([sb.from("projects").select("*").order("created_at", { ascending: false }), sb.from("api_endpoints").select("*").order("created_at", { ascending: false })]);
  if (projectResult.error) { notice(friendlyError(projectResult.error), "error"); return; }
  if (apiResult.error && !["42P01", "PGRST205"].includes(apiResult.error.code)) { notice(friendlyError(apiResult.error), "error"); return; }
  apisCache = apiResult.data || [];
  renderProjects(projectResult.data || []);
}
async function startLogin() {
  if (!ready() || !sb) { notice("La conexión todavía no está lista.", "error"); return; }
  const result = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, scopes: GOOGLE_SCOPES, queryParams: { access_type: "offline", prompt: "consent" } } });
  if (result.error) notice(friendlyError(result.error), "error");
}
async function signOut() {
  token = null; tokenExpiresAt = 0; if (sb) await sb.auth.signOut();
  user = null; $("#public-home").classList.remove("hidden"); $("#dashboard").classList.add("hidden");
  $("#header-actions").innerHTML = '<button class="button small" data-open-auth="google">Continuar con Google</button>'; bindAuthButtons();
}
function dashboard(account) {
  if (!account) return; user = account; $("#public-home").classList.add("hidden"); $("#dashboard").classList.remove("hidden");
  const display = account.user_metadata?.full_name || account.user_metadata?.name || account.email?.split("@")[0] || "usuario";
  $("#user-name").textContent = display; $("#header-actions").innerHTML = '<span class="account-chip">' + esc(account.email || "") + '</span><button class="text-button" id="header-sign-out">Salir</button>'; $("#header-sign-out").onclick = signOut; projects();
}
async function listSheetsForProject() {
  const button = $("#authorize-google"); button.disabled = true; message("#sheet-message", "Buscando tus hojas…");
  try {
    const params = new URLSearchParams({ q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false", fields: "files(id,name,modifiedTime,webViewLink)", orderBy: "modifiedTime desc", pageSize: "100" });
    const data = await gf("https://www.googleapis.com/drive/v3/files?" + params.toString()), list = $("#sheets-list");
    list.innerHTML = (data.files || []).map(file => '<button class="sheet-option" data-sheet-id="' + file.id + '" data-sheet-name="' + esc(file.name) + '">▦ ' + esc(file.name) + "</button>").join("");
    $$(".sheet-option", list).forEach(option => option.onclick = () => createProjectFromSheet(option.dataset.sheetId, option.dataset.sheetName));
    button.classList.add("hidden"); message("#sheet-message", data.files?.length ? "Elige una hoja para conectarla." : "No encontramos hojas en tu Drive.", "success");
  } catch (error) { message("#sheet-message", friendlyError(error), "error"); button.disabled = false; }
}
async function createProjectFromSheet(spreadsheetId, name) {
  try {
    const data = await gf("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) + "?includeGridData=false&fields=sheets.properties");
    const firstSheet = data.sheets?.[0]?.properties?.title || "Hoja 1";
    const result = await sb.from("projects").insert({ user_id: user.id, name: name, spreadsheet_id: spreadsheetId, sheet_name: firstSheet }).select().single();
    if (result.error) throw result.error;
    sheetDialog.close(); notice("Proyecto conectado. Ya puedes consultar, editar, formatear y exportar.", "success"); await projects();
  } catch (error) { message("#sheet-message", friendlyError(error), "error"); }
}
async function saveRange() {
  try { const values = parseRows($("#edit-values").value), range = sheetRef($("#edit-range").value); await gf(valuesUrl(activeProject.spreadsheet_id, range) + "?valueInputOption=USER_ENTERED", { method: "PUT", body: JSON.stringify({ range: range, majorDimension: "ROWS", values: values }) }); message("#workspace-message", "Rango actualizado.", "success"); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function insertRow() {
  try { const rows = parseRows($("#insert-values").value), range = sheetRef("A:ZZ"); await gf(valuesUrl(activeProject.spreadsheet_id, range) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=true", { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: rows }) }); message("#workspace-message", "Fila insertada.", "success"); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function saveCell() {
  try { const range = sheetRef($("#edit-cell").value), value = $("#edit-cell-value").value; await gf(valuesUrl(activeProject.spreadsheet_id, range) + "?valueInputOption=USER_ENTERED", { method: "PUT", body: JSON.stringify({ range: range, majorDimension: "ROWS", values: [[value]] }) }); message("#workspace-message", "Celda actualizada.", "success"); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function batchUpdate(requests) { return gf("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(activeProject.spreadsheet_id) + ":batchUpdate", { method: "POST", body: JSON.stringify({ requests: requests }) }); }
async function deleteRows() {
  const start = Number($("#delete-start").value), end = Number($("#delete-end").value);
  if (!start || !end || end < start) return message("#workspace-message", "Indica un intervalo de filas válido.", "error");
  if (!confirm("¿Eliminar las filas " + start + " a " + end + "?")) return;
  try { const sheet = activeSpreadsheet.sheets.map(item => item.properties).find(item => item.title === activeSheet); await batchUpdate([{ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: "ROWS", startIndex: start - 1, endIndex: end } } }]); message("#workspace-message", "Filas eliminadas.", "success"); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function clearValues() {
  try { await gf(valuesUrl(activeProject.spreadsheet_id, sheetRef($("#clear-range").value)) + ":clear", { method: "POST", body: JSON.stringify({}) }); message("#workspace-message", "Rango vaciado.", "success"); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function addSheet() {
  const title = $("#new-sheet-name").value.trim(); if (!title) return message("#workspace-message", "Escribe el nombre de la nueva pestaña.", "error");
  try { await batchUpdate([{ addSheet: { properties: { title: title } } }]); message("#workspace-message", "Pestaña creada.", "success"); await loadProjectSheets(); $("#sheet-select").value = title; activeSheet = title; await saveActiveSheet(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function renameSheet() {
  const title = $("#rename-sheet-name").value.trim(); if (!title || !activeSheet) return;
  try { const sheet = activeSpreadsheet.sheets.map(item => item.properties).find(item => item.title === activeSheet); await batchUpdate([{ updateSheetProperties: { properties: { sheetId: sheet.sheetId, title: title }, fields: "title" } }]); activeSheet = title; await saveActiveSheet(); message("#workspace-message", "Pestaña renombrada.", "success"); await loadProjectSheets(); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function deleteSheet() {
  const sheets = activeSpreadsheet.sheets.map(item => item.properties); if (sheets.length < 2) return message("#workspace-message", "Google Sheets necesita conservar al menos una pestaña.", "error"); if (!confirm("¿Eliminar la pestaña " + activeSheet + "?")) return;
  try { const sheet = sheets.find(item => item.title === activeSheet); await batchUpdate([{ deleteSheet: { sheetId: sheet.sheetId } }]); activeSheet = sheets.find(item => item.title !== activeSheet).title; await saveActiveSheet(); message("#workspace-message", "Pestaña eliminada.", "success"); await loadProjectSheets(); await loadValues(); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function clearFilters() {
  try { const sheet = activeSpreadsheet.sheets.map(item => item.properties).find(item => item.title === activeSheet); await batchUpdate([{ deleteBasicFilter: { sheetId: sheet.sheetId } }]); message("#workspace-message", "Filtros de la pestaña limpiados.", "success"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
function colorObject(hex) { const clean = String(hex || "#000000").replace("#", ""); return { red: parseInt(clean.slice(0, 2), 16) / 255, green: parseInt(clean.slice(2, 4), 16) / 255, blue: parseInt(clean.slice(4, 6), 16) / 255 }; }
async function applyFormat() {
  try { const sheet = activeSpreadsheet.sheets.map(item => item.properties).find(item => item.title === activeSheet), grid = parseGridRange($("#format-range").value); await batchUpdate([{ repeatCell: { range: Object.assign({ sheetId: sheet.sheetId }, grid), cell: { userEnteredFormat: { backgroundColor: colorObject($("#format-bg").value), textFormat: { foregroundColor: colorObject($("#format-fg").value), bold: $("#format-bold").checked, fontSize: Number($("#format-size").value) } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } }]); message("#workspace-message", "Formato aplicado.", "success"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function formatHeader() { $("#format-range").value = "A1:" + columnName(Math.max(1, (loadedValues[0] || []).length)) + "1"; $("#format-bg").value = "#087a70"; $("#format-fg").value = "#ffffff"; $("#format-bold").checked = true; await applyFormat(); }
async function resizeColumns() {
  try { const sheet = activeSpreadsheet.sheets.map(item => item.properties).find(item => item.title === activeSheet), columns = Math.max(1, (loadedValues[0] || []).length); await batchUpdate([{ autoResizeDimensions: { dimensions: { sheetId: sheet.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columns } } }]); message("#workspace-message", "Columnas ajustadas.", "success"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function copySheet() {
  const destination = projectsCache.find(project => project.id === $("#copy-destination").value); if (!destination) return message("#workspace-message", "Conecta otro proyecto para copiar esta pestaña.", "error");
  try { const sheet = activeSpreadsheet.sheets.map(item => item.properties).find(item => item.title === activeSheet); await gf("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(activeProject.spreadsheet_id) + "/sheets/" + sheet.sheetId + ":copyTo", { method: "POST", body: JSON.stringify({ destinationSpreadsheetId: destination.spreadsheet_id }) }); message("#workspace-message", "Pestaña copiada en " + destination.name + ".", "success"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function checkCapacity() {
  const sheets = activeSpreadsheet.sheets.map(item => item.properties); let cells = 0, rows = 0, columns = 0;
  try { for (const sheet of sheets) { const data = await gf(valuesUrl(activeProject.spreadsheet_id, "'" + sheet.title.replace(/'/g, "''") + "'!A:ZZ") + "?majorDimension=ROWS"), values = data.values || []; let width = 0; values.forEach(row => { width = Math.max(width, row.length); }); cells += values.length * width; rows += values.length; columns = Math.max(columns, width); } const limit = 10000000, used = cells / limit * 100, maxRows = columns ? Math.floor(limit / columns) - 1 : Math.floor(limit / 26) - 1; $("#capacity-result").textContent = cells.toLocaleString() + " celdas usadas (" + used.toFixed(2) + "%). Filas aproximadas disponibles: " + Math.max(0, maxRows - Math.max(0, rows - sheets.length)).toLocaleString() + "."; message("#workspace-message", "Capacidad calculada.", "success"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
function mapHeaders(query) {
  const headers = loadedValues[0] || []; let result = String(query || "");
  headers.forEach((header, index) => { const name = String(header || "").trim(); if (name) result = result.replace(new RegExp("\\b" + name.replace(/[.*+?^()|[\\]\\\\]/g, "\\\\$&") + "\\b", "g"), columnName(index + 1)); });
  return result;
}
function parseGviz(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("Respuesta de consulta no válida.");
  const table = JSON.parse(text.slice(start, end + 1)).table || {}, cols = table.cols || [];
  return (table.rows || []).map(row => { const values = row.c || [], object = {}; cols.forEach((column, index) => { const cell = values[index]; object[column.label || column.id || columnName(index + 1)] = cell && (cell.f ?? cell.v) != null ? (cell.f ?? cell.v) : ""; }); return object; });
}
async function runGviz(query, target) {
  try { const queryText = mapHeaders(query), url = "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(activeProject.spreadsheet_id) + "/gviz/tq?tqx=out:json&sheet=" + encodeURIComponent(activeSheet) + "&tq=" + encodeURIComponent(queryText), response = await fetch(url, { headers: { Authorization: "Bearer " + await google() } }); if (!response.ok) throw new Error("Google no pudo ejecutar la consulta."); const result = parseGviz(await response.text()); renderObjectTable(result, target); return result; }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); return []; }
}
const runQuery = () => runGviz($("#custom-query").value, "#query-result");
async function runAdvanced() { const condition = $("#advanced-where").value.trim(); if (!condition) return message("#workspace-message", "Escribe una condición.", "error"); await runGviz("SELECT * WHERE " + condition, "#query-result"); }
function numeric(value) { const normalized = String(value == null ? "" : value).replace(/\s/g, "").replace(",", "."); return normalized !== "" && !Number.isNaN(Number(normalized)) ? Number(normalized) : null; }
async function calculateStats() {
  if (!loadedValues.length) await loadValues();
  const index = Number($("#stats-column").value || 0), header = loadedValues[0]?.[index] || columnName(index + 1), rows = loadedValues.slice(1), values = rows.map(row => row[index]).filter(value => value != null && String(value) !== ""), numbers = values.map(numeric).filter(value => value != null), compare = $("#countif-value").value, countIf = compare === "" ? "—" : values.filter(value => String(value) === compare).length;
  $("#stats-result").innerHTML = '<div class="stat-card"><span>Columna</span><strong>' + esc(header) + '</strong></div><div class="stat-card"><span>Conteo</span><strong>' + values.length.toLocaleString() + '</strong></div><div class="stat-card"><span>Suma</span><strong>' + numbers.reduce((sum, value) => sum + value, 0).toLocaleString() + '</strong></div><div class="stat-card"><span>COUNTIF</span><strong>' + countIf + "</strong></div>";
}
async function downloadCsv() {
  try { const data = await getValues("A:ZZ"); downloadBlob(new Blob([csvText(data.values || [])], { type: "text/csv;charset=utf-8" }), (activeProject.name || "sheet") + ".csv"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
async function downloadExcel() {
  try { const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(activeProject.spreadsheet_id) + "/export?mimeType=" + encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), { headers: { Authorization: "Bearer " + await google() } }); if (!response.ok) throw new Error("No se pudo exportar el libro."); downloadBlob(await response.blob(), (activeProject.name || "sheet") + ".xlsx"); }
  catch (error) { message("#workspace-message", friendlyError(error), "error"); }
}
function driveQuery(search) { let query = "'" + driveParent.replace(/'/g, "\\'") + "' in parents and trashed = false"; if (search) query += " and name contains '" + search.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; return query; }
async function loadDrive() {
  const search = $("#drive-search").value.trim(); message("#drive-message", "Cargando Drive…");
  try { const params = new URLSearchParams({ q: driveQuery(search), fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents),nextPageToken", orderBy: "folder,name", pageSize: "100" }), data = await gf("https://www.googleapis.com/drive/v3/files?" + params.toString()); $("#drive-breadcrumb").textContent = driveParentName; $("#drive-list").innerHTML = (data.files || []).map(file => { const folder = file.mimeType === "application/vnd.google-apps.folder"; return '<div class="drive-item"><span class="drive-kind">' + (folder ? "▰" : "▤") + '</span><div class="drive-item-main"><strong>' + esc(file.name) + '</strong><small>' + (folder ? "Carpeta" : esc(file.mimeType || "Archivo")) + "</small></div><div class=\"drive-item-actions\">" + (folder ? '<button class=\"text-button\" data-drive-open=\"' + file.id + '\" data-drive-name=\"' + esc(file.name) + '\">Abrir</button>' : '<button class=\"text-button\" data-drive-download=\"' + file.id + '\" data-drive-name=\"' + esc(file.name) + '\">Descargar</button>') + '<button class=\"text-button\" data-drive-rename=\"' + file.id + '\" data-drive-name=\"' + esc(file.name) + '\">Renombrar</button><button class=\"danger-link\" data-drive-delete=\"' + file.id + '\">Eliminar</button></div></div>'; }).join("") || '<p class="muted">No hay archivos en esta carpeta.</p>'; message("#drive-message", (data.files || []).length + " elementos.", "success"); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
async function createFolder() {
  const name = prompt("Nombre de la carpeta:"); if (!name) return;
  try { await gf("https://www.googleapis.com/drive/v3/files", { method: "POST", body: JSON.stringify({ name: name, mimeType: "application/vnd.google-apps.folder", parents: [driveParent] }) }); await loadDrive(); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
async function renameDrive(id, oldName) {
  const name = prompt("Nuevo nombre:", oldName); if (!name || name === oldName) return;
  try { await gf("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ name: name }) }); await loadDrive(); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
async function deleteDrive(id) {
  if (!confirm("¿Eliminar este archivo o carpeta de Drive?")) return;
  try { await gf("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id), { method: "DELETE" }); await loadDrive(); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
async function downloadDrive(id, name) {
  try { const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media", { headers: { Authorization: "Bearer " + await google() } }); if (!response.ok) throw new Error("No se pudo descargar el archivo."); downloadBlob(await response.blob(), name); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
async function uploadDrive(file) {
  if (!file) return;
  try { const form = new FormData(); form.append("metadata", new Blob([JSON.stringify({ name: file.name, parents: [driveParent] })], { type: "application/json" })); form.append("file", file); const result = await gf("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", { method: "POST", body: form }); message("#drive-message", "Archivo subido: " + result.name, "success"); await loadDrive(); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
async function driveQuota() {
  try { const data = await gf("https://www.googleapis.com/drive/v3/about?fields=user,storageQuota"), quota = data.storageQuota || {}, used = Number(quota.usage || 0), total = Number(quota.limit || 0); message("#drive-message", total ? "Uso de Drive: " + (used / 1073741824).toFixed(2) + " GB de " + (total / 1073741824).toFixed(2) + " GB." : "Google no informó un límite de almacenamiento.", "success"); }
  catch (error) { message("#drive-message", friendlyError(error), "error"); }
}
function bindAuthButtons() { $$("[data-open-auth]").forEach(button => { button.onclick = startLogin; }); }
function bindEvents() {
  bindAuthButtons(); $("#close-dialog").onclick = () => authDialog.close(); $("#close-sheet-dialog").onclick = () => sheetDialog.close(); $("#close-workspace").onclick = () => workspaceDialog.close(); $("#close-drive").onclick = () => driveDialog.close(); $("#close-api").onclick = () => apiDialog.close(); $("#copy-api-url").onclick = copyApiUrl; $("#authorize-google").onclick = listSheetsForProject;
  $("#new-project").onclick = () => { $("#sheets-list").innerHTML = ""; $("#authorize-google").classList.remove("hidden"); $("#authorize-google").disabled = false; message("#sheet-message", ""); sheetDialog.showModal(); };
  $("#connect-sheet").onclick = () => $("#new-project").click(); $("#open-drive").onclick = () => { if (!driveDialog.open) driveDialog.showModal(); loadDrive(); }; $("#sign-out").onclick = signOut; $("#load-data").onclick = loadValues;
  $("#search-data").onclick = () => { const term = $("#search-value").value.toLowerCase(), index = $("#search-column").value; if (!term) return renderTable(loadedValues, "#data-table"); const result = [loadedValues[0] || []].concat(loadedValues.slice(1).filter(row => index === "" ? row.some(value => String(value || "").toLowerCase().includes(term)) : String(row[index] || "").toLowerCase().includes(term))); renderTable(result, "#data-table"); message("#workspace-message", Math.max(0, result.length - 1) + " coincidencias.", "success"); };
  $("#clear-search").onclick = () => { $("#search-value").value = ""; renderTable(loadedValues, "#data-table"); };
  $("#sheet-select").onchange = async event => { activeSheet = event.target.value; $("#rename-sheet-name").value = activeSheet; try { await saveActiveSheet(); await loadProjectSheets(); await loadValues(); } catch (error) { message("#workspace-message", friendlyError(error), "error"); } };
  $$(".tab-button").forEach(button => button.onclick = () => switchTab(button.dataset.tab)); $("#save-range").onclick = saveRange; $("#insert-row").onclick = insertRow; $("#save-cell").onclick = saveCell; $("#delete-rows").onclick = deleteRows; $("#clear-values").onclick = clearValues; $("#add-sheet").onclick = addSheet; $("#rename-sheet").onclick = renameSheet; $("#delete-sheet").onclick = deleteSheet; $("#clear-filters").onclick = clearFilters; $("#copy-sheet").onclick = copySheet; $("#check-capacity").onclick = checkCapacity; $("#apply-format").onclick = applyFormat; $("#format-header").onclick = formatHeader; $("#resize-columns").onclick = resizeColumns; $("#run-query").onclick = runQuery; $("#run-advanced").onclick = runAdvanced; $("#calculate-stats").onclick = calculateStats; $("#download-csv").onclick = downloadCsv; $("#download-excel").onclick = downloadExcel; $("#load-drive").onclick = loadDrive; $("#create-folder").onclick = createFolder; $("#drive-quota").onclick = driveQuota; $("#upload-file").onchange = event => uploadDrive(event.target.files[0]);
  $("#drive-list").onclick = event => { const button = event.target.closest("button"); if (!button) return; if (button.dataset.driveOpen) { driveParent = button.dataset.driveOpen; driveParentName = button.dataset.driveName; loadDrive(); } if (button.dataset.driveDownload) downloadDrive(button.dataset.driveDownload, button.dataset.driveName); if (button.dataset.driveRename) renameDrive(button.dataset.driveRename, button.dataset.driveName); if (button.dataset.driveDelete) deleteDrive(button.dataset.driveDelete); };
  $("#projects-grid").onclick = event => { const button = event.target.closest("button"); if (!button) return; const project = projectsCache.find(item => item.id === (button.dataset.openProject || button.dataset.formatProject || button.dataset.removeProject || button.dataset.apiProject || button.dataset.removeApi)); if (!project) return; if (button.dataset.openProject) openProject(project, "data"); if (button.dataset.formatProject) openProject(project, "format"); if (button.dataset.removeProject) removeProject(project); if (button.dataset.apiProject) { const api = apiForProject(project); api ? showApiDialog(project, api) : createApi(project); } if (button.dataset.removeApi) removeApi(project); };
}
async function removeProject(project) { if (!confirm("¿Quitar " + project.name + " de SheetPilot? La hoja de Google no se eliminará.")) return; const result = await sb.from("projects").delete().eq("id", project.id).eq("user_id", user.id); if (result.error) return notice(friendlyError(result.error), "error"); notice("Proyecto quitado. La hoja original sigue en tu Drive.", "success"); projects(); }
bindEvents();
if (ready()) {
  sb = window.supabase.createClient(cfg.url, cfg.publishableKey);
  sb.auth.getSession().then(result => { if (result.data.session?.user) dashboard(result.data.session.user); });
  sb.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT") { user = null; $("#public-home").classList.remove("hidden"); $("#dashboard").classList.add("hidden"); } else if (session?.user) dashboard(session.user); });
}
