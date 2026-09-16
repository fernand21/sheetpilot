/* LittleAPI MCP server - protocol revision 2026-07-28
 * Stateless MCP endpoint exposed at /api/v1/{API_ID}/mcp.
 * The endpoint uses the same LittleAPI API key as the REST API.
 */

const MCP_VERSION = "2026-07-28";
const SERVER_VERSION = "1.0.0";
const PUBLIC_API_BASE = "https://littleapi.online/api/v1";

type ResourceType = "sheet" | "drive";

type Tool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

function serverMeta() {
  return { "io.modelcontextprotocol/serverInfo": { name: "LittleAPI MCP", version: SERVER_VERSION } };
}

function mcpResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "MCP-Protocol-Version": MCP_VERSION,
      ...extra,
    },
  });
}

function rpcResult(id: unknown, result: Record<string, unknown>) {
  return mcpResponse({ jsonrpc: "2.0", id: id ?? null, result: { resultType: "complete", ...result, _meta: { ...(result._meta as any || {}), ...serverMeta() } } });
}

function rpcError(id: unknown, code: number, message: string, data?: unknown, status = 400) {
  return mcpResponse({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }, status);
}

function apiKeyFrom(request: Request) {
  const direct = request.headers.get("x-api-key") || request.headers.get("x-littleapi-key") || "";
  if (direct) return direct;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return bearer;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

const commonSheet = { sheet: { type: "string", description: "Google Sheets tab name. Omit to use the API default tab." } };

const sheetTools: Tool[] = [
  {
    name: "read_rows",
    title: "Read Google Sheets rows",
    description: "Read rows from the default or selected Google Sheets tab. Supports pagination, selected columns and sorting.",
    inputSchema: objectSchema({ ...commonSheet, limit: { type: "integer", minimum: 1, maximum: 1000 }, offset: { type: "integer", minimum: 0 }, select: { type: "string", description: "Comma-separated column names." }, sort_by: { type: "string" }, sort_order: { type: "string", enum: ["asc", "desc"] }, raw: { type: "boolean" } }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "search_rows",
    title: "Search Google Sheets rows",
    description: "Search any column and/or filter rows by exact values or contains conditions.",
    inputSchema: objectSchema({ ...commonSheet, search: { type: "string", description: "Free-text search across every column." }, filters: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] }, description: "Exact/comparison filters keyed by column name. Values may use >, >=, <, <=, ! or * wildcards." }, contains: { type: "object", additionalProperties: { type: "string" }, description: "Contains filters keyed by column name." }, or: { type: "boolean", description: "When true, match any condition instead of all conditions." }, limit: { type: "integer", minimum: 1, maximum: 1000 }, offset: { type: "integer", minimum: 0 } }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "query_sheet",
    title: "Run an advanced Sheets query",
    description: "Run Google Visualization Query Language using human column header names. Supports SELECT, WHERE, GROUP BY, SUM, AVG, COUNT, MIN, MAX, PIVOT, LABEL, ORDER BY, LIMIT and OFFSET.",
    inputSchema: objectSchema({ query: { type: "string", description: "Example: SELECT Product, SUM(Total) GROUP BY Product ORDER BY SUM(Total) DESC" }, ...commonSheet, raw: { type: "boolean" }, headers: { type: "integer", minimum: 0, maximum: 10 } }, ["query"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "insert_rows",
    title: "Insert Sheets rows",
    description: "Append one row or multiple rows to a Google Sheets tab. Objects use the sheet header names.",
    inputSchema: objectSchema({ rows: { description: "A row object, an array of row objects, or arrays ordered by column position." }, ...commonSheet }, ["rows"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "update_rows",
    title: "Update matching Sheets rows",
    description: "Update rows matching column conditions. Use all=true only when every data row must be changed.",
    inputSchema: objectSchema({ where: { type: "object", additionalProperties: true }, data: { type: "object", additionalProperties: true }, ...commonSheet, all: { type: "boolean" }, casesensitive: { type: "boolean" } }, ["data"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "update_range",
    title: "Update an A1 range",
    description: "Write a matrix of values to an exact A1 range such as B2:D20.",
    inputSchema: objectSchema({ range: { type: "string" }, values: { type: "array", items: { type: "array" } }, ...commonSheet }, ["range", "values"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "delete_rows",
    title: "Delete matching Sheets rows",
    description: "Delete complete rows matching conditions. Use all=true only when every data row must be deleted.",
    inputSchema: objectSchema({ where: { type: "object", additionalProperties: true }, ...commonSheet, all: { type: "boolean" }, casesensitive: { type: "boolean" } }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "clear_range",
    title: "Clear a Sheets range",
    description: "Clear values in an A1 range without deleting the rows.",
    inputSchema: objectSchema({ range: { type: "string" }, ...commonSheet }, ["range"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "format_range",
    title: "Format a Sheets range",
    description: "Format an A1 range: bold, italic, underline, font size, colors, alignment and wrapping.",
    inputSchema: objectSchema({ range: { type: "string" }, ...commonSheet, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, strikethrough: { type: "boolean" }, fontSize: { type: "number" }, textColor: { type: "string" }, bgColor: { type: "string" }, horizontalAlignment: { type: "string" }, verticalAlignment: { type: "string" }, wrapStrategy: { type: "string" } }, ["range"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_sheets",
    title: "List workbook tabs",
    description: "List Google Sheets tabs with IDs, indexes and grid sizes.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "create_sheet",
    title: "Create workbook tab",
    description: "Create a new tab in the Google Sheets workbook.",
    inputSchema: objectSchema({ name: { type: "string" } }, ["name"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "rename_sheet",
    title: "Rename workbook tab",
    description: "Rename a Google Sheets tab.",
    inputSchema: objectSchema({ name: { type: "string" }, new_name: { type: "string" } }, ["name", "new_name"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "delete_sheet",
    title: "Delete workbook tab",
    description: "Delete a Google Sheets tab. Google requires at least one tab to remain.",
    inputSchema: objectSchema({ name: { type: "string" } }, ["name"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];

const driveTools: Tool[] = [
  {
    name: "drive_get_file",
    title: "Get Drive file metadata",
    description: "Get metadata for a Google Drive file or folder.",
    inputSchema: objectSchema({ file_id: { type: "string" } }, ["file_id"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "drive_list_folder",
    title: "List Drive folder",
    description: "List files and folders inside a Google Drive folder.",
    inputSchema: objectSchema({ folder_id: { type: "string" }, page_size: { type: "integer", minimum: 1, maximum: 1000 }, page_token: { type: "string" }, order_by: { type: "string" } }, ["folder_id"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "drive_search",
    title: "Search Google Drive",
    description: "Search Google Drive by file name and optionally inside a specific parent folder.",
    inputSchema: objectSchema({ name: { type: "string" }, parent_id: { type: "string" }, page_size: { type: "integer", minimum: 1, maximum: 1000 }, page_token: { type: "string" } }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "drive_create_folder",
    title: "Create Drive folder",
    description: "Create a folder in Google Drive, optionally under a parent folder.",
    inputSchema: objectSchema({ name: { type: "string" }, parent_id: { type: "string" } }, ["name"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "drive_upload_base64",
    title: "Upload file to Drive",
    description: "Upload a file to Google Drive using Base64 content.",
    inputSchema: objectSchema({ name: { type: "string" }, mime_type: { type: "string" }, content_base64: { type: "string" }, parent_id: { type: "string" } }, ["name", "content_base64"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "drive_rename",
    title: "Rename Drive item",
    description: "Rename a Google Drive file or folder.",
    inputSchema: objectSchema({ file_id: { type: "string" }, name: { type: "string" } }, ["file_id", "name"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "drive_delete",
    title: "Delete Drive item",
    description: "Delete a Google Drive file or folder.",
    inputSchema: objectSchema({ file_id: { type: "string" } }, ["file_id"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "drive_quota",
    title: "Get Drive storage quota",
    description: "Read Google Drive storage quota information.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

function toolList(resourceType: ResourceType) {
  return resourceType === "drive" ? driveTools : sheetTools;
}

function buildQuery(args: Record<string, any>, allowed: string[]) {
  const params = new URLSearchParams();
  for (const key of allowed) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    params.set(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
  }
  return params;
}

async function callLittleApi(request: Request, apiId: string, path: string, options: { method?: string; params?: URLSearchParams; body?: unknown } = {}) {
  const params = options.params || new URLSearchParams();
  const url = `${PUBLIC_API_BASE}/${encodeURIComponent(apiId)}${path ? `/${path.replace(/^\/+/, "")}` : ""}${params.toString() ? `?${params}` : ""}`;
  const headers = new Headers({ "User-Agent": "LittleAPI-MCP/1.0" });
  const key = apiKeyFrom(request);
  if (key) headers.set("X-API-Key", key);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, { method: options.method || "GET", headers, body });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("json") ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const message = typeof data === "object" && data ? (data.message || data.error || `HTTP ${response.status}`) : String(data || `HTTP ${response.status}`);
    throw new Error(message);
  }
  return data;
}

async function executeTool(request: Request, apiId: string, resourceType: ResourceType, name: string, args: Record<string, any>) {
  if (resourceType === "sheet") {
    if (name === "read_rows") return callLittleApi(request, apiId, "", { params: buildQuery(args, ["sheet","limit","offset","select","sort_by","sort_order","raw"]) });
    if (name === "search_rows") {
      const path = args.or ? "search_or" : "search", params = buildQuery(args, ["sheet","search","limit","offset"]);
      for (const [key, value] of Object.entries(args.filters || {})) params.append(key, String(value));
      for (const [key, value] of Object.entries(args.contains || {})) params.append(`contains[${key}]`, String(value));
      return callLittleApi(request, apiId, path, { params });
    }
    if (name === "query_sheet") return callLittleApi(request, apiId, "query", { method: "POST", body: { query: args.query, sheet: args.sheet, raw: args.raw === true, headers: args.headers ?? 1 } });
    if (name === "insert_rows") return callLittleApi(request, apiId, "", { method: "POST", params: buildQuery(args, ["sheet"]), body: args.rows });
    if (name === "update_rows") return callLittleApi(request, apiId, "", { method: "PATCH", params: buildQuery(args, ["sheet"]), body: { ...(args.all ? { all: true } : { where: args.where || {} }), data: args.data || {}, casesensitive: args.casesensitive === true } });
    if (name === "update_range") return callLittleApi(request, apiId, "", { method: "PATCH", params: buildQuery(args, ["sheet"]), body: { range: args.range, values: args.values } });
    if (name === "delete_rows") return callLittleApi(request, apiId, "", { method: "DELETE", params: buildQuery(args, ["sheet"]), body: { ...(args.all ? { all: true } : { where: args.where || {} }), casesensitive: args.casesensitive === true } });
    if (name === "clear_range") return callLittleApi(request, apiId, "clear", { method: "POST", body: { sheet: args.sheet, range: args.range } });
    if (name === "format_range") {
      const { range, sheet, ...format } = args;
      return callLittleApi(request, apiId, "format", { method: "PATCH", body: { range, sheet, ...format } });
    }
    if (name === "list_sheets") return callLittleApi(request, apiId, "sheets");
    if (name === "create_sheet") return callLittleApi(request, apiId, "sheets", { method: "POST", body: { name: args.name } });
    if (name === "rename_sheet") return callLittleApi(request, apiId, `sheets/${encodeURIComponent(args.name)}`, { method: "PATCH", body: { name: args.new_name } });
    if (name === "delete_sheet") return callLittleApi(request, apiId, `sheets/${encodeURIComponent(args.name)}`, { method: "DELETE" });
  } else {
    if (name === "drive_get_file") return callLittleApi(request, apiId, encodeURIComponent(args.file_id));
    if (name === "drive_list_folder") return callLittleApi(request, apiId, `children/${encodeURIComponent(args.folder_id)}`, { params: buildQuery(args, ["page_size","page_token","order_by"]) });
    if (name === "drive_search") return callLittleApi(request, apiId, "search", { params: buildQuery(args, ["name","parent_id","page_size","page_token"]) });
    if (name === "drive_create_folder") return callLittleApi(request, apiId, args.parent_id ? encodeURIComponent(args.parent_id) : "", { method: "POST", body: { name: args.name, mimeType: "application/vnd.google-apps.folder" } });
    if (name === "drive_upload_base64") return callLittleApi(request, apiId, args.parent_id ? encodeURIComponent(args.parent_id) : "", { method: "POST", body: { name: args.name, mimeType: args.mime_type || "application/octet-stream", content_base64: args.content_base64 } });
    if (name === "drive_rename") return callLittleApi(request, apiId, encodeURIComponent(args.file_id), { method: "PATCH", body: { name: args.name } });
    if (name === "drive_delete") return callLittleApi(request, apiId, encodeURIComponent(args.file_id), { method: "DELETE" });
    if (name === "drive_quota") return callLittleApi(request, apiId, "quota");
  }
  throw new Error(`Unknown tool: ${name}`);
}

function toolResult(id: unknown, data: unknown, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return rpcResult(id, {
    content: [{ type: "text", text }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  });
}

function validateHeaders(request: Request, method: string, name: string) {
  const version = request.headers.get("mcp-protocol-version");
  if (version && version !== MCP_VERSION) return `Unsupported MCP protocol version ${version}. LittleAPI supports ${MCP_VERSION}.`;
  const methodHeader = request.headers.get("mcp-method");
  if (methodHeader && methodHeader !== method) return "Mcp-Method header does not match the JSON-RPC method.";
  const nameHeader = request.headers.get("mcp-name");
  if (nameHeader && name && nameHeader !== name) return "Mcp-Name header does not match params.name.";
  return "";
}

export async function handleMcp(request: Request, api: { api_id: string; name: string; resource_type: ResourceType }) {
  if (request.method !== "POST") return rpcError(null, -32600, "LittleAPI MCP uses stateless HTTP POST requests.", undefined, 405);
  const payload = await request.json().catch(() => null) as any;
  if (!payload || payload.jsonrpc !== "2.0" || !payload.method) return rpcError(payload?.id, -32600, "Invalid JSON-RPC request.");
  const method = String(payload.method), toolName = method === "tools/call" ? String(payload.params?.name || "") : "";
  const headerError = validateHeaders(request, method, toolName);
  if (headerError) return rpcError(payload.id, -32020, headerError);

  if (method === "server/discover") {
    return rpcResult(payload.id, {
      supportedVersions: [MCP_VERSION],
      capabilities: { tools: {} },
      serverInfo: { name: "LittleAPI MCP", version: SERVER_VERSION },
      instructions: `Tools for the LittleAPI API “${api.name}”. This MCP endpoint works with ${api.resource_type === "drive" ? "Google Drive" : "Google Sheets"}. Destructive tools must only be used when the user clearly asks for the change.`,
      ttlMs: 60_000,
      cacheScope: "private",
    });
  }

  if (method === "tools/list") {
    return rpcResult(payload.id, { tools: toolList(api.resource_type), ttlMs: 60_000, cacheScope: "private" });
  }

  if (method === "tools/call") {
    if (!toolName) return rpcError(payload.id, -32602, "params.name is required.");
    if (!toolList(api.resource_type).some(tool => tool.name === toolName)) return rpcError(payload.id, -32602, `Unknown tool: ${toolName}`);
    try {
      const data = await executeTool(request, api.api_id, api.resource_type, toolName, payload.params?.arguments || {});
      return toolResult(payload.id, data, false);
    } catch (error) {
      return toolResult(payload.id, { error: error instanceof Error ? error.message : String(error), tool: toolName }, true);
    }
  }

  return rpcError(payload.id, -32601, `Method not found: ${method}`, undefined, 404);
}
