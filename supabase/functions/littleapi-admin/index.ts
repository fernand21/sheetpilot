type AdminRole = "owner" | "admin" | "support";
type Plan = "free" | "inicial" | "pro" | "business" | "unlimited";

type AdminContext = {
  user: { id: string; email?: string | null };
  role: AdminRole;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "";
const serviceKey = (() => {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (direct) return direct;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch (_) { return ""; }
})();

const allowedOrigins = new Set(["https://littleapi.online", "https://www.littleapi.online"]);
const PLAN_LIMITS: Record<Plan, { apiLimit: number; requestsPerApi: number }> = {
  free: { apiLimit: 2, requestsPerApi: 5000 },
  inicial: { apiLimit: 10, requestsPerApi: 50000 },
  pro: { apiLimit: 50, requestsPerApi: 250000 },
  business: { apiLimit: 200, requestsPerApi: 1000000 },
  unlimited: { apiLimit: 1000000, requestsPerApi: 10000000 },
};
const PLAN_PRICES: Record<Exclude<Plan, "free" | "unlimited">, number> = { inicial: 3, pro: 7, business: 25 };

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Expose-Headers": "x-littleapi-admin-version",
    "Cache-Control": "no-store",
  };
  if (!origin || allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin || "https://littleapi.online";
  return headers;
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "X-LittleAPI-Admin-Version": "1.0.0" },
  });
}

function failure(request: Request, status: number, error: string, message: string, details?: unknown) {
  return json(request, { error, message, ...(details === undefined ? {} : { details }) }, status);
}

function serviceHeaders() {
  if (!serviceKey) throw new Error("Missing Supabase service key.");
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

async function dbFetch(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase server configuration is incomplete.");
  const headers = new Headers(init.headers || {});
  Object.entries(serviceHeaders()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function authAdminFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  Object.entries(serviceHeaders()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path.replace(/^\//, "")}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase Auth ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function currentAdmin(request: Request): Promise<AdminContext | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const authKey = publicKey || serviceKey;
  if (!token || !authKey || !supabaseUrl) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: authKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  if (!user?.id) return null;
  const rows = await dbFetch(`littleapi_admin_users?select=user_id,role,enabled&user_id=eq.${encodeURIComponent(user.id)}&enabled=eq.true&limit=1`);
  if (!rows?.[0]) return null;
  return { user: { id: user.id, email: user.email || null }, role: rows[0].role as AdminRole };
}

function routeParts(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const marker = parts.indexOf("littleapi-admin");
  return marker >= 0 ? parts.slice(marker + 1) : parts;
}

function monthStartIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function addOneMonth(iso: string) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const result = new Date(d);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString();
}

async function listAllUsers() {
  const users: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = await authAdminFetch(`users?page=${page}&per_page=1000`);
    const batch = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function findAuthUser(userId: string) {
  return authAdminFetch(`users/${encodeURIComponent(userId)}`);
}

async function findUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const users = await listAllUsers();
  return users.find((item) => String(item.email || "").toLowerCase() === normalized) || null;
}

async function applyPlan(admin: AdminContext, userId: string, plan: Plan, options: { status?: string; source?: string; periodStart?: string | null; periodEnd?: string | null; graceUntil?: string | null; saleId?: string | null } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)) throw new Error("Invalid plan.");
  const user = await findAuthUser(userId);
  if (!user?.id) throw new Error("User not found.");

  const existingApp = user.app_metadata || user.raw_app_meta_data || {};
  const nextApp = { ...existingApp, littleapi_plan: plan, littleapi_unlimited: plan === "unlimited" };
  await authAdminFetch(`users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ app_metadata: nextApp }),
  });

  const status = ["active", "past_due", "paused", "canceled"].includes(String(options.status || "")) ? String(options.status) : "active";
  const subscription = {
    user_id: userId,
    plan,
    status,
    current_period_start: options.periodStart || null,
    current_period_end: options.periodEnd || null,
    grace_until: options.graceUntil || null,
    source: options.source || "admin",
    last_sale_id: options.saleId || null,
    updated_by: admin.user.id,
    updated_at: new Date().toISOString(),
  };
  const subRows = await dbFetch("littleapi_subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(subscription),
  });

  const email = String(user.email || "").trim();
  if (plan === "unlimited") {
    await dbFetch("littleapi_unlimited_users?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, email, enabled: true, note: "Managed from LittleAPI Admin", updated_at: new Date().toISOString() }),
    });
  } else {
    await dbFetch(`littleapi_unlimited_users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
    });
  }

  await dbFetch(`api_endpoints?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ monthly_request_limit: PLAN_LIMITS[plan].requestsPerApi, updated_at: new Date().toISOString() }),
  });

  return { user_id: userId, email, plan, status, limits: PLAN_LIMITS[plan], subscription: subRows?.[0] || subscription };
}

async function summary() {
  const [users, projects, apis, subscriptions, sales, usage, webhooks, deliveries, recentErrors] = await Promise.all([
    listAllUsers(),
    dbFetch("projects?select=id,user_id"),
    dbFetch("api_endpoints?select=api_id,user_id,enabled,resource_type"),
    dbFetch("littleapi_subscriptions?select=user_id,plan,status,current_period_end"),
    dbFetch("littleapi_sales?select=id,amount,currency,status,paid_at,created_at,plan"),
    dbFetch(`api_usage_monthly?select=api_id,requests&period_start=eq.${monthStartIso()}`),
    dbFetch("api_webhooks?select=id,enabled,failure_count"),
    dbFetch("api_webhook_deliveries?select=id,success,created_at&order=created_at.desc&limit=500"),
    dbFetch(`api_request_logs?select=id,status,created_at&status=gte.400&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&limit=1000`),
  ]);
  const completed = (sales || []).filter((sale: any) => sale.status === "completed");
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const paidThisMonth = completed.filter((sale: any) => String(sale.paid_at || sale.created_at || "").startsWith(monthKey));
  const revenueTotal = completed.filter((sale: any) => sale.currency === "USD").reduce((sum: number, sale: any) => sum + Number(sale.amount || 0), 0);
  const revenueMonth = paidThisMonth.filter((sale: any) => sale.currency === "USD").reduce((sum: number, sale: any) => sum + Number(sale.amount || 0), 0);
  return {
    users: users.length,
    projects: (projects || []).length,
    apis: (apis || []).filter((api: any) => api.enabled !== false).length,
    sheet_apis: (apis || []).filter((api: any) => api.enabled !== false && api.resource_type === "sheet").length,
    drive_apis: (apis || []).filter((api: any) => api.enabled !== false && api.resource_type === "drive").length,
    requests_this_month: (usage || []).reduce((sum: number, row: any) => sum + Number(row.requests || 0), 0),
    active_paid_accounts: (subscriptions || []).filter((sub: any) => sub.status === "active" && ["inicial", "pro", "business"].includes(sub.plan)).length,
    sales_total: completed.length,
    sales_this_month: paidThisMonth.length,
    revenue_usd_total: revenueTotal,
    revenue_usd_this_month: revenueMonth,
    enabled_webhooks: (webhooks || []).filter((row: any) => row.enabled).length,
    webhook_failures: (deliveries || []).filter((row: any) => row.success === false).length,
    errors_24h: (recentErrors || []).length,
  };
}

async function usersList(request: Request) {
  const url = new URL(request.url);
  const search = String(url.searchParams.get("search") || "").trim().toLowerCase();
  const users = await listAllUsers();
  const [subs, apis, projects] = await Promise.all([
    dbFetch("littleapi_subscriptions?select=user_id,plan,status,current_period_start,current_period_end,grace_until,source"),
    dbFetch("api_endpoints?select=user_id,api_id,enabled"),
    dbFetch("projects?select=user_id,id"),
  ]);
  const subMap = new Map((subs || []).map((item: any) => [item.user_id, item]));
  const apiCounts = new Map<string, number>(), projectCounts = new Map<string, number>();
  for (const item of apis || []) if (item.enabled !== false) apiCounts.set(item.user_id, (apiCounts.get(item.user_id) || 0) + 1);
  for (const item of projects || []) projectCounts.set(item.user_id, (projectCounts.get(item.user_id) || 0) + 1);
  return users.map((user: any) => ({
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || "",
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    plan: subMap.get(user.id)?.plan || user.app_metadata?.littleapi_plan || "free",
    subscription_status: subMap.get(user.id)?.status || "active",
    current_period_end: subMap.get(user.id)?.current_period_end || null,
    grace_until: subMap.get(user.id)?.grace_until || null,
    api_count: apiCounts.get(user.id) || 0,
    project_count: projectCounts.get(user.id) || 0,
  })).filter((user: any) => !search || `${user.email || ""} ${user.name || ""}`.toLowerCase().includes(search));
}

async function salesList() {
  const sales = await dbFetch("littleapi_sales?select=*&order=created_at.desc&limit=500");
  const users = await listAllUsers();
  const emailMap = new Map(users.map((user: any) => [user.id, user.email || ""]));
  return (sales || []).map((sale: any) => ({ ...sale, account_email: sale.user_id ? emailMap.get(sale.user_id) || null : null }));
}

async function createSale(request: Request, admin: AdminContext) {
  const body = await request.json().catch(() => ({}));
  const plan = String(body.plan || "").toLowerCase() as Plan;
  if (!["inicial", "pro", "business"].includes(plan)) return failure(request, 400, "invalid_plan", "Choose inicial, pro or business.");
  let userId = String(body.user_id || "").trim();
  const email = String(body.customer_email || body.email || "").trim();
  if (!userId && email) userId = String((await findUserByEmail(email))?.id || "");
  const status = ["pending", "completed", "refunded", "failed", "canceled"].includes(String(body.status || "")) ? String(body.status) : "completed";
  const paidAt = body.paid_at ? new Date(body.paid_at).toISOString() : status === "completed" ? new Date().toISOString() : null;
  const periodStart = status === "completed" ? String(body.period_start || paidAt || new Date().toISOString()) : null;
  const periodEnd = status === "completed" ? String(body.period_end || addOneMonth(periodStart!)) : null;
  const amount = Number(body.amount ?? PLAN_PRICES[plan as keyof typeof PLAN_PRICES]);
  if (!Number.isFinite(amount) || amount < 0) return failure(request, 400, "invalid_amount", "Amount must be a valid number.");
  const row = {
    provider: String(body.provider || "paypal").toLowerCase() === "manual" ? "manual" : "paypal",
    provider_payment_id: String(body.provider_payment_id || body.payment_id || "").trim() || null,
    user_id: userId || null,
    customer_email: email || null,
    plan,
    amount,
    currency: String(body.currency || "USD").toUpperCase().slice(0, 8),
    status,
    paid_at: paidAt,
    period_start: periodStart,
    period_end: periodEnd,
    notes: String(body.notes || "").trim() || null,
    recorded_by: admin.user.id,
    updated_at: new Date().toISOString(),
  };
  let rows: any;
  try {
    rows = await dbFetch("littleapi_sales", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  } catch (error) {
    return failure(request, 409, "sale_not_saved", error instanceof Error ? error.message : "Sale could not be saved.");
  }
  const sale = rows?.[0] || row;
  let activation = null;
  if (status === "completed" && userId && body.activate_plan !== false) {
    activation = await applyPlan(admin, userId, plan, { source: row.provider, periodStart, periodEnd, saleId: sale.id });
  }
  return json(request, { sale, activation }, 201);
}

async function updateSale(request: Request, admin: AdminContext, saleId: string) {
  const existingRows = await dbFetch(`littleapi_sales?select=*&id=eq.${encodeURIComponent(saleId)}&limit=1`);
  const existing = existingRows?.[0];
  if (!existing) return failure(request, 404, "sale_not_found", "Sale not found.");
  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status && ["pending", "completed", "refunded", "failed", "canceled"].includes(String(body.status))) update.status = String(body.status);
  if (body.notes !== undefined) update.notes = String(body.notes || "").trim() || null;
  if (body.provider_payment_id !== undefined) update.provider_payment_id = String(body.provider_payment_id || "").trim() || null;
  if (body.customer_email !== undefined) update.customer_email = String(body.customer_email || "").trim() || null;
  if (body.paid_at !== undefined) update.paid_at = body.paid_at ? new Date(body.paid_at).toISOString() : null;
  const rows = await dbFetch(`littleapi_sales?id=eq.${encodeURIComponent(saleId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(update) });
  const sale = rows?.[0] || { ...existing, ...update };
  let activation = null;
  if (sale.status === "completed" && sale.user_id && body.activate_plan === true) {
    const start = sale.period_start || sale.paid_at || new Date().toISOString();
    const end = sale.period_end || addOneMonth(start);
    activation = await applyPlan(admin, sale.user_id, sale.plan, { source: sale.provider, periodStart: start, periodEnd: end, saleId: sale.id });
  }
  return json(request, { sale, activation });
}

async function apisList() {
  const [apis, usage, users] = await Promise.all([
    dbFetch("api_endpoints?select=api_id,name,user_id,resource_type,default_sheet,public_read,enabled,cache_ttl,monthly_request_limit,created_at,updated_at&order=created_at.desc"),
    dbFetch(`api_usage_monthly?select=api_id,requests&period_start=eq.${monthStartIso()}`),
    listAllUsers(),
  ]);
  const usageMap = new Map((usage || []).map((item: any) => [item.api_id, Number(item.requests || 0)]));
  const emailMap = new Map(users.map((user: any) => [user.id, user.email || ""]));
  return (apis || []).map((api: any) => ({ ...api, requests_this_month: usageMap.get(api.api_id) || 0, owner_email: emailMap.get(api.user_id) || null }));
}

async function updateApi(request: Request, apiId: string) {
  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.public_read === "boolean") update.public_read = body.public_read;
  if (body.monthly_request_limit !== undefined) {
    const limit = Number(body.monthly_request_limit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100000000) return failure(request, 400, "invalid_limit", "Invalid monthly request limit.");
    update.monthly_request_limit = limit;
  }
  if (body.cache_ttl !== undefined) {
    const ttl = Number(body.cache_ttl);
    if (!Number.isInteger(ttl) || ttl < 0 || ttl > 3600) return failure(request, 400, "invalid_cache_ttl", "Cache TTL must be between 0 and 3600 seconds.");
    update.cache_ttl = ttl;
  }
  const rows = await dbFetch(`api_endpoints?api_id=eq.${encodeURIComponent(apiId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(update) });
  if (!rows?.[0]) return failure(request, 404, "api_not_found", "API not found.");
  return json(request, rows[0]);
}

async function logsList(request: Request) {
  const url = new URL(request.url);
  const apiId = String(url.searchParams.get("api_id") || "").trim();
  const status = Number(url.searchParams.get("status") || 0);
  let path = "api_request_logs?select=request_id,api_id,method,path,query_string,status,duration_ms,client_ip,origin,user_agent,created_at&order=created_at.desc&limit=300";
  if (apiId) path += `&api_id=eq.${encodeURIComponent(apiId)}`;
  if (Number.isInteger(status) && status >= 100) path += `&status=eq.${status}`;
  return dbFetch(path);
}

async function auditList() {
  return dbFetch("api_audit_logs?select=api_id,actor_type,action,resource,details,created_at&order=created_at.desc&limit=300");
}

async function webhooksList() {
  const [hooks, deliveries] = await Promise.all([
    dbFetch("api_webhooks?select=id,api_id,url,events,enabled,last_delivery_at,last_status,failure_count,created_at,updated_at&order=created_at.desc&limit=300"),
    dbFetch("api_webhook_deliveries?select=id,webhook_id,api_id,event,status_code,success,error,attempt,delivered_at,created_at&order=created_at.desc&limit=300"),
  ]);
  return { webhooks: hooks || [], deliveries: deliveries || [] };
}

async function handler(request: Request) {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return failure(request, 403, "origin_not_allowed", "This origin cannot use the LittleAPI admin console.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const admin = await currentAdmin(request);
  if (!admin) return failure(request, 403, "admin_required", "This account is not authorized for LittleAPI Admin.");

  const parts = routeParts(request);
  if (request.method === "GET" && (!parts[0] || parts[0] === "me")) return json(request, { user: admin.user, role: admin.role });
  if (request.method === "GET" && parts[0] === "summary") return json(request, await summary());
  if (request.method === "GET" && parts[0] === "users") return json(request, { users: await usersList(request) });
  if (request.method === "PATCH" && parts[0] === "users" && parts[1] && parts[2] === "plan") {
    const body = await request.json().catch(() => ({}));
    const plan = String(body.plan || "").toLowerCase() as Plan;
    if (!Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)) return failure(request, 400, "invalid_plan", "Invalid plan.");
    return json(request, await applyPlan(admin, parts[1], plan, {
      status: body.status,
      source: body.source || "admin",
      periodStart: body.current_period_start || null,
      periodEnd: body.current_period_end || null,
      graceUntil: body.grace_until || null,
    }));
  }
  if (request.method === "GET" && parts[0] === "sales") return json(request, { sales: await salesList() });
  if (request.method === "POST" && parts[0] === "sales") return createSale(request, admin);
  if (request.method === "PATCH" && parts[0] === "sales" && parts[1]) return updateSale(request, admin, parts[1]);
  if (request.method === "GET" && parts[0] === "apis") return json(request, { apis: await apisList() });
  if (request.method === "PATCH" && parts[0] === "apis" && parts[1]) return updateApi(request, parts[1]);
  if (request.method === "GET" && parts[0] === "logs") return json(request, { logs: await logsList(request) });
  if (request.method === "GET" && parts[0] === "audit") return json(request, { audit: await auditList() });
  if (request.method === "GET" && parts[0] === "webhooks") return json(request, await webhooksList());
  return failure(request, 404, "not_found", "Admin route not found.");
}

Deno.serve(async (request) => {
  try {
    return await handler(request);
  } catch (error) {
    console.error("LittleAPI Admin error", error);
    return failure(request, 500, "internal_error", error instanceof Error ? error.message : "Unexpected admin error.");
  }
});
