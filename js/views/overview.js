import { call } from '../api.js';
import { can, methodLabel, methods, state } from '../state.js';
import { addDays, applyTxn, esc, fmt, loading, prettyDate, sum, taka, todayISO } from '../util.js';
import { available, runShortcut, modKey } from '../shortcuts.js';

const DAYS = 14;

/** Overview: a Bento grid of the numbers you check every day. */
export async function renderOverview(view) {
  view.innerHTML = loading();
  const today = todayISO();
  const month = today.slice(0, 7);
  const from = [addDays(today, -(DAYS - 1)), `${month}-01`].sort()[0];

  // Only ask for what this user is allowed to see.
  const seeCash = can(['cash', 'report']);
  const skip = Promise.resolve(null);
  const [cash, stock, salary] = await Promise.allSettled([
    seeCash ? call('range', { from, to: today }) : skip,
    can('inventory') ? call('inventory') : skip,
    can('attendance') ? call('salaryMonth', { month }) : skip,
  ]);
  if (cash.status === 'rejected') throw cash.reason;
  const { opening, txns } = cash.value || { opening: {}, txns: [] };
  const syncedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // Balance at the start of the 14-day window, then walk forward one day at a time.
  const chartFrom = addDays(today, -(DAYS - 1));
  const bal = { ...opening };
  txns.filter(t => t.date < chartFrom).forEach(t => applyTxn(bal, t));
  const series = [];
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(chartFrom, i);
    const rows = txns.filter(t => t.date === d);
    rows.forEach(t => applyTxn(bal, t));
    series.push({
      date: d,
      in: sum(rows.filter(t => t.type === 'IN').map(t => t.amount)),
      out: sum(rows.filter(t => t.type === 'OUT').map(t => t.amount)),
      closing: sum(Object.values(bal)),
    });
  }
  const closing = bal;
  const total = sum(Object.values(closing));
  const net14 = sum(series.map(s => s.in - s.out));
  const todayRow = series[series.length - 1];

  // Checklist inputs
  const todaysEntries = txns.filter(t => t.date === today);
  const uncategorized = txns.filter(t => t.date >= `${month}-01` && t.type !== 'TRANSFER' && (!t.category || t.category === 'Uncategorized'));
  const items = stock.status === 'fulfilled' && stock.value ? stock.value.filter(i => i.active) : null;
  const low = items ? items.filter(i => i.qty <= i.reorderLevel) : [];
  let staff = null;
  let marked = 0;
  if (salary.status === 'fulfilled' && salary.value) {
    staff = salary.value.employees.filter(e => e.active && e.trackAttendance);
    marked = staff.filter(e => salary.value.attendance.some(a => a.employeeId === e.id && a.date === today)).length;
  }
  const isFriday = new Date().getDay() === 5;
  const checks = [
    can('cash') && { done: todaysEntries.length > 0, label: 'Cash book updated today', meta: `${todaysEntries.length} entr${todaysEntries.length === 1 ? 'y' : 'ies'}`, href: `#/day/${today}` },
    staff && { done: isFriday || (staff.length > 0 && marked === staff.length), label: 'Attendance marked', meta: isFriday ? 'Friday · off' : `${marked} of ${staff.length} staff`, href: '#/salary/attendance' },
    can('report') && { done: uncategorized.length === 0, label: 'Every entry has a category', meta: uncategorized.length ? `${uncategorized.length} uncategorized` : 'This month', href: `#/month/${month}` },
    items && { done: low.length === 0, label: 'Stock above reorder level', meta: low.length ? `${low.length} item${low.length === 1 ? '' : 's'} low` : `${items.length} items`, href: '#/inventory' },
  ].filter(Boolean);
  const doneCount = checks.filter(c => c.done).length;

  const recent = [...txns].filter(t => t.type !== 'TRANSFER')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  view.innerHTML = `
    <section class="page overview">
      <header class="page-head">
        <p class="eyebrow">Overview · ${esc(state.user?.name || '')}</p>
        <h1 class="page-title">${esc(prettyDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))}</h1>
      </header>

      <div class="bento">
        ${seeCash ? `
        <article class="tile wide">
          <div class="term-bar">
            <span class="dot-live" aria-hidden="true"></span>
            <code>sheets://Transactions</code>
            <span class="term-meta">synced ${esc(syncedAt)} · ${txns.length} rows</span>
          </div>
          <div class="tile-head">
            <p class="eyebrow">Cash flow · last ${DAYS} days</p>
            <h2 class="tile-title">${net14 < 0 ? '−' : '+'}${taka(Math.abs(net14))} <span class="muted">net</span></h2>
            <p class="tile-desc">Money received vs money spent each day. Hover a day for details; click it to open the ledger.</p>
          </div>
          <div class="legend-row">
            <span><i class="key" style="background:var(--series-in)"></i>Cash in ${taka(sum(series.map(s => s.in)))}</span>
            <span><i class="key" style="background:var(--series-out)"></i>Cash out ${taka(sum(series.map(s => s.out)))}</span>
            <button class="link" id="as-table" aria-expanded="false">View as table</button>
          </div>
          <div class="chart" id="chart">${chartSVG(series)}</div>
          <div class="chart-tip" id="tip" hidden></div>
          <div class="table-wrap" id="chart-table" hidden>${chartTable(series)}</div>
        </article>

        <article class="tile">
          <div class="tile-head">
            <p class="eyebrow">Cash position <span class="badge"><span class="dot-live" aria-hidden="true"></span>Live</span></p>
            <h2 class="tile-title big">${taka(total)}</h2>
            <p class="tile-desc">Closing balance across all accounts today.
              Today: <span class="pos">+${fmt(todayRow.in)}</span> / <span class="neg">−${fmt(todayRow.out)}</span></p>
          </div>
          <ul class="meters">
            ${methods().map(m => {
              const v = closing[m] || 0;
              const pct = total > 0 ? Math.max(0, (v / total) * 100) : 0;
              return `
                <li>
                  <div class="meter-row"><span>${esc(methodLabel(m))}</span><strong class="${v < 0 ? 'neg' : ''}">${taka(v)}</strong></div>
                  <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}" aria-label="${esc(methodLabel(m))} share">
                    <span style="width:${pct.toFixed(1)}%"></span>
                  </div>
                  <small>${pct.toFixed(0)}% of total</small>
                </li>`;
            }).join('')}
          </ul>
        </article>` : ''}

        <article class="tile">
          <div class="tile-head">
            <p class="eyebrow">Shortcuts</p>
            <h2 class="tile-title">Work from the keyboard</h2>
            <p class="tile-desc">Press a key anywhere in the app. Not while typing in a field.</p>
          </div>
          <ul class="kbd-list">
            ${available().filter(s => s.showOnOverview).map(s => `
              <li><button type="button" data-shortcut="${esc(s.id)}">
                <span>${esc(s.label)}</span>
                <span class="keys">${s.keys.map(k => `<kbd>${esc(k === 'Mod' ? modKey() : k)}</kbd>`).join('')}</span>
              </button></li>`).join('')}
          </ul>
        </article>

        ${checks.length ? `
        <article class="tile">
          <div class="tile-head">
            <p class="eyebrow">Today · ${doneCount}/${checks.length} done</p>
            <h2 class="tile-title">Daily checklist</h2>
          </div>
          <ul class="checklist">
            ${checks.map(c => `
              <li class="${c.done ? 'done' : ''}">
                <a href="${c.href}">
                  <span class="tick" aria-hidden="true">${c.done ? '<svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>' : ''}</span>
                  <span class="tick-label">${esc(c.label)}<span class="sr">${c.done ? ' (done)' : ' (to do)'}</span></span>
                  <span class="tick-meta">${esc(c.meta)}</span>
                </a>
              </li>`).join('')}
          </ul>
        </article>` : ''}

        ${seeCash ? `
        <article class="tile">
          <div class="tile-head">
            <p class="eyebrow">Activity</p>
            <h2 class="tile-title">Latest entries</h2>
          </div>
          ${recent.length ? `<ul class="feed">${recent.map(t => `
            <li>
              <a href="#/day/${t.date}">
                <span class="feed-dot ${t.type === 'IN' ? 'in' : 'out'}" aria-hidden="true"></span>
                <span class="feed-main"><span class="feed-title">${esc(t.description)}</span>
                  <span class="feed-meta">${esc(t.category)} · ${esc(prettyDate(t.date, { day: 'numeric', month: 'short' }))}${t.createdBy ? ` · ${esc(t.createdBy)}` : ''}</span></span>
                <span class="feed-amt ${t.type === 'IN' ? 'pos' : ''}">${t.type === 'IN' ? '+' : '−'}${fmt(t.amount)}</span>
              </a>
            </li>`).join('')}</ul>` : '<p class="empty">No entries yet.</p>'}
        </article>` : ''}
      </div>
    </section>`;

  if (seeCash) wireChart(view, series);
  view.onclick = e => {
    const b = e.target.closest('[data-shortcut]');
    if (b) runShortcut(b.dataset.shortcut);
  };
}

// ───────────── Chart: grouped columns, one baseline, hover tooltip ─────────────

const W = 640, H = 200, PAD_L = 44, PAD_B = 22, PAD_T = 8;

function niceMax(v) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
}

function chartSVG(series) {
  const max = niceMax(Math.max(...series.flatMap(s => [s.in, s.out])));
  const plotW = W - PAD_L, plotH = H - PAD_B - PAD_T;
  const slot = plotW / series.length;
  const bw = Math.min(12, (slot - 8) / 2);
  const y = v => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  // Column with a 4px rounded top and a square base on the baseline.
  const col = (x, v, cls) => {
    if (v <= 0) return '';
    const top = y(v), h = PAD_T + plotH - top, r = Math.min(4, h, bw / 2);
    return `<path class="${cls}" d="M${x},${PAD_T + plotH}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${PAD_T + plotH}Z"/>`;
  };
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily cash in and cash out for the last ${series.length} days">
      ${ticks.map(t => `
        <line class="grid" x1="${PAD_L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${PAD_L - 8}" y="${y(t) + 4}" text-anchor="end">${t >= 1000 ? `${fmt(t / 1000)}k` : fmt(t)}</text>`).join('')}
      ${series.map((s, i) => {
        const x0 = PAD_L + i * slot + (slot - (bw * 2 + 2)) / 2;
        const label = i % 2 === series.length % 2 || i === series.length - 1;
        return `
          <g class="day" data-i="${i}">
            <rect class="hit" x="${PAD_L + i * slot}" y="0" width="${slot}" height="${H}"/>
            ${col(x0, s.in, 'bar-in')}${col(x0 + bw + 2, s.out, 'bar-out')}
            ${label ? `<text class="axis" x="${PAD_L + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${Number(s.date.slice(8))}</text>` : ''}
          </g>`;
      }).join('')}
    </svg>`;
}

function chartTable(series) {
  return `<table class="table">
    <thead><tr><th>Date</th><th class="num">Cash in</th><th class="num">Cash out</th><th class="num">Closing</th></tr></thead>
    <tbody>${series.map(s => `<tr><td>${esc(prettyDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
      <td class="num">${fmt(s.in)}</td><td class="num">${fmt(s.out)}</td><td class="num">${fmt(s.closing)}</td></tr>`).join('')}</tbody>
  </table>`;
}

function wireChart(view, series) {
  const chart = view.querySelector('#chart');
  const tip = view.querySelector('#tip');
  const show = g => {
    chart.querySelectorAll('.day.active').forEach(x => x.classList.remove('active'));
    if (!g) {
      tip.hidden = true;
      return;
    }
    g.classList.add('active');
    const s = series[Number(g.dataset.i)];
    tip.innerHTML = `
      <strong>${esc(prettyDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</strong>
      <span><i class="key" style="background:var(--series-in)"></i>In<b>${fmt(s.in)}</b></span>
      <span><i class="key" style="background:var(--series-out)"></i>Out<b>${fmt(s.out)}</b></span>
      <span class="muted">Closing<b>${fmt(s.closing)}</b></span>`;
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const r = g.querySelector('.hit').getBoundingClientRect();
    const left = Math.min(Math.max(r.left - box.left + r.width / 2, 70), box.width - 70);
    tip.style.left = `${left}px`;
  };
  chart.onmousemove = e => show(e.target.closest('.day'));
  chart.onmouseleave = () => show(null);
  chart.onclick = e => {
    const g = e.target.closest('.day');
    if (g) location.hash = `#/day/${series[Number(g.dataset.i)].date}`;
  };
  const btn = view.querySelector('#as-table');
  btn.onclick = () => {
    const t = view.querySelector('#chart-table');
    t.hidden = !t.hidden;
    btn.setAttribute('aria-expanded', String(!t.hidden));
    btn.textContent = t.hidden ? 'View as table' : 'Hide table';
  };
}
