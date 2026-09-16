from pathlib import Path

# Patch index.ts
p = Path('supabase/functions/sheetpilot-api/index.ts')
s = p.read_text(encoding='utf-8')
s = s.replace('const API_VERSION = "1.4.0";', 'const API_VERSION = "1.4.1";', 1)

needle = 'function nonEmptyObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length); }\n'
insert = '''function nonEmptyObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length); }\nfunction objectValueForHeader(row: Record<string, unknown>, header: string) {\n  if (Object.prototype.hasOwnProperty.call(row, header)) return row[header];\n  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === header.toLowerCase());\n  return key === undefined ? "" : row[key];\n}\nfunction recognizedObjectColumns(row: Record<string, unknown>, headers: string[]) {\n  const available = new Set(headers.map((header) => header.toLowerCase()));\n  return Object.keys(row).filter((key) => available.has(key.toLowerCase()));\n}\n'''
if needle not in s:
    raise SystemExit('nonEmptyObject target not found')
s = s.replace(needle, insert, 1)

old = '''    const incoming = Array.isArray(body) ? body : body.rows || body.data || body.row || body, rows = Array.isArray(incoming) ? incoming : [incoming];\n    if (!rows.length) return failure(400, "rows_required", "Envía al menos una fila.");\n    const values = rows.map((row: unknown) => Array.isArray(row) ? row : headers.map((header) => (row as Record<string, unknown>)[header] ?? ""));\n    const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values }) });'''
new = '''    const incoming = Array.isArray(body) ? body : body.rows || body.data || body.row || body, rows = Array.isArray(incoming) ? incoming : [incoming];\n    if (!rows.length) return failure(400, "rows_required", "Envía al menos una fila.");\n    for (const row of rows) {\n      if (Array.isArray(row)) continue;\n      if (!row || typeof row !== "object") return failure(400, "invalid_row", "Cada fila debe ser un objeto JSON o un array de valores.");\n      const recognized = recognizedObjectColumns(row as Record<string, unknown>, headers);\n      if (!recognized.length) return failure(400, "unknown_columns", "Ninguna columna enviada coincide con los encabezados de la hoja.", { received_columns: Object.keys(row as Record<string, unknown>), available_columns: headers });\n    }\n    const values = rows.map((row: unknown) => Array.isArray(row) ? row : headers.map((header) => objectValueForHeader(row as Record<string, unknown>, header)));\n    const result = await sheetsRequest(api, token, `spreadsheets/${encodeURIComponent(api.spreadsheet_id || "")}/values/${encodeURIComponent(sheetRange(sheet, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values }) });'''
if old not in s:
    raise SystemExit('POST mapping target not found')
s = s.replace(old, new, 1)

old_catch = '''  let result: Response;\n  try { result = await handler(request); }\n  catch (error) {\n    console.error("sheetpilot-api request failed", error);\n    result = failure(502, "upstream_error", "No se pudo completar la solicitud. Inténtalo de nuevo más tarde.");\n  }'''
new_catch = '''  let result: Response;\n  try { result = await handler(request); }\n  catch (error) {\n    console.error("sheetpilot-api request failed", error);\n    const rawMessage = error instanceof Error ? error.message : String(error || "");\n    const safeMessage = rawMessage\n      .replace(/sp_live_[A-Za-z0-9_-]+/g, "[REDACTED]")\n      .replace(/Bearer\\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")\n      .slice(0, 900);\n    const sheetsMatch = safeMessage.match(/^Google Sheets respondió (\\d+):\\s*([\\s\\S]*)$/);\n    if (sheetsMatch) {\n      const upstreamStatus = Number(sheetsMatch[1]);\n      let reason = sheetsMatch[2].slice(0, 700);\n      try {\n        const parsed = JSON.parse(sheetsMatch[2]);\n        reason = String(parsed?.error?.message || parsed?.error?.status || reason).slice(0, 700);\n      } catch (_) {}\n      const code = upstreamStatus === 403 ? "google_sheets_forbidden" : upstreamStatus === 404 ? "google_sheet_not_found" : upstreamStatus === 400 ? "google_sheets_bad_request" : "google_sheets_error";\n      const status = upstreamStatus === 400 ? 400 : 502;\n      result = failure(status, code, `Google Sheets rechazó la operación (${upstreamStatus}).`, { upstream_status: upstreamStatus, reason });\n    } else if (/invalid_grant|Google no pudo renovar|refresh token|autorizaci[oó]n/i.test(safeMessage)) {\n      result = failure(401, "google_token_refresh_failed", "La autorización de Google debe renovarse. Vuelve a conectar Google desde LittleAPI.", { reason: safeMessage });\n    } else {\n      result = failure(502, "upstream_error", "No se pudo completar la solicitud.", { reason: safeMessage || "unknown_upstream_error" });\n    }\n  }'''
if old_catch not in s:
    raise SystemExit('catch target not found')
s = s.replace(old_catch, new_catch, 1)
p.write_text(s, encoding='utf-8')

# Patch platform.ts query-string logging
p = Path('supabase/functions/sheetpilot-api/platform.ts')
s = p.read_text(encoding='utf-8')
needle = '''async function insertRequestLog(input: TelemetryInput) {\n  if (input.settings?.request_logging === false) return;\n  const url = new URL(input.request.url);'''
replacement = '''function safeQueryString(url: URL) {\n  if (!url.search) return null;\n  const params = new URLSearchParams(url.search);\n  const sensitive = new Set(["x-api-key", "x-littleapi-key", "api-key", "api_key", "apikey", "key", "token", "access-token", "access_token", "refresh-token", "refresh_token", "authorization"]);\n  for (const key of Array.from(params.keys())) {\n    const normalized = key.trim().toLowerCase();\n    if (sensitive.has(normalized)) params.set(key, "[REDACTED]");\n  }\n  return params.toString().replace(/sp_live_[A-Za-z0-9_-]+/g, "%5BREDACTED%5D").slice(0, 2000) || null;\n}\n\nasync function insertRequestLog(input: TelemetryInput) {\n  if (input.settings?.request_logging === false) return;\n  const url = new URL(input.request.url);'''
if needle not in s:
    raise SystemExit('insertRequestLog target not found')
s = s.replace(needle, replacement, 1)
s = s.replace('query_string: url.search ? url.search.slice(1, 2001) : null,', 'query_string: safeQueryString(url),', 1)
p.write_text(s, encoding='utf-8')
