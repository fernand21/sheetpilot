import { accountRequest, getSecuritySettings, enforceRequestSecurity, withDynamicCors, scheduleTelemetry } from "./platform.ts";
import { handleMcp } from "./mcp.ts";

/*
 * LittleAPI API v1.5
 * Public REST API for Google Sheets and Google Drive.
 *
 * Published APIs do not require a Supabase login. Public GETs can be anonymous;
 * private reads, writes, Drive operations and administrative operations use
 * X-API-Key. Google refresh tokens and recoverable API keys stay encrypted.
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
  monthly_request_limit: number;
};

type TableData = { headers: string[]; rows: unknown[][]; values?: unknown[][] };
type PageResult = {
  data: unknown;
  total: number;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  next_offset: number | null;
  max_limit: number;
};
type QuotaState = { allowed: boolean; used: number; limit: number; reset_at: string };

const API_VERSION = "1.5.0";
const MAX_PAGE_SIZE = 1000;
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
  "Access-Control-Expose-Headers": "content-disposition, retry-after, x-littleapi-cache, x-littleapi-version, x-littleapi-quota-limit, x-littleapi-quota-used, x-littleapi-quota-remaining, x-littleapi-quota-reset",
  "Cache-Control": "no-store",
};
const cache = new Map<string, { expires: number; value: unknown }>();

function response(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "X-LittleAPI-Version": API_VERSION, ...extra },
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
  const fields = "api_id,name,user_id,resource_type,spreadsheet_id,default_sheet,drive_file_id,api_key_hash,public_read,permissions,enabled,cache_ttl,monthly_request_limit";
  const rows = await dbFetch(`api_endpoints?select=${fields}&api_id=eq.${encodeURIComponent(apiId)}&enabled=eq.true&limit=1`);
  if (rows?.[0]) return { cache_ttl: 60, monthly_request_limit: 5000, ...rows[0] };
  const publicFields = "api_id,name,user_id,resource_type,spreadsheet_id,default_sheet,drive_file_id,public_read,permissions,enabled,monthly_request_limit";
  const catalog = await dbFetch(`api_public_catalog?select=${publicFields}&api_id=eq.${encodeURIComponent(apiId)}&enabled=eq.true&limit=1`);
  return catalog?.[0] ? { ...catalog[0], api_key_hash: "", cache_ttl: 60, monthly_request_limit: catalog[0].monthly_request_limit || 5000 } : null;
}
type ApiKeyContext = {
  kind: "primary" | "additional";
  id: string | null;
  permissions: Record<string, boolean> | null;
};
const apiKeyContexts = new WeakMap<Request, ApiKeyContext | false>();

function suppliedApiKey(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return request.headers.get("x-api-key") || request.headers.get("x-littleapi-key") || bearer || "";
}

async function hasApiKey(api: ApiRecord, request: Request) {
  if (apiKeyContexts.has(request)) return apiKeyContexts.get(request) !== false;
  const supplied = suppliedApiKey(request);
  if (!supplied) { apiKeyContexts.set(request, false); return false; }
  const hash = await sha256(supplied);
  if (api.api_key_hash && sameSecret(hash, api.api_key_hash)) {
    apiKeyContexts.set(request, { kind: "primary", id: null, permissions: null });
    return true;
  }
  const rows = await dbFetch(`api_access_keys?select=id,permissions,expires_at,last_used_at&api_id=eq.${encodeURIComponent(api.api_id)}&key_hash=eq.${encodeURIComponent(hash)}&enabled=eq.true&limit=1`);
  const row = rows?.[0];
  if (!row) { apiKeyContexts.set(request, false); return false; }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) { apiKeyContexts.set(request, false); return false; }
  apiKeyContexts.set(request, { kind: "additional", id: row.id, permissions: row.permissions || {} });
  const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (!lastUsed || Date.now() - lastUsed > 300000) {
    try {
      await dbFetch(`api_access_keys?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    } catch (_) { /* last_used_at is best-effort */ }
  }
  return true;
}

function allowed(api: ApiRecord, action: string, request?: Request) {
  if (api.permissions?.[action] === false) return false;
  const context = request ? apiKeyContexts.get(request) : null;
  if (context && context !== false && context.kind === "additional" && context.permissions?.[action] === false) return false;
  return true;
}
function requirePermission(api: ApiRecord, action: string, request?: Request) {
  return allowed(api, action, request) ? null : failure(403, "permission_denied", `La API no tiene habilitado el permiso ${action}.`);
}
function columnName(number: number) {
  let result = "", current = Math.max(1, number);
  while (current > 0) { const rest = (current - 1) % 26; result = String.fromCharCode(65 + rest) + result; current = Math.floor((current - 1) / 26); }
  return result || "A";
}
function columnNumber(column: string) {
  let result = 0;
  for (const letter of String(column).toUpperCase()) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}
function cellValue(cell: { v?: unknown; f?: unknown } | undefined) { return cell?.f ?? cell?.v ?? ""; }
function parseVisualization(text: string): TableData {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Google no devolvió una tabla válida.");
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status && payload.status !== "ok") throw new Error(payload.errors?.[0]?.detailed_message || "Google no permite leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.");
  const table = payload.table || {}, used: string[] = [];
  const headers = (table.cols || []).map((column: { label?: string; id?: string }, index: number) => {
    const base = String(column.label || column.id || columnName(index + 1)).trim() || columnName(index + 1);
    let key = base, suffix = 2;
    while (used.includes(key)) key = `${base}_${suffix++}`;
    used.push(key);
    return key;
  });
  const rows = (table.rows || []).map((row: { c?: Array<{ v?: unknown; f?: unknown }> }) => headers.map((_: string, index: number) => cellValue(row.c?.[index])));
  return { headers, rows };
}
function sheetRange(sheet: string, range: string) { return `'${String(sheet || "Sheet1").replace(/'/g, "''")}'!${range || "A:ZZ"}`; }
async function readPublicSheet(api: ApiRecord, sheet: string): Promise<TableData> {
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) throw new Error("Esta API no está configurada como hoja de cálculo.");
  const params = new URLSearchParams({ tqx: "out:json", headers: "1", sheet });
  const result = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(api.spreadsheet_id)}/gviz/tq?${params.toString()}`), text = await result.text();
  if (!result.ok) throw new Error("Google no permitió leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.");
  return parseVisualization(text);
}
async function sheetsRequest(api: ApiRecord, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(`https://sheets.googleapis.com/v4/${path}`, { ...init, headers }), text = await result.text();
  if (!result.ok) throw new Error(`Google Sheets respondió ${result.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}
async function readAuthorized(
  api: ApiRecord,
  token: string,
  sheet: string,
  valueRenderOption: "FORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE",
): Promise<TableData> {
  const data = await sheetsRequest(
    api,
    token,
    `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A:ZZ"))}?majorDimension=ROWS&valueRenderOption=${encodeURIComponent(valueRenderOption)}`,
  );
  const values = Array.isArray(data.values) ? data.values : [];
  const headers = (values[0] || []).map((value: unknown, index: number) => String(value || columnName(index + 1)));
  return { headers, rows: values.slice(1), values };
}

const QUERY_RESERVED_WORDS = new Set([
  "select", "where", "group", "by", "pivot", "order", "limit", "offset", "label", "format", "options",
  "and", "or", "not", "contains", "starts", "with", "ends", "matches", "like", "is", "null",
  "date", "datetime", "timeofday", "true", "false", "sum", "avg", "count", "min", "max",
  "year", "month", "day", "hour", "minute", "second", "quarter", "dayofweek", "upper", "lower", "now", "todate",
]);
function escapeQueryRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function mapQueryHeaders(query: string, headers: string[]) {
  const mappings = headers
    .map((header, index) => ({ name: String(header || "").trim(), column: columnName(index + 1) }))
    .filter((item) => item.name && !QUERY_RESERVED_WORDS.has(item.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  const quoted = /('(?:''|[^'])*'|"(?:""|[^"])*")/g;
  return String(query || "").split(quoted).map((segment, index) => {
    if (index % 2 === 1) return segment;
    let result = segment;
    for (const mapping of mappings) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeQueryRegex(mapping.name)}(?=$|[^\\p{L}\\p{N}_])`, "giu");
      result = result.replace(pattern, (_match, prefix) => `${prefix}${mapping.column}`);
    }
    return result;
  }).join("");
}
async function queryHeaders(api: ApiRecord, sheet: string, token: string, headerRows: number) {
  try {
    const params = new URLSearchParams({ tqx: "out:json", headers: String(headerRows), sheet, tq: "limit 0" });
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const result = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(api.spreadsheet_id || "")}/gviz/tq?${params.toString()}`, { headers });
    const text = await result.text();
    if (result.ok) {
      const table = parseVisualization(text);
      if (table.headers.length) return table.headers;
    }
  } catch (_) { /* Fallback below. */ }
  return token ? (await readAuthorized(api, token, sheet)).headers : (await readPublicSheet(api, sheet)).headers;
}
async function queryOperation(api: ApiRecord, request: Request) {
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) return failure(400, "not_a_sheet_api", "Las consultas avanzadas sólo están disponibles para APIs de Google Sheets.");
  const denied = requirePermission(api, "read", request);
  if (denied) return denied;
  if (api.public_read !== true && !(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta API privada requiere la cabecera X-API-Key.");

  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const query = String(body.query || body.q || url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
  const sheet = String(body.sheet || url.searchParams.get("sheet") || api.default_sheet || "Sheet1").trim();
  const raw = body.raw === true || url.searchParams.get("raw") === "true";
  const columnsMode = String(body.columns || url.searchParams.get("columns") || "names").toLowerCase();
  const requestedHeaders = Number(body.headers ?? url.searchParams.get("headers") ?? 1);
  const headerRows = Number.isFinite(requestedHeaders) ? Math.max(0, Math.min(10, Math.floor(requestedHeaders))) : 1;

  if (!query) return failure(400, "query_required", "Indica la consulta en q/query.", {
    example: "SELECT Nombre, Total WHERE Total > 100 ORDER BY Total DESC LIMIT 20",
    url: `https://littleapi.online/api/v1/${api.api_id}/query?sheet=${encodeURIComponent(sheet)}&q=SELECT%20*%20LIMIT%2010`,
  });
  if (query.length > 4000) return failure(413, "query_too_long", "La consulta no puede superar 4000 caracteres.");

  const token = api.public_read ? "" : await googleTokenForUser(api.user_id);
  const sheetHeaders = columnsMode === "letters" ? [] : await queryHeaders(api, sheet, token, headerRows);
  const translatedQuery = columnsMode === "letters" ? query : mapQueryHeaders(query, sheetHeaders);
  const includeEmpty = shouldIncludeEmptyRows(url, body);
  const cacheKey = `${api.api_id}:query:${sheet}:${headerRows}:${columnsMode}:${raw}:${includeEmpty}:${translatedQuery}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return response(cached.value, 200, {
    "X-LittleAPI-Cache": "HIT",
    "Cache-Control": api.public_read ? `public, max-age=${Math.min(api.cache_ttl, 3600)}` : "no-store",
  });

  const params = new URLSearchParams({ tqx: "out:json", headers: String(headerRows), sheet, tq: translatedQuery });
  const googleHeaders = new Headers();
  if (token) googleHeaders.set("Authorization", `Bearer ${token}`);
  const result = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(api.spreadsheet_id)}/gviz/tq?${params.toString()}`, { headers: googleHeaders });
  const text = await result.text();
  if (!result.ok) return failure(502, "google_query_failed", `Google no pudo ejecutar la consulta (HTTP ${result.status}).`);

  try {
    const table = parseVisualization(text);
    const allData = rowsAsObjects(table.headers, table.rows);
    const data = shouldIncludeEmptyRows(url, body) ? allData : allData.filter(rowHasData);
    const payload = raw ? data : {
      data,
      total: data.length,
      columns: table.headers,
      meta: {
        api_id: api.api_id,
        name: api.name,
        sheet,
        query,
        translated_query: translatedQuery,
        header_rows: headerRows,
      },
    };
    if (api.cache_ttl > 0) cache.set(cacheKey, { expires: Date.now() + Math.min(api.cache_ttl, 3600) * 1000, value: payload });
    return response(payload, 200, {
      "X-LittleAPI-Cache": "MISS",
      "Cache-Control": api.public_read && api.cache_ttl > 0 ? `public, max-age=${Math.min(api.cache_ttl, 3600)}` : "no-store",
    });
  } catch (error) {
    return failure(400, "invalid_query", error instanceof Error ? error.message : "La consulta no es válida.", {
      query,
      translated_query: translatedQuery,
      sheet,
    });
  }
}

function rowsAsObjects(headers: string[], rows: unknown[][]) {
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}
function rowHasData(row: unknown[] | Record<string, unknown>) {
  const values = Array.isArray(row) ? row : Object.values(row || {});
  return values.some((value) => String(value ?? "").trim() !== "");
}
function shouldIncludeEmptyRows(url: URL, body?: Record<string, unknown>) {
  return body?.include_empty === true || url.searchParams.get("include_empty") === "true";
}
function valueOf(row: Record<string, unknown>, key: string) {
  const exact = Object.keys(row).find((candidate) => candidate === key);
  if (exact) return row[exact];
  const insensitive = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return insensitive ? row[insensitive] : undefined;
}
function compare(value: unknown, condition: string, casesensitive = false) {
  const original = String(value ?? ""), raw = String(condition ?? ""), left = casesensitive ? original : original.toLowerCase();
  const rightRaw = raw.startsWith("!") ? raw.slice(1) : raw, right = casesensitive ? rightRaw : rightRaw.toLowerCase();
  if (raw.startsWith("!")) return left !== right;
  const relational = raw.match(/^(<=|>=|<|>)(.*)$/);
  if (relational) {
    const aN = Number(original), bN = Number(relational[2]);
    const a: string | number = Number.isNaN(aN) || Number.isNaN(bN) ? left : aN;
    const b: string | number = Number.isNaN(aN) || Number.isNaN(bN) ? (casesensitive ? relational[2] : relational[2].toLowerCase()) : bN;
    if (relational[1] === "<") return a < b;
    if (relational[1] === ">") return a > b;
    if (relational[1] === "<=") return a <= b;
    return a >= b;
  }
  if (right.includes("*")) {
    const pattern = right.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${pattern}$`, casesensitive ? "" : "i").test(original);
  }
  return left === right;
}
function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>, casesensitive = false) {
  return Object.entries(where || {}).every(([key, condition]) => {
    if (key === "contains" && condition && typeof condition === "object") {
      return Object.entries(condition as Record<string, unknown>).every(([column, value]) => {
        const source = String(valueOf(row, column) ?? ""), target = String(value ?? "");
        return casesensitive ? source.includes(target) : source.toLowerCase().includes(target.toLowerCase());
      });
    }
    return compare(valueOf(row, key), String(condition), casesensitive);
  });
}
const RESERVED_QUERY = new Set([
  "sheet", "limit", "offset", "sort_by", "sort_order", "sort", "order", "sort_method", "sort_date_format",
  "cast_numbers", "single_object", "mode", "casesensitive", "legacy", "raw", "infer_types", "select",
  "group_by", "count", "sum", "avg", "min", "max", "search", "page_size", "page_token", "order_by", "include_empty",
]);
function filterRows(rows: Record<string, unknown>[], url: URL, orMode = false) {
  const casesensitive = url.searchParams.get("casesensitive") === "true", search = url.searchParams.get("search");
  let filtered = rows;
  if (search) {
    const needle = casesensitive ? search : search.toLowerCase();
    filtered = filtered.filter((row) => Object.values(row).some((value) => {
      const text = String(value ?? "");
      return casesensitive ? text.includes(needle) : text.toLowerCase().includes(needle);
    }));
  }
  const conditions: Array<[string, string[]]> = [];
  for (const key of new Set(Array.from(url.searchParams.keys()).filter((item) => !RESERVED_QUERY.has(item) && !item.startsWith("contains[")))) {
    conditions.push([key.endsWith("[]") ? key.slice(0, -2) : key, url.searchParams.getAll(key)]);
  }
  for (const key of Array.from(url.searchParams.keys()).filter((item) => item.startsWith("contains[") && item.endsWith("]"))) {
    conditions.push([`contains:${key.slice(9, -1)}`, url.searchParams.getAll(key)]);
  }
  if (!conditions.length) return filtered;
  return filtered.filter((row) => {
    const matches = conditions.map(([key, values]) => {
      if (key.startsWith("contains:")) {
        const source = String(valueOf(row, key.slice(9)) ?? "");
        return values.every((value) => casesensitive ? source.includes(value) : source.toLowerCase().includes(value.toLowerCase()));
      }
      return values.some((value) => compare(valueOf(row, key), value, casesensitive));
    });
    return orMode ? matches.some(Boolean) : matches.every(Boolean);
  });
}
function queryList(url: URL, name: string) {
  const values = url.searchParams.getAll(name).flatMap((value) => value.split(","));
  return values.map((value) => value.trim()).filter((value, index, list) => value && list.indexOf(value) === index);
}
function aggregate(rows: Record<string, unknown>[], url: URL) {
  const groupBy = url.searchParams.get("group_by"), countField = url.searchParams.get("count");
  const sums = queryList(url, "sum"), avgs = queryList(url, "avg"), mins = queryList(url, "min"), maxs = queryList(url, "max");
  if (!groupBy && !countField && !sums.length && !avgs.length && !mins.length && !maxs.length) return null;
  const groups = new Map<string, Record<string, unknown>[]>();
  if (groupBy) rows.forEach((row) => { const key = String(valueOf(row, groupBy) ?? ""); groups.set(key, [...(groups.get(key) || []), row]); });
  else groups.set("_all", rows);
  return Array.from(groups.entries()).map(([key, members]) => {
    const result: Record<string, unknown> = groupBy ? { [groupBy]: key } : {};
    result.count = members.length;
    if (countField) result[`count_${countField}`] = members.filter((row) => String(valueOf(row, countField) ?? "") !== "").length;
    sums.forEach((field) => { result[`sum_${field}`] = members.reduce((total, row) => total + (Number(valueOf(row, field)) || 0), 0); });
    avgs.forEach((field) => { const values = members.map((row) => Number(valueOf(row, field))).filter((value) => !Number.isNaN(value)); result[`avg_${field}`] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; });
    mins.forEach((field) => { const values = members.map((row) => Number(valueOf(row, field))).filter((value) => !Number.isNaN(value)); result[`min_${field}`] = values.length ? Math.min(...values) : null; });
    maxs.forEach((field) => { const values = members.map((row) => Number(valueOf(row, field))).filter((value) => !Number.isNaN(value)); result[`max_${field}`] = values.length ? Math.max(...values) : null; });
    return result;
  });
}
function inferValue(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^null$/i.test(text)) return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && !(text.length > 1 && /^-?0\d/.test(text))) return Number(text);
  return value;
}
function transform(rows: Record<string, unknown>[], url: URL): PageResult {
  let result = [...rows];
  const sortBy = url.searchParams.get("sort_by") || url.searchParams.get("sort"), order = (url.searchParams.get("sort_order") || url.searchParams.get("order") || "asc").toLowerCase();
  if (sortBy) result.sort((a, b) => {
    const left = String(valueOf(a, sortBy) ?? ""), right = String(valueOf(b, sortBy) ?? ""), aN = Number(left), bN = Number(right);
    const comparison = !Number.isNaN(aN) && !Number.isNaN(bN) ? aN - bN : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    return order === "desc" ? -comparison : comparison;
  });
  const total = result.length, offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0) || 0));
  const requestedRaw = Math.floor(Number(url.searchParams.get("limit") || 0) || 0), single = url.searchParams.get("single_object") === "true";
  const pageLimit = single ? 1 : requestedRaw > 0 ? Math.min(requestedRaw, MAX_PAGE_SIZE) : MAX_PAGE_SIZE;
  result = result.slice(offset, offset + pageLimit);
  const casts = (url.searchParams.get("cast_numbers") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (casts.length) result = result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, (casts.includes("*") || casts.includes(key)) && value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value])));
  if (url.searchParams.get("infer_types") === "true") result = result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, inferValue(value)])));
  const select = (url.searchParams.get("select") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (select.length) result = result.map((row) => Object.fromEntries(select.map((key) => [key, valueOf(row, key) ?? ""])));
  const returned = single ? (result[0] ? 1 : 0) : result.length, consumed = single ? returned : result.length;
  const hasMore = offset + consumed < total;
  return {
    data: single ? (result[0] || {}) : result,
    total,
    limit: requestedRaw > 0 || single ? pageLimit : result.length,
    offset,
    returned,
    has_more: hasMore,
    next_offset: hasMore ? offset + consumed : null,
    max_limit: MAX_PAGE_SIZE,
  };
}
function envelope(api: ApiRecord, sheet: string, page: PageResult) {
  return { data: page.data, total: page.total, limit: page.limit, offset: page.offset, returned: page.returned, has_more: page.has_more, next_offset: page.next_offset, max_limit: page.max_limit, meta: { api_id: api.api_id, name: api.name, sheet } };
}
function jsonAttachment(api: ApiRecord, payload: unknown) {
  const filename = `${api.name.replace(/[^A-Za-z0-9_-]+/g, "-") || "littleapi"}.json`;
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "X-LittleAPI-Version": API_VERSION } });
}

async function isUnlimitedOwner(userId: string) {
  try {
    const rows = await dbFetch(`littleapi_unlimited_users?select=user_id&user_id=eq.${encodeURIComponent(userId)}&enabled=eq.true&limit=1`);
    return Boolean(rows?.[0]?.user_id);
  } catch (_) { return false; }
}
async function consumeQuota(api: ApiRecord) {
  if (await isUnlimitedOwner(api.user_id)) return null;
  const limit = Math.max(1, Number(api.monthly_request_limit || 5000));
  const result = await dbFetch("rpc/consume_api_quota", { method: "POST", body: JSON.stringify({ p_api_id: api.api_id, p_limit: limit }) });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row) throw new Error("El servicio de cuotas no devolvió un estado válido.");
  const state: QuotaState = { allowed: Boolean(row.allowed), used: Number(row.used || 0), limit: Number(row.limit_value || limit), reset_at: String(row.reset_at || "") };
  if (state.allowed) return null;
  const reset = Date.parse(state.reset_at), retryAfter = Number.isNaN(reset) ? 3600 : Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return response({ error: "quota_exceeded", message: "Esta API ya no tiene más consultas disponibles este mes.", quota: { used: state.used, limit: state.limit, remaining: 0, reset_at: state.reset_at } }, 429, {
    "Retry-After": String(retryAfter), "X-LittleAPI-Quota-Limit": String(state.limit), "X-LittleAPI-Quota-Used": String(state.used), "X-LittleAPI-Quota-Remaining": "0", "X-LittleAPI-Quota-Reset": state.reset_at,
  });
}
async function quotaStatus(api: ApiRecord) {
  const period = new Date(); period.setUTCDate(1);
  const start = period.toISOString().slice(0, 10), rows = await dbFetch(`api_usage_monthly?select=period_start,requests&api_id=eq.${encodeURIComponent(api.api_id)}&period_start=eq.${start}&limit=1`), used = Number(rows?.[0]?.requests || 0);
  const reset = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1)).toISOString();
  if (await isUnlimitedOwner(api.user_id)) return { used, limit: null, remaining: null, reset_at: null, unlimited: true };
  const limit = Math.max(1, Number(api.monthly_request_limit || 5000));
  return { used, limit, remaining: Math.max(0, limit - used), reset_at: reset };
}
function csvCell(value: unknown) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function csvResponse(api: ApiRecord, table: TableData, sheet: string, includeEmpty = false) {
  const rows = includeEmpty ? table.rows : table.rows.filter(rowHasData);
  const csv = [table.headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(csv, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${api.name.replace(/[^A-Za-z0-9_-]+/g, "-")}-${sheet.replace(/[^A-Za-z0-9_-]+/g, "-")}.csv"`, "X-LittleAPI-Version": API_VERSION } });
}

async function exportOperation(api: ApiRecord, request: Request, format: "csv" | "xlsx") {
  const url = new URL(request.url), sheet = url.searchParams.get("sheet") || api.default_sheet || "Sheet1";
  if (format === "csv") {
    if (api.resource_type !== "sheet") return failure(400, "not_a_sheet_api", "CSV sólo está disponible para APIs de Sheets.");

    const render = String(url.searchParams.get("render") || "").toUpperCase() === "FORMULA"
      ? "FORMULA"
      : "FORMATTED_VALUE";

    if (render === "FORMULA") {
      if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta API requiere la cabecera X-API-Key.");
      const table = await readAuthorized(api, await googleTokenForUser(api.user_id), sheet, "FORMULA");
      return csvResponse(api, table, sheet, shouldIncludeEmptyRows(url));
    }

    const table = api.public_read ? await readPublicSheet(api, sheet) : (await hasApiKey(api, request) ? await readAuthorized(api, await googleTokenForUser(api.user_id), sheet) : null);
    if (!table) return failure(401, "api_key_required", "Esta API privada requiere la cabecera X-API-Key.");
    return csvResponse(api, table, sheet, shouldIncludeEmptyRows(url));
  }
  if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "La exportación Excel requiere la cabecera X-API-Key.");
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) return failure(400, "not_a_sheet_api", "Excel sólo está disponible para APIs de Sheets.");
  const token = await googleTokenForUser(api.user_id), result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(api.spreadsheet_id)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!result.ok) throw new Error(`Google Drive respondió ${result.status}: ${((await result.text()) || "").slice(0, 500)}`);
  return new Response(await result.arrayBuffer(), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${api.name.replace(/[^A-Za-z0-9_-]+/g, "-")}.xlsx"`, "X-LittleAPI-Version": API_VERSION } });
}
async function listSheetsOperation(api: ApiRecord, request: Request) {
  if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Listar pestañas requiere la cabecera X-API-Key.");
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) return failure(400, "not_a_sheet_api", "Esta API no está vinculada a un libro de Sheets.");
  const metadata = await spreadsheetMetadata(api, await googleTokenForUser(api.user_id));
  const sheets = (metadata.sheets || []).map((item: any) => ({ sheet_id: item.properties?.sheetId, title: item.properties?.title, index: item.properties?.index, row_count: item.properties?.gridProperties?.rowCount, column_count: item.properties?.gridProperties?.columnCount }));
  return response({ data: sheets, total: sheets.length });
}
async function readOperation(api: ApiRecord, request: Request, path: string[]) {
  const url = new URL(request.url);
  if (api.public_read !== true && !(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta API requiere la cabecera X-API-Key.");
  if (path[0] === "name") return response({ name: api.name, api_id: api.api_id });
  if (path[0] === "metadata" || path[0] === "openapi.json") return metadataResponse(api, path[0] === "openapi.json", request);
  if (path[0] === "sheets") return listSheetsOperation(api, request);
  if (path[0] === "export.csv") return exportOperation(api, request, "csv");
  if (path[0] === "export.xlsx") return exportOperation(api, request, "xlsx");
  if (api.resource_type === "drive") return driveOperation(api, request, path);
  const sheet = url.searchParams.get("sheet") || api.default_sheet || "Sheet1";
  const isSearch = path[0] === "search" || path[0] === "search_or";
  const denied = requirePermission(api, isSearch ? "search" : "read", request);
  if (denied) return denied;
  const cacheable = !["export.json", "keys", "count", "cells"].includes(path[0] || "");
  const cacheKey = `${api.api_id}:${path.join("/") || "root"}:${url.search}`;
  const cached = cacheable ? cache.get(cacheKey) : null;
  if (cached && cached.expires > Date.now()) return response(cached.value, 200, { "X-LittleAPI-Cache": "HIT", "Cache-Control": api.public_read ? `public, max-age=${Math.min(api.cache_ttl, 3600)}` : "no-store" });
  const table = api.public_read ? await readPublicSheet(api, sheet) : await readAuthorized(api, await googleTokenForUser(api.user_id), sheet);
  const allObjects = rowsAsObjects(table.headers, table.rows);
  const objects = shouldIncludeEmptyRows(url) ? allObjects : allObjects.filter(rowHasData);
  if (path[0] === "keys") return response(table.headers);
  if (path[0] === "count") return response({ rows: objects.length });
  if (path[0] === "cells") {
    const matrix = [table.headers, ...table.rows], cells: Record<string, unknown> = {};
    for (const cell of (path[1] || "").split(",")) {
      const match = cell.toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (match) cells[cell.toUpperCase()] = matrix[Number(match[2]) - 1]?.[columnNumber(match[1]) - 1] ?? "";
    }
    return response(cells);
  }
  const filtered = isSearch ? filterRows(objects, url, path[0] === "search_or") : objects;
  const grouped = aggregate(filtered, url), page = transform(grouped || filtered, url);
  const raw = url.searchParams.get("raw") === "true" || url.searchParams.get("legacy") === "true";
  const body = raw ? page.data : envelope(api, sheet, page);
  if (path[0] === "export.json") return jsonAttachment(api, body);
  if (cacheable && api.cache_ttl > 0) cache.set(cacheKey, { expires: Date.now() + Math.min(api.cache_ttl, 3600) * 1000, value: body });
  return response(body, 200, { "X-LittleAPI-Cache": "MISS", "Cache-Control": api.public_read && api.cache_ttl > 0 ? `public, max-age=${Math.min(api.cache_ttl, 3600)}` : "no-store" });
}

function base64(bytes: Uint8Array) { let result = ""; for (const byte of bytes) result += String.fromCharCode(byte); return btoa(result); }
function fromBase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
async function encryptionKey() {
  const secret = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") || "";
  if (!secret) throw new Error("Falta GOOGLE_TOKEN_ENCRYPTION_KEY en los secretos de la función.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  const joined = new Uint8Array(iv.length + encrypted.byteLength); joined.set(iv); joined.set(new Uint8Array(encrypted), iv.length); return base64(joined);
}
async function decryptToken(value: string) {
  const joined = fromBase64(value), iv = joined.slice(0, 12), encrypted = joined.slice(12), plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), encrypted);
  return new TextDecoder().decode(plain);
}
async function apiKeyEncryptionKey() {
  const secret = Deno.env.get("LITTLEAPI_KEY_ENCRYPTION_KEY") || Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") || serviceKey;
  if (!secret) throw new Error("Falta una clave de cifrado del servidor para guardar la clave de API.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptApiKey(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await apiKeyEncryptionKey(), new TextEncoder().encode(value));
  const joined = new Uint8Array(iv.length + encrypted.byteLength); joined.set(iv); joined.set(new Uint8Array(encrypted), iv.length); return base64(joined);
}
async function decryptApiKey(value: string) {
  const joined = fromBase64(value), iv = joined.slice(0, 12), encrypted = joined.slice(12), plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await apiKeyEncryptionKey(), encrypted);
  return new TextDecoder().decode(plain);
}
async function currentUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), authKey = publicKey || serviceKey;
  if (!token || !supabaseUrl || !authKey) return null;
  const result = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: authKey, Authorization: `Bearer ${token}` } });
  return result.ok ? await result.json() : null;
}
async function apiKeyConnection(request: Request) {
  const user = await currentUser(request);
  if (!user?.id) return failure(401, "login_required", "Inicia sesión para consultar la clave de API.");
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
  const apiKey = String(body.api_key || "").trim();
  if (!/^sp_live_[A-Za-z0-9_-]{20,}$/.test(apiKey)) return failure(400, "invalid_api_key", "La clave de API no tiene un formato válido.");
  const ciphertext = await encryptApiKey(apiKey);
  await dbFetch(`api_endpoints?id=eq.${encodeURIComponent(rows[0].id)}`, { method: "PATCH", body: JSON.stringify({ api_key_hash: await sha256(apiKey), api_key_prefix: apiKey.slice(0, 16), api_key_ciphertext: ciphertext, updated_at: new Date().toISOString() }) });
  return response({ success: true, api_id: apiId, stored: true });
}

function randomApiAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return "sp_live_" + btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizedAccessKeyPermissions(value: unknown, apiPermissions: Record<string, boolean> | null | undefined) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: Record<string, boolean> = {};
  for (const key of ["read", "search", "create", "update", "delete"]) {
    const requested = key in source ? source[key] !== false : (key === "read" || key === "search");
    result[key] = apiPermissions?.[key] !== false && requested;
  }
  return result;
}

async function apiKeysConnection(request: Request) {
  const user = await currentUser(request);
  if (!user?.id) return failure(401, "login_required", "Sign in to manage API keys.");
  const url = new URL(request.url);
  const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
  const apiId = String((body as any).api_id || url.searchParams.get("api_id") || "").trim();
  if (!apiId) return failure(400, "api_id_required", "Provide api_id.");

  const owned = await dbFetch(`api_endpoints?select=id,api_id,name,permissions&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
  const api = owned?.[0];
  if (!api) return failure(404, "api_not_found", "No API owned by this account exists with that identifier.");

  const keyId = String((body as any).id || url.searchParams.get("id") || "").trim();
  if (request.method === "GET") {
    const rows = await dbFetch(`api_access_keys?select=id,api_id,name,key_prefix,permissions,enabled,expires_at,last_used_at,created_at,updated_at&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.asc`);
    return response({ data: rows || [] });
  }

  if (request.method === "POST") {
    const existing = await dbFetch(`api_access_keys?select=id&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=21`);
    if ((existing || []).length >= 20) return failure(409, "api_key_limit", "This API already has the maximum of 20 additional keys.");
    const name = String((body as any).name || "").trim();
    if (!name || name.length > 80) return failure(400, "invalid_name", "Key name must contain 1 to 80 characters.");
    let expiresAt: string | null = null;
    if ((body as any).expires_at) {
      const parsed = Date.parse(String((body as any).expires_at));
      if (!Number.isFinite(parsed) || parsed <= Date.now()) return failure(400, "invalid_expiry", "Expiration must be a future date.");
      expiresAt = new Date(parsed).toISOString();
    }
    const secret = randomApiAccessKey();
    const permissions = normalizedAccessKeyPermissions((body as any).permissions, api.permissions || {});
    const rows = await dbFetch("api_access_keys", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        api_id: apiId,
        user_id: user.id,
        name,
        key_hash: await sha256(secret),
        key_prefix: secret.slice(0, 16),
        permissions,
        enabled: true,
        expires_at: expiresAt,
      }),
    });
    const created = rows?.[0];
    return response({
      success: true,
      key: created ? {
        id: created.id, api_id: apiId, name: created.name, key_prefix: created.key_prefix,
        permissions: created.permissions, enabled: created.enabled, expires_at: created.expires_at,
        created_at: created.created_at,
      } : null,
      api_key: secret,
      message: "Copy this key now. It will not be shown again.",
    }, 201);
  }

  if (!keyId) return failure(400, "key_id_required", "Provide the key id.");

  if (request.method === "PATCH") {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ((body as any).name !== undefined) {
      const name = String((body as any).name || "").trim();
      if (!name || name.length > 80) return failure(400, "invalid_name", "Key name must contain 1 to 80 characters.");
      patch.name = name;
    }
    if ((body as any).permissions !== undefined) patch.permissions = normalizedAccessKeyPermissions((body as any).permissions, api.permissions || {});
    if ((body as any).enabled !== undefined) patch.enabled = Boolean((body as any).enabled);
    if ((body as any).expires_at !== undefined) {
      if (!(body as any).expires_at) patch.expires_at = null;
      else {
        const parsed = Date.parse(String((body as any).expires_at));
        if (!Number.isFinite(parsed) || parsed <= Date.now()) return failure(400, "invalid_expiry", "Expiration must be a future date.");
        patch.expires_at = new Date(parsed).toISOString();
      }
    }
    await dbFetch(`api_access_keys?id=eq.${encodeURIComponent(keyId)}&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    return response({ success: true, id: keyId });
  }

  if (request.method === "DELETE") {
    await dbFetch(`api_access_keys?id=eq.${encodeURIComponent(keyId)}&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return response({ success: true, deleted: keyId });
  }

  return failure(405, "method_not_allowed", "Use GET, POST, PATCH, or DELETE for additional API keys.");
}

async function refreshGoogleTokenForUser(userId: string) {
  if (!serviceKey) throw new Error("La función necesita SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEYS para leer la conexión privada.");
  const rows = await dbFetch(`google_connections?select=refresh_token_ciphertext&user_id=eq.${encodeURIComponent(userId)}&limit=1`), encrypted = rows?.[0]?.refresh_token_ciphertext;
  if (!encrypted) throw new Error("Conecta Google otra vez y acepta los permisos de Sheets y Drive.");
  const refreshToken = await decryptToken(encrypted), clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "", clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) throw new Error("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en los secretos de la función.");
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const data = await result.json().catch(() => ({}));
  if (!result.ok || !data.access_token) throw new Error(data.error_description || "Google no pudo renovar la autorización.");
  return { access_token: data.access_token as string, expires_in: Number(data.expires_in || 3600) };
}
async function googleTokenForUser(userId: string) { return (await refreshGoogleTokenForUser(userId)).access_token; }
async function accountSheetSchema(request: Request) {
  const user = await currentUser(request);
  if (!user?.id) return failure(401, "login_required", "Inicia sesión para consultar la estructura de esta hoja.");
  if (request.method !== "GET") return failure(405, "method_not_allowed", "Usa GET para consultar la estructura de la hoja.");

  const url = new URL(request.url);
  const apiId = String(url.searchParams.get("api_id") || "").trim();
  if (!apiId) return failure(400, "api_id_required", "Indica el API_ID.");

  const api = await getApi(apiId);
  if (!api || api.user_id !== user.id) return failure(404, "api_not_found", "No existe una API propia con ese identificador.");
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) {
    return failure(400, "not_a_sheet_api", "Esta API no está vinculada a un libro de Google Sheets.");
  }

  try {
    const token = await googleTokenForUser(user.id);
    const metadata = await spreadsheetMetadata(api, token);
    const sheets = (metadata.sheets || [])
      .map((item: any) => ({
        sheet_id: item.properties?.sheetId,
        title: item.properties?.title,
        index: item.properties?.index,
      }))
      .filter((item: any) => item.title)
      .sort((a: any, b: any) => Number(a.index || 0) - Number(b.index || 0));

    let selectedSheet = String(url.searchParams.get("sheet") || api.default_sheet || sheets[0]?.title || "").trim();
    if (selectedSheet && !sheets.some((item: any) => item.title === selectedSheet)) {
      selectedSheet = String(sheets[0]?.title || "");
    }

    let headers: string[] = [];
    let preview: unknown[][] = [];
    if (selectedSheet) {
      const previewData = await sheetsRequest(
        api,
        token,
        `spreadsheets/${encodeURIComponent(api.spreadsheet_id)}/values/${encodeURIComponent(sheetRange(selectedSheet, "A1:ZZ9"))}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      );
      const values = Array.isArray(previewData.values) ? previewData.values : [];
      headers = (Array.isArray(values[0]) ? values[0] : [])
        .map((value: unknown, index: number) => String(value == null || value === "" ? columnName(index + 1) : value));
      preview = values.slice(1).filter((row: unknown[]) => rowHasData(row)).slice(0, 8);
    }

    return response({
      api_id: api.api_id,
      api_name: api.name,
      public_read: api.public_read === true,
      permissions: api.permissions || {},
      sheets,
      selected_sheet: selectedSheet,
      headers,
      preview,
      oauth_scope: "https://www.googleapis.com/auth/drive.file",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/403|insufficient|permission|scope/i.test(message)) {
      return failure(
        409,
        "google_file_access_required",
        "Vuelve a autorizar esta hoja con Google para que LittleAPI pueda leerla mediante drive.file.",
      );
    }
    if (/refresh|oauth|token/i.test(message)) {
      return failure(
        401,
        "google_reauthorization_required",
        "Vuelve a iniciar sesión con Google para renovar el acceso de LittleAPI.",
      );
    }
    throw error;
  }
}

async function googleConnection(request: Request) {
  const user = await currentUser(request);
  if (!user?.id) return failure(401, "login_required", "Inicia sesión para conectar Google.");
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/access-token")) {
    try { return response(await refreshGoogleTokenForUser(user.id)); }
    catch (error) { return failure(401, "google_token_refresh_failed", error instanceof Error ? error.message : "Google no pudo renovar la autorización."); }
  }
  if (request.method === "GET") {
    const rows = await dbFetch(`google_connections?select=user_id,scopes,updated_at&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    return response({ connected: Boolean(rows?.[0]), scopes: rows?.[0]?.scopes || [], updated_at: rows?.[0]?.updated_at || null });
  }
  if (request.method === "DELETE") {
    await dbFetch(`google_connections?user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" });
    return response({ success: true, connected: false });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.provider_refresh_token) return failure(400, "refresh_token_required", "Google no entregó un refresh token. Vuelve a autorizar con access_type=offline y prompt=consent.");
  const encrypted = await encryptToken(String(body.provider_refresh_token));
  await dbFetch("google_connections", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: user.id, refresh_token_ciphertext: encrypted, scopes: body.scopes || [], updated_at: new Date().toISOString() }) });
  return response({ success: true, connected: true });
}

async function updateValues(api: ApiRecord, token: string, range: string, values: unknown[][]) {
  return sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) });
}
async function spreadsheetMetadata(api: ApiRecord, token: string) {
  return sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}?includeGridData=false&fields=spreadsheetId,properties,sheets.properties`);
}
function nonEmptyObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length); }
async function mutationOperation(api: ApiRecord, request: Request, path: string[]) {
  if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Las operaciones de escritura requieren la cabecera X-API-Key.");
  const action = request.method === "POST" ? "create" : request.method === "PATCH" ? "update" : "delete", denied = requirePermission(api, action, request);
  if (denied) return denied;
  if (api.resource_type === "drive") return driveOperation(api, request, path);
  const body = request.method === "DELETE" || request.headers.get("content-length") === "0" ? await request.json().catch(() => ({})) : await request.json().catch(() => ({}));
  const token = await googleTokenForUser(api.user_id), sheet = String(body.sheet || new URL(request.url).searchParams.get("sheet") || api.default_sheet || "Sheet1");
  if (path[0] === "sheets" && path[1] === "copy") return copySheet(api, token, body);
  if (path[0] === "sheets") return sheetAdmin(api, token, request, path.slice(1), body);
  if (path[0] === "format" || path[0] === "clear" || path[0] === "batch") return sheetUtility(api, token, request, path[0], body, sheet);
  const table = await readAuthorized(api, token, sheet), headers = table.headers;
  if (request.method === "POST") {
    const incoming = Array.isArray(body) ? body : body.rows || body.data || body.row || body, rows = Array.isArray(incoming) ? incoming : [incoming];
    if (!rows.length) return failure(400, "rows_required", "Envía al menos una fila.");
    const values = rows.map((row: unknown) => Array.isArray(row) ? row : headers.map((header) => (row as Record<string, unknown>)[header] ?? ""));
    const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values }) });
    cache.clear(); return response({ success: true, inserted: values.length, updates: result.updates || null }, 201);
  }
  if (request.method === "PATCH" && body.range && Array.isArray(body.values)) {
    await updateValues(api, token, sheetRange(sheet, body.range), body.values); cache.clear();
    return response({ success: true, updated: body.values.length, range: body.range });
  }
  const whereCandidate = body.where || body.match || (body.row && !body.data ? body.row : null), where = nonEmptyObject(whereCandidate) ? whereCandidate : null;
  const allowAll = body.all === true || body.confirm_all === true;
  if (!where && !allowAll) return failure(400, "filter_required", "PATCH y DELETE requieren where/match. Para afectar todas las filas debes enviar all:true explícitamente.");
  const casesensitive = body.casesensitive === true;
  const indexed = table.rows.map((row, index) => ({ row, object: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])), sheetRow: index + 2 })).filter((entry) => !where || matchWhere(entry.object, where, casesensitive));
  if (!indexed.length) return response({ success: true, matched: 0, updated: 0, deleted: 0 });
  if (request.method === "PATCH") {
    const changes = body.data || body.update || {};
    if (!nonEmptyObject(changes)) return failure(400, "update_required", "Indica las columnas a actualizar en data o update.");
    for (const entry of indexed) {
      const next = headers.map((header, column) => Object.prototype.hasOwnProperty.call(changes, header) ? changes[header] : entry.row[column] ?? "");
      await updateValues(api, token, sheetRange(sheet, `A${entry.sheetRow}:${columnName(headers.length)}${entry.sheetRow}`), [next]);
    }
    cache.clear(); return response({ success: true, matched: indexed.length, updated: indexed.length });
  }
  const metadata = await spreadsheetMetadata(api, token), sheetInfo = metadata.sheets?.find((item: any) => item.properties?.title === sheet), sheetId = sheetInfo?.properties?.sheetId;
  if (sheetId === undefined) return failure(404, "sheet_not_found", "No se encontró la pestaña para eliminar las filas.");
  const requests = indexed.map((entry) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: entry.sheetRow - 1, endIndex: entry.sheetRow } } })).reverse();
  await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  cache.clear(); return response({ success: true, matched: indexed.length, deleted: indexed.length });
}
async function sheetAdmin(api: ApiRecord, token: string, request: Request, subpath: string[], body: any) {
  const title = decodeURIComponent(subpath[0] || body.name || "");
  if (request.method === "POST") {
    const name = String(body.name || "").trim();
    if (!name) return failure(400, "sheet_name_required", "Indica name para la nueva pestaña.");
    const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name } } }] }) });
    cache.clear(); return response({ success: true, sheet: result.replies?.[0]?.addSheet?.properties || null }, 201);
  }
  if (!title) return failure(400, "sheet_name_required", "Indica la pestaña en la ruta.");
  const metadata = await spreadsheetMetadata(api, token), info = metadata.sheets?.find((item: any) => item.properties?.title === title);
  if (!info) return failure(404, "sheet_not_found", "No existe esa pestaña.");
  if (request.method === "PATCH" && !String(body.name || "").trim()) return failure(400, "sheet_name_required", "Indica name con el nuevo nombre.");
  if (request.method === "DELETE" && (metadata.sheets || []).length <= 1) return failure(409, "last_sheet", "Google Sheets necesita conservar al menos una pestaña.");
  const requestBody = request.method === "PATCH" ? { updateSheetProperties: { properties: { sheetId: info.properties.sheetId, title: String(body.name).trim() }, fields: "title" } } : { deleteSheet: { sheetId: info.properties.sheetId } };
  await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [requestBody] }) });
  cache.clear(); return response({ success: true, sheet: request.method === "PATCH" ? String(body.name).trim() : title });
}
async function copySheet(api: ApiRecord, token: string, body: any) {
  if (!api.spreadsheet_id) return failure(400, "spreadsheet_required", "Esta API no tiene un libro de Google Sheets.");
  const destination = String(body.destination_spreadsheet_id || body.destinationSpreadsheetId || "").trim();
  if (!destination) return failure(400, "destination_required", "Indica destination_spreadsheet_id.");
  const metadata = await spreadsheetMetadata(api, token), requested = String(body.sheet_id ?? body.sheet ?? api.default_sheet ?? "");
  const info = metadata.sheets?.find((item: any) => String(item.properties?.sheetId) === requested || item.properties?.title === requested);
  if (!info?.properties?.sheetId && info?.properties?.sheetId !== 0) return failure(404, "sheet_not_found", "No existe la pestaña que quieres copiar.");
  const copied = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id)}/sheets/${encodeURIComponent(info.properties.sheetId)}:copyTo`, { method: "POST", body: JSON.stringify({ destinationSpreadsheetId: destination }) });
  return response({ success: true, source_spreadsheet_id: api.spreadsheet_id, destination_spreadsheet_id: destination, sheet: copied }, 201);
}
function parseA1Part(value: string) {
  const match = String(value || "").trim().toUpperCase().match(/^([A-Z]*)(\d*)$/);
  if (!match) return null;
  return { column: match[1] ? columnNumber(match[1]) - 1 : null, row: match[2] ? Number(match[2]) - 1 : null };
}
function gridRangeFromA1(sheetId: number, input: string) {
  const clean = String(input || "").trim().replace(/^'[^']+'!/, "").replace(/^[^!]+!/, "");
  if (!clean) return { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 26 };
  const pieces = clean.split(":");
  if (pieces.length > 2) return null;
  const start = parseA1Part(pieces[0]), end = parseA1Part(pieces[1] || pieces[0]);
  if (!start || !end || (start.column === null && start.row === null)) return null;
  const range: Record<string, number> = { sheetId };
  if (start.column !== null) range.startColumnIndex = start.column;
  if (start.row !== null) range.startRowIndex = start.row;
  if (pieces.length === 1) {
    if (start.column !== null) range.endColumnIndex = start.column + 1;
    if (start.row !== null) range.endRowIndex = start.row + 1;
  } else {
    if (end.column !== null) range.endColumnIndex = end.column + 1;
    if (end.row !== null) range.endRowIndex = end.row + 1;
  }
  return range;
}
function color(value: string) {
  let hex = String(value || "").trim().replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split("").map((char) => char + char).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = (part: string) => parseInt(part, 16) / 255;
  return { red: n(hex.slice(0, 2)), green: n(hex.slice(2, 4)), blue: n(hex.slice(4, 6)) };
}
async function sheetUtility(api: ApiRecord, token: string, request: Request, operation: string, body: any, sheet: string) {
  if (operation === "batch") {
    if (!Array.isArray(body.requests) || body.requests.length < 1 || body.requests.length > 50) return failure(400, "invalid_batch", "Envía entre 1 y 50 solicitudes de Google Sheets.");
    await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: body.requests }) });
    cache.clear(); return response({ success: true, applied: body.requests.length });
  }
  const range = sheetRange(sheet, body.range || "A1:ZZ1000");
  if (operation === "clear") {
    await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(range)}:clear`, { method: "POST", body: "{}" });
    cache.clear(); return response({ success: true, range: body.range || "A1:ZZ1000" });
  }
  const metadata = await spreadsheetMetadata(api, token), info = metadata.sheets?.find((item: any) => item.properties?.title === sheet);
  if (!info) return failure(404, "sheet_not_found", "No existe esa pestaña.");
  const parsedRange = body.gridRange || gridRangeFromA1(info.properties.sheetId, body.range || "A1:Z1");
  if (!parsedRange) return failure(400, "invalid_range", "El rango A1 no es válido.");
  const fields: string[] = [], format: any = {};
  const setText = (name: string, value: unknown) => { format.textFormat = { ...(format.textFormat || {}), [name]: value }; fields.push(`userEnteredFormat.textFormat.${name}`); };
  if (body.bold !== undefined) setText("bold", Boolean(body.bold));
  if (body.italic !== undefined) setText("italic", Boolean(body.italic));
  if (body.underline !== undefined) setText("underline", Boolean(body.underline));
  if (body.strikethrough !== undefined) setText("strikethrough", Boolean(body.strikethrough));
  if (body.fontSize !== undefined) setText("fontSize", Number(body.fontSize));
  if (body.textColor) { const parsed = color(body.textColor); if (!parsed) return failure(400, "invalid_color", "textColor debe ser un color hexadecimal como #ffffff."); format.textFormat = { ...(format.textFormat || {}), foregroundColor: parsed }; fields.push("userEnteredFormat.textFormat.foregroundColor"); }
  if (body.bgColor) { const parsed = color(body.bgColor); if (!parsed) return failure(400, "invalid_color", "bgColor debe ser un color hexadecimal como #087a70."); format.backgroundColor = parsed; fields.push("userEnteredFormat.backgroundColor"); }
  if (body.horizontalAlignment) { format.horizontalAlignment = String(body.horizontalAlignment).toUpperCase(); fields.push("userEnteredFormat.horizontalAlignment"); }
  if (body.verticalAlignment) { format.verticalAlignment = String(body.verticalAlignment).toUpperCase(); fields.push("userEnteredFormat.verticalAlignment"); }
  if (body.wrapStrategy) { format.wrapStrategy = String(body.wrapStrategy).toUpperCase(); fields.push("userEnteredFormat.wrapStrategy"); }
  if (!fields.length) return failure(400, "invalid_format", "Indica al menos una propiedad de formato.");
  await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ repeatCell: { range: parsedRange, cell: { userEnteredFormat: format }, fields: fields.join(",") } }] }) });
  cache.clear(); return response({ success: true, range: body.range || null, gridRange: parsedRange });
}

async function driveRequest(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {}); headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers }), text = await result.text();
  if (!result.ok) throw new Error(`Google Drive respondió ${result.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}
function driveListPath(q: string, url: URL) {
  const fields = "files(id,name,mimeType,size,modifiedTime,parents,webViewLink),nextPageToken", requested = Number(url.searchParams.get("page_size") || 100) || 100;
  const params = new URLSearchParams({ q, fields, pageSize: String(Math.max(1, Math.min(1000, Math.floor(requested)))) });
  const token = url.searchParams.get("page_token"); if (token) params.set("pageToken", token);
  const order = url.searchParams.get("order_by"); if (order) params.set("orderBy", order);
  return `files?${params.toString()}`;
}
async function driveOperation(api: ApiRecord, request: Request, path: string[]) {
  const token = await googleTokenForUser(api.user_id), mode = path[0] || "", id = ["children", "download", "export"].includes(mode) ? (path[1] || api.drive_file_id || "root") : (mode || api.drive_file_id || "root");
  if (request.method === "GET") {
    if (mode === "download") {
      const result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (!result.ok) throw new Error(`Google Drive respondió ${result.status}: ${((await result.text()) || "").slice(0, 500)}`);
      return new Response(await result.arrayBuffer(), { status: 200, headers: { ...corsHeaders, "Content-Type": result.headers.get("content-type") || "application/octet-stream", "Content-Disposition": `attachment; filename="${id}"`, "X-LittleAPI-Version": API_VERSION } });
    }
    if (mode === "export") {
      const url = new URL(request.url), mimeType = url.searchParams.get("mime_type") || "";
      if (!mimeType) return failure(400, "mime_type_required", "Indica mime_type para exportar un archivo nativo de Google Drive.");
      const result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(mimeType)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!result.ok) throw new Error(`Google Drive respondió ${result.status}: ${((await result.text()) || "").slice(0, 500)}`);
      return new Response(await result.arrayBuffer(), { status: 200, headers: { ...corsHeaders, "Content-Type": mimeType, "Content-Disposition": `attachment; filename="${id}"`, "X-LittleAPI-Version": API_VERSION } });
    }
    const url = new URL(request.url);
    if (mode === "quota") return response(await driveRequest(token, "about?fields=user,storageQuota"));
    if (mode === "about") return response(await driveRequest(token, "about?fields=user,storageQuota,importFormats,exportFormats"));
    if (mode === "search") {
      const term = url.searchParams.get("name") || url.searchParams.get("q") || "", parent = url.searchParams.get("parent_id") || "";
      if (!term && !parent) return failure(400, "search_term_required", "Indica name, q o parent_id para buscar en Drive.");
      const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const clauses = ["trashed = false"]; if (term) clauses.push(`name contains '${quote(term)}'`); if (parent) clauses.push(`'${quote(parent)}' in parents`);
      return response(await driveRequest(token, driveListPath(clauses.join(" and "), url)));
    }
    if (mode === "children") return response(await driveRequest(token, driveListPath(`'${id.replace(/'/g, "\\'")}' in parents and trashed = false`, url)));
    return response(await driveRequest(token, `files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents,webViewLink`));
  }
  if (request.method === "POST") {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) return failure(415, "multipart_not_supported", "Para subir desde una API usa JSON con content_base64.");
    const body = await request.json().catch(() => ({})), name = String(body.name || "").trim();
    if (!name) return failure(400, "file_name_required", "Indica name para crear o subir un archivo.");
    const metadata = { name, mimeType: body.mimeType || "application/octet-stream", parents: body.parents || (id !== "root" ? [id] : undefined) };
    if (body.content_base64) {
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(String(body.content_base64)), (char) => char.charCodeAt(0)); }
      catch (_) { return failure(400, "invalid_base64", "content_base64 no contiene Base64 válido."); }
      const boundary = `littleapi_${crypto.randomUUID()}`, prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`, suffix = `\r\n--${boundary}--`;
      const encoded = new TextEncoder().encode(prefix), ending = new TextEncoder().encode(suffix), joined = new Uint8Array(encoded.length + bytes.length + ending.length);
      joined.set(encoded); joined.set(bytes, encoded.length); joined.set(ending, encoded.length + bytes.length);
      return response(await driveRequest(token, "files?uploadType=multipart&fields=id,name,mimeType,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: joined }), 201);
    }
    return response(await driveRequest(token, "files?fields=id,name,mimeType,webViewLink", { method: "POST", body: JSON.stringify(metadata) }), 201);
  }
  const body = await request.json().catch(() => ({}));
  if (request.method === "PATCH") {
    const name = String(body.name || "").trim(); if (!name) return failure(400, "file_name_required", "Indica name con el nuevo nombre.");
    return response(await driveRequest(token, `files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink`, { method: "PATCH", body: JSON.stringify({ name }) }));
  }
  await driveRequest(token, `files/${encodeURIComponent(id)}`, { method: "DELETE" });
  return response({ success: true, deleted: id });
}

function openApiParameter(name: string, description: string, schema: Record<string, unknown> = { type: "string" }, example?: unknown) {
  return { name, in: "query", description, schema, ...(example === undefined ? {} : { example }) };
}
function metadataResponse(api: ApiRecord, openapi: boolean, request: Request) {
  if (!openapi) return response({ api_id: api.api_id, name: api.name, resource_type: api.resource_type, spreadsheet_id: api.spreadsheet_id, default_sheet: api.default_sheet, permissions: api.permissions, public_read: api.public_read, version: API_VERSION });
  const publicBase = request.headers.get("x-littleapi-public-base") || `${supabaseUrl}/functions/v1/sheetpilot-api`, key = [{ ApiKeyAuth: [] }];
  const jsonBody = { "application/json": { schema: { type: "object" } } };
  const commonRead = [
    openApiParameter("sheet", "Pestaña de Google Sheets.", { type: "string" }, api.default_sheet || "Sheet1"),
    openApiParameter("limit", `Filas por página. Máximo ${MAX_PAGE_SIZE}.`, { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE }, 100),
    openApiParameter("offset", "Desplazamiento de paginación.", { type: "integer", minimum: 0 }, 0),
    openApiParameter("sort", "Columna para ordenar.", { type: "string" }),
    openApiParameter("order", "Dirección del orden.", { type: "string", enum: ["asc", "desc"] }, "asc"),
    openApiParameter("select", "Columnas a devolver, separadas por coma.", { type: "string" }, "id,name,status"),
    openApiParameter("cast_numbers", "Columnas que deben convertirse a número; usa * para todas.", { type: "string" }),
    openApiParameter("infer_types", "Convierte números, booleanos y null de forma segura.", { type: "boolean" }, false),
    openApiParameter("single_object", "Devuelve sólo el primer objeto.", { type: "boolean" }, false),
    openApiParameter("raw", "Devuelve sólo data, sin el sobre de metadatos.", { type: "boolean" }, false),
    openApiParameter("include_empty", "Incluye filas vacías o que sólo contienen espacios. Por defecto se omiten.", { type: "boolean" }, false),
  ];
  const basePaths: Record<string, unknown> = {
    "/name": { get: { operationId: "getApiName", summary: "Nombre de la API", security: api.public_read ? [] : key } },
    "/metadata": { get: { operationId: "getMetadata", summary: "Metadatos de la API", security: api.public_read ? [] : key } },
    "/openapi.json": { get: { operationId: "getOpenApi", summary: "Contrato OpenAPI completo", security: api.public_read ? [] : key } },
    "/usage": { get: { operationId: "getUsage", summary: "Consumo mensual", security: key } },
  };
  const sheetPaths: Record<string, unknown> = {
    "/": {
      get: { operationId: "listRows", summary: "Lista, ordena, pagina, proyecta o agrupa filas", security: api.public_read ? [] : key, parameters: [...commonRead,
        openApiParameter("group_by", "Agrupa por una columna."), openApiParameter("count", "Cuenta valores no vacíos de una columna."), openApiParameter("sum", "Suma una o varias columnas; admite comas o parámetros repetidos."), openApiParameter("avg", "Promedio de columnas."), openApiParameter("min", "Mínimo de columnas."), openApiParameter("max", "Máximo de columnas."),
      ] },
      post: { operationId: "insertRows", summary: "Inserta una o varias filas", security: key, requestBody: { required: true, content: jsonBody } },
      patch: { operationId: "updateRows", summary: "Actualiza filas por filtro o actualiza un rango", security: key, requestBody: { required: true, content: jsonBody } },
      delete: { operationId: "deleteRows", summary: "Elimina filas por filtro; all:true es obligatorio para borrar todas", security: key, requestBody: { required: true, content: jsonBody } },
    },
    "/search": { get: { operationId: "searchRows", summary: "Busca y filtra filas con condiciones AND", security: api.public_read ? [] : key, parameters: [...commonRead, openApiParameter("search", "Texto libre en cualquier columna."), openApiParameter("casesensitive", "Hace sensibles a mayúsculas los filtros."), openApiParameter("contains[campo]", "La columna debe contener el texto."), openApiParameter("campo[]", "Repite el parámetro para aceptar varios valores en la misma columna.")] } },
    "/search_or": { get: { operationId: "searchRowsOr", summary: "Filtra filas cuando coincide cualquiera de las condiciones", security: api.public_read ? [] : key, parameters: commonRead } },
    "/query": {
    get: { operationId: "advancedQuery", summary: "Consulta avanzada con Google Visualization Query Language y nombres de encabezado", security: api.public_read ? [] : key, parameters: [openApiParameter("sheet", "Pestaña a consultar."), openApiParameter("q", "Consulta, por ejemplo SELECT Nombre, SUM(Total) GROUP BY Nombre."), openApiParameter("query", "Alias de q."), openApiParameter("headers", "Número de filas de encabezado, de 0 a 10.", { type: "integer", minimum: 0, maximum: 10 }, 1), openApiParameter("columns", "Usa names para nombres de encabezado o letters para escribir A,B,C directamente.", { type: "string", enum: ["names", "letters"] }, "names"), openApiParameter("raw", "Devuelve sólo el array de resultados.", { type: "boolean" }, false), openApiParameter("include_empty", "Incluye filas vacías o que sólo contienen espacios.", { type: "boolean" }, false)] },
    post: { operationId: "advancedQueryPost", summary: "Consulta avanzada por JSON para consultas largas", security: api.public_read ? [] : key, requestBody: { required: true, content: jsonBody } },
  },
    "/keys": { get: { operationId: "listColumns", summary: "Nombres de columnas", security: api.public_read ? [] : key } },
    "/count": { get: { operationId: "countRows", summary: "Cantidad total de filas", security: api.public_read ? [] : key } },
    "/cells/{coordinates}": { get: { operationId: "readCells", summary: "Lee celdas A1,B2,...", security: api.public_read ? [] : key, parameters: [{ name: "coordinates", in: "path", required: true, schema: { type: "string" }, example: "A1,B2,C5" }] } },
    "/stats": { get: { operationId: "getStats", summary: "Conteo, suma, promedio, mínimo y máximo", security: api.public_read ? [] : key, parameters: [openApiParameter("sheet", "Pestaña."), openApiParameter("column", "Columna numérica a analizar.")] } },
    "/sheets": { get: { operationId: "listSheets", summary: "Lista pestañas", security: key }, post: { operationId: "createSheet", summary: "Crea una pestaña", security: key, requestBody: { required: true, content: jsonBody } } },
    "/sheets/{sheet}": { patch: { operationId: "renameSheet", summary: "Renombra una pestaña", security: key, parameters: [{ name: "sheet", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: jsonBody } }, delete: { operationId: "deleteSheet", summary: "Elimina una pestaña", security: key, parameters: [{ name: "sheet", in: "path", required: true, schema: { type: "string" } }] } },
    "/sheets/copy": { post: { operationId: "copySheet", summary: "Copia una pestaña a otro libro", security: key, requestBody: { required: true, content: jsonBody } } },
    "/format": { post: { operationId: "formatRange", summary: "Aplica formato a un rango A1 o gridRange", security: key, requestBody: { required: true, content: jsonBody } } },
    "/clear": { post: { operationId: "clearRange", summary: "Vacía los valores de un rango", security: key, requestBody: { required: true, content: jsonBody } } },
    "/batch": { post: { operationId: "batchUpdate", summary: "Ejecuta de 1 a 50 requests batchUpdate de Google Sheets", security: key, requestBody: { required: true, content: jsonBody } } },
    "/export.json": { get: { operationId: "exportJson", summary: "Descarga JSON; acepta los mismos parámetros de lectura", security: api.public_read ? [] : key, parameters: commonRead } },
    "/export.csv": { get: { operationId: "exportCsv", summary: "Descarga la pestaña como CSV", security: api.public_read ? [] : key, parameters: [openApiParameter("sheet", "Pestaña a exportar.")] } },
    "/export.xlsx": { get: { operationId: "exportXlsx", summary: "Descarga el libro completo como XLSX", security: key } },
  };
  const drivePaths: Record<string, unknown> = {
    "/": { get: { operationId: "getDriveRoot", summary: "Metadatos del recurso Drive configurado", security: key } },
    "/children/{folder_id}": { get: { operationId: "listDriveChildren", summary: "Lista archivos de una carpeta", security: key, parameters: [{ name: "folder_id", in: "path", required: true, schema: { type: "string" } }, openApiParameter("page_size", "Resultados por página.", { type: "integer", minimum: 1, maximum: 1000 }), openApiParameter("page_token", "Token de la siguiente página."), openApiParameter("order_by", "Orden compatible con Google Drive, por ejemplo folder,name.")] } },
    "/search": { get: { operationId: "searchDrive", summary: "Busca archivos por nombre y/o carpeta", security: key, parameters: [openApiParameter("name", "Texto incluido en el nombre."), openApiParameter("parent_id", "ID de carpeta padre."), openApiParameter("page_size", "Resultados por página.", { type: "integer", minimum: 1, maximum: 1000 }), openApiParameter("page_token", "Token de la siguiente página.")] } },
    "/quota": { get: { operationId: "driveQuota", summary: "Cuota de almacenamiento de Drive", security: key } },
    "/about": { get: { operationId: "driveAbout", summary: "Cuenta y formatos import/export de Drive", security: key } },
    "/download/{file_id}": { get: { operationId: "downloadDriveFile", summary: "Descarga un archivo binario normal", security: key, parameters: [{ name: "file_id", in: "path", required: true, schema: { type: "string" } }] } },
    "/export/{file_id}": { get: { operationId: "exportDriveFile", summary: "Exporta Docs/Sheets/Slides nativos", security: key, parameters: [{ name: "file_id", in: "path", required: true, schema: { type: "string" } }, openApiParameter("mime_type", "MIME de salida requerido.")] } },
    "/{file_id}": { get: { operationId: "getDriveFile", summary: "Metadatos de un archivo", security: key }, post: { operationId: "uploadDriveFile", summary: "Crea carpeta o sube content_base64 dentro del ID", security: key, requestBody: { required: true, content: jsonBody } }, patch: { operationId: "renameDriveFile", summary: "Renombra un archivo", security: key, requestBody: { required: true, content: jsonBody } }, delete: { operationId: "deleteDriveFile", summary: "Elimina un archivo", security: key } },
  };
  return response({
    openapi: "3.0.3",
    info: { title: api.name, version: API_VERSION, description: "LittleAPI REST API for Google Sheets and Google Drive." },
    servers: [{ url: `${publicBase}/${api.api_id}` }],
    externalDocs: { description: "LittleAPI documentation", url: "https://littleapi.online/docs/" },
    components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "Required for writes, private APIs, Drive and administrative operations." } } },
    paths: { ...basePaths, ...(api.resource_type === "drive" ? drivePaths : sheetPaths) },
  });
}
async function statsOperation(api: ApiRecord, request: Request) {
  const denied = requirePermission(api, "read", request); if (denied) return denied;
  const url = new URL(request.url), sheet = url.searchParams.get("sheet") || api.default_sheet || "Sheet1";
  let table: TableData;
  if (api.public_read) table = await readPublicSheet(api, sheet);
  else { if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta API privada requiere la cabecera X-API-Key."); table = await readAuthorized(api, await googleTokenForUser(api.user_id), sheet); }
  const column = url.searchParams.get("column") || "";
  const allRows = rowsAsObjects(table.headers, table.rows);
  const rows = shouldIncludeEmptyRows(url) ? allRows : allRows.filter(rowHasData);
  if (!column) return response({ columns: table.headers, rows: rows.length });
  const values = rows.map((row) => Number(valueOf(row, column))).filter((value) => !Number.isNaN(value));
  return response({ column, count: rows.filter((row) => String(valueOf(row, column) ?? "") !== "").length, numeric_count: values.length, sum: values.reduce((a, b) => a + b, 0), avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null });
}
function operationNeedsApiKey(api: ApiRecord, path: string[], method: string) {
  if (path[1] === "mcp") return false;
  if (path[1] === "query" && (method === "GET" || method === "POST")) return api.public_read !== true;
  if (method !== "GET") return true;
  if (api.resource_type === "drive") return true;
  if (api.public_read !== true) return true;
  return path[1] === "sheets" || path[1] === "export.xlsx";
}
function quotaExempt(path: string[], method: string) {
  if (path[1] === "mcp") return true;
  return method === "GET" && ["name", "metadata", "openapi.json", "usage"].includes(path[1] || "");
}
async function publicLittleApp(request: Request, path: string[]) {
  const slug = decodeURIComponent(path[0] || "").trim().toLowerCase();
  if (!slug) return failure(400, "app_slug_required", "Indica el identificador de la aplicación.");

  const rows = await dbFetch(
    `littleapps?select=api_id,name,slug,sheet,config,published,updated_at&slug=eq.${encodeURIComponent(slug)}&published=eq.true&limit=1`,
  );
  const app = rows?.[0];
  if (!app) return failure(404, "app_not_found", "No existe una aplicación publicada con ese identificador.");

  const config = app.config && typeof app.config === "object" ? app.config : {};
  const configuredFields = Array.isArray(config.fields) ? config.fields : [];
  const visibleFields = configuredFields.filter((field: any) => field?.visible !== false && field?.name);
  const editableFields = visibleFields.filter((field: any) => field?.editable !== false);
  const publicConfig = {
    ...config,
    fields: visibleFields.map((field: any) => ({
      name: String(field.name || ""),
      label: String(field.label || field.name || ""),
      type: String(field.type || "text"),
      required: field.required === true,
      editable: field.editable !== false,
    })),
  };

  if (path[1] === "manifest.webmanifest" && request.method === "GET") {
    const startUrl = `https://littleapi.online/littleapp-v3.html?v=20260919-7&app=${encodeURIComponent(app.slug)}`;
    return new Response(JSON.stringify({
      id: startUrl,
      name: app.name,
      short_name: String(app.name || "LittleApp").slice(0, 24),
      description: "Application powered by LittleAPI and Google Sheets.",
      start_url: startUrl,
      scope: "https://littleapi.online/",
      display: "standalone",
      orientation: "any",
      background_color: "#f7faf9",
      theme_color: "#0b766e",
      icons: (() => {
        const icon = config?.appIcon && typeof config.appIcon === "object" ? config.appIcon : null;
        const url = String(icon?.url || "").trim();
        if (url) {
          const width = Number(icon?.width || 0), height = Number(icon?.height || 0);
          return [{
            src: url,
            sizes: width > 0 && height > 0 ? `${width}x${height}` : "any",
            type: "image/png",
            purpose: "any",
          }];
        }
        return [{
          src: "https://littleapi.online/littleapi-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        }];
      })(),
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  if (path[1] === "dashboard") {
    if (request.method !== "GET") return failure(405, "method_not_allowed", "Usa GET para consultar el panel de una aplicación.");
    const api = await getApi(app.api_id);
    if (!api || api.resource_type !== "sheet") return failure(404, "api_not_found", "La fuente de datos de esta aplicación ya no está disponible.");

    const quotaError = await consumeQuota(api);
    if (quotaError) return quotaError;

    const dashboardConfig = config?.screens?.dashboard && typeof config.screens.dashboard === "object" ? config.screens.dashboard : {};
    const sheet = String(dashboardConfig.sheet || app.sheet || api.default_sheet || "Sheet1");
    const token = await googleTokenForUser(api.user_id);
    const table = await readAuthorized(api, token, sheet);

    const numberValue = (value: unknown) => {
      const raw = String(value ?? "").trim();
      if (!raw) return Number.NaN;
      const compact = raw.replace(/\s/g, "");
      if (/^-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?$/.test(compact)) {
        const lastDot = compact.lastIndexOf(".");
        const lastComma = compact.lastIndexOf(",");
        const decimalIndex = Math.max(lastDot, lastComma);
        const integerPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
        const decimalPart = compact.slice(decimalIndex + 1);
        return Number(integerPart + "." + decimalPart);
      }
      return Number(compact.replace(",", "."));
    };
    const aggregate = (values: unknown[], mode: string) => {
      if (mode === "count") return values.length;
      const numbers = values.map(numberValue).filter((value) => Number.isFinite(value));
      if (!numbers.length) return 0;
      if (mode === "sum") return numbers.reduce((sum, value) => sum + value, 0);
      if (mode === "average") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      if (mode === "min") return Math.min(...numbers);
      if (mode === "max") return Math.max(...numbers);
      return numbers.length;
    };
    const dateValue = (label: string) => {
      const raw = String(label || "").trim();
      let match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
      if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
      match = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
      if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    };
    const sortCategories = (labels: string[]) => {
      const dated = labels.map((label) => ({ label, time: dateValue(label) }));
      if (dated.length && dated.every((item) => Number.isFinite(item.time))) {
        return dated.sort((left, right) => left.time - right.time).map((item) => item.label);
      }
      return labels;
    };

    const blocks = Array.isArray(dashboardConfig.blocks) ? dashboardConfig.blocks : [];
    const referenced = new Set<string>();
    for (const block of blocks) {
      for (const key of ["valueField", "categoryField", "seriesField"]) {
        const name = String(block?.[key] || "");
        if (name && table.headers.includes(name)) referenced.add(name);
      }
    }
    const objects = table.rows
      .filter((row: unknown[]) => rowHasData(row))
      .map((row: unknown[]) => {
        const object: Record<string, unknown> = {};
        for (const header of table.headers) if (referenced.has(header)) object[header] = row[table.headers.indexOf(header)] ?? "";
        return object;
      });

    const resultBlocks = blocks.map((block: any) => {
      const aggregation = ["count", "sum", "average", "min", "max"].includes(String(block?.aggregation || "")) ? String(block.aggregation) : "count";
      const valueField = table.headers.includes(String(block?.valueField || "")) ? String(block.valueField) : "";
      const categoryField = table.headers.includes(String(block?.categoryField || "")) ? String(block.categoryField) : "";
      const seriesField = table.headers.includes(String(block?.seriesField || "")) ? String(block.seriesField) : "";
      const requestedKind = String(block?.kind || "");
      const kind = requestedKind === "compare" || (requestedKind === "chart" && seriesField) ? "compare" : requestedKind === "chart" ? "chart" : "metric";
      const chartType = ["bar", "line", "area", "pie", "doughnut"].includes(String(block?.chartType || "")) ? String(block.chartType) : "bar";
      const common = {
        id: String(block?.id || crypto.randomUUID()),
        kind,
        titleEn: String(block?.titleEn || ""),
        titleEs: String(block?.titleEs || ""),
        aggregation,
        valueField,
        categoryField,
        seriesField,
        chartType,
      };

      if (kind === "metric") {
        const values = valueField ? objects.map((row) => row[valueField]).filter((value) => aggregation !== "count" || String(value ?? "").trim() !== "") : objects;
        return { ...common, value: aggregation === "count" && !valueField ? objects.length : aggregate(values, aggregation) };
      }

      if (!categoryField) return { ...common, items: [], categories: [], series: [] };
      const limit = Math.max(1, Math.min(30, Number(block?.limit || 7)));
      if (kind === "compare" && (!seriesField || !["bar", "line", "area"].includes(chartType))) {
        return { ...common, limit, items: [], categories: [], series: [] };
      }

      if (kind === "compare" && seriesField && ["bar", "line", "area"].includes(chartType)) {
        const categorySet = new Set<string>();
        const seriesBuckets = new Map<string, Map<string, unknown[]>>();
        for (const row of objects) {
          const category = String(row[categoryField] ?? "").trim() || "—";
          const seriesName = String(row[seriesField] ?? "").trim() || "—";
          categorySet.add(category);
          if (!seriesBuckets.has(seriesName)) seriesBuckets.set(seriesName, new Map());
          const bucket = seriesBuckets.get(seriesName)!;
          if (!bucket.has(category)) bucket.set(category, []);
          bucket.get(category)!.push(valueField ? row[valueField] : 1);
        }
        const categories = sortCategories(Array.from(categorySet)).slice(0, limit);
        const seriesLimit = Math.max(1, Math.min(12, Number(block?.seriesLimit || 6)));
        const ranked = Array.from(seriesBuckets.entries()).map(([name, bucket]) => {
          const score = categories.reduce((total, category) => {
            const values = bucket.get(category) || [];
            return total + Number(aggregation === "count" ? values.length : aggregate(values, aggregation) || 0);
          }, 0);
          return { name, bucket, score };
        }).sort((a, b) => b.score - a.score).slice(0, seriesLimit);
        const series = ranked.map(({ name, bucket }) => ({
          name,
          values: categories.map((category) => {
            const values = bucket.get(category) || [];
            return aggregation === "count" ? values.length : aggregate(values, aggregation);
          }),
        }));
        return { ...common, limit, seriesLimit, categories, series };
      }

      const groups = new Map<string, unknown[]>();
      for (const row of objects) {
        const key = String(row[categoryField] ?? "").trim() || "—";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(valueField ? row[valueField] : 1);
      }
      let items = Array.from(groups.entries())
        .map(([label, values]) => ({ label, value: aggregation === "count" ? values.length : aggregate(values, aggregation) }));
      const orderedLabels = sortCategories(items.map((item) => item.label));
      if (orderedLabels.length && orderedLabels.every((label, index) => label === items[index]?.label) === false && orderedLabels.every((label) => Number.isFinite(dateValue(label)))) {
        const byLabel = new Map(items.map((item) => [item.label, item]));
        items = orderedLabels.map((label) => byLabel.get(label)!).filter(Boolean);
      } else if (!orderedLabels.every((label) => Number.isFinite(dateValue(label)))) {
        items.sort((left, right) => Number(right.value) - Number(left.value));
      }
      items = items.slice(0, limit);

      return { ...common, limit, items, categories: [], series: [] };
    });

    return response({ total: objects.length, sheet, blocks: resultBlocks }, 200, { "Cache-Control": "no-store" });
  }

  if (path[1] === "rows") {
    const api = await getApi(app.api_id);
    if (!api || api.resource_type !== "sheet") return failure(404, "api_not_found", "La fuente de datos de esta aplicación ya no está disponible.");

    const quotaError = await consumeQuota(api);
    if (quotaError) return quotaError;

    const requestUrl = new URL(request.url);
    const pageId = String(requestUrl.searchParams.get("page") || "data");
    const customPages = Array.isArray(config?.customPages) ? config.customPages : [];
    const customPage = customPages.find((page: any) => String(page?.id || "") === pageId);
    const screenConfig = customPage || (config?.screens?.[pageId] && typeof config.screens[pageId] === "object" ? config.screens[pageId] : {});
    const sheet = String(screenConfig?.sheet || app.sheet || api.default_sheet || "Sheet1");
    const token = await googleTokenForUser(api.user_id);
    const table = await readAuthorized(api, token, sheet);
    const pageFields = Array.isArray(screenConfig?.fields) ? screenConfig.fields.filter((field: any) => field?.name) : [];
    const fallbackFields = sheet === String(app.sheet || "") ? visibleFields : [];
    const configuredPageFields = pageFields.length ? pageFields : fallbackFields;
    const allowedNames = new Set((configuredPageFields.length ? configuredPageFields.filter((field: any) => field?.visible !== false).map((field: any) => String(field.name)) : table.headers).filter((name: string) => table.headers.includes(name)));
    const editableNames = new Set((configuredPageFields.length ? configuredPageFields.filter((field: any) => field?.editable !== false).map((field: any) => String(field.name)) : Array.from(allowedNames)).filter((name: string) => table.headers.includes(name)));

    if (request.method === "GET") {
      const search = String(requestUrl.searchParams.get("search") || "").trim().toLowerCase();
      const requested = Number(requestUrl.searchParams.get("limit") || config.pageSize || 25);
      const limit = Math.max(1, Math.min(100, Number.isFinite(requested) ? Math.floor(requested) : 25));
      const requestedOffset = Number(requestUrl.searchParams.get("offset") || 0);
      const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);

      let data = table.rows
        .map((row, index) => ({ row, sheetRow: index + 2 }))
        .filter((entry) => rowHasData(entry.row))
        .map((entry) => {
          const object: Record<string, unknown> = { __row: entry.sheetRow };
          for (const header of table.headers) if (allowedNames.has(header)) object[header] = entry.row[table.headers.indexOf(header)] ?? "";
          return object;
        });

      if (search) data = data.filter((row) => Object.entries(row).some(([key, value]) => key !== "__row" && String(value ?? "").toLowerCase().includes(search)));
      const total = data.length;
      const paged = data.slice(offset, offset + limit);
      return response({
        data: paged,
        total,
        limit,
        offset,
        returned: paged.length,
        has_more: offset + paged.length < total,
        next_offset: offset + paged.length < total ? offset + paged.length : null,
        headers: table.headers.filter((header: string) => allowedNames.has(header)),
        sheet,
        page: pageId,
      }, 200, { "Cache-Control": "no-store" });
    }

    const actions = config.actions && typeof config.actions === "object" ? config.actions : {};
    const action = request.method === "POST" ? "create" : request.method === "PATCH" ? "update" : "delete";
    if (actions[action] !== true) return failure(403, "app_action_disabled", `La aplicación no permite ${action} registros.`);
    const denied = requirePermission(api, action);
    if (denied) return denied;

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const data = body?.data && typeof body.data === "object" ? body.data : body;
      const values = table.headers.map((header) => editableNames.has(header) ? (data?.[header] ?? "") : "");
      if (!rowHasData(values)) return failure(400, "row_required", "Completa al menos un campo antes de guardar.");
      for (const field of editableFields) {
        if (field?.required === true && String(data?.[field.name] ?? "").trim() === "") {
          return failure(400, "required_field", `El campo ${field.label || field.name} es obligatorio.`);
        }
      }
      const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method: "POST",
        body: JSON.stringify({ majorDimension: "ROWS", values: [values] }),
      });
      cache.clear();
      return response({ success: true, inserted: 1, updates: result.updates || null }, 201, { "Cache-Control": "no-store" });
    }

    const rowNumber = Number(path[2] || 0);
    if (!Number.isInteger(rowNumber) || rowNumber < 2) return failure(400, "row_required", "Indica una fila válida.");

    const index = rowNumber - 2;
    if (index < 0 || index >= table.rows.length) return failure(404, "row_not_found", "El registro ya no existe.");

    if (request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const changes = body?.data && typeof body.data === "object" ? body.data : body;
      const current = table.rows[index] || [];
      const next = table.headers.map((header, column) => {
        if (editableNames.has(header) && Object.prototype.hasOwnProperty.call(changes, header)) return changes[header];
        return current[column] ?? "";
      });
      for (const field of editableFields) {
        if (field?.required === true) {
          const column = table.headers.indexOf(String(field.name));
          if (column >= 0 && String(next[column] ?? "").trim() === "") return failure(400, "required_field", `El campo ${field.label || field.name} es obligatorio.`);
        }
      }
      await updateValues(api, token, sheetRange(sheet, `A${rowNumber}:${columnName(table.headers.length)}${rowNumber}`), [next]);
      cache.clear();
      return response({ success: true, updated: 1, row: rowNumber }, 200, { "Cache-Control": "no-store" });
    }

    const metadata = await spreadsheetMetadata(api, token);
    const sheetInfo = metadata.sheets?.find((item: any) => item.properties?.title === sheet);
    const sheetId = sheetInfo?.properties?.sheetId;
    if (sheetId === undefined) return failure(404, "sheet_not_found", "No se encontró la pestaña de la aplicación.");
    await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } } }] }),
    });
    cache.clear();
    return response({ success: true, deleted: 1, row: rowNumber }, 200, { "Cache-Control": "no-store" });
  }

  if (request.method !== "GET") return failure(405, "method_not_allowed", "Usa GET para consultar una aplicación publicada.");

  return response({
    name: app.name,
    slug: app.slug,
    api_id: app.api_id,
    sheet: app.sheet,
    config: publicConfig,
    updated_at: app.updated_at,
    app_url: `https://littleapi.online/littleapp-v3.html?v=20260919-7&app=${encodeURIComponent(app.slug)}`,
  }, 200, { "Cache-Control": "no-store" });
}

async function handler(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders, "X-LittleAPI-Version": API_VERSION } });
  const url = new URL(request.url), path = partsFor(url);
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return failure(405, "method_not_allowed", "Usa GET, POST, PATCH o DELETE.", { allowed_methods: ["GET", "POST", "PATCH", "DELETE"] });
  if (path[0] === "health" && request.method === "GET") return response({ status: "ok", name: "LittleAPI", version: API_VERSION, time: new Date().toISOString() });
  if (path[0] === "apps") return publicLittleApp(request, path.slice(1));
  if (path[0] === "auth" && path[1] === "google") return googleConnection(request);
  if (path[0] === "auth" && path[1] === "api-key") return apiKeyConnection(request);
  if (path[0] === "auth" && path[1] === "api-keys") return apiKeysConnection(request);
  if (path[0] === "account" && path[1] === "sheet-schema") return accountSheetSchema(request);
  if (path[0] === "account") return accountRequest(request, path.slice(1));
  if (!path[0]) return response({ name: "LittleAPI", version: API_VERSION, usage: "/sheetpilot-api/{API_ID}", public_url: "https://littleapi.online/api/v1/{API_ID}", methods: ["GET", "POST", "PATCH", "DELETE"], authentication: "Public GETs can be anonymous; use X-API-Key for writes, private reads, Drive and admin operations." });
  const api = await getApi(path[0]);
  if (!api) return failure(404, "api_not_found", "No existe una API con ese identificador o está desactivada.");
  if (path[1] === "usage" && request.method === "GET") {
    if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Consultar el consumo requiere la cabecera X-API-Key.");
    return response({ api_id: api.api_id, quota: await quotaStatus(api) });
  }
  if (operationNeedsApiKey(api, path, request.method) && !(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta operación requiere la cabecera X-API-Key.");
  if (!quotaExempt(path, request.method)) {
    const quotaError = await consumeQuota(api); if (quotaError) return quotaError;
  }
  if (path[1] === "mcp") return handleMcp(request, api, await hasApiKey(api, request));
  if (path[1] === "query" && (request.method === "GET" || request.method === "POST")) return queryOperation(api, request);
  if (path[1] === "stats" && request.method === "GET") return statsOperation(api, request);
  if (request.method === "GET") return readOperation(api, request, path.slice(1));
  return mutationOperation(api, request, path.slice(1));
}
Deno.serve(async (request) => {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const path = partsFor(new URL(request.url));
  const apiId = path[0] && !["health", "auth", "account", "apps"].includes(path[0]) ? path[0] : "";
  const settings = apiId ? await getSecuritySettings(apiId).catch(() => null) : null;

  if (request.method === "OPTIONS") {
    const preflight = new Response(null, { status: 204, headers: { ...corsHeaders, "X-LittleAPI-Version": API_VERSION, "X-LittleAPI-Request-Id": requestId } });
    return withDynamicCors(preflight, request, settings);
  }

  if (apiId) {
    const blocked = enforceRequestSecurity(request, settings);
    if (blocked) {
      const headers = new Headers(blocked.headers);
      headers.set("X-LittleAPI-Version", API_VERSION);
      headers.set("X-LittleAPI-Request-Id", requestId);
      const secured = new Response(blocked.body, { status: blocked.status, headers });
      await scheduleTelemetry({ apiId, request, response: secured.clone(), durationMs: Date.now() - started, requestId, settings });
      return withDynamicCors(secured, request, settings);
    }
  }

  let result: Response;
  try { result = await handler(request); }
  catch (error) {
    console.error("sheetpilot-api request failed", error);
    result = failure(502, "upstream_error", "No se pudo completar la solicitud. Inténtalo de nuevo más tarde.");
  }

  const headers = new Headers(result.headers);
  headers.set("X-LittleAPI-Request-Id", requestId);
  result = new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  if (apiId) await scheduleTelemetry({ apiId, request, response: result.clone(), durationMs: Date.now() - started, requestId, settings });
  return withDynamicCors(result, request, settings);
});
