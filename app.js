const config = window.SUPABASE_CONFIG;
const dialog = document.querySelector('#auth-dialog');
const form = document.querySelector('#auth-form');
const setupMessage = document.querySelector('#auth-setup');
const message = document.querySelector('#auth-message');
let mode = 'login';
let supabase = null;

function isConfigured() {
  return config && config.url && config.publishableKey && !config.url.includes('TU-PROYECTO') && !config.publishableKey.includes('TU_CLAVE');
}

function setMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
}

function setMode(nextMode) {
  mode = nextMode;
  const signup = mode === 'signup';
  document.querySelector('#auth-kicker').textContent = signup ? 'CREA TU ESPACIO' : 'BIENVENIDO';
  document.querySelector('#auth-title').textContent = signup ? 'Crea tu cuenta' : 'Entra a tu cuenta';
  document.querySelector('#auth-intro').textContent = signup ? 'Te enviaremos un correo para confirmar tu cuenta.' : 'Usa el correo con el que creaste tu cuenta.';
  document.querySelector('#auth-submit').textContent = signup ? 'Crear cuenta' : 'Entrar';
  document.querySelector('#switch-copy').textContent = signup ? '¿Ya tienes una cuenta?' : '¿Aún no tienes cuenta?';
  document.querySelector('#switch-auth').textContent = signup ? 'Entrar' : 'Crear cuenta';
  document.querySelector('#password').autocomplete = signup ? 'new-password' : 'current-password';
  setMessage('');
}

function openAuth(nextMode) {
  setMode(nextMode);
  if (!isConfigured()) {
    form.classList.add('hidden');
    setupMessage.classList.remove('hidden');
  } else {
    form.classList.remove('hidden');
    setupMessage.classList.add('hidden');
  }
  dialog.showModal();
}

function showDashboard(user) {
  document.querySelector('#public-home').classList.add('hidden');
  document.querySelector('#dashboard').classList.remove('hidden');
  document.querySelector('#user-name').textContent = user.user_metadata?.name || user.email.split('@')[0];
  document.querySelector('#header-actions').innerHTML = '<button class="text-button" id="sign-out">Salir</button><span class="account-dot" title="Sesión activa">●</span>';
  document.querySelector('#sign-out').addEventListener('click', async () => { await supabase.auth.signOut(); showPublicHome(); });
}

function showPublicHome() {
  document.querySelector('#public-home').classList.remove('hidden');
  document.querySelector('#dashboard').classList.add('hidden');
  document.querySelector('#header-actions').innerHTML = '<button class="text-button" data-open-auth="login">Entrar</button><button class="button small" data-open-auth="signup">Crear cuenta</button>';
  bindAuthButtons();
}

function bindAuthButtons() { document.querySelectorAll('[data-open-auth]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.openAuth))); }

async function init() {
  bindAuthButtons();
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  document.querySelector('#switch-auth').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
  ['#new-project', '#connect-sheet'].forEach(selector => document.querySelector(selector).addEventListener('click', () => {
    const notice = document.querySelector('#setup-notice');
    notice.textContent = 'Próximo paso: aquí conectaremos tu cuenta de Google y elegirás una hoja.';
    notice.classList.remove('hidden');
  }));
  if (!isConfigured()) return;
  supabase = window.supabase.createClient(config.url, config.publishableKey);
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) showDashboard(session.user);
  supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) showDashboard(session.user); });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) return;
  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;
  const submit = document.querySelector('#auth-submit');
  submit.disabled = true;
  setMessage('');
  const result = mode === 'signup'
    ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    : await supabase.auth.signInWithPassword({ email, password });
  submit.disabled = false;
  if (result.error) return setMessage(result.error.message);
  if (mode === 'signup' && !result.data.session) return setMessage('Revisa tu correo y confirma tu cuenta para continuar.', true);
  dialog.close();
});

init();

