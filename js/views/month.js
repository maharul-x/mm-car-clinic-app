import { call } from '../api.js';
import { methodLabel, methods } from '../state.js';
import {
  addMonths, applyTxn, downloadCSV, esc, fmt, groupBy, isMonth, lastDayOfMonth, loading,
  openModal, prettyDate, prettyMonth, sum, taka, todayISO,
} from '../util.js';

export async function renderMonth(view, arg) {
  const ym = isMonth(arg) ? arg : todayISO().slice(0, 7);
  const from = `${ym}-01`;
  const to = lastDayOfMonth(ym);
  view.innerHTML = loading();
  const { opening, txns } = await call('range', { from, to });
  const ms = methods();

  const ins = txns.filter(t => t.type === 'IN');
  const outs = txns.filter(t => t.type === 'OUT');
  const totalIn = sum(ins.map(t => t.amount));
  const totalOut = sum(outs.map(t => t.amount));
  const openTotal = sum(Object.values(opening));
  const closing = { ...opening };
  txns.forEach(t => applyTxn(closing, t));

  const byCategory = list => [...groupBy(list, t => t.category || 'Uncategorized')]
    .map(([name, rows]) => ({ name, rows, total: sum(rows.map(t => t.amount)) }))
    .sort((a, b) => b.total - a.total);
  const outCats = byCategory(outs);
  const inCats = byCategory(ins);

  const running = { ...opening };
  const days = [...groupBy(txns, 'date')].map(([date, rows]) => {
    rows.forEach(t => applyTxn(running, t));
    const dayIn = sum(rows.filter(t => t.type === 'IN').map(t => t.amount));
    const dayOut = sum(rows.filter(t => t.type === 'OUT').map(t => t.amount));
    return { date, dayIn, dayOut, closing: sum(Object.values(running)) };
  });

  view.innerHTML = `
    <section class="page month">
      <div class="toolbar">
        <div class="datenav">
          <a class="btn icon" href="#/month/${addMonths(ym, -1)}" aria-label="Previous month">‹</a>
          <input type="month" id="pick" value="${ym}" aria-label="Choose month">
          <a class="btn icon" href="#/month/${addMonths(ym, 1)}" aria-label="Next month">›</a>
        </div>
        <div class="toolbar-actions">
          <button class="btn ghost" id="csv" ${txns.length ? '' : 'disabled'}>Download CSV</button>
          <button class="btn ghost" id="print">Print</button>
        </div>
      </div>

      <h1 class="page-title">${esc(prettyMonth(ym))}</h1>

      <div class="cards">
        ${card('Opening balance', openTotal)}
        ${card('Cash in', totalIn, 'in')}
        ${card('Cash out', totalOut, 'out')}
        ${card('Closing balance', openTotal + totalIn - totalOut, 'total', `Net ${totalIn - totalOut < 0 ? '−' : '+'}${taka(Math.abs(totalIn - totalOut))}`)}
      </div>

      <div class="two-col">
        <div class="panel">
          <h2>Expenses by category</h2>
          ${bars(outCats, totalOut, 'out')}
        </div>
        <div class="panel">
          <h2>Income by category</h2>
          ${bars(inCats, totalIn, 'in')}
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <h2>Day by day</h2>
          ${days.length ? `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Date</th><th class="num">Cash in</th><th class="num">Cash out</th><th class="num">Closing</th></tr></thead>
              <tbody>${days.map(d => `
                <tr>
                  <td><a href="#/day/${d.date}">${esc(prettyDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</a></td>
                  <td class="num">${fmt(d.dayIn)}</td>
                  <td class="num">${fmt(d.dayOut)}</td>
                  <td class="num">${fmt(d.closing)}</td>
                </tr>`).join('')}</tbody>
              <tfoot><tr><td>Total</td><td class="num">${fmt(totalIn)}</td><td class="num">${fmt(totalOut)}</td><td></td></tr></tfoot>
            </table></div>`
          : '<p class="empty">No entries this month.</p>'}
        </div>
        <div class="panel">
          <h2>Month-end balance by account</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Account</th><th class="num">Opening</th><th class="num">Closing</th></tr></thead>
            <tbody>${ms.map(m => `
              <tr><td>${esc(methodLabel(m))}</td><td class="num">${fmt(opening[m])}</td><td class="num ${closing[m] < 0 ? 'neg' : ''}">${fmt(closing[m])}</td></tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    </section>`;

  view.querySelector('#pick').onchange = e => {
    if (isMonth(e.target.value)) location.hash = `#/month/${e.target.value}`;
  };
  view.querySelector('#print').onclick = () => window.print();
  view.querySelector('#csv').onclick = () => downloadCSV(`mm-cashbook-${ym}.csv`, [
    ['Date', 'Type', 'Invoice', 'Description', 'Category', 'Method', 'To', 'Amount', 'Note'],
    ...txns.map(t => [t.date, t.type, t.invoice, t.description, t.category, t.method, t.toMethod, t.amount, t.note]),
  ]);

  const groups = { in: inCats, out: outCats };
  view.onclick = e => {
    const row = e.target.closest('[data-cat]');
    if (!row) return;
    const g = groups[row.dataset.kind].find(x => x.name === row.dataset.cat);
    openModal({
      title: `${g.name} · ${prettyMonth(ym)}`,
      wide: true,
      body: `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Description</th><th>Method</th><th class="num">Amount (৳)</th></tr></thead>
          <tbody>${g.rows.map(t => `
            <tr>
              <td class="nowrap"><a href="#/day/${t.date}" data-close>${esc(prettyDate(t.date, { day: 'numeric', month: 'short' }))}</a></td>
              <td>${esc(t.description)}${t.invoice ? ` <small class="muted">${esc(t.invoice)}</small>` : ''}</td>
              <td>${esc(methodLabel(t.method))}</td>
              <td class="num">${fmt(t.amount)}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Total (${g.rows.length} entries)</td><td class="num">${fmt(g.total)}</td></tr></tfoot>
        </table></div>`,
    });
  };
}

function card(label, value, kind = '', sub = '') {
  return `<div class="card ${kind}"><span>${label}</span><strong>${taka(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function bars(groups, total, kind) {
  if (!groups.length) return '<p class="empty">Nothing recorded.</p>';
  const max = groups[0].total || 1;
  return `<ul class="bars">${groups.map(g => `
    <li>
      <button class="bar-row" data-cat="${esc(g.name)}" data-kind="${kind}" title="See all ${esc(g.name)} entries">
        <span class="bar-label">${esc(g.name)}<small>${g.rows.length}×</small></span>
        <span class="bar-track"><span class="bar ${kind}" style="width:${((g.total / max) * 100).toFixed(1)}%"></span></span>
        <span class="bar-val">${fmt(g.total)}<small>${total ? Math.round((g.total / total) * 100) : 0}%</small></span>
      </button>
    </li>`).join('')}</ul>`;
}
