import { call, defaultApiUrl, getSession, saveSession } from '../api.js';
import { esc, formError, submitting } from '../util.js';

// The demo is only offered when running on this computer, not on the public site.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const SERVER_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

export function renderLogin(view, onDone, mode = 'signin') {
  const previous = getSession();
  let lastUrl = '';
  try { lastUrl = localStorage.getItem('mm.server') || ''; } catch { /* ignore */ }
  const url = defaultApiUrl || (previous && previous.url !== 'demo' ? previous.url : lastUrl);
  const signup = mode === 'signup';

  view.innerHTML = `
    <section class="login">
      <div class="login-card">
        <img src="assets/logo.png" alt="M&amp;M Car Clinic logo" class="login-logo" width="64" height="64">
        <h1>${signup ? 'Request access' : 'Sign in'}</h1>
        <p class="muted small">${signup ? 'The admin will approve your account and choose what you can see.' : 'M&amp;M Car Clinic · Cash book, inventory &amp; salary'}</p>
        <form class="form" novalidate>
          <label ${defaultApiUrl ? 'hidden' : ''}>Server URL
            <input name="url" type="url" inputmode="url" autocomplete="off" value="${esc(url)}"
              placeholder="https://script.google.com/macros/s/…/exec">
          </label>
          ${signup ? '<label>Your name<input name="name" maxlength="60" autocomplete="name" required placeholder="Shown on entries you make"></label>' : ''}
          <label>Username
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" required>
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required ${signup ? 'minlength="8"' : ''}>
          </label>
          ${signup
            ? '<label>Confirm password<input name="confirm" type="password" autocomplete="new-password" required></label>'
            : '<label class="check"><input type="checkbox" name="remember" checked> Keep me signed in on this device</label>'}
          <p class="form-error" hidden></p>
          <p class="form-ok" hidden></p>
          <button class="btn primary block">${signup ? 'Send request' : 'Sign in'}</button>
        </form>
        <p class="muted small switch">${signup
          ? 'Already approved? <button type="button" class="link" data-mode="signin">Sign in</button>'
          : 'New here? <button type="button" class="link" data-mode="signup">Request access</button>'}</p>
        ${LOCAL ? '<p class="muted small">No server set up yet? <button type="button" class="link" id="demo">Try the demo</button> with sample data.</p>' : ''}
      </div>
    </section>`;

  const form = view.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const server = (v.url || '').trim();
    if (!SERVER_RE.test(server)) return formError(form, 'Paste the Web app URL from Apps Script. It ends in /exec.');
    if (!v.username.trim()) return formError(form, 'Enter your username.');
    if (!v.password) return formError(form, 'Enter your password.');
    try { localStorage.setItem('mm.server', server); } catch { /* ignore */ }

    if (signup) {
      if (!v.name.trim()) return formError(form, 'Enter your name.');
      if (v.password.length < 8) return formError(form, 'The password must be at least 8 characters.');
      if (v.password !== v.confirm) return formError(form, 'The two passwords don’t match.');
      const ok = await submitting(form, () => call('signup', { username: v.username.trim(), name: v.name.trim(), password: v.password }, server));
      if (!ok) return;
      form.reset();
      form.elements.url.value = server;
      const msg = form.querySelector('.form-ok');
      msg.textContent = 'Request sent. You can sign in once the admin approves your account.';
      msg.hidden = false;
      return;
    }

    const res = await submitting(form, () => call('login', { username: v.username.trim(), password: v.password }, server));
    if (!res) return;
    saveSession({ url: server, token: res.token, user: res.user }, !!v.remember);
    location.hash = '#/overview';
    onDone();
  });

  view.querySelector('[data-mode]').onclick = e => renderLogin(view, onDone, e.currentTarget.dataset.mode);
  view.querySelector('#demo')?.addEventListener('click', () => {
    saveSession({ url: 'demo', token: '', user: null }, false);
    location.hash = '#/overview';
    onDone();
  });
}
