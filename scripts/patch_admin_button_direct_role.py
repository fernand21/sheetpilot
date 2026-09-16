from pathlib import Path
import re

p = Path('app-enhancements.js')
s = p.read_text(encoding='utf-8')

s = s.replace('link.textContent = text("Administración", "Admin");', 'link.textContent = text("⚙ Administración", "⚙ Admin");', 1)

pattern = re.compile(r'''  async function enhanceAdminEntry\(\) \{.*?\n  \}\n\n  function apply\(\)''', re.S)
replacement = '''  async function enhanceAdminEntry() {
    const actions = $("#dashboard .dashboard-actions");
    if (!actions || $("#admin-console-link", actions) || adminEntryChecking) return;
    if (adminEntryRole) { insertAdminEntry(actions, adminEntryRole); return; }
    if (adminEntryFailures >= 6) return;
    if (!sb) { setTimeout(enhanceAdminEntry, 500); return; }
    adminEntryChecking = true;
    try {
      let sessionResult = await sb.auth.getSession();
      let session = sessionResult?.data?.session;
      if (!session?.user?.id || !session?.access_token) return;

      let roleResult = await sb.from("littleapi_admin_users")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("enabled", true)
        .maybeSingle();

      const roleErrorText = String(roleResult.error?.message || roleResult.error || "").toLowerCase();
      if (roleResult.error && (roleErrorText.includes("jwt issued at future") || roleErrorText.includes("jwt issued in the future"))) {
        const refreshed = await sb.auth.refreshSession();
        session = refreshed?.data?.session || session;
        if (session?.access_token) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          roleResult = await sb.from("littleapi_admin_users")
            .select("role")
            .eq("user_id", session.user.id)
            .eq("enabled", true)
            .maybeSingle();
        }
      }

      if (!roleResult.error && roleResult.data?.role) {
        adminEntryRole = roleResult.data.role;
        adminEntryFailures = 0;
        insertAdminEntry(actions, adminEntryRole);
        return;
      }

      let accessToken = session?.access_token || "";
      const adminBase = String(cfg.url || "").replace(/\\/$/, "") + "/functions/v1/littleapi-admin/me";
      let response = await fetch(adminBase, { headers: { apikey: cfg.publishableKey, Authorization: "Bearer " + accessToken } });
      if (!response.ok && (response.status === 401 || response.status === 403)) {
        const refreshed = await sb.auth.refreshSession();
        accessToken = refreshed?.data?.session?.access_token || "";
        if (accessToken) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          response = await fetch(adminBase, { headers: { apikey: cfg.publishableKey, Authorization: "Bearer " + accessToken } });
        }
      }
      if (!response.ok) {
        adminEntryFailures += 1;
        if (adminEntryFailures < 6) setTimeout(enhanceAdminEntry, adminEntryFailures * 1500);
        return;
      }
      const info = await response.json().catch(() => ({}));
      if (!info?.user || !info?.role) return;
      adminEntryRole = info.role;
      adminEntryFailures = 0;
      insertAdminEntry(actions, adminEntryRole);
    } catch (_) {
      adminEntryFailures += 1;
      if (adminEntryFailures < 6) setTimeout(enhanceAdminEntry, adminEntryFailures * 1500);
    } finally {
      adminEntryChecking = false;
    }
  }

  function apply()'''

s2, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit('enhanceAdminEntry target not found')
p.write_text(s2, encoding='utf-8')
