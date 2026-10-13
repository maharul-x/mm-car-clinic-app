import { call } from '../api.js';
import { can, methodLabel } from '../state.js';
import { addMonths, esc, fmt, formError, isISO, lastDayOfMonth, loading, openModal, prettyDate, submitting, taka, toast, todayISO } from '../util.js';
import { loadHistory } from './history.js';

const short = d => prettyDate(d, { day: 'numeric', month: 'short' });
const range = (from, to) => `${prettyDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${prettyDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
const signed = n => (n < 0 ? `−${taka(Math.abs(n))}` : taka(n));

/**
 * Profit: per-invoice sell/cost from the cash book (with manual overrides), operating expenses by category,
 * and net profit for a date range. #/profit = this month, #/profit/<from>/<to> = any range.
 */
export async function renderProfit(view, a, b) {
  const thisMonth = todayISO().slice(0, 7);
  const lastMonth = addMonths(thisMonth, -1);
  const presets = {
    this: [`${thisMonth}-01`, lastDayOfMonth(thisMonth)],
    last: [`${lastMonth}-01`, lastDayOfMonth(lastMonth)],
  };
  const [from, to] = isISO(a) && isISO(b) && a <= b ? [a, b] : presets.this;
  const preset = from === presets.this[0] && to === presets.this[1] ? 'this'
    : from === presets.last[0] && to === presets.last[1] ? 'last' : 'custom';
  const refresh = () => renderProfit(view, from, to);

  view.innerHTML = loading();
  const d = await call('profit', { from, to });
  const t = d.totals;
  const edited = d.invoices.filter(i => i.sellEdited || i.costEdited).length;

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
                <td class="num">${fmt(i.sell)}${i.sellEdited ? ' <span class="chip edited">edited</span>' : ''}</td>
                <td class="num">${fmt(i.cost)}${i.costEdited ? ' <span class="chip edited">edited</span>' : ''}</td>
                <td class="num ${i.gross < 0 ? 'neg' : ''}"><strong>${signed(i.gross).replace('৳', '')}</strong></td>
              </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(t.sell)}</td><td class="num">${fmt(t.cost)}</td><td class="num ${t.gross < 0 ? 'neg' : ''}">${signed(t.gross).replace('৳', '')}</td></tr></tfoot>
          </table></div>
          <p class="empty" id="inv-none" hidden>No invoices match your search.</p>`
        : '<p class="empty">No invoices in this period. An invoice appears here when a cash-in or cash-out entry has its invoice number.</p>'}
        <p class="muted small">An invoice is listed in the period of its first entry. Its sell and cost prices include every payment for that invoice, on any date.
          ${edited ? `${edited} invoice${edited === 1 ? ' has' : 's have'} a manually edited price.` : ''}</p>
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
}

function card(label, value, kind = '', sub = '', negative = false) {
  return `<div class="card ${kind}"><span>${label}</span><strong class="${negative ? 'neg' : ''}">${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function priceField(name, label, auto, value, isEdited, countLabel, edit) {
  return `
    <div class="price-field">
      <label>${label} (৳)
        <input name="${name}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value)}" ${edit ? '' : 'disabled'}>
      </label>
      <p class="muted small">
        Calculated: <strong>${taka(auto)}</strong> from ${esc(countLabel)}
        ${isEdited ? `<span class="chip edited">edited</span>${edit ? ` <button type="button" class="link" data-reset="${name}">Reset to auto</button>` : ''}` : ''}
      </p>
    </div>`;
}

function openInvoice({ inv, onSaved }) {
  const edit = can('profit', 'edit');
  const ins = inv.entries.filter(e => e.type === 'IN');
  const outs = inv.entries.filter(e => e.type === 'OUT');
  const entries = (n, kind) => `${n} ${kind} ${n === 1 ? 'entry' : 'entries'}`;
  const m = openModal({
    title: `Invoice ${inv.invoice}`,
    wide: true,
    body: `
      <p class="muted">${esc(inv.customer || 'No cash in yet')} · ${esc(short(inv.firstDate))}${inv.lastDate !== inv.firstDate ? ` – ${esc(short(inv.lastDate))}` : ''}
        ${inv.editedBy ? ` · price edited by <strong>${esc(inv.editedBy)}</strong>` : ''}</p>
      <form class="form" novalidate>
        <div class="grid2">
          ${priceField('sell', 'Sell price', inv.sellAuto, inv.sell, inv.sellEdited, entries(ins.length, 'cash-in'), edit)}
          ${priceField('cost', 'Cost price', inv.costAuto, inv.cost, inv.costEdited, entries(outs.length, 'cash-out'), edit)}
        </div>
        <p class="gross-line">Gross profit: <strong class="${inv.gross < 0 ? 'neg' : ''}" data-gross>${signed(inv.gross)}</strong></p>
        <p class="form-error" hidden></p>
        ${edit ? `<div class="actions"><span class="muted small">Change a price to override the calculated value. It stays until you reset it.</span><span class="spacer"></span><button class="btn primary">Save</button></div>` : '<p class="muted small">You can view this invoice but not change its prices.</p>'}
      </form>
      <h3 class="sub-title">Entries for this invoice</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Account</th><th class="num">Amount (৳)</th></tr></thead>
        <tbody>${inv.entries.map(e => `
          <tr>
            <td class="nowrap"><a href="#/day/${e.date}" data-close>${esc(short(e.date))}</a></td>
            <td>${e.type === 'IN' ? 'Cash in' : 'Cash out'}</td>
            <td>${esc(e.description)}${e.type === 'OUT' && e.category ? ` <span class="chip">${esc(e.category)}</span>` : ''}</td>
            <td>${esc(methodLabel(e.method))}</td>
            <td class="num ${e.type === 'OUT' ? '' : 'pos'}">${e.type === 'OUT' ? '−' : '+'}${fmt(e.amount)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <details class="history-box"><summary>Price change history</summary><div class="h-body"></div></details>`,
  });
  const form = m.el.querySelector('form');
  const box = m.el.querySelector('.history-box');
  box.addEventListener('toggle', () => {
    if (box.open && !box.dataset.loaded) {
      box.dataset.loaded = '1';
      loadHistory(box.querySelector('.h-body'), 'Invoices', inv.key);
    }
  });
  if (!edit) return;

  const grossEl = form.querySelector('[data-gross]');
  form.oninput = () => {
    const s = Number(form.elements.sell.value || inv.sellAuto);
    const c = Number(form.elements.cost.value || inv.costAuto);
    grossEl.textContent = signed(s - c);
    grossEl.classList.toggle('neg', s - c < 0);
  };
  const save = async payload => {
    const ok = await submitting(form, () => call('saveInvoiceOverride', { invoice: inv.key, ...payload }));
    if (!ok) return;
    m.close();
    onSaved();
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    // A field left empty, or equal to the calculated value while not overridden, stays automatic.
    const value = (name, auto, wasEdited) => {
      const raw = form.elements[name].value.trim();
      if (raw === '') return null;
      const n = Number(raw);
      return !wasEdited && n === auto ? null : n;
    };
    const sell = value('sell', inv.sellAuto, inv.sellEdited);
    const cost = value('cost', inv.costAuto, inv.costEdited);
    if ((sell !== null && !(sell >= 0)) || (cost !== null && !(cost >= 0))) return formError(form, 'Prices cannot be negative.');
    await save({ sell, cost });
    toast('Invoice prices saved');
  });
  form.querySelectorAll('[data-reset]').forEach(btn => {
    btn.onclick = async () => {
      await save({ [btn.dataset.reset]: null });
      toast(`${btn.dataset.reset === 'sell' ? 'Sell' : 'Cost'} price back to automatic`);
    };
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
