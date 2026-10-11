import { call } from '../api.js';
import { esc, loading, options } from '../util.js';
import { historyList } from './history.js';

const ENTITIES = [
  ['', 'Everything'], ['Transactions', 'Cash book'], ['Inventory', 'Inventory'], ['StockMoves', 'Stock movements'],
  ['Attendance', 'Attendance'], ['SalaryPayments', 'Salary payments'], ['Employees', 'Employees'],
  ['Settings', 'Settings'], ['Categories', 'Categories'], ['Users', 'Users'],
];
const LABEL = Object.fromEntries(ENTITIES);

/** Admin-only: every add, edit and delete, newest first, with old → new values. */
export async function renderActivity(view) {
  view.innerHTML = loading();
  const users = await call('users');
  const filter = { user: '', entity: '' };
  let before = 0;

  view.innerHTML = `
    <section class="page activity">
      <header class="page-head">
        <p class="eyebrow">Admin</p>
        <h1 class="page-title">Activity</h1>
        <p class="muted">Every change anyone makes, with what it was before and after. This log can’t be edited from the app.</p>
      </header>
      <div class="toolbar">
        <div class="toolbar-actions filters">
          <label class="sr" for="f-user">Person</label>
          <select id="f-user">${options(['', ...users.map(u => u.name)], '', v => v || 'Everyone')}</select>
          <label class="sr" for="f-entity">Area</label>
          <select id="f-entity">${ENTITIES.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="panel"><div id="log"></div>
        <div class="actions start"><button class="btn" id="more" hidden>Load older changes</button></div>
      </div>
    </section>`;

  const log = view.querySelector('#log');
  const more = view.querySelector('#more');
  const load = async append => {
    if (!append) {
      log.innerHTML = loading();
      before = 0;
    }
    more.disabled = true;
    try {
      const res = await call('changeLog', { ...filter, before });
      const html = historyList(res.rows.map(r => ({ ...r, summary: `${LABEL[r.entity] || r.entity} · ${r.summary}` })), { showSummary: true });
      if (append) log.insertAdjacentHTML('beforeend', res.rows.length ? html : '');
      else log.innerHTML = html;
      before = res.before;
      more.hidden = !before;
    } catch (err) {
      log.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    } finally {
      more.disabled = false;
    }
  };
  view.querySelector('#f-user').onchange = e => { filter.user = e.target.value; load(false); };
  view.querySelector('#f-entity').onchange = e => { filter.entity = e.target.value; load(false); };
  more.onclick = () => load(true);
  load(false);
}
