/* LittleAPI JavaScript SDK
 * Browser / Node ESM client for https://littleapi.online
 * Source distribution. No npm publication is implied by this file.
 */

const DEFAULT_BASE_URL = "https://littleapi.online/api/v1";

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach(item => search.append(key, String(item)));
    else if (typeof value === "boolean") search.set(key, value ? "true" : "false");
    else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export class LittleAPIError extends Error {
  constructor(message, { status = 0, code = "request_failed", details = null, response = null } = {}) {
    super(message);
    this.name = "LittleAPIError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.response = response;
  }
}

export class LittleAPI {
  constructor({ apiId, apiKey = "", baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    if (!apiId) throw new TypeError("apiId is required");
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
    this.apiId = String(apiId);
    this.apiKey = String(apiKey || "");
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  url(path = "", params = {}) {
    const suffix = String(path || "").replace(/^\/+/, "");
    return `${this.baseUrl}/${encodeURIComponent(this.apiId)}${suffix ? `/${suffix}` : ""}${queryString(params)}`;
  }

  async request(path = "", { method = "GET", params = {}, body, headers = {}, responseType = "json" } = {}) {
    const requestHeaders = new Headers(headers);
    if (this.apiKey && !requestHeaders.has("X-API-Key")) requestHeaders.set("X-API-Key", this.apiKey);
    let payload = body;
    if (body !== undefined && body !== null && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      if (!requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }
    const response = await this.fetch(this.url(path, params), { method, headers: requestHeaders, body: payload });
    if (!response.ok) {
      let data = null;
      try { data = await response.clone().json(); } catch (_) { try { data = await response.clone().text(); } catch (_) {} }
      throw new LittleAPIError(data?.message || data?.error || `LittleAPI returned HTTP ${response.status}`, {
        status: response.status,
        code: data?.error || "request_failed",
        details: data?.details ?? null,
        response,
      });
    }
    if (responseType === "response") return response;
    if (responseType === "text") return response.text();
    if (responseType === "blob") return response.blob();
    if (responseType === "arrayBuffer") return response.arrayBuffer();
    if (response.status === 204) return null;
    return response.json();
  }

  // ----- Google Sheets: reads -----
  list(options = {}) { return this.request("", { params: options }); }
  search(filters = {}, options = {}) { return this.request("search", { params: { ...options, ...filters } }); }
  searchOr(filters = {}, options = {}) { return this.request("search_or", { params: { ...options, ...filters } }); }
  columns({ sheet } = {}) { return this.request("keys", { params: { sheet } }); }
  count({ sheet } = {}) { return this.request("count", { params: { sheet } }); }
  cells(coordinates, { sheet } = {}) {
    const value = Array.isArray(coordinates) ? coordinates.join(",") : String(coordinates);
    return this.request(`cells/${encodeURIComponent(value)}`, { params: { sheet } });
  }
  stats(column = "", { sheet } = {}) { return this.request("stats", { params: { sheet, column } }); }
  metadata() { return this.request("metadata"); }
  openapi() { return this.request("openapi.json"); }
  usage() { return this.request("usage"); }

  async query(query, options = {}) {
    const { sheet, headers = 1, columns = "names", raw = false, method = "auto" } = options;
    const usePost = method === "POST" || (method === "auto" && String(query).length > 1200);
    if (usePost) return this.request("query", { method: "POST", body: { query, sheet, headers, columns, raw } });
    return this.request("query", { params: { q: query, sheet, headers, columns, raw } });
  }

  // ----- Google Sheets: writes -----
  insert(rows, { sheet } = {}) { return this.request("", { method: "POST", params: { sheet }, body: rows }); }
  update(where, data, { sheet, casesensitive = false, all = false } = {}) {
    return this.request("", { method: "PATCH", params: { sheet }, body: { ...(all ? { all: true } : { where }), data, casesensitive } });
  }
  updateRange(range, values, { sheet } = {}) { return this.request("", { method: "PATCH", params: { sheet }, body: { range, values } }); }
  deleteRows(where, { sheet, casesensitive = false, all = false } = {}) {
    return this.request("", { method: "DELETE", params: { sheet }, body: { ...(all ? { all: true } : { where }), casesensitive } });
  }
  clear(range, { sheet } = {}) { return this.request("clear", { method: "POST", body: { sheet, range } }); }
  format(range, format, { sheet, gridRange } = {}) {
    return this.request("format", { method: "PATCH", body: { sheet, ...(gridRange ? { gridRange } : { range }), ...format } });
  }
  batch(requests) { return this.request("batch", { method: "POST", body: { requests } }); }

  // ----- Google Sheets: tabs -----
  sheets() { return this.request("sheets"); }
  createSheet(name) { return this.request("sheets", { method: "POST", body: { name } }); }
  renameSheet(name, newName) { return this.request(`sheets/${encodeURIComponent(name)}`, { method: "PATCH", body: { name: newName } }); }
  deleteSheet(name) { return this.request(`sheets/${encodeURIComponent(name)}`, { method: "DELETE" }); }
  copySheet(sheet, destinationSpreadsheetId) {
    return this.request("sheets/copy", { method: "POST", body: { sheet, destination_spreadsheet_id: destinationSpreadsheetId } });
  }

  // ----- Exports -----
  exportJson(options = {}) { return this.request("export.json", { params: options }); }
  exportCsv({ sheet } = {}) { return this.request("export.csv", { params: { sheet }, responseType: "text" }); }
  exportXlsx() { return this.request("export.xlsx", { responseType: "arrayBuffer" }); }

  // ----- Google Drive -----
  driveFile(fileId = "") { return this.request(fileId ? encodeURIComponent(fileId) : ""); }
  driveChildren(folderId, options = {}) { return this.request(`children/${encodeURIComponent(folderId)}`, { params: options }); }
  driveSearch({ name, parentId, pageSize, pageToken, orderBy } = {}) {
    return this.request("search", { params: { name, parent_id: parentId, page_size: pageSize, page_token: pageToken, order_by: orderBy } });
  }
  driveQuota() { return this.request("quota"); }
  driveAbout() { return this.request("about"); }
  driveCreate({ name, mimeType = "application/octet-stream", parentId = "", parents, contentBase64 } = {}) {
    const path = parentId ? encodeURIComponent(parentId) : "";
    return this.request(path, { method: "POST", body: { name, mimeType, parents, ...(contentBase64 ? { content_base64: contentBase64 } : {}) } });
  }
  driveRename(fileId, name) { return this.request(encodeURIComponent(fileId), { method: "PATCH", body: { name } }); }
  driveDelete(fileId) { return this.request(encodeURIComponent(fileId), { method: "DELETE" }); }
  driveDownload(fileId) { return this.request(`download/${encodeURIComponent(fileId)}`, { responseType: "arrayBuffer" }); }
  driveExport(fileId, mimeType) { return this.request(`export/${encodeURIComponent(fileId)}`, { params: { mime_type: mimeType }, responseType: "arrayBuffer" }); }
}

export default LittleAPI;
