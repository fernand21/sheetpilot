/*
 * LittleAPI: API pública para Google Sheets y Drive.
 *
 * La identidad del propietario se usa sólo para guardar de forma cifrada el
 * refresh token de Google. Las llamadas a una API publicada no necesitan
 * iniciar sesión: GET puede ser público y las escrituras se protegen con
 * X-API-Key. La clave de API nunca se almacena en claro.
 */
type ApiRecord = {
  api_id: string;
  name: string;
  user_id: string;
  resource_type: "sheet" | "drive";
  spreadsheet_id: string | null;
  default_sheet: string | null;
  drive_file_id: string | null;
  api_key_hash: string;
  public_read: boolean;
  permissions: Record<string, boolean>;
  enabled: boolean;
  cache_ttl: number;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "";
const serviceKey = (() => {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (direct) return direct;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch (_) { return ""; }
})();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, x-api-key, authorization, x-littleapi-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Cache-Control": "no-store",
};
const cache = new Map<string, { expires: number; value: unknown }>();

function response(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
function failure(status: number, code: string, message: string, details?: unknown) {
  return response({ error: code, message, ...(details === undefined ? {} : { details }) }, status);
}
function partsFor(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const marker = parts.indexOf("sheetpilot-api");
  if (marker >= 0) return parts.slice(marker + 1);
  const version = parts.indexOf("v1");
  if (version >= 1 && parts[version - 1] === "api") return parts.slice(version + 1);
  return parts;
}
function dbHeaders() {
  const key = serviceKey || publicKey;
  return { apikey: key, Authorization: `Bearer ${key}` };
}
async function dbFetch(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !(serviceKey || publicKey)) throw new Error("Supabase no está configurado en la función.");
  const headers = new Headers(init.headers || {});
  Object.entries(dbHeaders()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  const text = await result.text();
  if (!result.ok) throw new Error(`Supabase respondió ${result.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sameSecret(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}
async function getApi(apiId: string): Promise<ApiRecord | null> {
  const fields = "api_id,name,user_id,resource_type,spreadsheet_id,default_sheet,drive_file_id,api_key_hash,public_read,permissions,enabled,cache_ttl";
  const rows = await dbFetch(`api_endpoints?select=${fields}&api_id=eq.${encodeURIComponent(apiId)}&enabled=eq.true&limit=1`);
  if (rows?.[0]) return { cache_ttl: 60, ...rows[0] };
  const publicFields = "api_id,name,user_id,resource_type,spreadsheet_id,default_sheet,drive_file_id,public_read,permissions,enabled";
  const catalog = await dbFetch(`api_public_catalog?select=${publicFields}&api_id=eq.${encodeURIComponent(apiId)}&enabled=eq.true&limit=1`);
  return catalog?.[0] ? { ...catalog[0], api_key_hash: "", cache_ttl: 60 } : null;
}
async function hasApiKey(api: ApiRecord, request: Request) {
  const url = new URL(request.url);
  const supplied = request.headers.get("x-api-key") || request.headers.get("x-littleapi-key") || url.searchParams.get("api_key") || "";
  if (!supplied || !api.api_key_hash) return false;
  return sameSecret(await sha256(supplied), api.api_key_hash);
}
function allowed(api: ApiRecord, action: string) { return api.permissions?.[action] !== false; }
function columnName(number: number) {
  let result = "", current = Math.max(1, number);
  while (current > 0) { const rest = (current - 1) % 26; result = String.fromCharCode(65 + rest) + result; current = Math.floor((current - 1) / 26); }
  return result || "A";
}
function columnNumber(column: string) { let result = 0; for (const letter of String(column).toUpperCase()) result = result * 26 + letter.charCodeAt(0) - 64; return result; }
function cellValue(cell: { v?: unknown; f?: unknown } | undefined) { return cell?.f ?? cell?.v ?? ""; }
function parseVisualization(text: string) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Google no devolvió una tabla válida.");
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status && payload.status !== "ok") throw new Error(payload.errors?.[0]?.detailed_message || "Google no permite leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.");
  const table = payload.table || {}, used: string[] = [];
  const headers = (table.cols || []).map((column: { label?: string; id?: string }, index: number) => {
    const base = String(column.label || column.id || columnName(index + 1)).trim() || columnName(index + 1);
    let key = base, suffix = 2; while (used.includes(key)) key = `${base}_${suffix++}`; used.push(key); return key;
  });
  const rows = (table.rows || []).map((row: { c?: Array<{ v?: unknown; f?: unknown }> }) => headers.map((_: string, index: number) => cellValue(row.c?.[index])));
  return { headers, rows };
}
function sheetRange(sheet: string, range: string) { return `'${String(sheet || "Sheet1").replace(/'/g, "''")}'!${range || "A:ZZ"}`; }
async function readPublicSheet(api: ApiRecord, sheet: string, query?: string) {
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) throw new Error("Esta API no está configurada como hoja de cálculo.");
  const params = new URLSearchParams({ tqx: "out:json", headers: "1", sheet }); if (query) params.set("tq", query);
  const result = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(api.spreadsheet_id)}/gviz/tq?${params.toString()}`), text = await result.text();
  if (!result.ok) throw new Error("Google no permitió leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.");
  return parseVisualization(text);
}
async function sheetsRequest(api: ApiRecord, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {}); headers.set("Authorization", `Bearer ${token}`); if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(`https://sheets.googleapis.com/v4/${path}`, { ...init, headers }), text = await result.text();
  if (!result.ok) throw new Error(`Google Sheets respondió ${result.status}: ${text.slice(0, 500)}`); return text ? JSON.parse(text) : {};
}
function rowsAsObjects(headers: string[], rows: unknown[][]) { return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))); }
function valueOf(row: Record<string, unknown>, key: string) { const exact = Object.keys(row).find((candidate) => candidate === key); if (exact) return row[exact]; const insensitive = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase()); return insensitive ? row[insensitive] : undefined; }
function compare(value: unknown, condition: string, casesensitive = false) {
  const original = String(value ?? ""), raw = String(condition ?? ""), left = casesensitive ? original : original.toLowerCase(); const rightRaw = raw.startsWith("!") ? raw.slice(1) : raw, right = casesensitive ? rightRaw : rightRaw.toLowerCase();
  if (raw.startsWith("!")) return left !== right;
  const relational = raw.match(/^(<=|>=|<|>)(.*)$/);
  if (relational) { const aN = Number(original), bN = Number(relational[2]); const a: string | number = Number.isNaN(aN) || Number.isNaN(bN) ? left : aN; const b: string | number = Number.isNaN(aN) || Number.isNaN(bN) ? (casesensitive ? relational[2] : relational[2].toLowerCase()) : bN; if (relational[1] === "<") return a < b; if (relational[1] === ">") return a > b; if (relational[1] === "<=") return a <= b; return a >= b; }
  if (right.includes("*")) { const pattern = right.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"); return new RegExp(`^${pattern}$`, casesensitive ? "" : "i").test(original); }
  return left === right;
}
function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>, casesensitive = false) { return Object.entries(where || {}).every(([key, condition]) => key === "contains" && condition && typeof condition === "object" ? Object.entries(condition as Record<string, unknown>).every(([column, value]) => String(valueOf(row, column) ?? "").toLowerCase().includes(String(value).toLowerCase())) : compare(valueOf(row, key), String(condition), casesensitive)); }
function aggregate(rows: Record<string, unknown>[], url: URL) {
  const groupBy = url.searchParams.get("group_by"), countField = url.searchParams.get("count");
  const sums = url.searchParams.getAll("sum").concat((url.searchParams.get("sum") || "").split(",").filter(Boolean)), avgs = url.searchParams.getAll("avg").concat((url.searchParams.get("avg") || "").split(",").filter(Boolean));
  if (!groupBy && !countField && !sums.length && !avgs.length) return null;
  const groups = new Map<string, Record<string, unknown>[]>(); if (groupBy) rows.forEach((row) => { const key = String(valueOf(row, groupBy) ?? ""); groups.set(key, [...(groups.get(key) || []), row]); }); else groups.set("_all", rows);
  return Array.from(groups.entries()).map(([key, members]) => { const result: Record<string, unknown> = groupBy ? { [groupBy]: key } : {}; result.count = members.length; if (countField) result[`count_${countField}`] = members.filter((row) => String(valueOf(row, countField) ?? "") !== "").length; sums.filter((item, index, list) => item && list.indexOf(item) === index).forEach((field) => { result[`sum_${field}`] = members.reduce((total, row) => total + (Number(valueOf(row, field)) || 0), 0); }); avgs.filter((item, index, list) => item && list.indexOf(item) === index).forEach((field) => { const values = members.map((row) => Number(valueOf(row, field))).filter((value) => !Number.isNaN(value)); result[`avg_${field}`] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }); return result; });
}
function transform(rows: Record<string, unknown>[], url: URL) {
  let result = [...rows]; const sortBy = url.searchParams.get("sort_by") || url.searchParams.get("sort"), order = (url.searchParams.get("sort_order") || url.searchParams.get("order") || "asc").toLowerCase();
  if (sortBy) result.sort((a, b) => { const left = String(valueOf(a, sortBy) ?? ""), right = String(valueOf(b, sortBy) ?? ""), aN = Number(left), bN = Number(right); const comparison = !Number.isNaN(aN) && !Number.isNaN(bN) ? aN - bN : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }); return order === "desc" ? -comparison : comparison; });
  const total = result.length, offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0), requested = Number(url.searchParams.get("limit") || 0) || 0; result = result.slice(offset, requested > 0 ? offset + Math.min(requested, 1000) : offset + 1000);
  const casts = (url.searchParams.get("cast_numbers") || "").split(",").map((item) => item.trim()).filter(Boolean); if (casts.length) result = result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, casts.includes(key) && value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value])));
  return { data: url.searchParams.get("single_object") === "true" ? (result[0] || {}) : result, total, limit: requested || result.length, offset };
}
function searchRows(rows: Record<string, unknown>[], url: URL, orMode = false) {
  const reserved = new Set(["sheet", "limit", "offset", "sort_by", "sort_order", "sort", "order", "sort_method", "sort_date_format", "cast_numbers", "single_object", "mode", "casesensitive", "legacy", "infer_types", "group_by", "count", "sum", "avg", "search"]), casesensitive = url.searchParams.get("casesensitive") === "true", search = url.searchParams.get("search");
  let filtered = search ? rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase()))) : rows; const conditions: Array<[string, string[]]> = [];
  for (const key of new Set(Array.from(url.searchParams.keys()).filter((item) => !reserved.has(item) && !item.startsWith("contains[")))) conditions.push([key.endsWith("[]") ? key.slice(0, -2) : key, url.searchParams.getAll(key)]);
  for (const key of Array.from(url.searchParams.keys()).filter((item) => item.startsWith("contains[") && item.endsWith("]"))) conditions.push([`contains:${key.slice(9, -1)}`, url.searchParams.getAll(key)]);
  if (conditions.length) filtered = filtered.filter((row) => { const matches = conditions.map(([key, values]) => key.startsWith("contains:") ? values.every((value) => String(valueOf(row, key.slice(9)) ?? "").toLowerCase().includes(value.toLowerCase())) : values.some((value) => compare(valueOf(row, key), value, casesensitive))); return orMode ? matches.some(Boolean) : matches.every(Boolean); });
  return transform(filtered, url);
}
function requirePermission(api: ApiRecord, action: string) { return allowed(api, action) ? null : failure(403, "permission_denied", `La API no tiene habilitado el permiso ${action}.`); }
async function readOperation(api: ApiRecord, request: Request, path: string[]) {
  const url = new URL(request.url); if (api.public_read !== true && !(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta API requiere la cabecera X-API-Key.");
  if (path[0] === "name") return response({ name: api.name, api_id: api.api_id }); if (path[0] === "metadata" || path[0] === "openapi.json") return metadataResponse(api, path[0] === "openapi.json", request);
  if (api.resource_type === "drive") return driveOperation(api, request, path);
  const sheet = url.searchParams.get("sheet") || api.default_sheet || "Sheet1", denied = requirePermission(api, path[0] === "search" || path[0] === "search_or" ? "search" : "read"); if (denied) return denied;
  const cacheKey = `${api.api_id}:${url.search}`, cached = cache.get(cacheKey); if (cached && cached.expires > Date.now()) return response(cached.value, 200, { "X-LittleAPI-Cache": "HIT", "Cache-Control": `public, max-age=${Math.min(api.cache_ttl, 3600)}` });
  const data = await readPublicSheet(api, sheet), objects = rowsAsObjects(data.headers, data.rows); if (path[0] === "keys") return response(data.headers); if (path[0] === "count") return response({ rows: objects.length });
  if (path[0] === "cells") { const matrix = [data.headers, ...data.rows], cells: Record<string, unknown> = {}; for (const cell of (path[1] || "").split(",")) { const match = cell.toUpperCase().match(/^([A-Z]+)(\d+)$/); if (match) cells[cell.toUpperCase()] = matrix[Number(match[2]) - 1]?.[columnNumber(match[1]) - 1] ?? ""; } return response(cells); }
  const result = path[0] === "search" || path[0] === "search_or" ? searchRows(objects, url, path[0] === "search_or") : transform(objects, url), grouped = aggregate(objects, url), finalResult = grouped ? { data: grouped, total: grouped.length, limit: grouped.length, offset: 0 } : result;
  const body = url.searchParams.get("legacy") === "true" ? finalResult.data : { data: finalResult.data, total: finalResult.total, limit: finalResult.limit, offset: finalResult.offset, meta: { api_id: api.api_id, name: api.name, sheet } }; if (api.cache_ttl > 0) cache.set(cacheKey, { expires: Date.now() + Math.min(api.cache_ttl, 3600) * 1000, value: body });
  return response(body, 200, { "X-LittleAPI-Cache": "MISS", ...(api.cache_ttl > 0 ? { "Cache-Control": `public, max-age=${Math.min(api.cache_ttl, 3600)}` } : {}) });
}
async function readAuthorized(api: ApiRecord, token: string, sheet: string) { const data = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A:ZZ"))}?majorDimension=ROWS`), values = Array.isArray(data.values) ? data.values : [], headers = (values[0] || []).map((value: unknown, index: number) => String(value || columnName(index + 1))); return { headers, rows: values.slice(1), values }; }
async function googleTokenForUser(userId: string) {
  if (!serviceKey) throw new Error("La función necesita SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEYS para leer la conexión privada."); const rows = await dbFetch(`google_connections?select=refresh_token_ciphertext&user_id=eq.${encodeURIComponent(userId)}&limit=1`), encrypted = rows?.[0]?.refresh_token_ciphertext; if (!encrypted) throw new Error("Conecta Google otra vez y acepta los permisos de Sheets y Drive."); const refreshToken = await decryptToken(encrypted), clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "", clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || ""; if (!clientId || !clientSecret) throw new Error("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en los secretos de la función.");
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }), result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }), data = await result.json(); if (!result.ok || !data.access_token) throw new Error(data.error_description || "Google no pudo renovar la autorización."); return data.access_token as string;
}
async function updateValues(api: ApiRecord, token: string, range: string, values: unknown[][]) { return sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) }); }
async function mutationOperation(api: ApiRecord, request: Request, path: string[]) {
  if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Las operaciones de escritura requieren la cabecera X-API-Key."); const action = request.method === "POST" ? "create" : request.method === "PATCH" ? "update" : "delete", denied = requirePermission(api, action); if (denied) return denied; if (api.resource_type === "drive") return driveOperation(api, request, path);
  const body = request.method === "DELETE" || request.headers.get("content-length") === "0" ? {} : await request.json().catch(() => ({})), token = await googleTokenForUser(api.user_id), sheet = String(body.sheet || new URL(request.url).searchParams.get("sheet") || api.default_sheet || "Sheet1");
  if (path[0] === "sheets") return sheetAdmin(api, token, request, path.slice(1), body); if (path[0] === "format" || path[0] === "clear" || path[0] === "batch") return sheetUtility(api, token, request, path[0], body, sheet);
  const table = await readAuthorized(api, token, sheet), headers = table.headers;
  if (request.method === "POST") { const incoming = Array.isArray(body) ? body : body.rows || body.data || body.row || body, rows = Array.isArray(incoming) ? incoming : [incoming], values = rows.map((row: unknown) => Array.isArray(row) ? row : headers.map((header) => (row as Record<string, unknown>)[header] ?? "")); const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values }) }); cache.clear(); return response({ success: true, inserted: values.length, updates: result.updates || null }, 201); }
  const where = body.where || body.match || (body.row && !body.data ? body.row : null); if (body.range && Array.isArray(body.values)) { await updateValues(api, token, sheetRange(sheet, body.range), body.values); cache.clear(); return response({ success: true, updated: body.values.length, range: body.range }); }
  const indexed = table.rows.map((row, index) => ({ row, object: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])), sheetRow: index + 2 })).filter((entry) => !where || matchWhere(entry.object, where)); if (!indexed.length) return response({ success: true, matched: 0, updated: 0, deleted: 0 });
  if (request.method === "PATCH") { const changes = body.data || body.update || {}; for (const entry of indexed) { const next = headers.map((header, column) => Object.prototype.hasOwnProperty.call(changes, header) ? changes[header] : entry.row[column] ?? ""); await updateValues(api, token, sheetRange(sheet, `A${entry.sheetRow}:${columnName(headers.length)}${entry.sheetRow}`), [next]); } cache.clear(); return response({ success: true, matched: indexed.length, updated: indexed.length }); }
  const metadata = await spreadsheetMetadata(api, token), sheetInfo = metadata.sheets?.find((item: any) => item.properties?.title === sheet), sheetId = sheetInfo?.properties?.sheetId; if (sheetId === undefined) throw new Error("No se encontró la pestaña para eliminar las filas."); const requests = indexed.map((entry) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: entry.sheetRow - 1, endIndex: entry.sheetRow } } })).reverse(); await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) }); cache.clear(); return response({ success: true, matched: indexed.length, deleted: indexed.length });
}
async function spreadsheetMetadata(api: ApiRecord, token: string) { return sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}?includeGridData=false&fields=spreadsheetId,properties,sheets.properties`); }
async function sheetAdmin(api: ApiRecord, token: string, request: Request, subpath: string[], body: any) {
  const title = decodeURIComponent(subpath[0] || body.name || ""); if (request.method === "POST") { const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: body.name } } }] }) }); return response({ success: true, sheet: result.replies?.[0]?.addSheet?.properties || null }, 201); }
  const metadata = await spreadsheetMetadata(api, token), info = metadata.sheets?.find((item: any) => item.properties?.title === title); if (!info) return failure(404, "sheet_not_found", "No existe esa pestaña."); const requestBody = request.method === "PATCH" ? { updateSheetProperties: { properties: { sheetId: info.properties.sheetId, title: body.name }, fields: "title" } } : { deleteSheet: { sheetId: info.properties.sheetId } }; await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [requestBody] }) }); cache.clear(); return response({ success: true, sheet: request.method === "PATCH" ? body.name : title });
}
async function sheetUtility(api: ApiRecord, token: string, request: Request, operation: string, body: any, sheet: string) {
  if (operation === "batch") { if (!Array.isArray(body.requests) || body.requests.length > 50) return failure(400, "invalid_batch", "Envía entre 1 y 50 solicitudes de Google Sheets."); await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: body.requests }) }); cache.clear(); return response({ success: true, applied: body.requests.length }); }
  const range = sheetRange(sheet, body.range || "A1:ZZ1000"); if (operation === "clear") { await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(range)}:clear`, { method: "POST", body: "{}" }); cache.clear(); return response({ success: true, range: body.range }); }
  const metadata = await spreadsheetMetadata(api, token), info = metadata.sheets?.find((item: any) => item.properties?.title === sheet); if (!info) return failure(404, "sheet_not_found", "No existe esa pestaña."); const grid = body.gridRange || { sheetId: info.properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 26 }, fields: string[] = [], format: any = {};
  if (body.bold !== undefined) { format.textFormat = { ...(format.textFormat || {}), bold: Boolean(body.bold) }; fields.push("userEnteredFormat.textFormat.bold"); } if (body.fontSize) { format.textFormat = { ...(format.textFormat || {}), fontSize: Number(body.fontSize) }; fields.push("userEnteredFormat.textFormat.fontSize"); } if (body.textColor) { format.textFormat = { ...(format.textFormat || {}), foregroundColor: color(body.textColor) }; fields.push("userEnteredFormat.textFormat.foregroundColor"); } if (body.bgColor) { format.backgroundColor = color(body.bgColor); fields.push("userEnteredFormat.backgroundColor"); } if (body.horizontalAlignment) { format.horizontalAlignment = body.horizontalAlignment; fields.push("userEnteredFormat.horizontalAlignment"); } if (!fields.length) return failure(400, "invalid_format", "Indica al menos una propiedad de formato.");
  await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ repeatCell: { range: grid, cell: { userEnteredFormat: format }, fields: fields.join(",") } }] }) }); cache.clear(); return response({ success: true, range: body.range || null });
}
function color(value: string) { const hex = String(value).replace("#", ""); const n = (part: string) => parseInt(part, 16) / 255; return { red: n(hex.slice(0, 2) || "00"), green: n(hex.slice(2, 4) || "00"), blue: n(hex.slice(4, 6) || "00") }; }
async function driveRequest(token: string, path: string, init: RequestInit = {}) { const headers = new Headers(init.headers || {}); headers.set("Authorization", `Bearer ${token}`); if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json"); const result = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers }); const text = await result.text(); if (!result.ok) throw new Error(`Google Drive respondió ${result.status}: ${text.slice(0, 500)}`); return text ? JSON.parse(text) : {}; }
async function driveOperation(api: ApiRecord, request: Request, path: string[]) {
  const token = await googleTokenForUser(api.user_id), mode = path[0] || "", id = mode === "children" || mode === "download" ? (path[1] || api.drive_file_id || "root") : (mode || api.drive_file_id || "root");
  if (request.method === "GET") { if (mode === "download") { const result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } }); return new Response(await result.arrayBuffer(), { status: result.status, headers: { ...corsHeaders, "Content-Type": result.headers.get("content-type") || "application/octet-stream", "Content-Disposition": `attachment; filename="${id}"` } }); } const q = mode === "children" ? `'${id}' in parents and trashed = false` : `id = '${id}'`, fields = "files(id,name,mimeType,size,modifiedTime,parents,webViewLink),id,name,mimeType,size,modifiedTime,parents,webViewLink"; return response(await driveRequest(token, `files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100`)); }
  if (request.method === "POST") { if (request.headers.get("content-type")?.includes("multipart/form-data")) return failure(415, "multipart_not_supported", "Para subir desde una API usa JSON con content_base64."); const body = await request.json().catch(() => ({})), metadata = { name: body.name, mimeType: body.mimeType || "application/octet-stream", parents: body.parents || (id !== "root" ? [id] : undefined) }; if (body.content_base64) { const boundary = `littleapi_${crypto.randomUUID()}`, bytes = Uint8Array.from(atob(body.content_base64), (char) => char.charCodeAt(0)), prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`, suffix = `\r\n--${boundary}--`, encoded = new TextEncoder().encode(prefix), ending = new TextEncoder().encode(suffix), joined = new Uint8Array(encoded.length + bytes.length + ending.length); joined.set(encoded); joined.set(bytes, encoded.length); joined.set(ending, encoded.length + bytes.length); return response(await driveRequest(token, `files?uploadType=multipart&fields=id,name,mimeType,webViewLink`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: joined }), 201); } return response(await driveRequest(token, `files?fields=id,name,mimeType,webViewLink`, { method: "POST", body: JSON.stringify(metadata) }), 201); }
  const body = await request.json().catch(() => ({})); if (request.method === "PATCH") return response(await driveRequest(token, `files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink`, { method: "PATCH", body: JSON.stringify({ name: body.name }) })); await driveRequest(token, `files/${encodeURIComponent(id)}`, { method: "DELETE" }); return response({ success: true, deleted: id });
}
function metadataResponse(api: ApiRecord, openapi: boolean, request: Request) {
  if (!openapi) return response({ api_id: api.api_id, name: api.name, resource_type: api.resource_type, spreadsheet_id: api.spreadsheet_id, default_sheet: api.default_sheet, permissions: api.permissions, public_read: api.public_read });
  const publicBase = request.headers.get("x-littleapi-public-base") || `${supabaseUrl}/functions/v1/sheetpilot-api`;
  return response({ openapi: "3.0.3", info: { title: api.name, version: "1.0.0" }, servers: [{ url: `${publicBase}/${api.api_id}` }], paths: { "/": { get: { summary: "Lista filas" }, post: { summary: "Inserta filas" }, patch: { summary: "Actualiza filas" }, delete: { summary: "Elimina filas" } }, "/search": { get: { summary: "Filtra filas" } }, "/sheets": { post: { summary: "Crea una pestaña" } }, "/format": { post: { summary: "Aplica formato" } }, "/batch": { post: { summary: "Ejecuta cambios atómicos" } } } });
}
function base64(bytes: Uint8Array) { let result = ""; for (const byte of bytes) result += String.fromCharCode(byte); return btoa(result); }
function fromBase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
async function encryptionKey() { const secret = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") || ""; if (!secret) throw new Error("Falta GOOGLE_TOKEN_ENCRYPTION_KEY en los secretos de la función."); const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function encryptToken(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)), encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value)); const joined = new Uint8Array(iv.length + encrypted.byteLength); joined.set(iv); joined.set(new Uint8Array(encrypted), iv.length); return base64(joined); }
async function decryptToken(value: string) { const joined = fromBase64(value), iv = joined.slice(0, 12), encrypted = joined.slice(12), plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), encrypted); return new TextDecoder().decode(plain); }
async function apiKeyEncryptionKey() {
  const secret = Deno.env.get("LITTLEAPI_KEY_ENCRYPTION_KEY") || Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") || serviceKey;
  if (!secret) throw new Error("Falta una clave de cifrado del servidor para guardar la clave de API.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptApiKey(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)), encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await apiKeyEncryptionKey(), new TextEncoder().encode(value)); const joined = new Uint8Array(iv.length + encrypted.byteLength); joined.set(iv); joined.set(new Uint8Array(encrypted), iv.length); return base64(joined); }
async function decryptApiKey(value: string) { const joined = fromBase64(value), iv = joined.slice(0, 12), encrypted = joined.slice(12), plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await apiKeyEncryptionKey(), encrypted); return new TextDecoder().decode(plain); }
async function currentUser(request: Request) { const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); const authKey = publicKey || serviceKey; if (!token || !supabaseUrl || !authKey) return null; const result = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: authKey, Authorization: `Bearer ${token}` } }); return result.ok ? await result.json() : null; }
async function apiKeyConnection(request: Request) {
  const user = await currentUser(request); if (!user?.id) return failure(401, "login_required", "Inicia sesión para consultar la clave de API.");
  const url = new URL(request.url), body = request.method === "POST" ? await request.json().catch(() => ({})) : {}, apiId = String(body.api_id || url.searchParams.get("api_id") || "").trim();
  if (!apiId) return failure(400, "api_id_required", "Indica el API_ID.");
  const filter = `api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;
  const rows = await dbFetch(`api_endpoints?select=id,api_id,name,api_key_ciphertext&${filter}`);
  if (!rows?.[0]) return failure(404, "api_not_found", "No existe una API propia con ese identificador.");
  if (request.method === "GET") {
    if (!rows[0].api_key_ciphertext) return failure(404, "api_key_not_stored", "Esta API se creó antes de activar la recuperación segura de claves.");
    return response({ api_id: apiId, name: rows[0].name, api_key: await decryptApiKey(rows[0].api_key_ciphertext) });
  }
  if (request.method !== "POST") return failure(405, "method_not_allowed", "Usa GET o POST para la clave de API.");
  const apiKey = String(body.api_key || "").trim(); if (!/^sp_live_[A-Za-z0-9_-]{20,}$/.test(apiKey)) return failure(400, "invalid_api_key", "La clave de API no tiene un formato válido.");
  const ciphertext = await encryptApiKey(apiKey);
  await dbFetch(`api_endpoints?id=eq.${encodeURIComponent(rows[0].id)}`, { method: "PATCH", body: JSON.stringify({ api_key_hash: await sha256(apiKey), api_key_prefix: apiKey.slice(0, 16), api_key_ciphertext: ciphertext, updated_at: new Date().toISOString() }) });
  return response({ success: true, api_id: apiId, stored: true });
}
async function googleConnection(request: Request) {
  const user = await currentUser(request); if (!user?.id) return failure(401, "login_required", "Inicia sesión para conectar Google.");
  if (request.method === "GET") { const rows = await dbFetch(`google_connections?select=user_id,scopes,updated_at&user_id=eq.${encodeURIComponent(user.id)}&limit=1`); return response({ connected: Boolean(rows?.[0]), scopes: rows?.[0]?.scopes || [], updated_at: rows?.[0]?.updated_at || null }); }
  if (request.method === "DELETE") { await dbFetch(`google_connections?user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" }); return response({ success: true, connected: false }); }
  const body = await request.json().catch(() => ({})); if (!body.provider_refresh_token) return failure(400, "refresh_token_required", "Google no entregó un refresh token. Vuelve a autorizar con access_type=offline y prompt=consent."); const encrypted = await encryptToken(String(body.provider_refresh_token)); await dbFetch("google_connections", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: user.id, refresh_token_ciphertext: encrypted, scopes: body.scopes || [], updated_at: new Date().toISOString() }) }); return response({ success: true, connected: true });
}
async function statsOperation(api: ApiRecord, request: Request) { const denied = requirePermission(api, "read"); if (denied) return denied; const token = await googleTokenForUser(api.user_id), url = new URL(request.url), sheet = url.searchParams.get("sheet") || api.default_sheet || "Sheet1", table = await readAuthorized(api, token, sheet), column = url.searchParams.get("column") || ""; const rows = rowsAsObjects(table.headers, table.rows); if (!column) return response({ columns: table.headers, rows: rows.length }); const values = rows.map((row) => Number(valueOf(row, column))).filter((value) => !Number.isNaN(value)); return response({ column, count: rows.filter((row) => String(valueOf(row, column) ?? "") !== "").length, sum: values.reduce((a, b) => a + b, 0), avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }); }
async function handler(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders }); const url = new URL(request.url), path = partsFor(url);
  if (path[0] === "auth" && path[1] === "google") return googleConnection(request);
  if (path[0] === "auth" && path[1] === "api-key") return apiKeyConnection(request);
  if (!path[0]) return response({ name: "LittleAPI", version: "1", usage: "/sheetpilot-api/{API_ID}", methods: ["GET", "POST", "PATCH", "DELETE"], authentication: "Las APIs publicadas se consumen sin login; usa X-API-Key para escrituras." });
  const api = await getApi(path[0]); if (!api) return failure(404, "api_not_found", "No existe una API con ese identificador o está desactivada."); if (path[1] === "stats" && request.method === "GET") return statsOperation(api, request); if (request.method === "GET") return readOperation(api, request, path.slice(1)); return mutationOperation(api, request, path.slice(1));
}
Deno.serve(async (request) => { try { return await handler(request); } catch (error) { return failure(502, "upstream_error", error instanceof Error ? error.message : "No se pudo completar la solicitud."); } });
