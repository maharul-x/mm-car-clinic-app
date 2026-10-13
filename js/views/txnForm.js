import { call } from '../api.js';
import { can, categories, methodLabel, methods } from '../state.js';
import { confirmDialog, esc, formError, openModal, options, prettyMonth, submitting, taka, toast } from '../util.js';
import { loadHistory, stampLine } from './history.js';

const TITLES = { IN: 'Cash in', OUT: 'Cash out', TRANSFER: 'Move money between accounts' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const isSalary = c => String(c || '').trim().toLowerCase() === 'salary';
const salaryDescription = (name, month, type) =>
  `${name.toUpperCase()} ${MONTHS[Number(month.slice(5, 7)) - 1]} ${type === 'ADVANCE' ? 'ADV' : 'SALARY'} (SALARY)`;

// Employee list for the salary fields, fetched once per minute at most.
let staffCache = { at: 0, list: null };
async function staff() {
  if (!staffCache.list || Date.now() - staffCache.at > 60000) {
    staffCache = { at: Date.now(), list: (await call('employees')).filter(e => e.active).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return staffCache.list;
}

/**
 * Add, edit or (for view-only users) look at one cash-book entry, with who added/edited it and its full history.
 * Calls onSaved() after every successful save or delete.
 */
export function openTxnForm({ type, date, txn, onSaved }) {
  const editing = !!txn;
  const readOnly = !can('cash', 'edit');
  type = txn?.type || type;
  const ms = methods();
  const cats = [...categories(type)];
  const t = txn || { date, type, method: ms[0], toMethod: ms[1] || ms[0], category: type === 'IN' ? cats[0] : '' };
  if (t.category && type !== 'TRANSFER' && !cats.includes(t.category)) cats.push(t.category);
  // Salary cash-outs can be linked to an employee and month, which also records it on the salary sheet.
  const canLink = type === 'OUT' && !readOnly && can('salary', 'edit');
  const link = t.salary || null;
  const salaryFields = !canLink ? (link ? `
      <p class="salary-linked">Paid to <strong>${esc(link.employee)}</strong> · ${esc(prettyMonth(link.month))} ${link.type === 'ADVANCE' ? 'advance' : 'salary'} · on the salary sheet</p>` : '') : `
      <fieldset class="salary-link" ${isSalary(t.category) ? '' : 'hidden'}>
        <legend>Salary payment</legend>
        <label>Employee
          <select name="employeeId"><option value="">Loading…</option></select>
        </label>
        <div class="grid2" data-salary-more>
          <label>Salary for month<input type="month" name="salaryMonth" value="${esc(link?.month || String(t.date || '').slice(0, 7))}"></label>
          <label>Type
            <select name="salaryType">
              <option value="ADVANCE" ${link?.type === 'SALARY' ? '' : 'selected'}>Advance</option>
              <option value="SALARY" ${link?.type === 'SALARY' ? 'selected' : ''}>Salary payment</option>
            </select>
          </label>
        </div>
        <p class="muted small" data-salary-hint></p>
      </fieldset>`;

  const methodField = type === 'TRANSFER'
    ? `<div class="grid2">
        <label>From<select name="method">${options(ms, t.method, methodLabel)}</select></label>
        <label>To<select name="toMethod">${options(ms, t.toMethod, methodLabel)}</select></label>
      </div>`
    : `<label>${type === 'IN' ? 'Received in' : 'Paid from'}<select name="method">${options(ms, t.method, methodLabel)}</select></label>`;

  const m = openModal({
    title: `${readOnly ? '' : editing ? 'Edit: ' : 'New: '}${TITLES[type]}`,
    body: `
      ${editing ? stampLine(t) : ''}
      <form class="form" novalidate>
       <fieldset class="plain" ${readOnly ? 'disabled' : ''}>
        ${type === 'TRANSFER' ? '' : `
          <label>${type === 'IN' ? 'Customer / description' : 'Description'}
            <input name="description" maxlength="200" required autofocus value="${esc(t.description || '')}"
              placeholder="${type === 'IN' ? 'e.g. Customer name' : 'e.g. Lunch for staff'}">
          </label>`}
        <div class="grid2">
          <label>Amount (৳)<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(t.amount ?? '')}" ${type === 'TRANSFER' ? 'autofocus' : ''}></label>
          ${type === 'TRANSFER' ? '' : `
            <label>Category
              <select name="category" required>
                ${type === 'OUT' ? `<option value="" ${t.category ? '' : 'selected'} disabled>Choose…</option>` : ''}
                ${options(cats, t.category)}
              </select>
            </label>`}
        </div>
        ${salaryFields}
        ${methodField}
        <div class="grid2">
          <label>Date<input type="date" name="date" required value="${esc(t.date)}"></label>
          ${type === 'TRANSFER' ? '' : `<label>Invoice no. (optional)<input name="invoice" maxlength="40" value="${esc(t.invoice || '')}"></label>`}
        </div>
        <label>Note (optional)<textarea name="note" rows="2" maxlength="300">${esc(t.note || '')}</textarea></label>
       </fieldset>
        <p class="form-error" hidden></p>
        ${readOnly ? '<p class="muted small">You can view this entry but not change it.</p>' : `
        <div class="actions">
          ${editing ? '<button type="button" class="btn danger ghost" data-delete>Delete</button><span class="spacer"></span>' : '<button type="submit" class="btn" data-again>Save &amp; add another</button>'}
          <button type="submit" class="btn primary">Save</button>
        </div>`}
      </form>
      ${editing ? `
        <details class="history-box">
          <summary>History</summary>
          <div class="h-body"></div>
        </details>` : ''}`,
  });
  const box = m.el.querySelector('.history-box');
  box?.addEventListener('toggle', () => {
    if (box.open && !box.dataset.loaded) {
      box.dataset.loaded = '1';
      loadHistory(box.querySelector('.h-body'), 'Transactions', t.id);
    }
  });

  const form = m.el.querySelector('form');
  const sal = canLink ? wireSalaryFields(form, t, link) : null;
  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const extra = link ? ` It is also removed from ${link.employee}'s salary sheet.` : '';
    if (!(await confirmDialog(`Delete "${t.description}" (${taka(t.amount)})? This cannot be undone.${extra}`))) return;
    const ok = await submitting(form, () => call('deleteTxn', { id: t.id }));
    if (!ok) return;
    toast('Entry deleted');
    m.close();
    onSaved?.();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (readOnly) return;
    const again = !!e.submitter?.hasAttribute('data-again');
    const v = Object.fromEntries(new FormData(form));
    const amount = Number(v.amount);
    if (!v.date) return formError(form, 'Choose a date.');
    if (!(amount > 0)) return formError(form, 'Enter an amount greater than 0.');
    if (type !== 'TRANSFER' && !v.description?.trim()) return formError(form, 'Enter a description.');
    if (type === 'OUT' && !v.category) return formError(form, 'Choose a category.');
    if (type === 'TRANSFER' && v.method === v.toMethod) return formError(form, 'Choose two different accounts.');

    const { employeeId, salaryMonth, salaryType, ...fields } = v;
    const payload = { ...t, ...fields, type, amount };
    delete payload.salary;
    const req = { txn: payload };
    if (sal) {
      if (isSalary(v.category) && employeeId) {
        if (!/^\d{4}-\d{2}$/.test(salaryMonth || '')) return formError(form, 'Choose the salary month.');
        req.salary = { employeeId, month: salaryMonth, type: salaryType };
      } else if (link) req.salary = null;
    }
    const saved = await submitting(form, () => call(editing ? 'updateTxn' : 'addTxn', req));
    if (!saved) return;
    const who = req.salary ? sal.name(employeeId) : '';
    toast(who ? `Saved and added to ${who}'s salary sheet` : editing ? 'Entry updated' : 'Entry saved');
    onSaved?.();
    if (!again) return m.close();
    ['amount', 'description', 'invoice', 'note'].forEach(n => { if (form.elements[n]) form.elements[n].value = ''; });
    if (type === 'OUT') form.elements.category.value = '';
    sal?.reset();
    (form.elements.description || form.elements.amount).focus();
  });
}

/** Shows the salary fields when the category is Salary, fills the employee list and suggests a description. */
function wireSalaryFields(form, t, link) {
  const box = form.querySelector('.salary-link');
  const els = form.elements;
  const hint = box.querySelector('[data-salary-hint]');
  const more = box.querySelector('[data-salary-more]');
  let list = [];
  let autoDesc = '';
  const name = id => list.find(e => e.id === id)?.name || link?.employee || '';
  const sync = () => {
    box.hidden = !isSalary(els.category.value);
    const id = els.employeeId.value;
    more.hidden = !id;
    const month = els.salaryMonth.value;
    hint.textContent = id
      ? `Also recorded on ${name(id)}'s salary sheet for ${/^\d{4}-\d{2}$/.test(month) ? prettyMonth(month) : 'that month'} as ${els.salaryType.value === 'ADVANCE' ? 'an advance' : 'a salary payment'}.`
      : 'Pick an employee to record this on their salary sheet, or leave it for other salary costs (e.g. lunch bill).';
    // Suggest "RUBEL OCT ADV (SALARY)" unless the description was typed by hand.
    if (id && /^\d{4}-\d{2}$/.test(month) && (!els.description.value.trim() || els.description.value === autoDesc)) {
      autoDesc = salaryDescription(name(id), month, els.salaryType.value);
      els.description.value = autoDesc;
    }
  };
  ['change', 'input'].forEach(ev => {
    els.category.addEventListener(ev, sync);
    els.employeeId.addEventListener(ev, sync);
    els.salaryMonth.addEventListener(ev, sync);
    els.salaryType.addEventListener(ev, sync);
  });
  els.date.addEventListener('change', () => {
    if (!els.employeeId.value && /^\d{4}-\d{2}-\d{2}$/.test(els.date.value)) els.salaryMonth.value = els.date.value.slice(0, 7);
  });
  staff().then(rows => {
    list = rows;
    const current = link?.employeeId || '';
    const known = list.some(e => e.id === current);
    els.employeeId.innerHTML = '<option value="">— Not for a specific employee —</option>' +
      list.map(e => `<option value="${esc(e.id)}" ${e.id === current ? 'selected' : ''}>${esc(e.name)}${e.designation ? ` · ${esc(e.designation)}` : ''}</option>`).join('') +
      (current && !known ? `<option value="${esc(current)}" selected>${esc(link.employee)} (former)</option>` : '');
    // Keep updating the description only if it is still the one we suggested.
    autoDesc = link && t.description === salaryDescription(link.employee, link.month, link.type) ? t.description : '';
    sync();
  }).catch(err => {
    els.employeeId.innerHTML = '<option value="">Could not load employees</option>';
    hint.textContent = err.message;
  });
  sync();
  return {
    name,
    reset() {
      els.employeeId.value = '';
      autoDesc = '';
      sync();
    },
  };
}
