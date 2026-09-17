const originalRequestJson = Request.prototype.json;

function wrapCaseInsensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wrapCaseInsensitive);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;

  const target: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) target[key] = wrapCaseInsensitive(item);

  const resolveKey = (prop: PropertyKey) => {
    if (typeof prop !== "string") return prop;
    if (Object.prototype.hasOwnProperty.call(target, prop)) return prop;
    const lowered = prop.toLowerCase();
    return Object.keys(target).find((key) => key.toLowerCase() === lowered) ?? prop;
  };

  return new Proxy(target, {
    get(obj, prop, receiver) { return Reflect.get(obj, resolveKey(prop), receiver); },
    has(obj, prop) { return Reflect.has(obj, resolveKey(prop)); },
    getOwnPropertyDescriptor(obj, prop) {
      const resolved = resolveKey(prop);
      const descriptor = Reflect.getOwnPropertyDescriptor(obj, resolved);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

Object.defineProperty(Request.prototype, "json", {
  configurable: true,
  writable: true,
  value: async function(this: Request) {
    return wrapCaseInsensitive(await originalRequestJson.call(this));
  },
});

const NativeResponse = globalThis.Response;

const exactMessages = new Map<string, string>([
  ["Las consultas avanzadas sólo están disponibles para APIs de Google Sheets.", "Advanced queries are only available for Google Sheets APIs."],
  ["Esta API privada requiere la cabecera X-API-Key.", "This private API requires the X-API-Key header."],
  ["Indica la consulta en q/query.", "Provide the query in q/query."],
  ["La consulta no puede superar 4000 caracteres.", "The query cannot exceed 4000 characters."],
  ["La consulta no es válida.", "The query is not valid."],
  ["CSV sólo está disponible para APIs de Sheets.", "CSV is only available for Google Sheets APIs."],
  ["La exportación Excel requiere la cabecera X-API-Key.", "Excel export requires the X-API-Key header."],
  ["Excel sólo está disponible para APIs de Sheets.", "Excel export is only available for Google Sheets APIs."],
  ["Listar pestañas requiere la cabecera X-API-Key.", "Listing sheets requires the X-API-Key header."],
  ["Esta API no está vinculada a un libro de Sheets.", "This API is not linked to a Google Sheets workbook."],
  ["Esta API requiere la cabecera X-API-Key.", "This API requires the X-API-Key header."],
  ["Inicia sesión para consultar la clave de API.", "Sign in to retrieve the API key."],
  ["Indica el API_ID.", "Provide the API_ID."],
  ["No existe una API propia con ese identificador.", "No API owned by this account exists with that identifier."],
  ["Esta API se creó antes de activar la recuperación segura de claves.", "This API was created before secure key recovery was enabled."],
  ["Usa GET o POST para la clave de API.", "Use GET or POST for the API key endpoint."],
  ["La clave de API no tiene un formato válido.", "The API key format is invalid."],
  ["Inicia sesión para conectar Google.", "Sign in to connect Google."],
  ["Google no pudo renovar la autorización.", "Google authorization could not be refreshed."],
  ["Google no entregó un refresh token. Vuelve a autorizar con access_type=offline y prompt=consent.", "Google did not return a refresh token. Authorize again with access_type=offline and prompt=consent."],
  ["Las operaciones de escritura requieren la cabecera X-API-Key.", "Write operations require the X-API-Key header."],
  ["Envía al menos una fila.", "Send at least one row."],
  ["PATCH y DELETE requieren where/match. Para afectar todas las filas debes enviar all:true explícitamente.", "PATCH and DELETE require where/match. To affect every row, explicitly send all:true."],
  ["Indica las columnas a actualizar en data o update.", "Provide the columns to update in data or update."],
  ["No se encontró la pestaña para eliminar las filas.", "The sheet required to delete the rows was not found."],
  ["Indica name para la nueva pestaña.", "Provide name for the new sheet."],
  ["Indica la pestaña en la ruta.", "Provide the sheet name in the path."],
  ["No existe esa pestaña.", "That sheet does not exist."],
  ["Indica name con el nuevo nombre.", "Provide name with the new name."],
  ["Google Sheets necesita conservar al menos una pestaña.", "Google Sheets requires at least one sheet to remain."],
  ["Esta API no tiene un libro de Google Sheets.", "This API does not have a Google Sheets workbook."],
  ["Indica destination_spreadsheet_id.", "Provide destination_spreadsheet_id."],
  ["No existe la pestaña que quieres copiar.", "The sheet you want to copy does not exist."],
  ["Envía entre 1 y 50 solicitudes de Google Sheets.", "Send between 1 and 50 Google Sheets requests."],
  ["El rango A1 no es válido.", "The A1 range is invalid."],
  ["textColor debe ser un color hexadecimal como #ffffff.", "textColor must be a hexadecimal color such as #ffffff."],
  ["bgColor debe ser un color hexadecimal como #087a70.", "bgColor must be a hexadecimal color such as #087a70."],
  ["Indica al menos una propiedad de formato.", "Provide at least one formatting property."],
  ["Indica mime_type para exportar un archivo nativo de Google Drive.", "Provide mime_type to export a native Google Drive file."],
  ["Indica name, q o parent_id para buscar en Drive.", "Provide name, q, or parent_id to search Google Drive."],
  ["Para subir desde una API usa JSON con content_base64.", "To upload through the API, use JSON with content_base64."],
  ["Indica name para crear o subir un archivo.", "Provide name to create or upload a file."],
  ["content_base64 no contiene Base64 válido.", "content_base64 does not contain valid Base64."],
  ["Usa GET, POST, PATCH o DELETE.", "Use GET, POST, PATCH, or DELETE."],
  ["No existe una API con ese identificador o está desactivada.", "No API exists with that identifier, or it is disabled."],
  ["Consultar el consumo requiere la cabecera X-API-Key.", "Checking usage requires the X-API-Key header."],
  ["Esta operación requiere la cabecera X-API-Key.", "This operation requires the X-API-Key header."],
  ["Esta API ya no tiene más consultas disponibles este mes.", "This API has no requests remaining for this month."],
  ["No se pudo completar la solicitud. Inténtalo de nuevo más tarde.", "The request could not be completed. Please try again later."],
  ["Google no devolvió una tabla válida.", "Google did not return a valid table."],
  ["Google no permite leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.", "Google does not allow this sheet to be read. Publish it or share it so anyone with the link can view it."],
  ["Esta API no está configurada como hoja de cálculo.", "This API is not configured as a spreadsheet."],
  ["Google no permitió leer esta hoja. Publícala o compártela para que cualquiera con el enlace pueda verla.", "Google did not allow this sheet to be read. Publish it or share it so anyone with the link can view it."],
  ["El servicio de cuotas no devolvió un estado válido.", "The quota service did not return a valid state."],
]);

function translateMessage(value: string): string {
  const exact = exactMessages.get(value);
  if (exact) return exact;

  let match = value.match(/^La API no tiene habilitado el permiso (.+)\.$/);
  if (match) return `This API does not have the ${match[1]} permission enabled.`;

  match = value.match(/^Google no pudo ejecutar la consulta \(HTTP (\d+)\)\.$/);
  if (match) return `Google could not execute the query (HTTP ${match[1]}).`;

  match = value.match(/^Google Sheets respondió (\d+):\s*(.*)$/s);
  if (match) return `Google Sheets returned HTTP ${match[1]}: ${match[2]}`;

  match = value.match(/^Google Drive respondió (\d+):\s*(.*)$/s);
  if (match) return `Google Drive returned HTTP ${match[1]}: ${match[2]}`;

  match = value.match(/^Supabase respondió (\d+):\s*(.*)$/s);
  if (match) return `Supabase returned HTTP ${match[1]}: ${match[2]}`;

  return value;
}

function translateResponseObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(translateResponseObject);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "message" || key === "error_description") && typeof item === "string") {
      result[key] = translateMessage(item);
    } else {
      result[key] = translateResponseObject(item);
    }
  }
  return result;
}

function translatedJsonBody(body: BodyInit | null | undefined, init?: ResponseInit): BodyInit | null | undefined {
  if (typeof body !== "string") return body;
  const headers = new Headers(init?.headers || {});
  const contentType = headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("json")) return body;
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(translateResponseObject(parsed));
  } catch (_) {
    return body;
  }
}

class EnglishApiResponse extends NativeResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(translatedJsonBody(body, init), init);
  }
}

Object.defineProperty(globalThis, "Response", {
  configurable: true,
  writable: true,
  value: EnglishApiResponse,
});

await import("./index.ts");
