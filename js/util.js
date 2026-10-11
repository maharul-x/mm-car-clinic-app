export const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
export const fmt = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const taka = n => `৳${fmt(n)}`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

const pad = n => String(n).padStart(2, '0');
export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
export const parseISO = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const addMonths = (ym, n) => {
  const d = parseISO(`${ym}-01`);
  d.setMonth(d.getMonth() + n);
  return toISO(d).slice(0, 7);
};
export const lastDayOfMonth = ym => {
  const [y, m] = ym.split('-').map(Number);
  return toISO(new Date(y, m, 0));
};
export const prettyDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  parseISO(s).toLocaleDateString('en-GB', opts);
export const prettyMonth = ym => parseISO(`${ym}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** Moves money between per-method balances, the same way the server does. */
export function applyTxn(bal, t) {
  const a = Number(t.amount) || 0;
  if (t.type === 'IN') bal[t.method] = (bal[t.method] || 0) + a;
  else if (t.type === 'OUT') bal[t.method] = (bal[t.method] || 0) - a;
  else if (t.type === 'TRANSFER') {
    bal[t.method] = (bal[t.method] || 0) - a;
    bal[t.toMethod] = (bal[t.toMethod] || 0) + a;
  }
}

export function groupBy(list, key) {
  const m = new Map();
  list.forEach(x => {
    const k = typeof key === 'function' ? key(x) : x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return m;
}

/** A screen with unsaved changes sets guard.message; the router asks before leaving. */
export const guard = { message: null };

export const loading =(text = 'Loading…') => `<div class="loading" role="status"><span class="spinner"></span>${esc(text)}</div>`;

export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = ''; }, 3200);
}

export function openModal({ title, body, wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h2 id="modal-title">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">×</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  const previous = document.activeElement;
  // Only the top-most dialog reacts to Escape, so a confirm box doesn't also close the form under it.
  const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === el) close(); };
  function close() {
    el.remove();
    document.removeEventListener('keydown', onKey);
    previous?.focus?.();
    onClose?.();
  }
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(el);
  setTimeout(() => (el.querySelector('[autofocus]') || el.querySelector('input:not([type=hidden]), select, textarea'))?.focus(), 0);
  return { el, close };
}

export function confirmDialog(message, { okLabel = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    const m = openModal({
      title: 'Please confirm',
      body: `<p>${esc(message)}</p>
        <div class="actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>
        </div>`,
      onClose: () => resolve(false),
    });
    m.el.querySelector('[data-ok]').onclick = () => {
      resolve(true);
      m.close();
    };
  });
}

/** Runs an async save with the form's buttons disabled, showing any error inside the form. */
export async function submitting(form, fn) {
  const buttons = [...form.querySelectorAll('button')];
  const err = form.querySelector('.form-error');
  buttons.forEach(b => { b.disabled = true; });
  if (err) err.hidden = true;
  try {
    return await fn();
  } catch (e) {
    if (err) {
      err.textContent = e.message;
      err.hidden = false;
    } else toast(e.message, 'error');
    return undefined;
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

export function formError(form, message) {
  const err = form.querySelector('.form-error');
  err.textContent = message;
  err.hidden = false;
}

export const options = (list, selected, labelOf = x => x) =>
  list.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labelOf(v))}</option>`).join('');

export function downloadCSV(filename, rows) {
  const cell = c => {
    let s = String(c ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
