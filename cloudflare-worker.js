/*
 * Proxy de LittleAPI para Cloudflare Workers.
 *
 * Ruta de Cloudflare:
 *   littleapi.online/api/v1/*
 *
 * La página normal continúa en GitHub Pages. Sólo las peticiones que empiezan
 * por /api/v1 se envían a la Edge Function privada de Supabase.
 */
const BACKEND = "https://dnwaapropjmoyqxquzvs.supabase.co/functions/v1/sheetpilot-api";
const PREFIX = "/api/v1";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith(PREFIX)) {
      return new Response("LittleAPI API proxy: usa /api/v1/{API_ID}", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const suffix = incoming.pathname.slice(PREFIX.length) || "/";
    const target = new URL(BACKEND + suffix);
    target.search = incoming.search;

    // Se conservan método, cuerpo y encabezados (incluido X-API-Key).
    // El encabezado permite que OpenAPI muestre la URL pública de LittleAPI.
    const forwarded = new Request(target, request);
    forwarded.headers.set("x-littleapi-public-base", incoming.origin + PREFIX);
    return fetch(forwarded);
  },
};
