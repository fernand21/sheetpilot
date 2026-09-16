type SecuritySettings = {
  api_id: string;
  allowed_origins: string[];
  allowed_ips: string[];
  request_logging: boolean;
  audit_logging: boolean;
};

type TelemetryInput = {
  apiId: string;
  request: Request;
  response: Response;
  durationMs: number;
  requestId: string;
  settings: SecuritySettings | null;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "";
const serviceKey = (() => {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (direct) return direct;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch (_) { return ""; }
})();

const DEFAULT_SECURITY: Omit<SecuritySettings, "api_id"> = {
  allowed_origins: [],
  allowed_ips: [],
  request_logging: true,
  audit_logging: true,
};

const securityCache = new Map<string, { expires: number; value: SecuritySettings }>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function dbHeaders() {
  const key = serviceKey || publicKey;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function dbFetch(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !(serviceKey || publicKey)) throw new Error("Supabase is not configured.");
  const headers = new Headers(init.headers || {});
  Object.entries(dbHeaders()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  const text = await result.text();
  if (!result.ok) throw new Error(`Supabase ${result.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function currentUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = publicKey || serviceKey;
  if (!token || !supabaseUrl || !key) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  return response.ok ? await response.json() : null;
}

async function ownedApi(userId: string, apiId: string) {
  const rows = await dbFetch(`api_endpoints?select=api_id,name,resource_type,user_id&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows?.[0] || null;
}

function normalizeOrigin(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch (_) { return ""; }
}

function normalizeList(value: unknown) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return input.map((item) => String(item || "").trim()).filter((item, index, list) => item && list.indexOf(item) === index);
}

function normalizeIp(value: string) {
  let ip = String(value || "").trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

function ipv4ToInt(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipMatches(ip: string, rule: string) {
  const candidate = normalizeIp(ip), normalizedRule = normalizeIp(rule);
  if (!candidate || !normalizedRule) return false;
  if (!normalizedRule.includes("/")) return candidate.toLowerCase() === normalizedRule.toLowerCase();
  const [network, bitsRaw] = normalizedRule.split("/"), bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(candidate), netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

export function clientIp(request: Request) {
  return normalizeIp(
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    ""
  );
}

export async function getSecuritySettings(apiId: string): Promise<SecuritySettings> {
  const cached = securityCache.get(apiId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const rows = await dbFetch(`api_security_settings?select=api_id,allowed_origins,allowed_ips,request_logging,audit_logging&api_id=eq.${encodeURIComponent(apiId)}&limit=1`);
  const row = rows?.[0];
  const value: SecuritySettings = {
    api_id: apiId,
    allowed_origins: Array.isArray(row?.allowed_origins) ? row.allowed_origins : [],
    allowed_ips: Array.isArray(row?.allowed_ips) ? row.allowed_ips : [],
    request_logging: row?.request_logging !== false,
    audit_logging: row?.audit_logging !== false,
  };
  securityCache.set(apiId, { expires: Date.now() + 30_000, value });
  return value;
}

export function enforceRequestSecurity(request: Request, settings: SecuritySettings | null) {
  if (!settings) return null;
  const origin = request.headers.get("origin") || "";
  if (settings.allowed_origins.length && origin && !settings.allowed_origins.includes(origin)) {
    return json({ error: "origin_not_allowed", message: "This browser origin is not allowed for this API.", origin }, 403);
  }
  if (settings.allowed_ips.length) {
    const ip = clientIp(request);
    if (!ip || !settings.allowed_ips.some((rule) => ipMatches(ip, rule))) {
      return json({ error: "ip_not_allowed", message: "This IP address is not allowed for this API." }, 403);
    }
  }
  return null;
}

export function withDynamicCors(response: Response, request: Request, settings: SecuritySettings | null) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Headers", "content-type, apikey, x-api-key, authorization, x-littleapi-key, x-client-info, x-retry-count, traceparent, tracestate, baggage");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Expose-Headers", "content-disposition, retry-after, x-littleapi-cache, x-littleapi-version, x-littleapi-quota-limit, x-littleapi-quota-used, x-littleapi-quota-remaining, x-littleapi-quota-reset, x-littleapi-request-id");
  const origin = request.headers.get("origin") || "";
  if (!settings?.allowed_origins?.length) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && settings.allowed_origins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", headers.get("Vary") ? `${headers.get("Vary")}, Origin` : "Origin");
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function background(task: Promise<unknown>) {
  const safe = task.catch((error) => console.error("LittleAPI background task failed", error));
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(safe);
}

async function insertRequestLog(input: TelemetryInput) {
  if (input.settings?.request_logging === false) return;
  const url = new URL(input.request.url);
  await dbFetch("api_request_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      request_id: input.requestId,
      api_id: input.apiId,
      method: input.request.method,
      path: url.pathname,
      query_string: url.search ? url.search.slice(1, 2001) : null,
      status: input.response.status,
      duration_ms: Math.max(0, Math.round(input.durationMs)),
      client_ip: clientIp(input.request) || null,
      origin: input.request.headers.get("origin") || null,
      user_agent: (input.request.headers.get("user-agent") || "").slice(0, 500) || null,
    }),
  });
}

function mutationEvent(request: Request) {
  const url = new URL(request.url), parts = url.pathname.split("/").filter(Boolean);
  const marker = parts.indexOf("v1"), route = marker >= 0 ? parts.slice(marker + 2) : parts.slice(parts.indexOf("sheetpilot-api") + 2);
  const first = route[0] || "";
  if (request.method === "GET") return "api.request.completed";
  if (first === "query") return "api.request.completed";
  if (first === "format") return "sheet.formatted";
  if (first === "clear") return "sheet.cleared";
  if (first === "batch") return "sheet.batch";
  if (first === "sheets") {
    if (route[1] === "copy") return "sheet.copied";
    if (request.method === "POST") return "sheet.created";
    if (request.method === "PATCH") return "sheet.renamed";
    if (request.method === "DELETE") return "sheet.deleted";
  }
  if (request.method === "POST") return "row.created";
  if (request.method === "PATCH") return "row.updated";
  if (request.method === "DELETE") return "row.deleted";
  return "api.request.completed";
}

async function insertAudit(input: TelemetryInput, event: string) {
  if (input.settings?.audit_logging === false || input.response.status >= 400 || event === "api.request.completed") return;
  const url = new URL(input.request.url);
  await dbFetch("api_audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      api_id: input.apiId,
      actor_type: input.request.headers.get("x-api-key") || input.request.headers.get("x-littleapi-key") ? "api_key" : "public",
      action: event,
      resource: url.pathname,
      details: { method: input.request.method, status: input.response.status, request_id: input.requestId },
    }),
  });
}

async function encryptionKey() {
  const secret = Deno.env.get("LITTLEAPI_KEY_ENCRYPTION_KEY") || Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") || serviceKey;
  if (!secret) throw new Error("Missing server encryption key.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array) {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}

function base64ToBytes(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  const joined = new Uint8Array(iv.length + encrypted.byteLength);
  joined.set(iv); joined.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64(joined);
}

async function decryptSecret(value: string) {
  const joined = base64ToBytes(value), iv = joined.slice(0, 12), encrypted = joined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), encrypted);
  return new TextDecoder().decode(plain);
}

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(signature).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deliverWebhook(webhook: any, event: string, payload: Record<string, unknown>) {
  const deliveryId = crypto.randomUUID(), body = JSON.stringify({ id: deliveryId, event, created_at: new Date().toISOString(), ...payload });
  const secret = await decryptSecret(webhook.secret_ciphertext), signature = await hmac(secret, body);
  let statusCode: number | null = null, success = false, error = "", snippet = "", attempt = 0;
  for (attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "LittleAPI-Webhooks/1.0",
          "X-LittleAPI-Event": event,
          "X-LittleAPI-Delivery": deliveryId,
          "X-LittleAPI-Signature": `sha256=${signature}`,
        },
        body,
      });
      statusCode = response.status;
      snippet = (await response.text()).slice(0, 500);
      success = response.ok;
      if (success) break;
      error = `HTTP ${response.status}`;
    } catch (deliveryError) {
      error = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 500 : 1500));
  }
  await dbFetch("api_webhook_deliveries", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ webhook_id: webhook.id, api_id: webhook.api_id, event, status_code: statusCode, success, error: error || null, response_snippet: snippet || null, attempt, delivered_at: new Date().toISOString() }),
  });
  const nextFailures = success ? 0 : Number(webhook.failure_count || 0) + 1;
  await dbFetch(`api_webhooks?id=eq.${encodeURIComponent(webhook.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_delivery_at: new Date().toISOString(), last_status: statusCode, failure_count: nextFailures, updated_at: new Date().toISOString() }),
  });
}

async function fireWebhooks(input: TelemetryInput, event: string) {
  const rows = await dbFetch(`api_webhooks?select=id,api_id,url,events,secret_ciphertext,failure_count&api_id=eq.${encodeURIComponent(input.apiId)}&enabled=eq.true`);
  const hooks = (rows || []).filter((hook: any) => Array.isArray(hook.events) && (hook.events.includes(event) || hook.events.includes("*")));
  if (!hooks.length) return;
  const url = new URL(input.request.url);
  const payload = {
    api_id: input.apiId,
    request_id: input.requestId,
    data: { method: input.request.method, path: url.pathname, status: input.response.status, duration_ms: Math.round(input.durationMs) },
  };
  await Promise.all(hooks.map((hook: any) => deliverWebhook(hook, event, payload)));
}

export function scheduleTelemetry(input: TelemetryInput) {
  const event = mutationEvent(input.request);
  background(Promise.all([
    insertRequestLog(input),
    insertAudit(input, event),
    input.response.status < 400 ? fireWebhooks(input, event) : Promise.resolve(),
  ]));
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `whsec_${value}`;
}

async function securityAccount(request: Request, user: any) {
  const url = new URL(request.url), body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
  const apiId = String(body.api_id || url.searchParams.get("api_id") || "").trim();
  if (!apiId) return json({ error: "api_id_required", message: "Indica api_id." }, 400);
  const api = await ownedApi(user.id, apiId);
  if (!api) return json({ error: "api_not_found", message: "No existe una API propia con ese ID." }, 404);
  if (request.method === "GET") {
    const settings = await getSecuritySettings(apiId);
    return json({ api_id: apiId, ...settings });
  }
  if (!["PUT", "PATCH", "POST"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const origins = normalizeList(body.allowed_origins).map(normalizeOrigin).filter(Boolean);
  const ips = normalizeList(body.allowed_ips);
  const row = {
    api_id: apiId,
    user_id: user.id,
    allowed_origins: origins,
    allowed_ips: ips,
    request_logging: body.request_logging !== false,
    audit_logging: body.audit_logging !== false,
    updated_at: new Date().toISOString(),
  };
  await dbFetch("api_security_settings?on_conflict=api_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
  securityCache.delete(apiId);
  await dbFetch("api_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ api_id: apiId, actor_type: "user", action: "security.updated", resource: "security", details: { allowed_origins: origins.length, allowed_ips: ips.length } }) });
  return json({ success: true, api_id: apiId, ...row });
}

async function logsAccount(request: Request, user: any) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(request.url), apiId = String(url.searchParams.get("api_id") || "").trim();
  if (!apiId) return json({ error: "api_id_required" }, 400);
  if (!(await ownedApi(user.id, apiId))) return json({ error: "api_not_found" }, 404);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100) || 100));
  const type = url.searchParams.get("type") || "requests";
  if (type === "audit") {
    const data = await dbFetch(`api_audit_logs?select=id,api_id,actor_type,action,resource,details,created_at&api_id=eq.${encodeURIComponent(apiId)}&order=created_at.desc&limit=${limit}`);
    return json({ data: data || [], type: "audit" });
  }
  if (type === "webhooks") {
    const data = await dbFetch(`api_webhook_deliveries?select=id,webhook_id,api_id,event,status_code,success,error,response_snippet,attempt,created_at,delivered_at&api_id=eq.${encodeURIComponent(apiId)}&order=created_at.desc&limit=${limit}`);
    return json({ data: data || [], type: "webhooks" });
  }
  const data = await dbFetch(`api_request_logs?select=id,request_id,api_id,method,path,query_string,status,duration_ms,client_ip,origin,user_agent,created_at&api_id=eq.${encodeURIComponent(apiId)}&order=created_at.desc&limit=${limit}`);
  return json({ data: data || [], type: "requests" });
}

async function webhooksAccount(request: Request, user: any, subpath: string[]) {
  const url = new URL(request.url), body = request.method === "GET" || request.method === "DELETE" ? await request.json().catch(() => ({})) : await request.json().catch(() => ({}));
  const apiId = String(body.api_id || url.searchParams.get("api_id") || "").trim();
  if (!apiId) return json({ error: "api_id_required" }, 400);
  if (!(await ownedApi(user.id, apiId))) return json({ error: "api_not_found" }, 404);
  if (subpath[0] === "test" && request.method === "POST") {
    const webhookId = String(body.id || "").trim();
    const rows = await dbFetch(`api_webhooks?select=id,api_id,url,events,secret_ciphertext,failure_count&id=eq.${encodeURIComponent(webhookId)}&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (!rows?.[0]) return json({ error: "webhook_not_found" }, 404);
    background(deliverWebhook(rows[0], "webhook.test", { api_id: apiId, data: { message: "LittleAPI webhook test" } }));
    return json({ success: true, queued: true });
  }
  if (request.method === "GET") {
    const rows = await dbFetch(`api_webhooks?select=id,api_id,url,events,secret_prefix,enabled,failure_count,last_delivery_at,last_status,created_at,updated_at&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc`);
    return json({ data: rows || [] });
  }
  if (request.method === "POST") {
    let parsed: URL;
    try { parsed = new URL(String(body.url || "")); } catch (_) { return json({ error: "invalid_url", message: "Indica una URL HTTPS válida." }, 400); }
    if (parsed.protocol !== "https:") return json({ error: "https_required", message: "Los webhooks requieren HTTPS." }, 400);
    const events = normalizeList(body.events);
    const secret = randomSecret();
    const rows = await dbFetch("api_webhooks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ api_id: apiId, user_id: user.id, url: parsed.toString(), events: events.length ? events : ["row.created", "row.updated", "row.deleted"], secret_ciphertext: await encryptSecret(secret), secret_prefix: secret.slice(0, 12), enabled: body.enabled !== false }) });
    await dbFetch("api_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ api_id: apiId, actor_type: "user", action: "webhook.created", resource: rows?.[0]?.id || null, details: { url: parsed.origin, events: events.length || 3 } }) });
    return json({ success: true, webhook: rows?.[0] ? { id: rows[0].id, api_id: apiId, url: rows[0].url, events: rows[0].events, enabled: rows[0].enabled } : null, secret, message: "Guarda este secreto: sólo se muestra una vez." }, 201);
  }
  const id = String(body.id || url.searchParams.get("id") || "").trim();
  if (!id) return json({ error: "webhook_id_required" }, 400);
  if (request.method === "PATCH") {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.url !== undefined) {
      let parsed: URL; try { parsed = new URL(String(body.url)); } catch (_) { return json({ error: "invalid_url" }, 400); }
      if (parsed.protocol !== "https:") return json({ error: "https_required" }, 400);
      patch.url = parsed.toString();
    }
    if (body.events !== undefined) patch.events = normalizeList(body.events);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    await dbFetch(`api_webhooks?id=eq.${encodeURIComponent(id)}&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    await dbFetch("api_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ api_id: apiId, actor_type: "user", action: "webhook.updated", resource: id, details: {} }) });
    return json({ success: true, id });
  }
  if (request.method === "DELETE") {
    await dbFetch(`api_webhooks?id=eq.${encodeURIComponent(id)}&api_id=eq.${encodeURIComponent(apiId)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await dbFetch("api_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ api_id: apiId, actor_type: "user", action: "webhook.deleted", resource: id, details: {} }) });
    return json({ success: true, deleted: id });
  }
  return json({ error: "method_not_allowed" }, 405);
}

export async function accountRequest(request: Request, path: string[]) {
  const user = await currentUser(request);
  if (!user?.id) return json({ error: "login_required", message: "Inicia sesión para administrar esta configuración." }, 401);
  if (path[0] === "security") return securityAccount(request, user);
  if (path[0] === "logs") return logsAccount(request, user);
  if (path[0] === "webhooks") return webhooksAccount(request, user, path.slice(1));
  return json({ error: "not_found", message: "Account endpoint not found." }, 404);
}
