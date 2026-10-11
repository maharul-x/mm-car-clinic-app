import { call } from '../api.js';
import { can, methodLabel, methods, settings } from '../state.js';
import {
  addMonths, confirmDialog, esc, fmt, formError, guard, isMonth, lastDayOfMonth, loading,
  openModal, options, parseISO, prettyDate, prettyMonth, submitting, sum, taka, toast, todayISO,
} from '../util.js';
import { openHistory } from './history.js';

const STATUS = {
  P: { label: 'Present', short: 'P' },
  A: { label: 'Absent', short: 'A' },
  L: { label: 'Paid leave', short: 'L' },
  O: { label: 'Off / holiday', short: 'O' },
};
const CYCLE = ['', 'P', 'A', 'L', 'O'];
// One day's pay = basic ÷ 26 (a month has about 26 working days; Friday is the weekly off).
const WORKING_DAYS = 26;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_TABS = [['attendance', 'Attendance'], ['sheet', 'Salary sheet'], ['employees', 'Employees']];
const TAB_SECTION = { attendance: 'attendance', sheet: 'salary', employees: 'employees' };
let TABS = ALL_TABS;

export async function renderSalary(view, sub, arg) {
  TABS = ALL_TABS.filter(([k]) => can(TAB_SECTION[k]));
  if (!TABS.length) throw Object.assign(new Error('You don’t have access to this page.'), { code: 'FORBIDDEN' });
  const tab = TABS.some(t => t[0] === sub) ? sub : TABS[0][0];
  const month = isMonth(arg) ? arg : todayISO().slice(0, 7);
  view.innerHTML = loading();
  if (tab === 'employees') return renderEmployees(view, await call('employees'));
  const data = await call('salaryMonth', { month });
  if (tab === 'sheet') return renderSheet(view, month, data);
  return renderAttendance(view, month, data);
}

function subnav(active, month) {
  return `<nav class="subnav no-print" aria-label="Salary sections">${TABS.map(([k, label]) =>
    `<a href="#/salary/${k}${k === 'employees' ? '' : `/${month}`}" ${k === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function monthNav(tab, month) {
  return `
    <div class="datenav">
      <a class="btn icon" href="#/salary/${tab}/${addMonths(month, -1)}" aria-label="Previous month">‹</a>
      <input type="month" id="pick" value="${month}" aria-label="Choose month">
      <a class="btn icon" href="#/salary/${tab}/${addMonths(month, 1)}" aria-label="Next month">›</a>
    </div>`;
}

function wireMonthPick(view, tab) {
  view.querySelector('#pick').onchange = e => {
    if (isMonth(e.target.value)) location.hash = `#/salary/${tab}/${e.target.value}`;
  };
}

// ───────────── Payroll maths ─────────────

function monthDays(month) {
  const n = Number(lastDayOfMonth(month).slice(8));
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function offDays() {
  const raw = String(settings().weeklyOff || '');
  return new Set(raw.split(',').map(x => WEEKDAYS.findIndex(w => w.toLowerCase() === x.trim().slice(0, 3).toLowerCase())).filter(i => i >= 0));
}

/**
 * Works out each employee's salary for the month.
 * Unmarked working days count as present; only A (absent) days are deducted, at basic ÷ 26 each.
 * Days before the joining date are deducted too. Future days are not counted yet.
 */
function payroll(month, data, statusOf) {
  const days = monthDays(month);
  const off = offDays();
  const today = todayISO();
  return data.employees
    .filter(e => e.active || data.attendance.some(a => a.employeeId === e.id) || data.payments.some(p => p.employeeId === e.id))
    .map(e => {
      const c = { P: 0, A: 0, L: 0, O: 0, unmarked: 0, beforeJoin: 0 };
      if (e.trackAttendance) {
        days.forEach(d => {
          if (d > today) return;
          if (e.joinDate && d < e.joinDate) { c.beforeJoin++; return; }
          const s = statusOf(e.id, d) || (off.has(parseISO(d).getDay()) ? 'O' : '');
          if (c[s] !== undefined) c[s]++;
          else c.unmarked++;
        });
      }
      const pays = data.payments.filter(p => p.employeeId === e.id);
      const dailyRate = e.basicSalary / WORKING_DAYS;
      const deduction = e.trackAttendance ? Math.round(dailyRate * (c.A + c.beforeJoin)) : 0;
      const advance = sum(pays.filter(p => p.type === 'ADVANCE').map(p => p.amount));
      const paid = sum(pays.filter(p => p.type === 'SALARY').map(p => p.amount));
      const net = e.basicSalary - advance - deduction;
      return { e, c, pays, dailyRate, deduction, advance, paid, net, due: net - paid, present: c.P + c.unmarked };
    });
}

// ───────────── Attendance grid ─────────────

function renderAttendance(view, month, data) {
  const days = monthDays(month);
  const off = offDays();
  const today = todayISO();
  const saved = new Map(data.attendance.map(a => [`${a.date}|${a.employeeId}`, a.status]));
  const markedBy = new Map(data.attendance.map(a => [`${a.date}|${a.employeeId}`, a.updatedBy]));
  const edit = can('attendance', 'edit');
  const seesMoney = can(['salary', 'employees']);
  const pending = new Map();
  const statusOf = (id, d) => {
    const k = `${d}|${id}`;
    return pending.has(k) ? pending.get(k) : (saved.get(k) || '');
  };
  const staff = data.employees.filter(e => e.active && e.trackAttendance);
  const notTracked = data.employees.filter(e => e.active && !e.trackAttendance);

  view.innerHTML = `
    <section class="page salary">
      ${subnav('attendance', month)}
      <div class="toolbar">
        ${monthNav('attendance', month)}
        <div class="toolbar-actions">
          <button class="btn ghost" id="att-history">Change history</button>
          ${edit ? `
          ${month === today.slice(0, 7) ? '<button class="btn" id="all-present">Mark today: all present</button>' : ''}
          <button class="btn primary" id="save" disabled>Save changes</button>` : '<span class="chip">View only</span>'}
        </div>
      </div>
      <h1 class="page-title">Attendance · ${esc(prettyMonth(month))}</h1>
      <p class="legend">
        ${Object.entries(STATUS).map(([k, s]) => `<span><b class="att s-${k}">${k}</b>${s.label}</span>`).join('')}
        <span class="muted">${edit ? 'Tap a day to change it. ' : ''}Blank working days count as present. Hover a day to see who marked it.</span>
      </p>
      ${staff.length ? `
        <div class="panel grid-panel">
          <div class="table-wrap att-wrap">
            <table class="att-grid">
              <thead><tr>
                <th class="sticky">Employee</th>
                ${days.map(d => {
                  const wd = parseISO(d).getDay();
                  return `<th class="${off.has(wd) ? 'off' : ''} ${d === today ? 'today' : ''}">${Number(d.slice(8))}<small>${WEEKDAYS[wd].slice(0, 2)}</small></th>`;
                }).join('')}
                <th class="sum">Present</th><th class="sum">Absent</th><th class="sum">Leave</th>${seesMoney ? '<th class="sum">Deduction</th>' : ''}
              </tr></thead>
              <tbody>${staff.map(e => `
                <tr data-emp="${esc(e.id)}">
                  <th class="sticky" scope="row">${esc(e.name)}<small>${esc(e.designation)}</small></th>
                  ${days.map(d => `<td><button class="att" data-day="${d}" ${edit ? '' : 'aria-disabled="true"'} aria-label="${esc(e.name)}, ${esc(prettyDate(d, { day: 'numeric', month: 'short' }))}"></button></td>`).join('')}
                  <td class="sum" data-k="present"></td><td class="sum" data-k="A"></td><td class="sum" data-k="L"></td>${seesMoney ? '<td class="sum" data-k="ded"></td>' : ''}
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`
      : '<div class="panel"><p class="empty">No employees with attendance tracking yet. Add them under <a href="#/salary/employees">Employees</a>.</p></div>'}
      ${notTracked.length ? `<p class="muted small">Not tracked (no deduction): ${esc(notTracked.map(e => e.name).join(', '))}</p>` : ''}
    </section>`;
  wireMonthPick(view, 'attendance');

  const saveBtn = view.querySelector('#save') || { disabled: true };
  view.querySelector('#att-history').onclick = () => openHistory({ entity: 'Attendance', id: month, title: `Attendance ${prettyMonth(month)}` });
  const draw = () => {
    const rows = payroll(month, data, statusOf);
    view.querySelectorAll('tr[data-emp]').forEach(tr => {
      const id = tr.dataset.emp;
      tr.querySelectorAll('button[data-day]').forEach(b => {
        const d = b.dataset.day;
        const explicit = statusOf(id, d);
        const auto = !explicit && off.has(parseISO(d).getDay()) ? 'O' : '';
        const s = explicit || auto;
        b.className = `att${s ? ` s-${s}` : ''}${auto ? ' auto' : ''}${pending.has(`${d}|${id}`) ? ' changed' : ''}`;
        b.textContent = s;
        const by = !pending.has(`${d}|${id}`) && explicit ? markedBy.get(`${d}|${id}`) : '';
        b.title = (s ? STATUS[s].label + (auto ? ' (weekly off)' : '') : 'Not marked (counts as present)') + (by ? ` · marked by ${by}` : '');
      });
      const r = rows.find(x => x.e.id === id);
      tr.querySelector('[data-k="present"]').textContent = r.present;
      tr.querySelector('[data-k="A"]').textContent = r.c.A || '';
      tr.querySelector('[data-k="L"]').textContent = r.c.L || '';
      const ded = tr.querySelector('[data-k="ded"]');
      if (ded) ded.textContent = r.deduction ? fmt(r.deduction) : '';
    });
    if (!edit) return;
    saveBtn.disabled = !pending.size;
    saveBtn.textContent = pending.size ? `Save ${pending.size} change${pending.size === 1 ? '' : 's'}` : 'Saved';
    guard.message = pending.size ? 'You have unsaved attendance changes. Leave without saving?' : null;
  };
  const set = (id, d, s) => {
    const k = `${d}|${id}`;
    if (s === (saved.get(k) || '')) pending.delete(k);
    else pending.set(k, s);
  };
  draw();
  // Start the grid scrolled so today's column is in view.
  const wrap = view.querySelector('.att-wrap');
  const todayCell = wrap?.querySelector('thead th.today');
  if (todayCell) wrap.scrollLeft = Math.max(0, todayCell.offsetLeft - wrap.clientWidth / 2);

  view.onclick = e => {
    const b = e.target.closest('button[data-day]');
    if (!b || !edit) return;
    const id = b.closest('tr').dataset.emp;
    const d = b.dataset.day;
    set(id, d, CYCLE[(CYCLE.indexOf(statusOf(id, d)) + 1) % CYCLE.length]);
    draw();
  };
  view.querySelector('#all-present')?.addEventListener('click', () => {
    if (off.has(parseISO(today).getDay())) return toast('Today is a weekly off day', 'error');
    staff.forEach(emp => { if (!statusOf(emp.id, today)) set(emp.id, today, 'P'); });
    draw();
  });
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const records = [...pending].map(([k, status]) => {
        const [date, employeeId] = k.split('|');
        return { date, employeeId, status };
      });
      await call('saveAttendance', { records });
      records.forEach(r => {
        saved.set(`${r.date}|${r.employeeId}`, r.status);
        markedBy.set(`${r.date}|${r.employeeId}`, 'you');
      });
      pending.clear();
      toast('Attendance saved');
    } catch (err) {
      toast(err.message, 'error');
    }
    draw();
  };
}

// ───────────── Salary sheet ─────────────

function renderSheet(view, month, data) {
  const att = new Map(data.attendance.map(a => [`${a.date}|${a.employeeId}`, a.status]));
  const rows = payroll(month, data, (id, d) => att.get(`${d}|${id}`) || '');
  const s = settings();
  const T = k => sum(rows.map(r => r[k]));

  view.innerHTML = `
    <section class="page salary">
      ${subnav('sheet', month)}
      <div class="toolbar">
        ${monthNav('sheet', month)}
        <div class="toolbar-actions"><button class="btn ghost" id="print">Print</button></div>
      </div>
      <header class="print-only print-head">
        <img src="assets/logo.png" alt="" width="64" height="64">
        <div><h1>${esc(s.businessName)}</h1><p>${esc(s.address)}</p><h2>Monthly Salary Sheet · ${esc(prettyMonth(month))}</h2></div>
      </header>
      <h1 class="page-title no-print">Salary sheet · ${esc(prettyMonth(month))}</h1>
      <div class="cards">
        <div class="card"><span>Basic salary</span><strong>${taka(sum(rows.map(r => r.e.basicSalary)))}</strong></div>
        <div class="card out"><span>Advances + deductions</span><strong>${taka(T('advance') + T('deduction'))}</strong><small>${taka(T('deduction'))} for absence</small></div>
        <div class="card total"><span>Net payable</span><strong>${taka(T('net'))}</strong></div>
        <div class="card ${T('due') > 0 ? 'in' : ''}"><span>Still to pay</span><strong>${taka(T('due'))}</strong><small>${taka(T('paid'))} paid</small></div>
      </div>
      <div class="panel">
        ${rows.length ? `
          <div class="table-wrap"><table class="table salary-table">
            <thead><tr>
              <th>SL</th><th>Employee</th><th class="num">Basic</th><th class="num">Present / Absent</th>
              <th class="num">Deduction</th><th class="num">Advance</th><th class="num">Net payable</th><th class="num">Paid</th><th class="num">Due</th>
              <th class="no-print"><span class="sr">Actions</span></th>
            </tr></thead>
            <tbody>${rows.map((r, i) => `
              <tr class="${r.e.active ? '' : 'archived'}">
                <td>${i + 1}</td>
                <td><strong>${esc(r.e.name)}</strong><small class="muted block">${esc(r.e.designation)}</small>
                  ${r.c.unmarked && r.e.trackAttendance ? `<span class="chip warn no-print" title="Counted as present">${r.c.unmarked} day${r.c.unmarked === 1 ? '' : 's'} not marked</span>` : ''}</td>
                <td class="num">${fmt(r.e.basicSalary)}</td>
                <td class="num">${r.e.trackAttendance ? `${r.present} / ${absentLabel(r.c)}` : '<span class="muted">Not tracked</span>'}</td>
                <td class="num">${r.deduction ? fmt(r.deduction) : '0'}</td>
                <td class="num">${r.advance ? fmt(r.advance) : '0'}</td>
                <td class="num"><strong>${fmt(r.net)}</strong></td>
                <td class="num"><button class="link" data-history="${esc(r.e.id)}" title="See payments">${fmt(r.paid)}${r.pays.length ? ` <small class="muted">(${r.pays.length})</small>` : ''}</button></td>
                <td class="num ${r.due < 0 ? 'neg' : ''}">${r.due === 0 && r.net > 0 ? '<span class="status ok">Paid</span>' : fmt(r.due)}</td>
                <td class="row-actions no-print">
                  ${can('salary', 'edit') ? `<button class="btn small" data-pay="ADVANCE" data-id="${esc(r.e.id)}">Advance</button>
                  <button class="btn small primary" data-pay="SALARY" data-id="${esc(r.e.id)}" ${r.due > 0 ? '' : 'disabled'}>Pay</button>` : ''}
                </td>
              </tr>`).join('')}</tbody>
            <tfoot><tr>
              <td colspan="2">Total</td><td class="num">${fmt(sum(rows.map(r => r.e.basicSalary)))}</td><td></td>
              <td class="num">${fmt(T('deduction'))}</td><td class="num">${fmt(T('advance'))}</td><td class="num">${fmt(T('net'))}</td>
              <td class="num">${fmt(T('paid'))}</td><td class="num">${fmt(T('due'))}</td><td class="no-print"></td>
            </tr></tfoot>
          </table></div>`
        : '<p class="empty">No employees yet. Add them under <a href="#/salary/employees">Employees</a>.</p>'}
      </div>
      <p class="muted small">Deduction per absent day = basic salary ÷ 26. Paid leave, Fridays and unmarked days are not deducted. Employees set to “not tracked” (heads of department, investors) are never deducted.
        Net payable = basic − advance − deduction.</p>
      <div class="print-only signatures">
        <span>Prepared by: ${esc(s.preparedBy)}</span>
        <span>Approved by: ______________________</span>
      </div>
    </section>`;
  wireMonthPick(view, 'sheet');
  view.querySelector('#print').onclick = () => window.print();

  const refresh = () => renderSalary(view, 'sheet', month);
  const byId = new Map(rows.map(r => [r.e.id, r]));
  view.onclick = e => {
    const pay = e.target.closest('[data-pay]');
    const hist = e.target.closest('[data-history]');
    if (pay) openPaymentForm({ row: byId.get(pay.dataset.id), type: pay.dataset.pay, month, onSaved: refresh });
    if (hist) openPayments({ row: byId.get(hist.dataset.history), month, onChanged: refresh });
  };
}

function absentLabel(c) {
  const parts = [];
  if (c.A) parts.push(`${c.A}`);
  if (c.beforeJoin) parts.push(`${c.beforeJoin} before joining`);
  return parts.join(' + ') || '0';
}

function openPaymentForm({ row, type, month, onSaved }) {
  const ms = methods();
  const advance = type === 'ADVANCE';
  const m = openModal({
    title: `${advance ? 'Advance' : 'Pay salary'}: ${row.e.name}`,
    body: `
      <form class="form" novalidate>
        <p class="muted">${esc(prettyMonth(month))} · net payable ${taka(row.net)} · paid ${taka(row.paid)} · due <strong>${taka(row.due)}</strong></p>
        <div class="grid2">
          <label>Amount (৳)<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" required autofocus value="${advance ? '' : Math.max(row.due, 0)}"></label>
          <label>Paid from<select name="method">${options(ms, ms[0], methodLabel)}</select></label>
        </div>
        <div class="grid2">
          <label>Date<input type="date" name="date" required value="${todayISO()}"></label>
          <label>Note (optional)<input name="note" maxlength="200"></label>
        </div>
        <label class="check"><input type="checkbox" name="cash" checked> Also record as cash out in the cash book (Salary)</label>
        <p class="form-error" hidden></p>
        <div class="actions"><button class="btn primary">Save</button></div>
      </form>`,
  });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const amount = Number(v.amount);
    if (!(amount > 0)) return formError(form, 'Enter an amount greater than 0.');
    if (!v.date) return formError(form, 'Choose a date.');
    if (!advance && amount > row.due && !(await confirmDialog(`That is ${taka(amount - row.due)} more than what is due. Save anyway?`, { okLabel: 'Save anyway', danger: false }))) return;
    const payment = { employeeId: row.e.id, month, type, amount, method: v.method, date: v.date, note: v.note };
    const ok = await submitting(form, () => call('addSalaryPayment', { payment, cash: !!v.cash }));
    if (!ok) return;
    toast(advance ? 'Advance recorded' : 'Salary payment recorded');
    m.close();
    onSaved();
  });
}

function openPayments({ row, month, onChanged }) {
  const m = openModal({
    title: `Payments: ${row.e.name} · ${prettyMonth(month)}`,
    wide: true,
    body: row.pays.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Note</th><th class="num">Amount (৳)</th><th><span class="sr">Actions</span></th></tr></thead>
        <tbody>${row.pays.map(p => `
          <tr>
            <td class="nowrap">${esc(prettyDate(p.date, { day: 'numeric', month: 'short' }))}</td>
            <td>${p.type === 'ADVANCE' ? 'Advance' : 'Salary'}${p.txnId ? ' <span class="chip">in cash book</span>' : ''}</td>
            <td>${esc(methodLabel(p.method))}</td>
            <td>${esc(p.note)}${p.createdBy ? `<small class="by">by ${esc(p.createdBy)}</small>` : ''}</td>
            <td class="num">${fmt(p.amount)}</td>
            <td class="row-actions">${can('salary', 'edit') ? `<button class="link danger" data-del="${esc(p.id)}">Delete</button>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No payments for this month yet.</p>',
  });
  m.el.querySelector('.modal-body').onclick = async e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!(await confirmDialog('Delete this payment? If it was also recorded in the cash book, that entry is deleted too.'))) return;
    try {
      await call('deleteSalaryPayment', { id: b.dataset.del });
      toast('Payment deleted');
      m.close();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ───────────── Employees ─────────────

function renderEmployees(view, employees) {
  const active = employees.filter(e => e.active);
  const archived = employees.filter(e => !e.active);
  const refresh = () => renderSalary(view, 'employees');
  const month = todayISO().slice(0, 7);
  const edit = can('employees', 'edit');
  const table = list => `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Designation</th><th class="num">Basic salary</th><th>Phone</th><th>Attendance</th><th><span class="sr">Actions</span></th></tr></thead>
      <tbody>${list.map(e => `
        <tr>
          <td><strong>${esc(e.name)}</strong>${e.joinDate ? `<small class="muted block">Joined ${esc(prettyDate(e.joinDate, { day: 'numeric', month: 'short', year: 'numeric' }))}</small>` : ''}</td>
          <td>${esc(e.designation)}</td>
          <td class="num">${fmt(e.basicSalary)}</td>
          <td>${esc(e.phone)}</td>
          <td>${e.trackAttendance ? 'Tracked' : '<span class="muted">Not tracked</span>'}</td>
          <td class="row-actions">
            <button class="link" data-emp-history="${esc(e.id)}">History</button>
            ${!edit ? '' : e.active
              ? `<button class="link" data-edit="${esc(e.id)}">Edit</button>`
              : `<button class="link" data-restore="${esc(e.id)}">Restore</button>`}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;

  view.innerHTML = `
    <section class="page salary">
      ${subnav('employees', month)}
      <div class="toolbar">
        <h1 class="page-title">Employees</h1>
        <div class="toolbar-actions">${edit ? '<button class="btn primary" id="new">+ New employee</button>' : '<span class="chip">View only</span>'}</div>
      </div>
      <div class="cards">
        <div class="card"><span>Active employees</span><strong>${active.length}</strong></div>
        <div class="card total"><span>Total basic salary / month</span><strong>${taka(sum(active.map(e => e.basicSalary)))}</strong></div>
      </div>
      <div class="panel">
        ${active.length ? table(active) : '<p class="empty">No employees yet. Add them here, or use “Import employees from a salary sheet” in the Google Sheet’s M&amp;M App menu.</p>'}
      </div>
      ${archived.length ? `<div class="panel"><h2>Former employees</h2>${table(archived)}</div>` : ''}
    </section>`;

  const byId = new Map(employees.map(e => [e.id, e]));
  view.querySelector('#new')?.addEventListener('click', () => openEmployeeForm({ onSaved: refresh }));
  view.onclick = async e => {
    const editBtn = e.target.closest('[data-edit]');
    const restore = e.target.closest('[data-restore]');
    const hist = e.target.closest('[data-emp-history]');
    if (hist) {
      const emp = byId.get(hist.dataset.empHistory);
      openHistory({ entity: 'Employees', id: emp.id, title: emp.name });
    }
    if (editBtn) openEmployeeForm({ emp: byId.get(editBtn.dataset.edit), onSaved: refresh });
    if (restore) {
      try {
        await call('saveEmployee', { employee: { ...byId.get(restore.dataset.restore), active: true } });
        toast('Employee restored');
        refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  };
}

function openEmployeeForm({ emp, onSaved }) {
  const editing = !!emp;
  const e = emp || { trackAttendance: true };
  const m = openModal({
    title: editing ? `Edit ${e.name}` : 'New employee',
    body: `
      <form class="form" novalidate>
        <label>Name<input name="name" required maxlength="100" value="${esc(e.name || '')}"></label>
        <div class="grid2">
          <label>Designation<input name="designation" maxlength="100" value="${esc(e.designation || '')}" placeholder="e.g. Senior Mechanic"></label>
          <label>Basic salary (৳ / month)<input name="basicSalary" type="number" min="0" step="1" inputmode="numeric" required value="${esc(e.basicSalary ?? '')}"></label>
        </div>
        <div class="grid2">
          <label>Phone (optional)<input name="phone" type="tel" maxlength="40" value="${esc(e.phone || '')}"></label>
          <label>Joining date (optional)<input name="joinDate" type="date" value="${esc(e.joinDate || '')}"></label>
        </div>
        <label class="check"><input type="checkbox" name="trackAttendance" ${e.trackAttendance ? 'checked' : ''}> Track attendance and deduct for absent days</label>
        <p class="muted small">Untick for heads of department, investors, or anyone paid a fixed amount.</p>
        <p class="form-error" hidden></p>
        <div class="actions">
          ${editing ? '<button type="button" class="btn danger ghost" data-remove>Remove employee</button>' : ''}
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    if (!v.name.trim()) return formError(form, 'Enter the employee name.');
    if (v.basicSalary === '' || Number(v.basicSalary) < 0) return formError(form, 'Enter the basic salary.');
    const employee = { ...e, ...v, basicSalary: Number(v.basicSalary), trackAttendance: !!v.trackAttendance, active: true };
    const ok = await submitting(form, () => call('saveEmployee', { employee }));
    if (!ok) return;
    toast(editing ? 'Employee updated' : 'Employee added');
    m.close();
    onSaved();
  });
  form.querySelector('[data-remove]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Remove ${e.name}? If they have attendance or payments, they move to “Former employees” so the history is kept.`, { okLabel: 'Remove' }))) return;
    try {
      const res = await call('deleteEmployee', { id: e.id });
      toast(res.archived ? 'Moved to former employees' : 'Employee removed');
      m.close();
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
