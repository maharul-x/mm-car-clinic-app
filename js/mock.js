// In-browser stand-in for the Apps Script server, used by "Try the demo".
// Data lives in this browser only. The sample data is made up.

const KEY = 'mm.demo.v8';
let db = null;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const stamp = () => new Date().toISOString();
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// A few made-up working days after 1 Oct so the Overview chart has something to show.
function laterDays() {
  const out = [];
  for (let d = 2; d <= 11; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    if (new Date(2026, 9, d).getDay() === 5) continue; // Friday off
    const k = (d * 37) % 11;
    const row = (type, description, amount, method, category) =>
      ({ id: uid(), date, type, invoice: type === 'IN' ? `INV-0010${String(d).padStart(2, '0')}` : '', description, category, amount, method, toMethod: '', note: '', source: 'demo', createdAt: `${date}T10:00:00` });
    out.push(row('IN', `SAMPLE CUSTOMER ${String.fromCharCode(67 + d)}`, 4000 + k * 1500, k % 3 ? 'Cash' : 'Bank', 'Customer Payment'));
    if (k % 2) out.push(row('IN', 'SAMPLE WALK-IN SERVICE', 1500 + k * 300, 'Bkash', 'Customer Payment'));
    out.push(row('OUT', 'LUNCH (FOOD)', 550 + (k % 4) * 40, 'Cash', 'Food'));
    if (k > 4) out.push(row('OUT', 'PARTS PURCHASE', 2500 + k * 600, 'Cash', 'Parts Purchase'));
  }
  return out;
}

function seed() {
  const date = '2026-10-01';
  const t = (type, invoice, description, amount, method, category) =>
    ({ id: uid(), date, type, invoice, description, category, amount, method, toMethod: '', note: '', source: 'demo', createdAt: '2026-10-01T09:00:00' });
  const items = [
    { id: uid(), sku: 'OIL-5W30-4L', name: 'Engine oil 5W-30 (4 L)', category: 'Lubricants', unit: 'can', costPrice: 3200, salePrice: 3800, reorderLevel: 5, active: true },
    { id: uid(), sku: 'FLT-OIL-TY', name: 'Oil filter (Toyota)', category: 'Filters', unit: 'pcs', costPrice: 350, salePrice: 550, reorderLevel: 10, active: true },
    { id: uid(), sku: 'FLT-AIR-TY', name: 'Air filter (Toyota)', category: 'Filters', unit: 'pcs', costPrice: 600, salePrice: 900, reorderLevel: 5, active: true },
    { id: uid(), sku: 'BRK-PAD-F', name: 'Brake pad set (front)', category: 'Brakes', unit: 'set', costPrice: 2200, salePrice: 3000, reorderLevel: 3, active: true },
  ];
  const move = (item, type, qty, note) =>
    ({ id: uid(), date, itemId: item.id, type, qty, unitPrice: item.costPrice, reference: '', note, txnId: '', createdAt: '2026-10-01T09:00:00' });
  const emp = (name, designation, basicSalary, trackAttendance = true) =>
    ({ id: uid(), name, designation, basicSalary, phone: '', joinDate: '', trackAttendance, active: true, sortOrder: 0 });
  const employees = [
    emp('Sample Mechanic', 'Senior Mechanic', 22000),
    emp('Sample Painter', 'Paint', 18000),
    emp('Sample Helper', 'Asst. Engine Technician', 6000),
    emp('Sample Front Desk', 'CRE', 15000),
    emp('Sample Head', 'Head Of Service', 15000, false),
    emp('Sample Investor', 'Investor', 15000, false),
  ];
  employees.forEach((e, i) => { e.sortOrder = i + 1; });
  const att = (e, day, status) => ({ date: `2026-10-${String(day).padStart(2, '0')}`, employeeId: e.id, status, note: '' });
  return {
    employees,
    attendance: [
      att(employees[0], 1, 'P'), att(employees[1], 1, 'P'), att(employees[2], 1, 'A'), att(employees[3], 1, 'P'),
      att(employees[0], 3, 'A'), att(employees[2], 5, 'A'), att(employees[1], 7, 'L'),
    ],
    payments: [
      { id: uid(), date: '2026-10-05', employeeId: employees[0].id, month: '2026-10', type: 'ADVANCE', amount: 2000, method: 'Cash', note: '', txnId: '', source: 'demo' },
      { id: uid(), date: '2026-10-08', employeeId: employees[2].id, month: '2026-10', type: 'ADVANCE', amount: 1000, method: 'Cash', note: '', txnId: '', source: 'demo' },
    ],
    settings: {
      weeklyOff: 'Fri',
      businessName: 'M & M CAR CLINIC',
      address: 'BAIZID LINK ROAD, AREFIN NAGOR, NEAR SOUTHERN UNIVERSITY',
      phone: '01708-523230',
      preparedBy: 'Manager',
      methods: ['Cash', 'Bank', 'Bkash'],
      startDate: date,
      opening_Cash: 20000,
      opening_Bank: 40000,
      opening_Bkash: 2000,
    },
    categories: {
      IN: ['Customer Payment', 'Other Income'],
      OUT: ['Food', 'Salary', 'Workshop', 'Parts Purchase', 'Vendor Payment', 'Commission', 'Utility', 'Invoice', 'Rent', 'Transport', 'Other'],
    },
    txns: [
      t('IN', 'INV-001001', 'SAMPLE CUSTOMER A', 3500, 'Cash', 'Customer Payment'),
      t('IN', 'INV-001002', 'SAMPLE CUSTOMER B', 18000, 'Bank', 'Customer Payment'),
      t('IN', 'INV-001003', 'SAMPLE CUSTOMER C', 1200, 'Bkash', 'Customer Payment'),
      t('OUT', '', 'BREAKFAST (FOOD)', 200, 'Cash', 'Food'),
      t('OUT', 'PO-0501', 'PARTS SUPPLIER', 7500, 'Cash', 'Uncategorized'),
      t('OUT', '', 'CLEANING SUPPLIES (WORKSHOP)', 150, 'Cash', 'Workshop'),
      t('OUT', '', 'LUNCH (FOOD)', 600, 'Cash', 'Food'),
      t('OUT', '', 'MECHANIC 1 ADVANCE (SALARY)', 1000, 'Cash', 'Salary'),
      t('OUT', '', 'HELPER DAILY (SALARY)', 300, 'Cash', 'Salary'),
      ...laterDays(),
    ],
    items,
    moves: [
      move(items[0], 'ADJUST', 8, 'Opening stock'),
      move(items[1], 'ADJUST', 6, 'Opening stock'),
      move(items[2], 'ADJUST', 9, 'Opening stock'),
      move(items[3], 'ADJUST', 2, 'Opening stock'),
    ],
  };
}

function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db) db = seed();
  return db;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* demo still works in memory */ }
}

export function resetDemo() {
  db = seed();
  ensureAuth();
  persist();
}

function settings() {
  const s = { ...db.settings };
  s.methods.forEach(m => { s[`opening_${m}`] = Number(s[`opening_${m}`]) || 0; });
  return s;
}

function apply(bal, t) {
  if (t.type === 'IN') bal[t.method] = (bal[t.method] || 0) + t.amount;
  else if (t.type === 'OUT') bal[t.method] = (bal[t.method] || 0) - t.amount;
  else {
    bal[t.method] = (bal[t.method] || 0) - t.amount;
    bal[t.toMethod] = (bal[t.toMethod] || 0) + t.amount;
  }
}

function validateTxn(x) {
  const s = settings();
  const t = { ...x, type: String(x.type).toUpperCase(), amount: r2(x.amount), description: String(x.description || '').trim() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) throw new Error('Choose a valid date.');
  if (!(t.amount > 0)) throw new Error('Amount must be more than 0.');
  if (!s.methods.includes(t.method)) throw new Error(`Unknown payment method: ${t.method}`);
  if (t.type === 'TRANSFER') {
    if (!s.methods.includes(t.toMethod) || t.toMethod === t.method) throw new Error('Choose two different accounts for a transfer.');
    t.category = 'Transfer';
    t.description ||= `${t.method} → ${t.toMethod}`;
  } else {
    t.toMethod = '';
    if (!t.description) throw new Error('Description is required.');
    t.category ||= 'Uncategorized';
  }
  return t;
}

const find = (list, id) => {
  const i = list.findIndex(x => x.id === id);
  if (i < 0) throw new Error('That record was not found. It may have been deleted; refresh and try again.');
  return i;
};

function addTxn(txn) {
  const t = { ...validateTxn(txn), id: uid(), source: 'app', createdAt: stamp() };
  db.txns.push(t);
  return { id: t.id };
}

const handlers = {
  ping: () => ({ settings: settings() }),
  meta: () => ({ settings: settings(), categories: db.categories }),
  range: ({ from, to }) => {
    const s = settings();
    const opening = {};
    s.methods.forEach(m => { opening[m] = s[`opening_${m}`]; });
    const txns = [];
    db.txns.forEach(t => {
      if (s.startDate && t.date < s.startDate) return;
      if (t.date < from) apply(opening, t);
      else if (t.date <= to) txns.push(t);
    });
    txns.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    return { from, to, opening, txns };
  },
  addTxn: ({ txn }) => addTxn(txn),
  updateTxn: ({ txn }) => {
    const i = find(db.txns, txn.id);
    db.txns[i] = { ...db.txns[i], ...validateTxn(txn) };
    return { id: txn.id };
  },
  deleteTxn: ({ id }) => {
    db.txns.splice(find(db.txns, id), 1);
    return { deleted: true };
  },
  saveSettings: ({ settings: input }) => {
    Object.entries(input).forEach(([k, v]) => {
      if (k === 'methods') v = (Array.isArray(v) ? v : String(v).split(',')).map(x => String(x).trim()).filter(Boolean);
      else if (k.startsWith('opening_')) v = r2(v);
      db.settings[k] = v;
    });
    if (!db.settings.methods.length) throw new Error('Keep at least one payment method.');
    return settings();
  },
  saveCategories: ({ categories }) => {
    const clean = list => [...new Map((list || []).map(n => String(n).trim()).filter(Boolean).map(n => [n.toLowerCase(), n])).values()];
    const c = { IN: clean(categories.IN), OUT: clean(categories.OUT) };
    if (!c.IN.length || !c.OUT.length) throw new Error('Keep at least one cash-in and one cash-out category.');
    db.categories = c;
    return c;
  },
  inventory: () => {
    const qty = {};
    db.moves.forEach(m => { qty[m.itemId] = (qty[m.itemId] || 0) + (m.type === 'OUT' ? -m.qty : m.qty); });
    return db.items.map(i => ({ ...i, qty: r2(qty[i.id] || 0) }));
  },
  saveItem: ({ item, openingQty }) => {
    const it = {
      ...item,
      name: String(item.name || '').trim(),
      unit: item.unit || 'pcs',
      costPrice: r2(item.costPrice),
      salePrice: r2(item.salePrice),
      reorderLevel: r2(item.reorderLevel),
      active: true,
    };
    if (!it.name) throw new Error('Item name is required.');
    if (it.sku && db.items.some(x => x.sku.toLowerCase() === it.sku.toLowerCase() && x.id !== it.id)) {
      throw new Error(`Another item already uses SKU ${it.sku}.`);
    }
    if (it.id) db.items[find(db.items, it.id)] = it;
    else {
      it.id = uid();
      db.items.push(it);
      const q = r2(openingQty);
      if (q) db.moves.push({ id: uid(), date: new Date().toISOString().slice(0, 10), itemId: it.id, type: 'ADJUST', qty: q, unitPrice: it.costPrice, reference: '', note: 'Opening stock', txnId: '', createdAt: stamp() });
    }
    return it;
  },
  deleteItem: ({ id }) => {
    const i = find(db.items, id);
    if (db.moves.some(m => m.itemId === id)) {
      db.items[i].active = false;
      return { archived: true };
    }
    db.items.splice(i, 1);
    return { deleted: true };
  },
  addMove: ({ move, cash }) => {
    const item = db.items[find(db.items, move.itemId)];
    const m = { ...move, id: uid(), qty: r2(move.qty), unitPrice: r2(move.unitPrice), txnId: '', createdAt: stamp() };
    if (m.type === 'ADJUST' ? m.qty === 0 : !(m.qty > 0)) throw new Error('Enter a quantity.');
    if (cash && m.type !== 'ADJUST') {
      const amount = r2(m.qty * m.unitPrice);
      if (!(amount > 0)) throw new Error('Enter a unit price to record this in the cash book.');
      m.txnId = addTxn({
        date: m.date,
        type: m.type === 'IN' ? 'OUT' : 'IN',
        invoice: m.reference,
        description: `${item.name} × ${m.qty} ${item.unit}`,
        category: cash.category,
        amount,
        method: cash.method,
        note: m.type === 'IN' ? 'Inventory: stock in' : 'Inventory: stock out',
      }).id;
    }
    db.moves.push(m);
    return { id: m.id, txnId: m.txnId };
  },
  moves: ({ itemId }) =>
    db.moves
      .filter(m => !itemId || m.itemId === itemId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  deleteMove: ({ id }) => {
    const [m] = db.moves.splice(find(db.moves, id), 1);
    const ti = db.txns.findIndex(t => t.id === m.txnId);
    if (ti >= 0) db.txns.splice(ti, 1);
    return { deleted: true };
  },
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

Object.assign(handlers, {
  employees: () => [...db.employees].sort((a, b) => a.sortOrder - b.sortOrder),
  saveEmployee: ({ employee }) => {
    const e = { ...employee, name: String(employee.name || '').trim(), basicSalary: r2(employee.basicSalary), active: employee.active !== false, trackAttendance: employee.trackAttendance !== false };
    if (!e.name) throw new Error('Employee name is required.');
    if (e.id) {
      const i = find(db.employees, e.id);
      db.employees[i] = { ...db.employees[i], ...e };
    } else {
      e.id = uid();
      e.sortOrder = db.employees.reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1;
      db.employees.push(e);
    }
    return e;
  },
  deleteEmployee: ({ id }) => {
    const i = find(db.employees, id);
    if (db.attendance.some(a => a.employeeId === id) || db.payments.some(p => p.employeeId === id)) {
      db.employees[i].active = false;
      return { archived: true };
    }
    db.employees.splice(i, 1);
    return { deleted: true };
  },
  salaryMonth: ({ month }) => ({
    month,
    employees: handlers.employees(),
    attendance: db.attendance.filter(a => a.date.startsWith(month) && a.status),
    payments: db.payments.filter(p => p.month === month).sort((a, b) => a.date.localeCompare(b.date)),
  }),
  saveAttendance: ({ records }) => {
    records.forEach(r => {
      const i = db.attendance.findIndex(a => a.date === r.date && a.employeeId === r.employeeId);
      if (i >= 0) db.attendance[i] = { ...db.attendance[i], status: r.status };
      else if (r.status) db.attendance.push({ date: r.date, employeeId: r.employeeId, status: r.status, note: '' });
    });
    return { saved: records.length };
  },
  addSalaryPayment: ({ payment, cash }) => {
    const e = db.employees[find(db.employees, payment.employeeId)];
    const p = { ...payment, id: uid(), amount: r2(payment.amount), txnId: '', source: 'app' };
    if (!(p.amount > 0)) throw new Error('Amount must be more than 0.');
    if (cash) {
      const mon = MONTHS[Number(p.month.slice(5, 7)) - 1];
      p.txnId = addTxn({
        date: p.date, type: 'OUT', category: 'Salary', amount: p.amount, method: p.method, note: p.note || 'From salary tracker',
        description: `${e.name.toUpperCase()} ${mon}${p.type === 'ADVANCE' ? ' ADV' : ' SALARY'} (SALARY)`,
      }).id;
    }
    db.payments.push(p);
    return { id: p.id, txnId: p.txnId };
  },
  deleteSalaryPayment: ({ id }) => {
    const [p] = db.payments.splice(find(db.payments, id), 1);
    const ti = db.txns.findIndex(t => t.id === p.txnId);
    if (ti >= 0) db.txns.splice(ti, 1);
    return { deleted: true };
  },
});

// ───────────── Demo users, permissions and change log (mirrors Code.gs) ─────────────

const SECTIONS = ['cash', 'report', 'inventory', 'attendance', 'salary', 'employees', 'settings'];
const RANK = { none: 0, view: 1, edit: 2 };
const RULES = {
  me: 'any', logout: 'any', changePassword: 'any', meta: 'any', history: 'any', ping: 'any',
  users: 'admin', updateUser: 'admin', resetPassword: 'admin', changeLog: 'admin',
  range: [['cash', 'report'], 'view'],
  addTxn: [['cash'], 'edit'], updateTxn: [['cash'], 'edit'], deleteTxn: [['cash'], 'edit'],
  saveSettings: [['settings'], 'edit'], saveCategories: [['settings'], 'edit'],
  inventory: [['inventory'], 'view'], moves: [['inventory'], 'view'],
  saveItem: [['inventory'], 'edit'], deleteItem: [['inventory'], 'edit'], addMove: [['inventory'], 'edit'], deleteMove: [['inventory'], 'edit'],
  employees: [['employees', 'attendance', 'salary'], 'view'],
  saveEmployee: [['employees'], 'edit'], deleteEmployee: [['employees'], 'edit'],
  salaryMonth: [['attendance', 'salary'], 'view'],
  saveAttendance: [['attendance'], 'edit'],
  addSalaryPayment: [['salary'], 'edit'], deleteSalaryPayment: [['salary'], 'edit'],
};
const ENTITY_SECTION = {
  Transactions: 'cash', Inventory: 'inventory', StockMoves: 'inventory', Employees: 'employees',
  Attendance: 'attendance', SalaryPayments: 'salary', Settings: 'settings', Categories: 'settings', Users: 'admin',
};

const pad2 = n => String(n).padStart(2, '0');
const localStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const clone = o => (o ? JSON.parse(JSON.stringify(o)) : null);
const strip = o => {
  if (!o || Array.isArray(o)) return o;
  const c = clone(o);
  ['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'source', 'password', 'lastLogin'].forEach(k => delete c[k]);
  return c;
};

function seedUsers() {
  const full = Object.fromEntries(SECTIONS.map(s => [s, 'edit']));
  return [
    { id: 'u-admin', username: 'owner', name: 'Owner', password: 'demo1234', status: 'active', isAdmin: true, perms: full, createdAt: '2026-10-01T09:00:00', approvedBy: 'Sheet owner', lastLogin: localStamp() },
    { id: 'u-cashier', username: 'cashier', name: 'Cashier', password: 'demo1234', status: 'active', isAdmin: false, perms: { cash: 'view', attendance: 'edit' }, createdAt: '2026-10-02T10:00:00', approvedBy: 'Owner', lastLogin: '2026-10-11T18:20:00' },
    { id: 'u-newstaff', username: 'newstaff', name: 'New Staff', password: 'demo1234', status: 'pending', isAdmin: false, perms: {}, createdAt: '2026-10-12T08:45:00', approvedBy: '', lastLogin: '' },
  ];
}

function ensureAuth() {
  if (db.users) return;
  db.users = seedUsers();
  db.currentUserId = 'u-admin';
  db.audit = [];
  // Give the sample data an author, and one example edit so the history view has something to show.
  db.txns.forEach((t, i) => { t.createdBy = i % 4 === 3 ? 'Cashier' : 'Owner'; t.createdAt ||= `${t.date}T10:00:00`; });
  const lunch = db.txns.find(t => t.description === 'LUNCH (FOOD)');
  if (lunch) {
    const before = { ...strip(lunch), amount: 560 };
    lunch.updatedBy = 'Cashier';
    lunch.updatedAt = `${lunch.date}T14:05:00`;
    db.audit.push({ id: uid(), at: lunch.createdAt, user: lunch.createdBy, action: 'add', entity: 'Transactions', recordId: lunch.id, summary: `Cash out: ${lunch.description} ৳560`, before: null, after: before });
    db.audit.push({ id: uid(), at: lunch.updatedAt, user: 'Cashier', action: 'edit', entity: 'Transactions', recordId: lunch.id, summary: `Cash out: ${lunch.description} ৳${lunch.amount}`, before, after: strip(lunch) });
  }
  db.attendance.forEach(a => { a.updatedBy ||= 'Cashier'; });
  db.audit.push({ id: uid(), at: '2026-10-12T08:45:00', user: 'New Staff', action: 'add', entity: 'Users', recordId: 'u-newstaff', summary: 'New user newstaff (waiting for approval)', before: null, after: { username: 'newstaff', name: 'New Staff', status: 'pending' } });
}

const me = () => db.users.find(u => u.id === db.currentUserId) || db.users[0];
const permsFor = u => Object.fromEntries(SECTIONS.map(s => [s, u.isAdmin ? 'edit' : (u.perms[s] || 'none')]));
const canDo = (u, secs, lvl) => secs.some(s => RANK[permsFor(u)[s]] >= RANK[lvl]);
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, status: u.status, isAdmin: u.isAdmin, perms: permsFor(u), createdAt: u.createdAt, approvedBy: u.approvedBy, lastLogin: u.lastLogin });
const forbidden = () => Object.assign(new Error('You don’t have access to do that. Ask the admin.'), { code: 'FORBIDDEN' });

function audit(action, entity, recordId, summary, before, after) {
  db.audit.push({ id: uid(), at: localStamp(), user: me().name, action, entity, recordId: String(recordId), summary, before: strip(before), after: strip(after) });
}

function authorize(action, p) {
  const rule = RULES[action];
  const u = me();
  if (!rule) throw forbidden();
  if (rule === 'any') return;
  if (rule === 'admin') { if (!u.isAdmin) throw forbidden(); return; }
  if (!canDo(u, rule[0], rule[1])) throw forbidden();
  if ((action === 'addMove' || action === 'addSalaryPayment') && p.cash && !canDo(u, ['cash'], 'edit')) throw forbidden();
}

const txnLabel = t => `${{ IN: 'Cash in', OUT: 'Cash out', TRANSFER: 'Transfer' }[t.type]}: ${t.description} ৳${t.amount} (${t.date})`;

/** Wraps a handler so that writes record who did them and what changed. */
const base = { ...handlers };
Object.assign(handlers, {
  me: () => ({ user: { ...publicUser(me()), perms: permsFor(me()) } }),
  logout: () => ({ ok: true }),
  changePassword: ({ oldPassword, newPassword }) => {
    const u = me();
    if (oldPassword !== u.password) throw new Error('Your current password is wrong.');
    if (String(newPassword).length < 8) throw new Error('The password must be at least 8 characters.');
    u.password = newPassword;
    audit('edit', 'Users', u.id, `Password changed for ${u.username}`, null, null);
    return { ok: true };
  },
  users: () => db.users.map(publicUser),
  updateUser: ({ user: x }) => {
    const u = db.users.find(r => r.id === x.id);
    if (!u) throw new Error('User not found.');
    if (u.id === me().id && (x.status && x.status !== 'active' || x.isAdmin === false)) throw new Error('You can’t disable yourself or remove your own admin rights.');
    const before = publicUser(u);
    if (x.name) u.name = x.name;
    if (x.status) u.status = x.status;
    if (x.isAdmin !== undefined) u.isAdmin = !!x.isAdmin;
    if (x.perms) u.perms = Object.fromEntries(SECTIONS.map(s => [s, x.perms[s] || 'none']));
    if (before.status !== 'active' && u.status === 'active' && !u.approvedBy) u.approvedBy = me().name;
    const after = publicUser(u);
    const summary = before.status !== after.status ? `${{ active: 'Approved', disabled: 'Disabled', pending: 'Set to pending:' }[after.status]} ${u.username}` : `Changed access for ${u.username}`;
    audit('edit', 'Users', u.id, summary, before, after);
    return after;
  },
  resetPassword: ({ id, password }) => {
    const u = db.users.find(r => r.id === id);
    if (String(password).length < 8) throw new Error('The password must be at least 8 characters.');
    u.password = password;
    audit('edit', 'Users', u.id, `Password changed for ${u.username}`, null, null);
    return { ok: true };
  },
  history: ({ entity, id }) => {
    const sec = ENTITY_SECTION[entity];
    if (!sec || (sec === 'admin' ? !me().isAdmin : !canDo(me(), [sec], 'view'))) throw forbidden();
    return db.audit.filter(a => a.entity === entity && a.recordId === String(id)).reverse();
  },
  changeLog: ({ user, entity }) => ({
    rows: db.audit.filter(a => (!user || a.user.toLowerCase() === user.toLowerCase()) && (!entity || a.entity === entity)).slice().reverse().slice(0, 100),
    before: 0,
  }),
  addTxn: p => {
    const res = base.addTxn(p);
    const t = db.txns.find(x => x.id === res.id);
    Object.assign(t, { createdBy: me().name, createdAt: localStamp(), updatedBy: '' });
    audit('add', 'Transactions', t.id, txnLabel(t), null, t);
    return res;
  },
  updateTxn: p => {
    const before = clone(db.txns.find(x => x.id === p.txn.id));
    const res = base.updateTxn(p);
    const t = db.txns.find(x => x.id === p.txn.id);
    Object.assign(t, { updatedBy: me().name, updatedAt: localStamp(), createdBy: before.createdBy, createdAt: before.createdAt });
    audit('edit', 'Transactions', t.id, txnLabel(t), before, t);
    return res;
  },
  deleteTxn: p => {
    const before = clone(db.txns.find(x => x.id === p.id));
    const res = base.deleteTxn(p);
    audit('delete', 'Transactions', p.id, txnLabel(before), before, null);
    return res;
  },
  saveItem: p => {
    const before = p.item.id ? clone(db.items.find(i => i.id === p.item.id)) : null;
    const it = base.saveItem(p);
    const stored = db.items.find(i => i.id === it.id);
    if (before) Object.assign(stored, { updatedBy: me().name, updatedAt: localStamp(), createdBy: before.createdBy });
    else stored.createdBy = me().name;
    audit(before ? 'edit' : 'add', 'Inventory', it.id, `Item: ${it.name}`, before, stored);
    return it;
  },
  addMove: p => {
    const res = base.addMove(p);
    const m = db.moves.find(x => x.id === res.id);
    m.createdBy = me().name;
    const item = db.items.find(i => i.id === m.itemId);
    const label = `${{ IN: 'Stock in', OUT: 'Stock out', ADJUST: 'Adjustment' }[m.type]}: ${item.name} ${m.qty} ${item.unit}`;
    audit('add', 'StockMoves', m.id, label, null, m);
    audit('add', 'Inventory', item.id, label, null, m);
    if (res.txnId) {
      const t = db.txns.find(x => x.id === res.txnId);
      t.createdBy = me().name;
      audit('add', 'Transactions', t.id, txnLabel(t), null, t);
    }
    return res;
  },
  saveEmployee: p => {
    const before = p.employee.id ? clone(db.employees.find(e => e.id === p.employee.id)) : null;
    const e = base.saveEmployee(p);
    db.employees.find(x => x.id === e.id).updatedBy = me().name;
    audit(before ? 'edit' : 'add', 'Employees', e.id, `${before ? 'Employee' : 'New employee'}: ${e.name}`, before, e);
    return e;
  },
  saveAttendance: p => {
    const names = Object.fromEntries(db.employees.map(e => [e.id, e.name]));
    const changes = p.records.map(r => ({
      date: r.date, employee: names[r.employeeId], to: r.status,
      from: (db.attendance.find(a => a.date === r.date && a.employeeId === r.employeeId) || {}).status || '',
    })).filter(c => c.from !== c.to);
    const res = base.saveAttendance(p);
    p.records.forEach(r => {
      const a = db.attendance.find(x => x.date === r.date && x.employeeId === r.employeeId);
      if (a) a.updatedBy = me().name;
    });
    const months = [...new Set(changes.map(c => c.date.slice(0, 7)))];
    months.forEach(mo => {
      const list = changes.filter(c => c.date.startsWith(mo));
      audit('edit', 'Attendance', mo, `${list.length} attendance change${list.length === 1 ? '' : 's'} for ${mo}`, null, list);
    });
    return res;
  },
  addSalaryPayment: p => {
    const res = base.addSalaryPayment(p);
    const pay = db.payments.find(x => x.id === res.id);
    pay.createdBy = me().name;
    const emp = db.employees.find(e => e.id === pay.employeeId);
    audit('add', 'SalaryPayments', pay.id, `${pay.type === 'ADVANCE' ? 'Advance' : 'Salary'} to ${emp.name} ৳${pay.amount} for ${pay.month}`, null, { employee: emp.name, ...pay });
    if (res.txnId) {
      const t = db.txns.find(x => x.id === res.txnId);
      t.createdBy = me().name;
      audit('add', 'Transactions', t.id, txnLabel(t), null, t);
    }
    return res;
  },
  salaryMonth: p => {
    const out = base.salaryMonth(p);
    const u = me();
    if (!canDo(u, ['salary'], 'view')) out.payments = [];
    if (!canDo(u, ['salary', 'employees'], 'view')) out.employees = out.employees.map(({ basicSalary, ...e }) => e);
    return out;
  },
  employees: p => {
    const list = base.employees(p);
    return canDo(me(), ['salary', 'employees'], 'view') ? list : list.map(({ basicSalary, ...e }) => e);
  },
});

/** Demo only: switch which sample user you are, to preview their access. */
export function demoSwitchUser(username) {
  load();
  ensureAuth();
  const u = db.users.find(x => x.username === username && x.status === 'active');
  if (!u) return false;
  db.currentUserId = u.id;
  persist();
  return true;
}

export async function mockCall(action, params) {
  await new Promise(r => setTimeout(r, 120));
  load();
  ensureAuth();
  const fn = handlers[action];
  if (!fn) throw new Error(`Unknown action: ${action}`);
  authorize(action, params || {});
  const out = fn(params || {});
  persist();
  return JSON.parse(JSON.stringify(out ?? null));
}
