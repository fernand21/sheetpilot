/*
 * LittleAPI billing with Airtm pay-ins.
 *
 * The browser only receives a short-lived checkout URL. Airtm credentials and
 * payment verification stay in this Edge Function. This function deliberately
 * creates one-time pay-ins: monthly renewals remain manual and are never
 * charged automatically.
 */

type Plan = "inicial" | "pro" | "business";
type AirtmStatus =
  | "CREATED"
  | "CONFIRMED"
  | "CANCELED"
  | "PROCESSING"
  | "FAILED"
  | "BRIDGE_FAILED"
  | "BRIDGE_CANCELED";

const plans: Record<Plan, { amount: number; label: string }> = {
  inicial: { amount: 3, label: "LittleAPI Inicial · 1 mes" },
  pro: { amount: 7, label: "LittleAPI Pro · 1 mes" },
  business: { amount: 25, label: "LittleAPI Business · 1 mes" },
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "";
const serviceKey = (() => {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (direct) return direct;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || "";
  } catch (_) {
    return "";
  }
})();

const airtmBaseUrl = (Deno.env.get("AIRTM_API_BASE_URL") || "https://api.enterprise.airtm.com/v2").replace(/\/$/, "");
const airtmCheckoutUrl = (Deno.env.get("AIRTM_CHECKOUT_BASE_URL") || "https://app.airtm.com/payin").replace(/\/$/, "");
const publicSiteUrl = (Deno.env.get("AIRTM_PUBLIC_SITE_URL") || "https://littleapi.online").replace(/\/$/, "");
const airtmApiKey = Deno.env.get("AIRTM_API_KEY") || "";
const airtmApiSecret = Deno.env.get("AIRTM_API_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function routeParts(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const marker = parts.indexOf("airtm-payments");
  return marker >= 0 ? parts.slice(marker + 1) : parts;
}

function configured() {
  return Boolean(airtmApiKey && airtmApiSecret && serviceKey && supabaseUrl);
}

function dbHeaders() {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

async function dbFetch(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase no está configurado en la función.");
  const headers = new Headers(init.headers || {});
  Object.entries(dbHeaders()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  const text = await result.text();
  if (!result.ok) throw new Error(`Supabase respondió ${result.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function airtmHeaders() {
  if (!airtmApiKey || !airtmApiSecret) throw new Error("Airtm todavía no está configurado. Faltan las credenciales del API.");
  const encoded = btoa(`${airtmApiKey}:${airtmApiSecret}`);
  return { Authorization: `Basic ${encoded}`, Accept: "application/json", "Content-Type": "application/json" };
}

async function airtmFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  Object.entries(airtmHeaders()).forEach(([key, value]) => headers.set(key, value));
  const result = await fetch(`${airtmBaseUrl}/${path.replace(/^\//, "")}`, { ...init, headers });
  const text = await result.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  if (!result.ok) {
    const providerMessage = typeof body === "object" && body !== null && "message" in body ? String(body.message) : text.slice(0, 300);
    const error = new Error(`Airtm respondió ${result.status}: ${providerMessage}`);
    (error as Error & { status?: number; provider?: unknown }).status = result.status;
    (error as Error & { status?: number; provider?: unknown }).provider = body;
    throw error;
  }
  return body as Record<string, unknown>;
}

function validEmail(value: unknown) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function safeCode(value: unknown) {
  const code = typeof value === "string" ? value.trim() : "";
  return code && /^[A-Za-z0-9._-]{8,80}$/.test(code) ? code : `littleapi-${crypto.randomUUID()}`;
}

async function optionalUserId(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const authKey = publicKey || serviceKey;
  if (!bearer || !supabaseUrl || !authKey) return null;
  const result = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: authKey, Authorization: `Bearer ${bearer}` } });
  if (!result.ok) return null;
  const user = await result.json().catch(() => null);
  return typeof user?.id === "string" ? user.id : null;
}

function checkoutResponse(order: Record<string, unknown>, provider: Record<string, unknown>) {
  const paymentId = String(provider.id || order.provider_payment_id || "");
  return {
    order_id: order.id,
    code: order.code,
    plan: order.plan,
    amount: order.amount,
    currency: "USD",
    status: String(provider.status || order.status || "CREATED"),
    payment_id: paymentId,
    checkout_url: paymentId ? `${airtmCheckoutUrl}/${encodeURIComponent(paymentId)}` : null,
    message: "Continúa en Airtm para confirmar el pago. La renovación es única y manual.",
  };
}

async function createCheckout(request: Request) {
  if (!configured()) return failure(503, "airtm_not_configured", "Airtm aún no está habilitado. Configura las credenciales Enterprise en los secretos de Supabase.");
  const body = await request.json().catch(() => ({}));
  const plan = String(body.plan || "").trim().toLowerCase() as Plan;
  if (!Object.prototype.hasOwnProperty.call(plans, plan)) return failure(400, "invalid_plan", "Elige un plan válido: inicial, pro o business.");
  const email = body.email == null || body.email === "" ? null : String(body.email).trim();
  if (email && !validEmail(email)) return failure(400, "invalid_email", "Escribe un correo válido para asociar la renovación.");
  const selected = plans[plan];
  const code = safeCode(body.client_reference);
  const confirmationUri = `${publicSiteUrl}/pricing.html?airtm=confirmed`;
  const cancelUri = `${publicSiteUrl}/pricing.html?airtm=canceled`;
  const payload = {
    code,
    amount: selected.amount,
    description: selected.label,
    items: [{ description: selected.label, amount: selected.amount, quantity: 1 }],
    confirmationUri,
    cancelUri,
  };

  let provider: Record<string, unknown>;
  try {
    provider = await airtmFetch("payins", { method: "POST", body: JSON.stringify(payload) });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status || 502);
    return failure(status >= 400 && status < 500 ? status : 502, "airtm_provider_error", error instanceof Error ? error.message : "Airtm no pudo crear el pago.");
  }

  const userId = await optionalUserId(request);
  const order = {
    provider: "airtm",
    provider_payment_id: String(provider.id || ""),
    code,
    plan,
    amount: selected.amount,
    currency: "USD",
    status: String(provider.status || "CREATED").toUpperCase(),
    customer_email: email,
    user_id: userId,
    confirmation_uri: confirmationUri,
    cancel_uri: cancelUri,
  };
  const rows = await dbFetch("airtm_payments", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(order) });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  return response(checkoutResponse(saved || order, provider), 201);
}

async function getStatus(request: Request) {
  if (!configured()) return failure(503, "airtm_not_configured", "Airtm aún no está habilitado.");
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim();
  if (!code || !/^[A-Za-z0-9._-]{8,80}$/.test(code)) return failure(400, "payment_code_required", "Indica un código de pago válido.");
  const rows = await dbFetch(`airtm_payments?select=id,provider_payment_id,code,plan,amount,currency,status,created_at,updated_at,confirmed_at&code=eq.${encodeURIComponent(code)}&limit=1`);
  const order = Array.isArray(rows) ? rows[0] : null;
  if (!order) return failure(404, "payment_not_found", "No encontramos ese pago de LittleAPI.");
  let provider: Record<string, unknown>;
  try {
    provider = await airtmFetch(`payins/${encodeURIComponent(String(order.provider_payment_id))}`);
  } catch (error) {
    return failure(502, "airtm_status_error", error instanceof Error ? error.message : "No se pudo consultar el estado en Airtm.");
  }
  const status = String(provider.status || order.status || "CREATED").toUpperCase();
  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "CONFIRMED" && !order.confirmed_at) updates.confirmed_at = new Date().toISOString();
  await dbFetch(`airtm_payments?id=eq.${encodeURIComponent(String(order.id))}`, { method: "PATCH", body: JSON.stringify(updates) });
  return response({ order_id: order.id, code, plan: order.plan, amount: order.amount, currency: "USD", status, confirmed: status === "CONFIRMED", created_at: order.created_at, updated_at: updates.updated_at, message: status === "CONFIRMED" ? "Pago confirmado. La renovación quedará lista para activación." : "El pago todavía no está confirmado." });
}

async function handler(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const parts = routeParts(request);
  if (request.method === "GET" && parts[0] === "status") return getStatus(request);
  if (request.method === "POST" && (!parts[0] || parts[0] === "checkout")) return createCheckout(request);
  if (request.method === "GET" && !parts[0]) return response({ provider: "airtm", configured: configured(), plans: Object.fromEntries(Object.entries(plans).map(([key, value]) => [key, { amount: value.amount, currency: "USD" }])), recurring: false, message: configured() ? "Airtm está listo para crear pagos únicos." : "Faltan las credenciales Airtm Enterprise en los secretos de Supabase." });
  return failure(404, "not_found", "Ruta de Airtm no encontrada.");
}

Deno.serve(async (request) => {
  try {
    return await handler(request);
  } catch (error) {
    return failure(500, "internal_error", error instanceof Error ? error.message : "No se pudo completar el pago.");
  }
});
