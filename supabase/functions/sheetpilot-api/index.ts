/*
 * API REST de LittleAPI: una URL estable por cada hoja conectada.
 *
 * GET requests read a public/published Google Sheet through Visualization API,
 * so no Google credential is exposed by this function. Mutations intentionally
 * return a clear 501 until a server-side Google refresh-token secret is set up.
 * The dashboard continues to provide full authenticated CRUD for the owner.
 */
type ApiRecord = {
  api_id: string;
  name: string;
  resource_type: "sheet" | "drive";
  spreadsheet_id: string | null;
  default_sheet: string | null;
  drive_file_id: string | null;
  api_key_hash: string;
  public_read: boolean;
  permissions: Record<string, boolean>;
  enabled: boolean;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-key, authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Cache-Control": "no-store",
};

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
  return marker < 0 ? [] : parts.slice(marker + 1);
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
  if (!supabaseUrl || !publicKey) throw new Error("Supabase public runtime is not configured.");
  const fields = "api_id,name,resource_type,spreadsheet_id,default_sheet,drive_file_id,public_read,permissions,enabled";
  const url = `${supabaseUrl}/rest/v1/api_public_catalog?select=${fields}&api_id=eq.${encodeURIComponent(apiId)}&enabled=eq.true&limit=1`;
  const result = await fetch(url, { headers: { apikey: publicKey, Authorization: `Bearer ${publicKey}` } });
  if (!result.ok) throw new Error(`No se pudo consultar el registro de la API (${result.status}).`);
  const rows = await result.json();
  return rows[0] ? { ...rows[0], api_key_hash: "" } : null;
}

async function hasApiKey(api: ApiRecord, request: Request) {
  const url = new URL(request.url);
  const supplied = request.headers.get("x-api-key") || url.searchParams.get("api_key") || "";
  if (!supplied) return false;
  return sameSecret(await sha256(supplied), api.api_key_hash);
}

function allowed(api: ApiRecord, action: string) {
  return api.permissions?.[action] !== false;
}

function columnName(number: number) {
  let result = "";
  let current = number;
  while (current > 0) {
    const rest = (current - 1) % 26;
    result = String.fromCharCode(65 + rest) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result || "A";
}

function cellValue(cell: { v?: unknown; f?: unknown } | undefined) {
  if (!cell) return "";
  return cell.f ?? cell.v ?? "";
}

function parseVisualization(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Google no devolvió una tabla válida.");
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status && payload.status !== "ok") throw new Error(payload.errors?.[0]?.detailed_message || "Google no permite leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.");
  const table = payload.table || {};
  const used: string[] = [];
  const headers = (table.cols || []).map((column: { label?: string; id?: string }, index: number) => {
    const base = String(column.label || column.id || columnName(index + 1)).trim() || columnName(index + 1);
    let key = base;
    let suffix = 2;
    while (used.includes(key)) key = `${base}_${suffix++}`;
    used.push(key);
    return key;
  });
  const rows = (table.rows || []).map((row: { c?: Array<{ v?: unknown; f?: unknown }> }) => headers.map((_, index) => cellValue(row.c?.[index])));
  return { headers, rows };
}

async function readSheet(api: ApiRecord, sheet: string, query?: string) {
  if (api.resource_type !== "sheet" || !api.spreadsheet_id) throw new Error("Esta API no está configurada como hoja de cálculo.");
  const params = new URLSearchParams({ tqx: "out:json", headers: "1", sheet });
  if (query) params.set("tq", query);
  const target = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(api.spreadsheet_id)}/gviz/tq?${params.toString()}`;
  const result = await fetch(target);
  const text = await result.text();
  if (!result.ok) throw new Error("Google no permitió leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.");
  return parseVisualization(text);
}

function valueOf(row: Record<string, unknown>, key: string) {
  const exact = Object.keys(row).find((candidate) => candidate === key);
  if (exact) return row[exact];
  const insensitive = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return insensitive ? row[insensitive] : undefined;
}

function compare(value: unknown, condition: string, casesensitive: boolean) {
  const original = String(value ?? "");
  const raw = String(condition ?? "");
  const left = casesensitive ? original : original.toLowerCase();
  const rightRaw = raw.startsWith("!") ? raw.slice(1) : raw;
  const right = casesensitive ? rightRaw : rightRaw.toLowerCase();
  if (raw.startsWith("!")) return left !== right;
  const relational = raw.match(/^(<=|>=|<|>)(.*)$/);
  if (relational) {
    const lNumber = Number(original);
    const rNumber = Number(relational[2]);
    const a = Number.isNaN(lNumber) || Number.isNaN(rNumber) ? left : lNumber;
    const b = Number.isNaN(lNumber) || Number.isNaN(rNumber) ? (casesensitive ? relational[2] : relational[2].toLowerCase()) : rNumber;
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

function rowsAsObjects(headers: string[], rows: unknown[][]) {
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function transform(rows: Record<string, unknown>[], url: URL) {
  let result = [...rows];
  const sortBy = url.searchParams.get("sort_by");
  const order = url.searchParams.get("sort_order") || "asc";
  if (sortBy) {
    if (order === "random") result.sort(() => Math.random() - 0.5);
    else result.sort((a, b) => {
      const left = String(valueOf(a, sortBy) ?? "");
      const right = String(valueOf(b, sortBy) ?? "");
      const numericLeft = Number(left), numericRight = Number(right);
      const comparison = !Number.isNaN(numericLeft) && !Number.isNaN(numericRight) ? numericLeft - numericRight : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
      return order === "desc" ? -comparison : comparison;
    });
  }
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
  const limitValue = Number(url.searchParams.get("limit") || 0) || 0;
  result = result.slice(offset, limitValue > 0 ? offset + limitValue : undefined);
  const casts = (url.searchParams.get("cast_numbers") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (casts.length) result = result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, casts.includes(key) && value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value])));
  return url.searchParams.get("single_object") === "true" ? (result[0] || {}) : result;
}

function searchRows(rows: Record<string, unknown>[], url: URL, orMode: boolean) {
  const reserved = new Set(["sheet", "limit", "offset", "sort_by", "sort_order", "sort_method", "sort_date_format", "cast_numbers", "single_object", "mode", "casesensitive"]);
  const casesensitive = url.searchParams.get("casesensitive") === "true";
  const conditions: Array<[string, string[]]> = [];
  for (const key of new Set(Array.from(url.searchParams.keys()).filter((item) => !reserved.has(item)))) {
    conditions.push([key.endsWith("[]") ? key.slice(0, -2) : key, url.searchParams.getAll(key)]);
  }
  if (!conditions.length) return transform(rows, url);
  const filtered = rows.filter((row) => {
    const matches = conditions.flatMap(([key, values]) => values.map((value) => compare(valueOf(row, key), value, casesensitive)));
    return orMode ? matches.some(Boolean) : matches.every(Boolean);
  });
  return transform(filtered, url);
}

function cellCoordinates(cell: string) {
  const match = cell.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function requirePermission(api: ApiRecord, action: string) {
  if (!allowed(api, action)) return failure(403, "permission_denied", `La API no tiene habilitado el permiso ${action}.`);
  return null;
}

async function readOperation(api: ApiRecord, request: Request, path: string[]) {
  const url = new URL(request.url);
  if (api.public_read !== true && !(await hasApiKey(api, request))) return failure(401, "api_key_required", "Esta API requiere la cabecera X-API-Key.");
  const sheet = url.searchParams.get("sheet") || api.default_sheet || "Sheet1";
  if (path[0] === "keys") {
    const denied = requirePermission(api, "read"); if (denied) return denied;
    return response((await readSheet(api, sheet)).headers);
  }
  if (path[0] === "name") return response({ name: api.name });
  const data = await readSheet(api, sheet);
  const objects = rowsAsObjects(data.headers, data.rows);
  if (path[0] === "count") return response({ rows: objects.length });
  if (path[0] === "cells") {
    const matrix = [data.headers, ...data.rows];
    const cells: Record<string, unknown> = {};
    for (const cell of (path[1] || "").split(",")) {
      const coordinates = cellCoordinates(cell); if (coordinates) cells[cell.toUpperCase()] = matrix[coordinates.row]?.[coordinates.column] ?? "";
    }
    return response(cells);
  }
  if (path[0] === "search" || path[0] === "search_or") {
    const denied = requirePermission(api, "search"); if (denied) return denied;
    return response(searchRows(objects, url, path[0] === "search_or"));
  }
  const denied = requirePermission(api, "read"); if (denied) return denied;
  return response(transform(objects, url));
}

async function mutationOperation(api: ApiRecord, request: Request, path: string[]) {
  if (!(await hasApiKey(api, request))) return failure(401, "api_key_required", "Las operaciones de escritura requieren la cabecera X-API-Key.");
  const action = request.method === "POST" ? "create" : request.method === "PATCH" ? "update" : "delete";
  const denied = requirePermission(api, action); if (denied) return denied;
  return failure(501, "server_google_authorization_required", "La API pública ya está creada para lectura, búsqueda y metadatos. Para habilitar POST, PATCH y DELETE de forma segura falta configurar OAuth de servidor para Google; el panel autenticado ya permite estas operaciones.", { method: request.method, path });
}

async function handler(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(request.url);
  const path = partsFor(url);
  if (!path[0]) return response({ name: "LittleAPI", version: "1", usage: "/sheetpilot-api/{API_ID}", methods: ["GET", "POST", "PATCH", "DELETE"] });
  const api = await getApi(path[0]);
  if (!api) return failure(404, "api_not_found", "No existe una API con ese identificador o está desactivada.");
  if (api.resource_type === "drive") return failure(501, "drive_api_not_ready", "Las APIs de Drive están previstas en el mismo registro, pero requieren OAuth de servidor para proteger los archivos. Esta API es de Google Sheets.");
  if (request.method === "GET") return await readOperation(api, request, path.slice(1));
  return await mutationOperation(api, request, path.slice(1));
}

Deno.serve(async (request) => {
  try { return await handler(request); }
  catch (error) { return failure(502, "upstream_error", error instanceof Error ? error.message : "No se pudo completar la solicitud."); }
});
