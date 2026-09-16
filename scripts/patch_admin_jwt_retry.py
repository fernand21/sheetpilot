from pathlib import Path

p = Path('admin/admin.js')
s = p.read_text(encoding='utf-8')
old = '''  async function call(path = "", options = {}) {
    const current = await session();
    if (!current?.access_token) throw Object.assign(new Error("session_required"), { code:"session_required" });
    const headers = new Headers(options.headers || {});
    headers.set("apikey", cfg.publishableKey);
    headers.set("Authorization", "Bearer " + current.access_token);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(base + (path ? "/" + path.replace(/^\\//, "") : ""), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${response.status}`), { code:data.error || "request_failed", status:response.status, data });
    return data;
  }'''
new = '''  async function call(path = "", options = {}, retryAuth = true) {
    const current = await session();
    if (!current?.access_token) throw Object.assign(new Error("session_required"), { code:"session_required" });
    const headers = new Headers(options.headers || {});
    headers.set("apikey", cfg.publishableKey);
    headers.set("Authorization", "Bearer " + current.access_token);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(base + (path ? "/" + path.replace(/^\\//, "") : ""), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && retryAuth && (response.status === 401 || response.status === 403)) {
      const refreshed = await sb.auth.refreshSession();
      if (!refreshed.error && refreshed.data.session?.access_token) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return call(path, options, false);
      }
    }
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${response.status}`), { code:data.error || "request_failed", status:response.status, data });
    return data;
  }'''
if old not in s:
    raise SystemExit('admin call target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
