import { call, isDemo, signOut } from '../api.js';
import { demoSwitchUser, resetDemo } from '../mock.js';
import { can, loadMeta, methodLabel, state } from '../state.js';
import { confirmDialog, esc, formError, submitting, toast } from '../util.js';
import { getTheme, setTheme, THEMES } from '../theme.js';

export function renderSettings(view) {
  const s = state.meta.settings;
  const cats = { IN: [...state.meta.categories.IN], OUT: [...state.meta.categories.OUT] };
  const refresh = async () => {
    await loadMeta();
    renderSettings(view);
  };

  const u = state.user;
  const showBiz = can('settings', 'view');
  const readOnly = !can('settings', 'edit');

  view.innerHTML = `
    <section class="page settings">
      <header class="page-head">
        <p class="eyebrow">Settings</p>
        <h1 class="page-title">${showBiz ? 'Settings' : 'Your account'}</h1>
      </header>

      <div class="panel">
        <h2>Your account</h2>
        <div class="account-row">
          <span class="avatar lg" aria-hidden="true">${esc((u.name || u.username || '?').charAt(0).toUpperCase())}</span>
          <div><strong>${esc(u.name)}</strong><p class="muted small">@${esc(u.username)} · ${u.isAdmin ? 'Admin' : 'Staff'}</p></div>
        </div>
        ${isDemo() ? '' : `
        <form class="form" id="password" novalidate>
          <h3>Change password</h3>
          <div class="grid3">
            <label>Current password<input name="oldPassword" type="password" autocomplete="current-password" required></label>
            <label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
            <label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" required></label>
          </div>
          <p class="form-error" hidden></p>
          <div class="actions"><button class="btn">Change password</button></div>
        </form>`}
      </div>

      ${u.isAdmin ? `
      <div class="panel admin-links">
        <h2>Admin</h2>
        <div class="actions start">
          <a class="btn" href="#/users">Users &amp; access</a>
          <a class="btn" href="#/activity">Activity log</a>
        </div>
      </div>` : ''}

      ${showBiz ? `
      ${readOnly ? '<p class="chip">View only: ask the admin to change these settings.</p>' : ''}
      <div class="biz">
      <form class="panel form" id="balances" novalidate>
        <h2>Starting balances</h2>
        <p class="muted">The balance in each account at the start of the first day you track. Every later day's opening balance is worked out from this automatically.</p>
        <label>First day tracked<input type="date" name="startDate" value="${esc(s.startDate)}"></label>
        <div class="grid3">
          ${s.methods.map(m => `
            <label>${esc(methodLabel(m))} (৳)<input name="opening_${esc(m)}" type="number" step="0.01" inputmode="decimal" value="${esc(s[`opening_${m}`])}"></label>`).join('')}
        </div>
        <label>Payment methods (comma separated)
          <input name="methods" value="${esc(s.methods.join(', '))}">
        </label>
        <p class="form-error" hidden></p>
        <div class="actions"><button class="btn primary">Save balances</button></div>
      </form>

      <form class="panel form" id="salary-rules" novalidate>
        <h2>Salary rules</h2>
        <p class="muted">Each absent day deducts basic salary ÷ 26. Paid leave and the weekly off day are never deducted.</p>
        <div class="grid2">
          <label>Weekly off day
            <select name="weeklyOff">
              ${['', 'Fri', 'Sat', 'Sun', 'Fri,Sat'].map(d => `<option value="${d}" ${String(s.weeklyOff || '') === d ? 'selected' : ''}>${d ? d.replace(',', ' + ') : 'None'}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="form-error" hidden></p>
        <div class="actions"><button class="btn primary">Save salary rules</button></div>
      </form>

      <div class="panel" id="cats">
        <h2>Categories</h2>
        <p class="muted">Used to group income and expenses in the monthly report. Removing a category doesn't change old entries.</p>
        <div class="two-col">
          ${catEditor('OUT', 'Cash out (expenses)', cats.OUT)}
          ${catEditor('IN', 'Cash in (income)', cats.IN)}
        </div>
        <div class="actions"><button class="btn primary" id="save-cats">Save categories</button></div>
      </div>

      <form class="panel form" id="business" novalidate>
        <h2>Business details</h2>
        <p class="muted">Printed at the top of the daily ledger.</p>
        <label>Business name<input name="businessName" maxlength="200" value="${esc(s.businessName)}"></label>
        <label>Address<input name="address" maxlength="200" value="${esc(s.address)}"></label>
        <div class="grid2">
          <label>Phone<input name="phone" maxlength="40" value="${esc(s.phone)}"></label>
          <label>Prepared by<input name="preparedBy" maxlength="100" value="${esc(s.preparedBy)}"></label>
        </div>
        <p class="form-error" hidden></p>
        <div class="actions"><button class="btn primary">Save details</button></div>
      </form>
      </div>` : ''}

      <div class="panel">
        <h2>Appearance</h2>
        <p class="muted">Saved on this device only.</p>
        <div class="segmented" role="radiogroup" aria-label="Theme">
          ${THEMES.map(([k, label]) => `<button type="button" role="radio" aria-checked="${getTheme() === k}" data-theme-pick="${k}">${label}</button>`).join('')}
        </div>
      </div>

      <div class="panel">
        <h2>This device</h2>
        <p class="muted">${isDemo() ? 'You are using the demo. Changes are saved in this browser only.' : 'Connected to your Google Sheet.'}</p>
        <div class="actions start">
          ${isDemo() && !u.isAdmin ? '<button class="btn" id="demo-admin">Back to the admin account</button>' : ''}
          ${isDemo() ? '<button class="btn" id="reset-demo">Reset demo data</button>' : ''}
          <button class="btn danger ghost" id="signout">Sign out</button>
        </div>
      </div>
    </section>`;

  view.querySelectorAll('[data-theme-pick]').forEach(b => {
    b.onclick = () => {
      setTheme(b.dataset.themePick);
      view.querySelectorAll('[data-theme-pick]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    };
  });

  const pw = view.querySelector('#password');
  pw?.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(pw));
    if (v.newPassword.length < 8) return formError(pw, 'The new password must be at least 8 characters.');
    if (v.newPassword !== v.confirm) return formError(pw, 'The two new passwords don’t match.');
    const ok = await submitting(pw, () => call('changePassword', { oldPassword: v.oldPassword, newPassword: v.newPassword }));
    if (!ok) return;
    toast('Password changed. Please sign in again.');
    await signOut();
    location.hash = '#/overview';
    window.dispatchEvent(new Event('mm:refresh'));
  });

  view.querySelector('#signout').onclick = async () => {
    if (!(await confirmDialog('Sign out on this device?', { okLabel: 'Sign out', danger: false }))) return;
    await signOut();
    location.hash = '#/overview';
    window.dispatchEvent(new Event('mm:refresh'));
  };
  view.querySelector('#demo-admin')?.addEventListener('click', () => {
    demoSwitchUser('owner');
    state.meta = null;
    location.hash = '#/overview';
    window.dispatchEvent(new Event('mm:refresh'));
  });
  view.querySelector('#reset-demo')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Reset the demo back to the sample data?', { okLabel: 'Reset' }))) return;
    resetDemo();
    toast('Demo data reset');
    refresh();
  });

  if (!showBiz) return;
  if (readOnly) {
    // Show the values but make every control inert.
    view.querySelectorAll('.biz input, .biz select, .biz button').forEach(el => { el.disabled = true; });
    view.querySelectorAll('.biz .actions, .biz .inline-add').forEach(el => { el.hidden = true; });
  }

  const balances = view.querySelector('#balances');
  balances.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(balances));
    const list = v.methods.split(',').map(x => x.trim()).filter(Boolean);
    if (!list.length) return formError(balances, 'Keep at least one payment method.');
    const ok = await submitting(balances, () => call('saveSettings', { settings: { ...v, methods: list } }));
    if (!ok) return;
    toast('Balances saved');
    refresh();
  });

  const rules = view.querySelector('#salary-rules');
  rules.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = await submitting(rules, () => call('saveSettings', { settings: Object.fromEntries(new FormData(rules)) }));
    if (!ok) return;
    toast('Salary rules saved');
    refresh();
  });

  const business = view.querySelector('#business');
  business.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = await submitting(business, () => call('saveSettings', { settings: Object.fromEntries(new FormData(business)) }));
    if (!ok) return;
    toast('Details saved');
    refresh();
  });

  const catBox = view.querySelector('#cats');
  const drawChips = type => {
    catBox.querySelector(`[data-chips="${type}"]`).innerHTML = cats[type]
      .map((c, i) => `<li class="tag">${esc(c)}${readOnly ? '' : `<button type="button" aria-label="Remove ${esc(c)}" data-remove="${type}:${i}">×</button>`}</li>`)
      .join('');
  };
  ['IN', 'OUT'].forEach(drawChips);
  catBox.onclick = e => {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    const [type, i] = rm.dataset.remove.split(':');
    cats[type].splice(Number(i), 1);
    drawChips(type);
  };
  catBox.querySelectorAll('[data-add-cat]').forEach(f => {
    f.addEventListener('submit', e => {
      e.preventDefault();
      const type = f.dataset.addCat;
      const name = f.elements.name.value.trim();
      if (!name) return;
      if (cats[type].some(c => c.toLowerCase() === name.toLowerCase())) return toast(`${name} is already in the list`, 'error');
      cats[type].push(name);
      f.reset();
      drawChips(type);
    });
  });
  view.querySelector('#save-cats').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call('saveCategories', { categories: cats });
      toast('Categories saved');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };

}

function catEditor(type, title, list) {
  return `
    <div>
      <h3>${title}</h3>
      <ul class="tags" data-chips="${type}"></ul>
      <form class="inline-add" data-add-cat="${type}" novalidate>
        <input name="name" maxlength="60" placeholder="New category" aria-label="New ${title} category">
        <button class="btn">Add</button>
      </form>
    </div>`;
}
