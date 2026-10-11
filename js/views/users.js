import { call, isDemo } from '../api.js';
import { demoSwitchUser } from '../mock.js';
import { SECTIONS, state } from '../state.js';
import { confirmDialog, esc, formError, loading, openModal, submitting, toast } from '../util.js';
import { openHistory, when } from './history.js';

const LEVELS = [['none', 'Hidden'], ['view', 'View'], ['edit', 'View & edit']];
const PRESETS = {
  'Cashier': { cash: 'edit', report: 'view' },
  'Supervisor': { cash: 'edit', report: 'view', inventory: 'edit', attendance: 'edit' },
  'Attendance only': { attendance: 'edit' },
  'View everything': Object.fromEntries(SECTIONS.map(([k]) => [k, 'view'])),
};
const STATUS = { pending: 'Waiting for approval', active: 'Active', disabled: 'Disabled' };

export async function renderUsers(view) {
  view.innerHTML = loading();
  const users = await call('users');
  const order = { pending: 0, active: 1, disabled: 2 };
  users.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const pending = users.filter(u => u.status === 'pending');
  const refresh = () => renderUsers(view);

  view.innerHTML = `
    <section class="page users">
      <header class="page-head">
        <p class="eyebrow">Admin</p>
        <h1 class="page-title">Users &amp; access</h1>
        <p class="muted">People request access from the sign-in screen. Approve them here and choose what each person can see.
          Access is checked by the server on every request, not just hidden in the app.</p>
      </header>
      ${pending.length ? `<p class="notice"><span class="dot-live" aria-hidden="true"></span>${pending.length} ${pending.length === 1 ? 'person is' : 'people are'} waiting for approval.</p>` : ''}
      <div class="panel">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>User</th><th>Status</th><th>Access</th><th>Last sign-in</th><th><span class="sr">Actions</span></th></tr></thead>
          <tbody>${users.map(u => `
            <tr class="clickable" data-user="${esc(u.id)}" tabindex="0">
              <td><span class="user-cell"><span class="avatar" aria-hidden="true">${esc((u.name || u.username).charAt(0).toUpperCase())}</span>
                <span><strong>${esc(u.name)}</strong><small class="muted block">@${esc(u.username)}${u.id === state.user.id ? ' · you' : ''}</small></span></span></td>
              <td><span class="status ${u.status === 'active' ? 'ok' : u.status === 'pending' ? 'low' : 'out'}">${STATUS[u.status]}</span></td>
              <td class="access-cell">${accessSummary(u)}</td>
              <td class="nowrap muted">${u.lastLogin ? esc(when(u.lastLogin)) : 'Never'}</td>
              <td class="row-actions">${u.status === 'pending' ? '<span class="btn small primary">Review</span>' : '<span class="link">Edit</span>'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </section>`;

  const byId = new Map(users.map(u => [u.id, u]));
  const open = row => openUserForm({ user: byId.get(row.dataset.user), onSaved: refresh });
  view.onclick = e => {
    const row = e.target.closest('[data-user]');
    if (row) open(row);
  };
  view.onkeydown = e => {
    const row = e.target.closest('[data-user]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open(row);
    }
  };
}

function accessSummary(u) {
  if (u.isAdmin) return '<span class="chip accent">Admin · everything</span>';
  const parts = SECTIONS.filter(([k]) => u.perms[k] !== 'none').map(([k, label]) => `<span class="chip">${esc(label)}${u.perms[k] === 'view' ? ' · view' : ''}</span>`);
  return parts.join('') || '<span class="muted">No access yet</span>';
}

function openUserForm({ user, onSaved }) {
  const self = user.id === state.user.id;
  const pending = user.status === 'pending';
  const m = openModal({
    title: pending ? `Approve ${user.name}?` : user.name,
    wide: true,
    body: `
      <form class="form" novalidate>
        <div class="grid2">
          <label>Name shown on entries<input name="name" maxlength="60" value="${esc(user.name)}"></label>
          <label>Username<input value="@${esc(user.username)}" disabled></label>
        </div>
        <label class="check"><input type="checkbox" name="isAdmin" ${user.isAdmin ? 'checked' : ''} ${self ? 'disabled' : ''}>
          Admin: full access, can approve users and see the activity log</label>
        <div class="perm-box" ${user.isAdmin ? 'hidden' : ''}>
          <div class="perm-head">
            <h3>What can ${esc(user.name)} use?</h3>
            <div class="presets">${Object.keys(PRESETS).map(p => `<button type="button" class="btn small ghost" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
          </div>
          <div class="perm-grid">
            ${SECTIONS.map(([k, label]) => `
              <div class="perm-row">
                <span>${esc(label)}</span>
                <div class="segmented" role="radiogroup" aria-label="${esc(label)}">
                  ${LEVELS.map(([lvl, l]) => `<button type="button" role="radio" data-sec="${k}" data-lvl="${lvl}" aria-checked="${(user.perms[k] || 'none') === lvl}">${l}</button>`).join('')}
                </div>
              </div>`).join('')}
          </div>
          <p class="muted small">Hidden: not in the menu at all. View: can see but not change. Salary amounts are only visible with Salary sheet or Employees access.</p>
        </div>
        <p class="form-error" hidden></p>
        <div class="actions">
          ${self ? '' : user.status === 'active'
            ? '<button type="button" class="btn danger ghost" data-status="disabled">Disable account</button>'
            : user.status === 'disabled' ? '<button type="button" class="btn ghost" data-status="active">Re-enable account</button>'
            : '<button type="button" class="btn danger ghost" data-status="disabled">Reject</button>'}
          ${pending ? '' : '<button type="button" class="btn ghost" data-reset>Reset password</button>'}
          <button type="button" class="btn ghost" data-history>History</button>
          ${isDemo() && user.status === 'active' && !self ? '<button type="button" class="btn ghost" data-preview>Preview as this user</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn primary">${pending ? 'Approve' : 'Save'}</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('form');
  const perms = { ...Object.fromEntries(SECTIONS.map(([k]) => [k, 'none'])), ...(user.isAdmin ? {} : user.perms) };
  const draw = () => form.querySelectorAll('[data-sec]').forEach(b => b.setAttribute('aria-checked', String(perms[b.dataset.sec] === b.dataset.lvl)));
  draw();
  form.onclick = e => {
    const b = e.target.closest('[data-sec]');
    if (b) {
      perms[b.dataset.sec] = b.dataset.lvl;
      draw();
    }
    const p = e.target.closest('[data-preset]');
    if (p) {
      SECTIONS.forEach(([k]) => { perms[k] = PRESETS[p.dataset.preset][k] || 'none'; });
      draw();
    }
  };
  form.elements.isAdmin.onchange = () => { form.querySelector('.perm-box').hidden = form.elements.isAdmin.checked; };

  const save = async extra => {
    const payload = { id: user.id, name: form.elements.name.value.trim(), isAdmin: form.elements.isAdmin.checked, perms, ...extra };
    return submitting(form, () => call('updateUser', { user: payload }));
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.elements.name.value.trim()) return formError(form, 'Enter a name.');
    if (!payloadHasAccess(form.elements.isAdmin.checked, perms) && !(await confirmDialog(`${user.name} won’t be able to see anything yet. Save anyway?`, { okLabel: 'Save', danger: false }))) return;
    const ok = await save(pending ? { status: 'active' } : {});
    if (!ok) return;
    toast(pending ? `${user.name} approved` : 'Access updated');
    m.close();
    onSaved();
  });
  form.querySelector('[data-status]')?.addEventListener('click', async e => {
    const status = e.currentTarget.dataset.status;
    if (status === 'disabled' && !(await confirmDialog(`${pending ? 'Reject' : 'Disable'} ${user.name}? They are signed out right away and can’t sign in until re-enabled.`, { okLabel: pending ? 'Reject' : 'Disable' }))) return;
    const ok = await save({ status });
    if (!ok) return;
    toast(status === 'active' ? 'Account re-enabled' : pending ? 'Request rejected' : 'Account disabled');
    m.close();
    onSaved();
  });
  form.querySelector('[data-reset]')?.addEventListener('click', () => openResetPassword(user));
  form.querySelector('[data-preview]')?.addEventListener('click', () => {
    demoSwitchUser(user.username);
    m.close();
    toast(`Demo: you are now ${user.name}. Switch back in Settings.`);
    state.meta = null;
    location.hash = '#/overview';
    window.dispatchEvent(new Event('mm:refresh'));
  });
  form.querySelector('[data-history]').onclick = () => openHistory({ entity: 'Users', id: user.id, title: user.name });
}

const payloadHasAccess = (admin, perms) => admin || Object.values(perms).some(v => v !== 'none');

function openResetPassword(user) {
  const m = openModal({
    title: `Reset password for ${user.name}`,
    body: `
      <form class="form" novalidate>
        <p class="muted">Tell ${esc(user.name)} the new password in person. They are signed out on every device and can change it later under Settings.</p>
        <div class="grid2">
          <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required autofocus></label>
          <label>Confirm<input name="confirm" type="password" autocomplete="new-password" required></label>
        </div>
        <p class="form-error" hidden></p>
        <div class="actions"><button class="btn primary">Reset password</button></div>
      </form>`,
  });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    if (v.password.length < 8) return formError(form, 'At least 8 characters.');
    if (v.password !== v.confirm) return formError(form, 'The two passwords don’t match.');
    const ok = await submitting(form, () => call('resetPassword', { id: user.id, password: v.password }));
    if (!ok) return;
    toast('Password reset');
    m.close();
  });
}
