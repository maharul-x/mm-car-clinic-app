import { call } from '../api.js';
import { can, categories, methodLabel, methods } from '../state.js';
import { confirmDialog, esc, fmt, formError, loading, openModal, options, prettyDate, submitting, sum, taka, toast, todayISO } from '../util.js';
import { loadHistory } from './history.js';

const UNITS = ['pcs', 'set', 'litre', 'can', 'box', 'kg', 'metre', 'pair'];
const MOVE_LABEL = { IN: 'Stock in', OUT: 'Stock out', ADJUST: 'Adjustment' };

export async function renderInventory(view) {
  view.innerHTML = loading();
  const items = (await call('inventory')).filter(i => i.active).sort((a, b) => a.name.localeCompare(b.name));
  const refresh = () => renderInventory(view);
  const edit = can('inventory', 'edit');
  const status = i => (i.qty <= 0 ? 'out' : i.qty <= i.reorderLevel ? 'low' : 'ok');
  const low = items.filter(i => status(i) !== 'ok');
  const stockValue = sum(items.map(i => Math.max(i.qty, 0) * i.costPrice));

  view.innerHTML = `
    <section class="page inventory">
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search name, SKU or category" aria-label="Search items">
        <div class="toolbar-actions">
          ${edit ? '<button class="btn primary" id="new">+ New item</button>' : '<span class="chip">View only</span>'}
        </div>
      </div>
      <h1 class="page-title">Inventory</h1>
      <div class="cards">
        <div class="card"><span>Items</span><strong>${items.length}</strong></div>
        <div class="card total"><span>Stock value (at cost)</span><strong>${taka(stockValue)}</strong></div>
        <div class="card ${low.length ? 'out' : ''}"><span>Low or out of stock</span><strong>${low.length}</strong>
          ${low.length ? `<small>${esc(low.slice(0, 3).map(i => i.name).join(', '))}${low.length > 3 ? '…' : ''}</small>` : ''}</div>
      </div>
      <div class="panel">
        ${items.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr>
              <th>Item</th><th>Category</th><th class="num">In stock</th><th class="num">Cost</th><th class="num">Sale</th><th>Status</th><th><span class="sr">Actions</span></th>
            </tr></thead>
            <tbody id="rows"></tbody>
          </table></div>
          <p class="empty" id="none" hidden>No items match your search.</p>`
        : '<p class="empty">No items yet. Add your first part or consumable with “New item”.</p>'}
      </div>
    </section>`;

  const tbody = view.querySelector('#rows');
  const draw = q => {
    if (!tbody) return;
    const needle = q.trim().toLowerCase();
    const shown = items.filter(i => !needle || `${i.name} ${i.sku} ${i.category}`.toLowerCase().includes(needle));
    view.querySelector('#none').hidden = shown.length > 0;
    tbody.innerHTML = shown.map(i => {
      const st = status(i);
      return `
        <tr>
          <td><strong>${esc(i.name)}</strong>${i.sku ? `<small class="muted block">${esc(i.sku)}</small>` : ''}</td>
          <td>${esc(i.category)}</td>
          <td class="num"><strong>${fmt(i.qty)}</strong> ${esc(i.unit)}<small class="muted block">reorder at ${fmt(i.reorderLevel)}</small></td>
          <td class="num">${fmt(i.costPrice)}</td>
          <td class="num">${fmt(i.salePrice)}</td>
          <td><span class="status ${st}">${st === 'out' ? 'Out of stock' : st === 'low' ? 'Low' : 'OK'}</span></td>
          <td class="row-actions">
            ${edit ? `<button class="btn small in" data-move="IN" data-id="${esc(i.id)}">In</button>
            <button class="btn small out" data-move="OUT" data-id="${esc(i.id)}">Out</button>` : ''}
            <button class="link" data-history="${esc(i.id)}">History</button>
            ${edit ? `<button class="link" data-edit="${esc(i.id)}">Edit</button>` : ''}
          </td>
        </tr>`;
    }).join('');
  };
  draw('');
  view.querySelector('#q').oninput = e => draw(e.target.value);
  view.querySelector('#new')?.addEventListener('click', () => openItemForm({ items, onSaved: refresh }));

  const byId = new Map(items.map(i => [i.id, i]));
  view.onclick = e => {
    const b = e.target.closest('[data-move], [data-history], [data-edit]');
    if (!b) return;
    if (b.dataset.move) openMoveForm({ item: byId.get(b.dataset.id), type: b.dataset.move, onSaved: refresh });
    else if (b.dataset.history) openHistory({ item: byId.get(b.dataset.history), onChanged: refresh, edit });
    else openItemForm({ item: byId.get(b.dataset.edit), items, onSaved: refresh });
  };
}

function openItemForm({ item, items, onSaved }) {
  const editing = !!item;
  const it = item || { unit: 'pcs', costPrice: '', salePrice: '', reorderLevel: '' };
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
  const m = openModal({
    title: editing ? `Edit ${it.name}` : 'New item',
    body: `
      <form class="form" novalidate>
        <label>Name<input name="name" required maxlength="120" value="${esc(it.name || '')}" placeholder="e.g. Engine oil 5W-30 (4 L)"></label>
        <div class="grid2">
          <label>SKU / part no. (optional)<input name="sku" maxlength="40" value="${esc(it.sku || '')}"></label>
          <label>Category<input name="category" maxlength="60" list="item-cats" value="${esc(it.category || '')}" placeholder="e.g. Filters"></label>
        </div>
        <datalist id="item-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="grid3">
          <label>Unit<select name="unit">${options([...new Set([...UNITS, it.unit])], it.unit)}</select></label>
          <label>Cost price (৳)<input name="costPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(it.costPrice)}"></label>
          <label>Sale price (৳)<input name="salePrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(it.salePrice)}"></label>
        </div>
        <div class="grid2">
          <label>Reorder when stock is at or below<input name="reorderLevel" type="number" min="0" step="any" value="${esc(it.reorderLevel)}"></label>
          ${editing ? '' : '<label>Stock you have now<input name="openingQty" type="number" min="0" step="any" placeholder="0"></label>'}
        </div>
        <p class="form-error" hidden></p>
        <div class="actions">
          ${editing ? '<button type="button" class="btn danger ghost" data-delete>Delete item</button>' : ''}
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    if (!v.name.trim()) return formError(form, 'Enter the item name.');
    const { openingQty, ...fields } = v;
    const ok = await submitting(form, () => call('saveItem', { item: { ...it, ...fields }, openingQty }));
    if (!ok) return;
    toast(editing ? 'Item updated' : 'Item added');
    m.close();
    onSaved();
  });
  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${it.name}? If it has stock history it will be archived instead, so the history is kept.`))) return;
    try {
      const res = await call('deleteItem', { id: it.id });
      toast(res.archived ? 'Item archived' : 'Item deleted');
      m.close();
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openMoveForm({ item, type, onSaved }) {
  const ms = methods();
  const cashType = type === 'IN' ? 'OUT' : 'IN';
  const cats = categories(cashType);
  const defaultCat = type === 'IN' ? (cats.find(c => /parts/i.test(c)) || cats[0]) : (cats.find(c => /customer/i.test(c)) || cats[0]);
  const m = openModal({
    title: `${MOVE_LABEL[type]}: ${item.name}`,
    body: `
      <form class="form" novalidate>
        <p class="muted">In stock now: <strong>${fmt(item.qty)} ${esc(item.unit)}</strong></p>
        <div class="grid2">
          <label>Date<input type="date" name="date" required value="${todayISO()}"></label>
          <label>Type<select name="type">${options(Object.keys(MOVE_LABEL), type, k => MOVE_LABEL[k])}</select></label>
        </div>
        <div class="grid2">
          <label><span data-qty-label>Quantity (${esc(item.unit)})</span><input name="qty" type="number" step="any" inputmode="decimal" required autofocus></label>
          <label>Unit price (৳)<input name="unitPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${type === 'IN' ? item.costPrice : item.salePrice}"></label>
        </div>
        <div class="grid2">
          <label>Invoice / reference (optional)<input name="reference" maxlength="60"></label>
          <label>Note (optional)<input name="note" maxlength="300" placeholder="${type === 'IN' ? 'Supplier' : 'Customer / car'}"></label>
        </div>
        <fieldset class="cash-link">
          <label class="check"><input type="checkbox" name="cash"> <span data-cash-label></span></label>
          <div class="grid2" data-cash-fields hidden>
            <label>Account<select name="method">${options(ms, ms[0], methodLabel)}</select></label>
            <label>Category<select name="category">${options(cats, defaultCat)}</select></label>
          </div>
        </fieldset>
        <p class="form-error" hidden></p>
        <div class="actions"><button type="submit" class="btn primary">Save</button></div>
      </form>`,
  });
  const form = m.el.querySelector('form');
  const els = form.elements;
  const sync = () => {
    const t = els.type.value;
    const adjust = t === 'ADJUST';
    form.querySelector('[data-qty-label]').textContent = adjust ? `Change (+ add / − remove, ${item.unit})` : `Quantity (${item.unit})`;
    form.querySelector('.cash-link').hidden = adjust;
    form.querySelector('[data-cash-label]').textContent = t === 'IN'
      ? 'Also record the payment as cash out in the cash book'
      : 'Also record the money received as cash in';
    form.querySelector('[data-cash-fields]').hidden = !els.cash.checked;
    const cashCats = categories(t === 'IN' ? 'OUT' : 'IN');
    if (!adjust) els.category.innerHTML = options(cashCats, cashCats.find(c => (t === 'IN' ? /parts/i : /customer/i).test(c)) || cashCats[0]);
  };
  els.type.onchange = () => {
    els.unitPrice.value = els.type.value === 'OUT' ? item.salePrice : item.costPrice;
    sync();
  };
  els.cash.onchange = () => { form.querySelector('[data-cash-fields]').hidden = !els.cash.checked; };
  sync();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const qty = Number(v.qty);
    if (v.type === 'ADJUST' ? !qty : !(qty > 0)) return formError(form, 'Enter a quantity.');
    if (v.type === 'OUT' && qty > item.qty && !(await confirmDialog(`Only ${fmt(item.qty)} ${item.unit} in stock. Record ${fmt(qty)} going out anyway?`, { okLabel: 'Record anyway', danger: false }))) return;
    const move = { date: v.date, itemId: item.id, type: v.type, qty, unitPrice: Number(v.unitPrice) || 0, reference: v.reference, note: v.note };
    const cash = v.cash && v.type !== 'ADJUST' ? { method: v.method, category: v.category } : null;
    const ok = await submitting(form, () => call('addMove', { move, cash }));
    if (!ok) return;
    toast(cash ? 'Stock and cash book updated' : 'Stock updated');
    m.close();
    onSaved();
  });
}

async function openHistory({ item, onChanged, edit }) {
  const m = openModal({
    title: `History: ${item.name}`,
    wide: true,
    body: `<div class="moves">${loading()}</div>
      <details class="history-box"><summary>All changes to this item</summary><div class="h-body"></div></details>`,
  });
  const body = m.el.querySelector('.moves');
  const box = m.el.querySelector('.history-box');
  box.addEventListener('toggle', () => {
    if (box.open && !box.dataset.loaded) {
      box.dataset.loaded = '1';
      loadHistory(box.querySelector('.h-body'), 'Inventory', item.id);
    }
  });
  const draw = async () => {
    const moves = await call('moves', { itemId: item.id });
    body.innerHTML = moves.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Type</th><th class="num">Qty</th><th class="num">Unit price</th><th>Reference / note</th><th>By</th><th><span class="sr">Actions</span></th></tr></thead>
        <tbody>${moves.map(mv => `
          <tr>
            <td class="nowrap">${esc(prettyDate(mv.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
            <td>${MOVE_LABEL[mv.type] || esc(mv.type)}${mv.txnId ? ' <span class="chip">in cash book</span>' : ''}</td>
            <td class="num">${mv.type === 'OUT' ? '−' : mv.qty > 0 ? '+' : ''}${fmt(mv.qty)}</td>
            <td class="num">${fmt(mv.unitPrice)}</td>
            <td>${esc([mv.reference, mv.note].filter(Boolean).join(' · '))}</td>
            <td class="muted">${esc(mv.createdBy || '—')}</td>
            <td class="row-actions">${edit ? `<button class="link danger" data-del-move="${esc(mv.id)}">Delete</button>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No stock movements yet.</p>';
  };
  try {
    await draw();
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
  body.onclick = async e => {
    const b = e.target.closest('[data-del-move]');
    if (!b) return;
    if (!(await confirmDialog('Delete this stock movement? If it was also recorded in the cash book, that entry is deleted too.'))) return;
    try {
      await call('deleteMove', { id: b.dataset.delMove });
      toast('Movement deleted');
      await draw();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
