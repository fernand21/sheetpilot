from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')

needle = '''const wait = ms => new Promise(resolve => setTimeout(resolve, ms));'''
replacement = '''const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function isTransientJwtError(error) {
  const value = String(error && (error.message || error.error_description || error.details || error.hint) || error || "").toLowerCase();
  return value.includes("jwt issued at future") || value.includes("jwt issued in the future");
}'''
if needle not in s:
    raise SystemExit('wait helper target not found')
s = s.replace(needle, replacement, 1)

old = '''async function projects() {
  if (!sb || !user) return;
  const apiFields = "id,user_id,project_id,api_id,name,resource_type,spreadsheet_id,default_sheet,drive_file_id,api_key_prefix,public_read,permissions,enabled,cache_ttl,monthly_request_limit,created_at,updated_at";
  const [projectResult, apiResult] = await Promise.all([sb.from("projects").select("*").order("created_at", { ascending: false }), sb.from("api_endpoints").select(apiFields).order("created_at", { ascending: false })]);
  if (projectResult.error) { notice(friendlyError(projectResult.error), "error"); return; }
  if (apiResult.error && !["42P01", "PGRST205"].includes(apiResult.error.code)) { notice(friendlyError(apiResult.error), "error"); return; }'''
new = '''async function projects(retryAuth = true) {
  if (!sb || !user) return;
  const apiFields = "id,user_id,project_id,api_id,name,resource_type,spreadsheet_id,default_sheet,drive_file_id,api_key_prefix,public_read,permissions,enabled,cache_ttl,monthly_request_limit,created_at,updated_at";
  const [projectResult, apiResult] = await Promise.all([sb.from("projects").select("*").order("created_at", { ascending: false }), sb.from("api_endpoints").select(apiFields).order("created_at", { ascending: false })]);
  const projectAuthError = projectResult.error && isTransientJwtError(projectResult.error) ? projectResult.error : null;
  const apiAuthError = apiResult.error && isTransientJwtError(apiResult.error) ? apiResult.error : null;
  if (retryAuth && (projectAuthError || apiAuthError)) {
    const refreshed = await sb.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session?.access_token) {
      await wait(1200);
      return projects(false);
    }
  }
  if (projectResult.error) { notice(friendlyError(projectResult.error), "error"); return; }
  if (apiResult.error && !["42P01", "PGRST205"].includes(apiResult.error.code)) { notice(friendlyError(apiResult.error), "error"); return; }'''
if old not in s:
    raise SystemExit('projects target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
