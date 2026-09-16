from pathlib import Path

# app.js
p = Path('app.js')
s = p.read_text(encoding='utf-8')
old = '  sb = window.supabase.createClient(cfg.url, cfg.publishableKey);'
new = '''  const projectRef = (() => { try { return new URL(cfg.url).hostname.split(".")[0]; } catch (_) { return "littleapi"; } })();
  const authStorageKey = `sb-${projectRef}-auth-token`;
  sb = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { storageKey: authStorageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });'''
if old not in s:
    raise SystemExit('app.js Supabase client target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# admin/admin.js
p = Path('admin/admin.js')
s = p.read_text(encoding='utf-8')
old = '  const sb = window.supabase?.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, detectSessionInUrl: true } });'
new = '''  const projectRef = (() => { try { return new URL(cfg.url).hostname.split(".")[0]; } catch (_) { return "littleapi"; } })();
  const authStorageKey = `sb-${projectRef}-auth-token`;
  const sb = window.supabase?.createClient(cfg.url, cfg.publishableKey, { auth: { storageKey: authStorageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });'''
if old not in s:
    raise SystemExit('admin/admin.js Supabase client target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
