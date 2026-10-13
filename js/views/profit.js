import { call } from '../api.js';
import { can, categories, methodLabel } from '../state.js';
import { addMonths, confirmDialog, esc, fmt, formError, isISO, lastDayOfMonth, loading, openModal, options, prettyDate, submitting, taka, toast, todayISO } from '../util.js';
import { historyList, stampLine } from './history.js';
import { openTxnForm } from './txnForm.js';

const short = d => prettyDate(d, { day: 'numeric', month: 'short' });
const range = (from, to) => `${prettyDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${prettyDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
const signed = n => (n < 0 ? `−${taka(Math.abs(n))}` : taka(n));

/**
 * Profit: per-invoice sell/cost from the cash book plus invoice-only lines, operating expenses by category,
 * and net profit for a date range. #/profit = this month, #/profit/<from>/<to> = any range.
 * `reopen` is an invoice key whose pop-up should open again after a refresh.
 */
export async function renderProfit(view, a, b, reopen) {
  const thisMonth = todayISO().slice(0, 7);
  const lastMonth = addMonths(thisMonth, -1);
  const presets = {
    this: [`${thisMonth}-01`, lastDayOfMonth(thisMonth)],
    last: [`${lastMonth}-01`, lastDayOfMonth(lastMonth)],
  };
  const [from, to] = isISO(a) && isISO(b) && a <= b ? [a, b] : presets.this;
  const preset = from === presets.this[0] && to === presets.this[1] ? 'this'
    : from === presets.last[0] && to === presets.last[1] ? 'last' : 'custom';
  const refresh = key => renderProfit(view, from, to, key);

  view.innerHTML = loading();
  const d = await call('profit', { from, to });
  const t = d.totals;
  const withLines = d.invoices.filter(i => i.lines).length;

  view.innerHTML = `
    <section class="page profit">
      <header class="page-head">
        <p class="eyebrow">Profit</p>
        <h1 class="page-title">Profit &amp; loss</h1>
      </header>

      <div class="toolbar">
        <div class="range-picker">
          <div class="segmented" role="radiogroup" aria-label="Period">
            <button type="button" role="radio" data-preset="this" aria-checked="${preset === 'this'}">This month</button>
            <button type="button" role="radio" data-preset="last" aria-checked="${preset === 'last'}">Last month</button>
            <button type="button" role="radio" data-preset="custom" aria-checked="${preset === 'custom'}">Custom</button>
          </div>
          <form class="custom-range" ${preset === 'custom' ? '' : 'hidden'} novalidate>
            <label class="sr" for="p-from">From</label>
            <input type="date" id="p-from" name="from" value="${from}" required>
            <span class="muted">to</span>
            <label class="sr" for="p-to">To</label>
            <input type="date" id="p-to" name="to" value="${to}" required>
            <button class="btn">Apply</button>
          </form>
        </div>
        <span class="muted small">${esc(range(from, to))}</span>
      </div>

      <div class="cards">
        ${card('Total sell price', taka(t.sell), 'in', `${d.invoices.length} invoice${d.invoices.length === 1 ? '' : 's'}`)}
        ${card('Total cost price', taka(t.cost), 'out')}
        ${card('Gross profit', signed(t.gross), '', 'Sell − cost', t.gross < 0)}
        ${card('Operating expense', taka(t.opex), 'out', `${d.opex.length} categor${d.opex.length === 1 ? 'y' : 'ies'}`)}
        ${card('Net profit', signed(t.net), 'total', t.net < 0 ? 'Loss for this period' : 'Gross profit − operating expense', t.net < 0)}
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>Invoices</h2>
          <input type="search" id="inv-q" placeholder="Search invoice or customer" aria-label="Search invoices">
        </div>
        ${d.invoices.length ? `
          <div class="table-wrap"><table class="table invoice-table">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th class="num">Sell price</th><th class="num">Cost price</th><th class="num">Gross profit</th></tr></thead>
            <tbody>${d.invoices.map(i => `
              <tr class="clickable" data-inv="${esc(i.key)}" data-q="${esc(`${i.invoice} ${i.customer}`.toLowerCase())}" tabindex="0">
                <td class="nowrap"><strong>${esc(i.invoice)}</strong></td>
                <td>${esc(i.customer || '—')}</td>
                <td class="nowrap">${esc(short(i.firstDate))}${i.lastDate !== i.firstDate ? `<small class="muted block">last ${esc(short(i.lastDate))}</small>` : ''}</td>
                <td class="num">${fmt(i.sell)}</td>
                <td class="num">${fmt(i.cost)}${i.lines ? ` <span class="chip edited" title="Has invoice-only lines">+${i.lines} line${i.lines === 1 ? '' : 's'}</span>` : ''}</td>
                <td class="num ${i.gross < 0 ? 'neg' : ''}"><strong>${signed(i.gross).replace('৳', '')}</strong></td>
              </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(t.sell)}</td><td class="num">${fmt(t.cost)}</td><td class="num ${t.gross < 0 ? 'neg' : ''}">${signed(t.gross).replace('৳', '')}</td></tr></tfoot>
          </table></div>
          <p class="empty" id="inv-none" hidden>No invoices match your search.</p>`
        : '<p class="empty">No invoices in this period. An invoice appears here when a cash-in or cash-out entry has its invoice number.</p>'}
        <p class="muted small">An invoice is listed in the period of its first entry. Its sell and cost prices include every entry for that invoice, on any date,
          plus its invoice-only lines${withLines ? ` (${withLines} invoice${withLines === 1 ? ' has' : 's have'} some)` : ''}.</p>
      </div>

      <div class="panel">
        <h2>Operating expenses</h2>
        ${d.opex.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Category</th><th class="num">Entries</th><th class="num">Amount (৳)</th></tr></thead>
            <tbody>${d.opex.map(c => `
              <tr class="clickable" data-cat="${esc(c.name)}" tabindex="0">
                <td>${esc(c.name)}</td><td class="num">${c.entries.length}</td><td class="num">${fmt(c.total)}</td>
              </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="2">Total operating expense</td><td class="num">${fmt(t.opex)}</td></tr></tfoot>
          </table></div>`
        : '<p class="empty">No cash out without an invoice number in this period.</p>'}
        <p class="muted small">Cash out with no invoice number (rent, salary, transport, utilities…), dated in this period.</p>
      </div>

      <div class="panel profit-sum">
        <h2>Net profit</h2>
        <dl class="sum-list">
          <div><dt>Total sell price</dt><dd>${taka(t.sell)}</dd></div>
          <div><dt>− Total cost price</dt><dd>${taka(t.cost)}</dd></div>
          <div><dt>− Total operating expense</dt><dd>${taka(t.opex)}</dd></div>
          <div class="sum-total"><dt>Net profit</dt><dd class="${t.net < 0 ? 'neg' : ''}">${signed(t.net)}</dd></div>
        </dl>
        ${d.unlinkedIn ? `<p class="muted small">Cash in without an invoice number in this period (${taka(d.unlinkedIn)}) is not part of this calculation.</p>` : ''}
      </div>
    </section>`;

  // Period picker
  const customForm = view.querySelector('.custom-range');
  view.querySelectorAll('[data-preset]').forEach(btn => {
    btn.onclick = () => {
      const p = btn.dataset.preset;
      if (p === 'custom') {
        view.querySelectorAll('[data-preset]').forEach(x => x.setAttribute('aria-checked', String(x === btn)));
        customForm.hidden = false;
        customForm.elements.from.focus();
        return;
      }
      location.hash = p === 'this' ? '#/profit' : `#/profit/${presets[p][0]}/${presets[p][1]}`;
    };
  });
  customForm.addEventListener('submit', e => {
    e.preventDefault();
    const f = customForm.elements.from.value, tt = customForm.elements.to.value;
    if (!isISO(f) || !isISO(tt) || f > tt) return toast('Choose a start date before the end date', 'error');
    location.hash = `#/profit/${f}/${tt}`;
  });

  // Invoice search
  const q = view.querySelector('#inv-q');
  q.oninput = () => {
    const needle = q.value.trim().toLowerCase();
    let shown = 0;
    view.querySelectorAll('[data-inv]').forEach(tr => {
      const hit = !needle || tr.dataset.q.includes(needle);
      tr.hidden = !hit;
      if (hit) shown++;
    });
    const none = view.querySelector('#inv-none');
    if (none) none.hidden = shown > 0;
  };

  const invByKey = new Map(d.invoices.map(i => [i.key, i]));
  const catByName = new Map(d.opex.map(c => [c.name, c]));
  const open = el => {
    if (el.dataset.inv) openInvoice({ inv: invByKey.get(el.dataset.inv), onSaved: refresh });
    else if (el.dataset.cat) openCategory(catByName.get(el.dataset.cat), from, to);
  };
  view.onclick = e => {
    const row = e.target.closest('[data-inv], [data-cat]');
    if (row) open(row);
  };
  view.onkeydown = e => {
    const row = e.target.closest('[data-inv], [data-cat]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open(row);
    }
  };
  if (reopen && invByKey.has(reopen)) openInvoice({ inv: invByKey.get(reopen), onSaved: refresh });
}

function card(label, value, kind = '', sub = '', negative = false) {
  return `<div class="card ${kind}"><span>${label}</span><strong class="${negative ? 'neg' : ''}">${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

/**
 * One invoice: its sell/cost/gross worked out from its lines, the lines themselves, buttons to add
 * invoice-only lines, and every change. Cash-book lines open the normal entry form; invoice-only
 * lines open their own form. After any save the page refreshes and this pop-up opens again.
 */
function openInvoice({ inv, onSaved }) {
  const edit = can('profit', 'edit');
  const m = openModal({
    title: `Invoice ${inv.invoice}`,
    wide: true,
    body: `
      <p class="muted">${esc(inv.customer || 'No cash in yet')} · ${esc(short(inv.firstDate))}${inv.lastDate !== inv.firstDate ? ` – ${esc(short(inv.lastDate))}` : ''}</p>
      <div class="cards inv-cards">
        <div class="card in"><span>Sell price</span><strong>${taka(inv.sell)}</strong></div>
        <div class="card out"><span>Cost price</span><strong>${taka(inv.cost)}</strong></div>
        <div class="card"><span>Gross profit</span><strong class="${inv.gross < 0 ? 'neg' : ''}">${signed(inv.gross)}</strong></div>
      </div>
      <div class="sub-head">
        <h3 class="sub-title">Entries for this invoice</h3>
        ${edit ? `
          <div class="toolbar-actions">
            <button type="button" class="btn small in" data-add-line="IN">Add cash in</button>
            <button type="button" class="btn small out" data-add-line="OUT">Add cash out</button>
          </div>` : ''}
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Account</th><th class="num">Amount (৳)</th></tr></thead>
        <tbody>${inv.entries.map((e, i) => `
          <tr class="clickable" data-entry="${i}" tabindex="0" title="Open to edit or delete">
            <td class="nowrap">${esc(short(e.date))}</td>
            <td class="nowrap">${e.type === 'IN' ? 'Cash in' : 'Cash out'}</td>
            <td>${esc(e.description)}${e.category ? ` <span class="chip">${esc(e.category)}</span>` : ''}
              ${e.createdBy ? `<small class="by">by ${esc(e.createdBy)}${e.updatedBy ? ` · edited by ${esc(e.updatedBy)}` : ''}</small>` : ''}</td>
            <td>${e.source === 'line' ? '<span class="chip edited">Invoice only</span>' : esc(methodLabel(e.method))}</td>
            <td class="num ${e.type === 'IN' ? 'pos' : ''}">${e.type === 'IN' ? '+' : '−'}${fmt(e.amount)}</td>
          </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">Gross profit</td><td class="num ${inv.gross < 0 ? 'neg' : ''}">${signed(inv.gross).replace('৳', '')}</td></tr></tfoot>
      </table></div>
      <p class="muted small">Invoice-only lines count for this invoice's sell and cost prices but are not in the cash book and don't change any balance.</p>
      <details class="history-box"><summary>Change history</summary><div class="h-body"></div></details>`,
  });
  const reopen = () => {
    m.close();
    onSaved(inv.key);
  };
  const box = m.el.querySelector('.history-box');
  box.addEventListener('toggle', async () => {
    if (!box.open || box.dataset.loaded) return;
    box.dataset.loaded = '1';
    const body = box.querySelector('.h-body');
    body.innerHTML = loading('Loading history…');
    try {
      body.innerHTML = historyList(await call('invoiceHistory', { invoice: inv.key }), { showSummary: true });
    } catch (err) {
      body.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  });
  const openEntry = i => {
    const e = inv.entries[i];
    if (e.source === 'line') openLineForm({ invoice: inv.key, line: e, onSaved: reopen });
    else openTxnForm({ txn: e, onSaved: reopen });
  };
  m.el.querySelector('.modal-body').addEventListener('click', ev => {
    const add = ev.target.closest('[data-add-line]');
    if (add) return openLineForm({ invoice: inv.key, type: add.dataset.addLine, onSaved: reopen });
    const row = ev.target.closest('[data-entry]');
    if (row) openEntry(Number(row.dataset.entry));
  });
  m.el.querySelector('.modal-body').addEventListener('keydown', ev => {
    const row = ev.target.closest('[data-entry]');
    if (row && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      openEntry(Number(row.dataset.entry));
    }
  });
}

/** Add, edit or delete an invoice-only line. View-only users see it read-only. */
function openLineForm({ invoice, type, line, onSaved }) {
  const edit = can('profit', 'edit');
  const editing = !!line;
  const l = line || { type, date: todayISO(), category: '' };
  const cats = [...categories(l.type)];
  if (l.category && !cats.includes(l.category)) cats.push(l.category);
  const kind = l.type === 'IN' ? 'cash in' : 'cash out';
  const m = openModal({
    title: `${editing ? (edit ? 'Edit' : '') : 'Add'} invoice-only ${kind} · ${invoice}`.replace(/^ /, ''),
    body: `
      ${editing ? stampLine(l) : ''}
      <form class="form" novalidate>
        <fieldset class="plain" ${edit ? '' : 'disabled'}>
          <label>Description<input name="description" maxlength="200" required autofocus value="${esc(l.description || '')}"
            placeholder="${l.type === 'IN' ? 'e.g. Labour charge' : 'e.g. Parts, tyre work'}"></label>
          <div class="grid2">
            <label>Amount (৳)<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" required value="${esc(l.amount ?? '')}"></label>
            <label>Category
              <select name="category">
                <option value="" ${l.category ? '' : 'selected'}>${l.type === 'IN' ? 'Customer Payment' : 'Uncategorized'}</option>
                ${options(cats.filter(c => c !== (l.type === 'IN' ? 'Customer Payment' : 'Uncategorized')), l.category)}
              </select>
            </label>
          </div>
          <div class="grid2">
            <label>Date<input type="date" name="date" required value="${esc(l.date)}"></label>
            <label>Note (optional)<input name="note" maxlength="300" value="${esc(l.note || '')}"></label>
          </div>
        </fieldset>
        <p class="muted small">Counts for invoice ${esc(invoice)} only. It won't appear in the cash book or change any balance.</p>
        <p class="form-error" hidden></p>
        ${edit ? `
        <div class="actions">
          ${editing ? '<button type="button" class="btn danger ghost" data-delete>Delete</button><span class="spacer"></span>' : ''}
          <button class="btn primary">Save</button>
        </div>` : ''}
      </form>`,
  });
  if (!edit) return;
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const amount = Number(v.amount);
    if (!v.description.trim()) return formError(form, 'Enter a description.');
    if (!(amount > 0)) return formError(form, 'Enter an amount greater than 0.');
    if (!v.date) return formError(form, 'Choose a date.');
    const ok = await submitting(form, () => call('saveInvoiceLine', { line: { ...l, ...v, invoice, type: l.type, amount } }));
    if (!ok) return;
    toast(editing ? 'Line updated' : 'Line added');
    m.close();
    onSaved();
  });
  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete "${l.description}" (${taka(l.amount)}) from invoice ${invoice}?`))) return;
    const ok = await submitting(form, () => call('deleteInvoiceLine', { id: l.id }));
    if (!ok) return;
    toast('Line deleted');
    m.close();
    onSaved();
  });
}

function openCategory(cat, from, to) {
  openModal({
    title: `${cat.name} · ${range(from, to)}`,
    wide: true,
    body: `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount (৳)</th></tr></thead>
        <tbody>${cat.entries.map(e => `
          <tr>
            <td class="nowrap"><a href="#/day/${e.date}" data-close>${esc(short(e.date))}</a></td>
            <td>${esc(e.description)}</td>
            <td>${esc(methodLabel(e.method))}</td>
            <td class="num">${fmt(e.amount)}</td>
          </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total (${cat.entries.length} entries)</td><td class="num">${fmt(cat.total)}</td></tr></tfoot>
      </table></div>`,
  });
}
