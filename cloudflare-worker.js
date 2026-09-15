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
      return fetch(request);
    }

    const suffix = incoming.pathname.slice(PREFIX.length) || "/";
    const target = new URL(BACKEND + suffix);
    target.search = incoming.search;

    // Se conservan método, cuerpo y encabezados (incluido X-API-Key).
    return fetch(new Request(target, request));
  },
};
