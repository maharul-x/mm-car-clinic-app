import { call } from '../api.js';
import { esc, fmt, loading, openModal, prettyDate } from '../util.js';

const LABELS = {
  date: 'Date', type: 'Type', invoice: 'Invoice no.', description: 'Description', category: 'Category', amount: 'Amount',
  method: 'Account', toMethod: 'To account', note: 'Note', sku: 'SKU', name: 'Name', unit: 'Unit', costPrice: 'Cost price',
  salePrice: 'Sale price', reorderLevel: 'Reorder level', active: 'Active', designation: 'Designation', basicSalary: 'Basic salary',
  phone: 'Phone', joinDate: 'Joining date', trackAttendance: 'Tracks attendance', status: 'Status', isAdmin: 'Admin',
  perms: 'Access', qty: 'Quantity', unitPrice: 'Unit price', reference: 'Reference', month: 'Month', employee: 'Employee',
  username: 'Username', IN: 'Cash-in categories', OUT: 'Cash-out categories', methods: 'Payment methods', startDate: 'First day tracked',
  weeklyOff: 'Weekly off', businessName: 'Business name', address: 'Address', preparedBy: 'Prepared by',
};
const HIDDEN = ['id', 'itemId', 'employeeId', 'txnId', 'sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'approvedBy', 'lastLogin'];
const SECTION = { cash: 'Cash book', report: 'Monthly report', inventory: 'Inventory', attendance: 'Attendance', salary: 'Salary sheet', employees: 'Employees', settings: 'Settings' };
const LEVEL = { none: 'Hidden', view: 'View', edit: 'View & edit' };
const ATT = { P: 'Present', A: 'Absent', L: 'Paid leave', O: 'Off', '': 'Not marked' };
const ACTION = { add: 'Added', edit: 'Edited', delete: 'Deleted' };

/** "12 Oct 2026, 3:40 pm" from the server's yyyy-MM-ddTHH:mm:ss (or a plain date). */
export function when(at) {
  if (!at) return '';
  const [d, t] = String(at).split('T');
  const date = prettyDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  if (!t) return date;
  const [h, m] = t.split(':').map(Number);
  return `${date}, ${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function show(key, v) {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(', ');
  if (typeof v === 'number' && /amount|price|salary|qty|opening|reorder/i.test(key)) return fmt(v);
  return String(v);
}

/** Field-by-field old → new list for one log entry. */
function changes(entry) {
  if (Array.isArray(entry.after)) {
    // Attendance: a list of { date, employee, from, to }
    return entry.after.map(c => `<li><span class="h-field">${esc(prettyDate(c.date, { day: 'numeric', month: 'short' }))} · ${esc(c.employee)}</span>
      <span class="h-old">${esc(ATT[c.from] || c.from)}</span><span class="h-arrow">→</span><span class="h-new">${esc(ATT[c.to] || c.to)}</span></li>`).join('');
  }
  const b = entry.before || {};
  const a = entry.after || {};
  if (entry.action === 'edit' && entry.before) {
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
      .filter(k => !HIDDEN.includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    const row = (label, from, to) => `<li><span class="h-field">${esc(label)}</span>
      <span class="h-old">${esc(from)}</span><span class="h-arrow">→</span><span class="h-new">${esc(to)}</span></li>`;
    return keys.map(k => {
      if (k === 'perms' && b.perms && a.perms) {
        // Only the sections whose access changed, e.g. "Cash book: Hidden → View & edit"
        return Object.keys(SECTION).filter(sec => (b.perms[sec] || 'none') !== (a.perms[sec] || 'none'))
          .map(sec => row(SECTION[sec], LEVEL[b.perms[sec] || 'none'], LEVEL[a.perms[sec] || 'none'])).join('');
      }
      return row(LABELS[k] || k, show(k, b[k]), show(k, a[k]));
    }).join('');
  }
  const src = entry.action === 'delete' ? b : a;
  return Object.keys(src).filter(k => !HIDDEN.includes(k) && src[k] !== '' && src[k] !== null)
    .map(k => `<li><span class="h-field">${esc(LABELS[k] || k)}</span><span class="${entry.action === 'delete' ? 'h-old' : 'h-new'}">${esc(show(k, src[k]))}</span></li>`)
    .join('');
}

export function historyList(entries, { showSummary = false } = {}) {
  if (!entries.length) return '<p class="empty">No changes recorded yet.</p>';
  return `<ol class="history">${entries.map(e => {
    const list = changes(e);
    return `
      <li class="h-entry ${esc(e.action)}">
        <div class="h-head">
          <span class="h-dot" aria-hidden="true"></span>
          <strong>${esc(e.user || 'Unknown')}</strong>
          <span class="muted">${ACTION[e.action] || esc(e.action)}${showSummary ? '' : ''}</span>
          <time class="h-time">${esc(when(e.at))}</time>
        </div>
        ${showSummary ? `<p class="h-summary">${esc(e.summary)}</p>` : ''}
        ${list ? `<ul class="h-changes">${list}</ul>` : ''}
      </li>`;
  }).join('')}</ol>`;
}

/** "Added by Karim · 12 Oct, 3:40 pm · Edited by Rahim · 12 Oct, 4:05 pm" */
export function stampLine(rec, { added = 'Added' } = {}) {
  const parts = [];
  if (rec.createdBy) parts.push(`${added} by <strong>${esc(rec.createdBy)}</strong>${rec.createdAt ? ` · ${esc(when(rec.createdAt))}` : ''}`);
  if (rec.updatedBy) parts.push(`Edited by <strong>${esc(rec.updatedBy)}</strong>${rec.updatedAt ? ` · ${esc(when(rec.updatedAt))}` : ''}`);
  return parts.length ? `<p class="stamp">${parts.join('<span class="sep">·</span>')}</p>` : '';
}

/** Loads a record's history into `el`. */
export async function loadHistory(el, entity, id) {
  el.innerHTML = loading('Loading history…');
  try {
    el.innerHTML = historyList(await call('history', { entity, id }));
  } catch (err) {
    el.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

export function openHistory({ entity, id, title }) {
  const m = openModal({ title: `History · ${title}`, wide: true, body: '<div class="h-body"></div>' });
  loadHistory(m.el.querySelector('.h-body'), entity, id);
}
