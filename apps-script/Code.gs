/**
 * M&M Car Clinic — Google Sheets backend.
 *
 * Paste this file into Extensions → Apps Script of the Google Sheet that is
 * the database, then deploy it as a Web app. See README.md for the steps.
 *
 * Every request is a POST with a JSON body: { action, pin (the app password), ...params }.
 * Replies are { ok: true, data } or { ok: false, error, code }.
 */

const TABS = {
  TXN: { name: 'Transactions', headers: ['id', 'date', 'type', 'invoice', 'description', 'category', 'amount', 'method', 'toMethod', 'note', 'source', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'] },
  CAT: { name: 'Categories', headers: ['type', 'name'] },
  SET: { name: 'Settings', headers: ['key', 'value'] },
  ITEM: { name: 'Inventory', headers: ['id', 'sku', 'name', 'category', 'unit', 'costPrice', 'salePrice', 'reorderLevel', 'active', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'] },
  MOVE: { name: 'StockMoves', headers: ['id', 'date', 'itemId', 'type', 'qty', 'unitPrice', 'reference', 'note', 'txnId', 'createdAt', 'createdBy'] },
  EMP: { name: 'Employees', headers: ['id', 'name', 'designation', 'basicSalary', 'phone', 'joinDate', 'trackAttendance', 'active', 'sortOrder', 'createdAt', 'updatedAt', 'updatedBy'] },
  ATT: { name: 'Attendance', headers: ['key', 'date', 'employeeId', 'status', 'note', 'updatedAt', 'updatedBy'] },
  PAY: { name: 'SalaryPayments', headers: ['id', 'date', 'employeeId', 'month', 'type', 'amount', 'method', 'note', 'txnId', 'source', 'createdAt', 'createdBy'] },
  USER: { name: 'Users', headers: ['id', 'username', 'name', 'passHash', 'status', 'isAdmin', 'perms', 'createdAt', 'approvedBy', 'lastLogin', 'sessionsFrom'] },
  AUDIT: { name: 'ChangeLog', headers: ['id', 'at', 'user', 'action', 'entity', 'recordId', 'summary', 'before', 'after'] },
};

const DEFAULT_SETTINGS = {
  businessName: 'M & M CAR CLINIC',
  address: 'BAIZID LINK ROAD, AREFIN NAGOR, NEAR SOUTHERN UNIVERSITY',
  phone: '01708-523230',
  preparedBy: '',
  methods: 'Cash,Bank,Bkash',
  startDate: '',
  weeklyOff: 'Fri',
};

const DEFAULT_CATEGORIES = {
  IN: ['Customer Payment', 'Other Income'],
  OUT: ['Food', 'Salary', 'Workshop', 'Parts Purchase', 'Vendor Payment', 'Commission', 'Utility', 'Invoice', 'Rent', 'Transport', 'Other'],
};

const TXN_TYPES = ['IN', 'OUT', 'TRANSFER'];
const MOVE_TYPES = ['IN', 'OUT', 'ADJUST'];
const ATT_STATUSES = ['P', 'A', 'L', 'O', ''];
const PAY_TYPES = ['ADVANCE', 'SALARY'];
// Designations whose salary is never cut for absence.
const NO_DEDUCTION = /invest|head\s+of/i;
const SETTING_KEYS = /^(businessName|address|phone|preparedBy|methods|startDate|weeklyOff|opening_[A-Za-z0-9 ]+)$/;
// Columns written as real dates; every other string is forced to plain text.
const DATE_FIELDS = ['date', 'joinDate', 'createdAt', 'updatedAt', 'at', 'lastLogin'];

// Parts of the app a user can be given access to. Each is 'none' (hidden), 'view' or 'edit'.
const SECTIONS = ['cash', 'report', 'inventory', 'attendance', 'salary', 'employees', 'settings'];
const LEVELS = ['none', 'view', 'edit'];
const SESSION_TTL = 21600; // seconds of inactivity before sign-out (the Apps Script cache maximum, 6 h)
const HASH_ROUNDS = 1000;
// Who is making the current request; set in doPost, used for "added by / edited by" and the change log.
let ACTOR = null;

// ───────────────────────────── Sheet menu ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('M&M App')
    .addItem('1. Set up / repair tabs', 'setup')
    .addItem('2. Create an admin account', 'createAdmin')
    .addItem('3. Reset a user\'s password', 'resetPasswordFromSheet')
    .addItem('4. Import old daily sheets', 'importLegacySheets')
    .addItem('5. Import employees from a salary sheet', 'importSalarySheet')
    .addToUi();
}

function setup() {
  ensureTabs_();
  SpreadsheetApp.getActive().toast('Tabs are ready.', 'M&M App');
}

function ensureTabs_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(k => {
    const tab = TABS[k];
    let sh = ss.getSheetByName(tab.name);
    if (!sh) sh = ss.insertSheet(tab.name);
    const current = sh.getRange(1, 1, 1, tab.headers.length).getValues()[0].map(String);
    const isPrefix = current.every((h, i) => h === '' || h === tab.headers[i]);
    if (current[0] === '' || (isPrefix && current.join() !== tab.headers.join())) {
      // New install, or an older version of this tab: (re)write the header row, keeping the data below.
      sh.getRange(1, 1, 1, tab.headers.length).setValues([tab.headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });

  const cat = ss.getSheetByName(TABS.CAT.name);
  if (cat.getLastRow() < 2) {
    const rows = [];
    Object.keys(DEFAULT_CATEGORIES).forEach(t => DEFAULT_CATEGORIES[t].forEach(n => rows.push([t, n])));
    cat.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  const set = ss.getSheetByName(TABS.SET.name);
  if (set.getLastRow() < 2) {
    const rows = Object.keys(DEFAULT_SETTINGS).map(k => [k, DEFAULT_SETTINGS[k]]);
    String(DEFAULT_SETTINGS.methods).split(',').forEach(m => rows.push(['opening_' + m, 0]));
    set.getRange(2, 1, rows.length, 2).setValues(rows.map(r => [r[0], safe_(r[1], 'value')]));
  }
}

function createAdmin() {
  const ui = SpreadsheetApp.getUi();
  ensureTabs_();
  const ask = (title, text) => {
    const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
  };
  const username = ask('Create admin', 'Username (letters, numbers, . _ -):');
  if (username === null) return;
  const name = ask('Create admin', 'Name shown on entries (e.g. Rahim):');
  if (name === null) return;
  const password = ask('Create admin', 'Password (at least 8 characters). It shows while you type, so make sure nobody is watching:');
  if (password === null) return;
  try {
    ACTOR = { id: '', name: 'Sheet owner' };
    withLock_(() => createUser_({ username: username, name: name, password: password }, { status: 'active', isAdmin: true }));
    ui.alert('Admin "' + username.toLowerCase() + '" created. Sign in to the app with it.');
  } catch (e) {
    ui.alert(e.message);
  }
}

function resetPasswordFromSheet() {
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('Reset password', 'Username:', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  const pw = ui.prompt('Reset password', 'New password (at least 8 characters):', ui.ButtonSet.OK_CANCEL);
  if (pw.getSelectedButton() !== ui.Button.OK) return;
  try {
    ACTOR = { id: '', name: 'Sheet owner' };
    const user = readUsers_().find(x => x.username === u.getResponseText().trim().toLowerCase());
    if (!user) throw new Error('No user with that username.');
    withLock_(() => setPassword_(user, pw.getResponseText()));
    ui.alert('Password changed. That user is now signed out on every device.');
  } catch (e) {
    ui.alert(e.message);
  }
}

// ───────────────────────────── Web API ─────────────────────────────

const API = {
  ping: () => ({ app: 'M&M Car Clinic API' }),
  login: req => login_(req),
  signup: req => signup_(req),
  me: (req, user) => ({ user: me_(user) }),
  logout: req => logout_(req.token),
  changePassword: (req, user) => changePassword_(user, req),
  users: () => readUsers_().map(publicUser_),
  updateUser: (req, user) => updateUser_(user, req.user),
  resetPassword: req => {
    const u = readUsers_().find(x => x.id === str_(req.id, 64));
    if (!u) throw new Error('User not found.');
    setPassword_(u, req.password);
    return { ok: true };
  },
  changeLog: req => changeLog_(req),
  history: (req, user) => history_(user, req),
  meta: () => ({ settings: readSettings_(), categories: readCategories_() }),
  range: req => range_(req.from, req.to),
  addTxn: req => saveTxn_(req.txn, false),
  updateTxn: req => saveTxn_(req.txn, true),
  deleteTxn: req => deleteTxn_(req.id),
  saveSettings: req => saveSettings_(req.settings),
  saveCategories: req => saveCategories_(req.categories),
  inventory: () => inventory_(),
  saveItem: req => saveItem_(req.item, req.openingQty),
  deleteItem: req => deleteItem_(req.id),
  addMove: req => addMove_(req),
  moves: req => moves_(req.itemId),
  deleteMove: req => deleteMove_(req.id),
  employees: (req, user) => employees_().map(e => hideSalary_(user, e)),
  saveEmployee: req => saveEmployee_(req.employee),
  deleteEmployee: req => deleteEmployee_(req.id),
  salaryMonth: (req, user) => salaryMonth_(req.month, user),
  saveAttendance: req => saveAttendance_(req.records),
  addSalaryPayment: req => addSalaryPayment_(req),
  deleteSalaryPayment: req => deleteSalaryPayment_(req.id),
};
const WRITES = ['addTxn', 'updateTxn', 'deleteTxn', 'saveSettings', 'saveCategories', 'saveItem', 'deleteItem', 'addMove', 'deleteMove',
  'saveEmployee', 'deleteEmployee', 'saveAttendance', 'addSalaryPayment', 'deleteSalaryPayment',
  'signup', 'changePassword', 'updateUser', 'resetPassword'];

// Actions anyone can call without signing in.
const PUBLIC = ['ping', 'login', 'signup'];
// What each action needs: [sections (any one is enough), level]. 'any' = any signed-in user; 'admin' = admins only.
// Anything not listed here is refused.
const RULES = {
  me: 'any', logout: 'any', changePassword: 'any', meta: 'any', history: 'any',
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

function doGet() {
  return json_({ ok: true, data: { app: 'M&M Car Clinic API' } });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API[req.action];
    if (!fn) throw new Error('Unknown action: ' + req.action);
    let user = null;
    if (PUBLIC.indexOf(req.action) < 0) {
      user = session_(req.token);
      authorize_(user, req.action, req);
      ACTOR = { id: user.id, name: user.name || user.username };
    }
    const data = WRITES.indexOf(req.action) >= 0 ? withLock_(() => fn(req, user)) : fn(req, user);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: err.message, code: err.code || '' });
  }
}

// ───────────────────────────── Users, sign-in & permissions ─────────────────────────────

function cleanUser_(r) {
  let perms = {};
  try { perms = JSON.parse(String(r.perms || '{}')) || {}; } catch (e) { perms = {}; }
  return {
    _row: r._row,
    id: String(r.id),
    username: String(r.username).toLowerCase(),
    name: String(r.name),
    passHash: String(r.passHash),
    status: String(r.status || 'pending'),
    isAdmin: r.isAdmin === true || String(r.isAdmin).toUpperCase() === 'TRUE',
    perms: perms,
    createdAt: String(r.createdAt),
    approvedBy: String(r.approvedBy),
    lastLogin: String(r.lastLogin),
    sessionsFrom: Number(r.sessionsFrom) || 0, // sessions started at or before this time (ms) are invalid
  };
}

function readUsers_() {
  return readRows_(TABS.USER).map(cleanUser_);
}

/** Each section's level for this user; admins can do everything. */
function permsFor_(u) {
  const out = {};
  SECTIONS.forEach(sec => {
    const lvl = u.isAdmin ? 'edit' : String(u.perms[sec] || 'none');
    out[sec] = LEVELS.indexOf(lvl) >= 0 ? lvl : 'none';
  });
  return out;
}

function can_(u, sections, level) {
  const p = permsFor_(u);
  return sections.some(sec => LEVELS.indexOf(p[sec]) >= LEVELS.indexOf(level));
}

function me_(u) {
  return { id: u.id, username: u.username, name: u.name, isAdmin: u.isAdmin, perms: permsFor_(u) };
}

function publicUser_(u) {
  return {
    id: u.id, username: u.username, name: u.name, status: u.status, isAdmin: u.isAdmin, perms: permsFor_(u),
    createdAt: u.createdAt, approvedBy: u.approvedBy, lastLogin: u.lastLogin,
  };
}

function authorize_(user, action, req) {
  const rule = RULES[action];
  const deny = () => { throw codeError_('You don\'t have access to do that. Ask the admin.', 'FORBIDDEN'); };
  if (!rule) deny();
  if (rule === 'any') return;
  if (rule === 'admin') {
    if (!user.isAdmin) deny();
    return;
  }
  if (!can_(user, rule[0], rule[1])) deny();
  // Actions that also write a cash-book entry need cash-book edit access too.
  if ((action === 'addMove' || action === 'addSalaryPayment') && req.cash && !can_(user, ['cash'], 'edit')) deny();
}

/** Basic salary is visible only to people with salary or employee access. */
function hideSalary_(user, e) {
  if (can_(user, ['salary', 'employees'], 'view')) return e;
  const copy = Object.assign({}, e);
  delete copy.basicSalary;
  return copy;
}

function hashPassword_(password, salt, rounds) {
  const key = Utilities.newBlob(String(password)).getBytes();
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt).getBytes(), key);
  for (let i = 1; i < rounds; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}

function makeHash_(password) {
  const salt = Utilities.getUuid();
  return ['v1', HASH_ROUNDS, salt, hashPassword_(password, salt, HASH_ROUNDS)].join('$');
}

function verifyPassword_(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const a = hashPassword_(password, parts[2], Number(parts[1]) || HASH_ROUNDS);
  const b = parts[3];
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkNewPassword_(password) {
  if (String(password || '').length < 8) throw new Error('The password must be at least 8 characters.');
}

function createUser_(x, opts) {
  const username = str_(x.username, 30).toLowerCase();
  const name = str_(x.name, 60);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Username must be 3–30 letters, numbers, dots, dashes or underscores.');
  if (!name) throw new Error('Enter your name.');
  checkNewPassword_(x.password);
  if (readUsers_().some(u => u.username === username)) throw new Error('That username is taken. Choose another.');
  const u = {
    id: Utilities.getUuid(), username: username, name: name, passHash: makeHash_(x.password),
    status: opts.status, isAdmin: !!opts.isAdmin, perms: '{}', createdAt: new Date(),
    approvedBy: opts.status === 'active' ? actorName_() : '', lastLogin: '', sessionsFrom: 0,
  };
  sheet_(TABS.USER).appendRow(toRow_(TABS.USER, u));
  audit_('add', 'Users', u.id, 'New user ' + username + (opts.status === 'pending' ? ' (waiting for approval)' : ''),
    null, { username: username, name: name, status: u.status, isAdmin: u.isAdmin });
  return u;
}

function signup_(req) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('signups') || 0);
  if (n >= 20) throw new Error('Too many sign-up requests right now. Try again later.');
  cache.put('signups', String(n + 1), 3600);
  ACTOR = { id: '', name: str_(req.name, 60) || str_(req.username, 30) };
  createUser_(req, { status: 'pending', isAdmin: false });
  return { pending: true };
}

function login_(req) {
  const username = str_(req.username, 30).toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail:' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw codeError_('Too many wrong attempts for this username. Try again in 15 minutes.', 'LOGIN');
  const u = readUsers_().find(x => x.username === username);
  if (!u || !verifyPassword_(req.password, u.passHash)) {
    cache.put(failKey, String(fails + 1), 900);
    throw codeError_('Wrong username or password.', 'LOGIN');
  }
  cache.remove(failKey);
  if (u.status === 'pending') throw codeError_('Your account is waiting for the admin to approve it.', 'LOGIN');
  if (u.status !== 'active') throw codeError_('This account is disabled. Ask the admin.', 'LOGIN');
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess:' + token, u.id + '|' + Date.now(), SESSION_TTL);
  sheet_(TABS.USER).getRange(u._row, TABS.USER.headers.indexOf('lastLogin') + 1).setValue(new Date());
  return { token: token, user: me_(u) };
}

function session_(token) {
  const expired = () => codeError_('Please sign in again.', 'AUTH');
  if (!token || !/^[a-f0-9]{64}$/.test(String(token))) throw expired();
  const cache = CacheService.getScriptCache();
  const v = cache.get('sess:' + token);
  if (!v) throw expired();
  const parts = v.split('|');
  const u = readUsers_().find(x => x.id === parts[0]);
  const issued = Number(parts[1]) || 0;
  if (!u || u.status !== 'active' || issued <= u.sessionsFrom) {
    cache.remove('sess:' + token);
    throw expired();
  }
  cache.put('sess:' + token, v, SESSION_TTL); // sliding expiry
  return u;
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('sess:' + token);
  return { ok: true };
}

/** Changes a password and signs that user out on every device. */
function setPassword_(u, password) {
  checkNewPassword_(password);
  const sh = sheet_(TABS.USER);
  sh.getRange(u._row, TABS.USER.headers.indexOf('passHash') + 1).setValue(safe_(makeHash_(password), 'passHash'));
  sh.getRange(u._row, TABS.USER.headers.indexOf('sessionsFrom') + 1).setValue(Date.now());
  audit_('edit', 'Users', u.id, 'Password changed for ' + u.username, null, null);
}

function changePassword_(user, req) {
  if (!verifyPassword_(req.oldPassword, user.passHash)) throw new Error('Your current password is wrong.');
  setPassword_(user, req.newPassword);
  return { ok: true };
}

function updateUser_(admin, x) {
  x = x || {};
  const users = readUsers_();
  const u = users.find(r => r.id === str_(x.id, 64));
  if (!u) throw new Error('User not found.');
  const before = publicUser_(u);
  const next = {
    name: x.name !== undefined ? str_(x.name, 60) || u.name : u.name,
    status: ['pending', 'active', 'disabled'].indexOf(x.status) >= 0 ? x.status : u.status,
    isAdmin: x.isAdmin !== undefined ? !!x.isAdmin : u.isAdmin,
    perms: u.perms,
  };
  if (x.perms) {
    next.perms = {};
    SECTIONS.forEach(sec => { next.perms[sec] = LEVELS.indexOf(x.perms[sec]) >= 0 ? x.perms[sec] : 'none'; });
  }
  if (u.id === admin.id && (next.status !== 'active' || !next.isAdmin)) {
    throw new Error('You can\'t disable yourself or remove your own admin rights.');
  }
  const otherAdmins = users.filter(r => r.status === 'active' && r.isAdmin && r.id !== u.id).length;
  if (u.isAdmin && u.status === 'active' && (!next.isAdmin || next.status !== 'active') && otherAdmins === 0) {
    throw new Error('Keep at least one active admin.');
  }
  const sh = sheet_(TABS.USER);
  const H = TABS.USER.headers;
  const set = (field, value) => sh.getRange(u._row, H.indexOf(field) + 1).setValue(safe_(value, field));
  set('name', next.name);
  set('status', next.status);
  set('isAdmin', next.isAdmin);
  set('perms', JSON.stringify(next.perms));
  if (u.status !== 'active' && next.status === 'active' && !u.approvedBy) set('approvedBy', actorName_());
  if (next.status !== 'active') set('sessionsFrom', Date.now());
  const after = publicUser_(Object.assign({}, u, next));
  const summary = before.status !== after.status
    ? { active: 'Approved ', disabled: 'Disabled ', pending: 'Set to pending: ' }[after.status] + u.username
    : 'Changed access for ' + u.username;
  audit_('edit', 'Users', u.id, summary, before, after);
  return after;
}

// ───────────────────────────── Change log ─────────────────────────────

const ENTITY_SECTION = {
  Transactions: 'cash', Inventory: 'inventory', StockMoves: 'inventory', Employees: 'employees',
  Attendance: 'attendance', SalaryPayments: 'salary', Settings: 'settings', Categories: 'settings', Users: 'admin',
};
// Bookkeeping fields left out of the before/after snapshots.
const AUDIT_SKIP = ['_row', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'passHash', 'sessionsFrom', 'source', 'lastLogin'];

function snapshot_(o) {
  if (!o) return null;
  if (Array.isArray(o)) return o;
  const out = {};
  Object.keys(o).forEach(k => { if (AUDIT_SKIP.indexOf(k) < 0) out[k] = o[k] instanceof Date ? cell_(o[k], tz_()) : o[k]; });
  return out;
}

function actorName_() {
  return ACTOR ? ACTOR.name : 'Sheet owner';
}

/** Appends one line to the ChangeLog tab: who did what to which record, with old and new values. */
function audit_(action, entity, recordId, summary, before, after) {
  const j = v => (v ? JSON.stringify(snapshot_(v)).slice(0, 45000) : '');
  sheet_(TABS.AUDIT).appendRow(toRow_(TABS.AUDIT, {
    id: Utilities.getUuid(), at: new Date(), user: actorName_(), action: action, entity: entity,
    recordId: String(recordId || ''), summary: str_(summary, 300), before: j(before), after: j(after),
  }));
}

function cleanAudit_(r) {
  const parse = v => {
    try { return v ? JSON.parse(String(v)) : null; } catch (e) { return null; }
  };
  return {
    id: String(r.id), at: String(r.at), user: String(r.user), action: String(r.action), entity: String(r.entity),
    recordId: String(r.recordId), summary: String(r.summary), before: parse(r.before), after: parse(r.after),
  };
}

/** Every logged change to one record, newest first. */
function history_(user, req) {
  const entity = str_(req.entity, 40);
  const id = str_(req.id, 100);
  const section = ENTITY_SECTION[entity];
  if (!section || !id) throw new Error('Unknown record.');
  if (section === 'admin' ? !user.isAdmin : !can_(user, [section], 'view')) {
    throw codeError_('You don\'t have access to that history.', 'FORBIDDEN');
  }
  const sh = sheet_(TABS.AUDIT);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const col = TABS.AUDIT.headers.indexOf('recordId') + 1;
  // Rows are appended in order, so a later row is a later change (timestamps only have one-second precision).
  return sh.getRange(2, col, n, 1).createTextFinder(id).matchEntireCell(true).findAll()
    .map(c => c.getRow())
    .sort((a, b) => b - a)
    .map(row => cleanAudit_(readRow_(TABS.AUDIT, row)))
    .filter(a => a.entity === entity);
}

/**
 * Recent changes for the admin's Activity screen, newest first, up to 100 at a time.
 * Scans at most 500 rows per call; `before` (a row number) continues from where the last page stopped.
 */
function changeLog_(req) {
  const sh = sheet_(TABS.AUDIT);
  const last = sh.getLastRow();
  const end = Math.min(Number(req.before) || last + 1, last + 1) - 1;
  if (end < 2) return { rows: [], before: 0 };
  const start = Math.max(2, end - 499);
  const values = sh.getRange(start, 1, end - start + 1, TABS.AUDIT.headers.length).getValues();
  const tz = tz_();
  const userQ = str_(req.user, 60).toLowerCase();
  const entityQ = str_(req.entity, 40);
  const rows = [];
  let stoppedAt = start;
  for (let i = values.length - 1; i >= 0; i--) {
    if (rows.length === 100) {
      stoppedAt = start + i + 1;
      break;
    }
    const o = {};
    TABS.AUDIT.headers.forEach((h, j) => { o[h] = cell_(values[i][j], tz); });
    if (userQ && String(o.user).toLowerCase() !== userQ) continue;
    if (entityQ && o.entity !== entityQ) continue;
    rows.push(cleanAudit_(o));
  }
  const more = rows.length === 100 ? stoppedAt : start;
  return { rows: rows, before: more > 2 ? more : 0 };
}

// ───────────────────────────── Cash book ─────────────────────────────

function range_(from, to) {
  if (!isDate_(from) || !isDate_(to) || from > to) throw new Error('Invalid date range.');
  const s = readSettings_();
  const opening = {};
  s.methods.forEach(m => { opening[m] = s['opening_' + m]; });
  const txns = [];
  readRows_(TABS.TXN).map(cleanTxn_).forEach(t => {
    if (s.startDate && t.date < s.startDate) return;
    if (t.date < from) applyTxn_(opening, t);
    else if (t.date <= to) txns.push(t);
  });
  txns.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return { from: from, to: to, opening: opening, txns: txns };
}

function applyTxn_(bal, t) {
  const a = Number(t.amount) || 0;
  if (t.type === 'IN') bal[t.method] = (bal[t.method] || 0) + a;
  else if (t.type === 'OUT') bal[t.method] = (bal[t.method] || 0) - a;
  else if (t.type === 'TRANSFER') {
    bal[t.method] = (bal[t.method] || 0) - a;
    bal[t.toMethod] = (bal[t.toMethod] || 0) + a;
  }
}

function validateTxn_(x, s) {
  x = x || {};
  const t = {
    id: str_(x.id, 64),
    date: str_(x.date, 10),
    type: str_(x.type, 10).toUpperCase(),
    invoice: str_(x.invoice, 40),
    description: str_(x.description, 200),
    category: str_(x.category, 60),
    amount: num_(x.amount),
    method: str_(x.method, 30),
    toMethod: str_(x.toMethod, 30),
    note: str_(x.note, 300),
  };
  if (!isDate_(t.date)) throw new Error('Choose a valid date.');
  if (TXN_TYPES.indexOf(t.type) < 0) throw new Error('Unknown entry type.');
  if (!(t.amount > 0)) throw new Error('Amount must be more than 0.');
  if (s.methods.indexOf(t.method) < 0) throw new Error('Unknown payment method: ' + t.method);
  if (t.type === 'TRANSFER') {
    if (s.methods.indexOf(t.toMethod) < 0 || t.toMethod === t.method) throw new Error('Choose two different accounts for a transfer.');
    t.category = 'Transfer';
    if (!t.description) t.description = t.method + ' → ' + t.toMethod;
  } else {
    t.toMethod = '';
    if (!t.description) throw new Error('Description is required.');
    if (!t.category) t.category = 'Uncategorized';
  }
  return t;
}

function saveTxn_(input, isUpdate) {
  const t = validateTxn_(input, readSettings_());
  const sh = sheet_(TABS.TXN);
  const now = new Date();
  if (isUpdate) {
    const row = findRow_(TABS.TXN, t.id);
    const old = readRow_(TABS.TXN, row);
    t.source = old.source;
    t.createdAt = old.createdAt;
    t.createdBy = old.createdBy;
    t.updatedAt = now;
    t.updatedBy = actorName_();
    sh.getRange(row, 1, 1, TABS.TXN.headers.length).setValues([toRow_(TABS.TXN, t)]);
    audit_('edit', 'Transactions', t.id, txnLabel_(t), cleanTxn_(old), t);
  } else {
    t.id = Utilities.getUuid();
    t.source = 'app';
    t.createdAt = now;
    t.updatedAt = now;
    t.createdBy = actorName_();
    t.updatedBy = '';
    sh.appendRow(toRow_(TABS.TXN, t));
    audit_('add', 'Transactions', t.id, txnLabel_(t), null, t);
  }
  return { id: t.id };
}

function txnLabel_(t) {
  const kind = { IN: 'Cash in', OUT: 'Cash out', TRANSFER: 'Transfer' }[t.type] || t.type;
  return kind + ': ' + t.description + ' ৳' + t.amount + ' (' + t.date + ')';
}

function deleteTxn_(id) {
  const row = findRow_(TABS.TXN, id);
  const old = cleanTxn_(readRow_(TABS.TXN, row));
  sheet_(TABS.TXN).deleteRow(row);
  audit_('delete', 'Transactions', id, txnLabel_(old), old, null);
  return { deleted: true };
}

function cleanTxn_(r) {
  return {
    id: String(r.id),
    date: String(r.date).slice(0, 10),
    type: String(r.type).toUpperCase(),
    invoice: String(r.invoice),
    description: String(r.description),
    category: String(r.category),
    amount: Number(r.amount) || 0,
    method: String(r.method),
    toMethod: String(r.toMethod),
    note: String(r.note),
    source: String(r.source),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    createdBy: String(r.createdBy || ''),
    updatedBy: String(r.updatedBy || ''),
  };
}

// ───────────────────────────── Settings & categories ─────────────────────────────

function readSettings_() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  readRows_(TABS.SET).forEach(r => { s[String(r.key)] = r.value; });
  s.methods = String(s.methods).split(',').map(x => x.trim()).filter(String);
  s.startDate = s.startDate ? String(s.startDate).slice(0, 10) : '';
  s.methods.forEach(m => { s['opening_' + m] = Number(s['opening_' + m]) || 0; });
  return s;
}

function saveSettings_(input) {
  input = input || {};
  const beforeAll = readSettings_();
  const sh = sheet_(TABS.SET);
  const at = {};
  readRows_(TABS.SET).forEach(r => { at[String(r.key)] = r._row; });
  Object.keys(input).forEach(key => {
    if (!SETTING_KEYS.test(key)) return;
    let v = input[key];
    if (key === 'methods') {
      v = (Array.isArray(v) ? v : String(v).split(',')).map(x => str_(x, 30)).filter(String);
      if (!v.length) throw new Error('Keep at least one payment method.');
      v = v.join(',');
    } else if (key === 'startDate') {
      v = str_(v, 10);
      if (v && !isDate_(v)) throw new Error('Invalid start date.');
    } else if (key.indexOf('opening_') === 0) {
      v = num_(v);
    } else if (key === 'weeklyOff') {
      v = str_(v, 40);
    } else {
      v = str_(v, 200);
    }
    const cell = safe_(v, key === 'startDate' ? 'date' : 'value');
    if (at[key]) sh.getRange(at[key], 2).setValue(cell);
    else {
      sh.appendRow([key, cell]);
      at[key] = sh.getLastRow();
    }
  });
  const afterAll = readSettings_();
  const before = {}, after = {};
  Object.keys(input).forEach(k => {
    if (SETTING_KEYS.test(k) && String(beforeAll[k]) !== String(afterAll[k])) {
      before[k] = beforeAll[k];
      after[k] = afterAll[k];
    }
  });
  if (Object.keys(after).length) audit_('edit', 'Settings', 'settings', 'Settings changed: ' + Object.keys(after).join(', '), before, after);
  return afterAll;
}

function readCategories_() {
  const c = { IN: [], OUT: [] };
  readRows_(TABS.CAT).forEach(r => {
    const t = String(r.type).toUpperCase();
    const n = String(r.name);
    if (c[t] && n && c[t].indexOf(n) < 0) c[t].push(n);
  });
  return c;
}

function saveCategories_(input) {
  input = input || {};
  const rows = [];
  ['IN', 'OUT'].forEach(t => {
    const seen = {};
    (input[t] || []).forEach(n => {
      n = str_(n, 60);
      if (n && !seen[n.toLowerCase()]) {
        seen[n.toLowerCase()] = true;
        rows.push([t, safe_(n, 'name')]);
      }
    });
  });
  if (!rows.some(r => r[0] === 'IN') || !rows.some(r => r[0] === 'OUT')) {
    throw new Error('Keep at least one cash-in and one cash-out category.');
  }
  const before = readCategories_();
  const sh = sheet_(TABS.CAT);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  const after = readCategories_();
  audit_('edit', 'Categories', 'categories', 'Categories changed', before, after);
  return after;
}

// ───────────────────────────── Inventory ─────────────────────────────

function cleanItem_(r) {
  return {
    id: String(r.id),
    sku: String(r.sku),
    name: String(r.name),
    category: String(r.category),
    unit: String(r.unit || 'pcs'),
    costPrice: Number(r.costPrice) || 0,
    salePrice: Number(r.salePrice) || 0,
    reorderLevel: Number(r.reorderLevel) || 0,
    active: r.active !== false && String(r.active).toUpperCase() !== 'FALSE',
    createdBy: String(r.createdBy || ''),
    updatedBy: String(r.updatedBy || ''),
    updatedAt: String(r.updatedAt || ''),
  };
}

function inventory_() {
  const qty = {};
  readRows_(TABS.MOVE).forEach(m => {
    const q = Number(m.qty) || 0;
    qty[m.itemId] = (qty[m.itemId] || 0) + (String(m.type).toUpperCase() === 'OUT' ? -q : q);
  });
  return readRows_(TABS.ITEM).map(cleanItem_).map(i => {
    i.qty = Math.round((qty[i.id] || 0) * 100) / 100;
    return i;
  });
}

function saveItem_(x, openingQty) {
  x = x || {};
  const it = {
    id: str_(x.id, 64),
    sku: str_(x.sku, 40),
    name: str_(x.name, 120),
    category: str_(x.category, 60),
    unit: str_(x.unit, 20) || 'pcs',
    costPrice: num_(x.costPrice),
    salePrice: num_(x.salePrice),
    reorderLevel: num_(x.reorderLevel),
    active: true,
  };
  if (!it.name) throw new Error('Item name is required.');
  if (it.costPrice < 0 || it.salePrice < 0 || it.reorderLevel < 0) throw new Error('Prices and reorder level cannot be negative.');
  if (it.sku) {
    const clash = readRows_(TABS.ITEM).some(r => String(r.sku).toLowerCase() === it.sku.toLowerCase() && String(r.id) !== it.id);
    if (clash) throw new Error('Another item already uses SKU ' + it.sku + '.');
  }
  const sh = sheet_(TABS.ITEM);
  const now = new Date();
  if (it.id) {
    const row = findRow_(TABS.ITEM, it.id);
    const old = readRow_(TABS.ITEM, row);
    it.createdAt = old.createdAt;
    it.createdBy = old.createdBy;
    it.updatedAt = now;
    it.updatedBy = actorName_();
    sh.getRange(row, 1, 1, TABS.ITEM.headers.length).setValues([toRow_(TABS.ITEM, it)]);
    audit_('edit', 'Inventory', it.id, 'Item: ' + it.name, cleanItem_(old), it);
  } else {
    it.id = Utilities.getUuid();
    it.createdAt = now;
    it.updatedAt = now;
    it.createdBy = actorName_();
    it.updatedBy = '';
    sh.appendRow(toRow_(TABS.ITEM, it));
    audit_('add', 'Inventory', it.id, 'Item: ' + it.name, null, it);
    const q = num_(openingQty);
    if (q) {
      const mv = { date: today_(), itemId: it.id, type: 'ADJUST', qty: q, unitPrice: it.costPrice, reference: '', note: 'Opening stock', txnId: '' };
      appendMove_(mv);
      audit_('add', 'StockMoves', mv.id, 'Opening stock: ' + it.name + ' ' + q, null, mv);
    }
  }
  return cleanItem_(it);
}

function deleteItem_(id) {
  const row = findRow_(TABS.ITEM, id);
  const used = readRows_(TABS.MOVE).some(m => String(m.itemId) === String(id));
  const old = cleanItem_(readRow_(TABS.ITEM, row));
  if (used) {
    // Keep the history: archive instead of deleting.
    sheet_(TABS.ITEM).getRange(row, TABS.ITEM.headers.indexOf('active') + 1).setValue(false);
    audit_('edit', 'Inventory', id, 'Archived item: ' + old.name, old, Object.assign({}, old, { active: false }));
    return { archived: true };
  }
  sheet_(TABS.ITEM).deleteRow(row);
  audit_('delete', 'Inventory', id, 'Deleted item: ' + old.name, old, null);
  return { deleted: true };
}

function addMove_(req) {
  const x = req.move || {};
  const m = {
    date: str_(x.date, 10),
    itemId: str_(x.itemId, 64),
    type: str_(x.type, 10).toUpperCase(),
    qty: num_(x.qty),
    unitPrice: num_(x.unitPrice),
    reference: str_(x.reference, 60),
    note: str_(x.note, 300),
    txnId: '',
  };
  if (!isDate_(m.date)) throw new Error('Choose a valid date.');
  if (MOVE_TYPES.indexOf(m.type) < 0) throw new Error('Unknown stock movement type.');
  if (m.type === 'ADJUST' ? m.qty === 0 : !(m.qty > 0)) throw new Error('Enter a quantity.');
  if (m.unitPrice < 0) throw new Error('Unit price cannot be negative.');
  const item = cleanItem_(readRow_(TABS.ITEM, findRow_(TABS.ITEM, m.itemId)));

  if (req.cash && m.type !== 'ADJUST') {
    const amount = Math.round(m.qty * m.unitPrice * 100) / 100;
    if (!(amount > 0)) throw new Error('Enter a unit price to record this in the cash book.');
    const txn = saveTxn_({
      date: m.date,
      type: m.type === 'IN' ? 'OUT' : 'IN',
      invoice: m.reference,
      description: item.name + ' × ' + m.qty + ' ' + item.unit,
      category: req.cash.category,
      amount: amount,
      method: req.cash.method,
      note: m.type === 'IN' ? 'Inventory: stock in' : 'Inventory: stock out',
    }, false);
    m.txnId = txn.id;
  }
  const res = appendMove_(m);
  audit_('add', 'StockMoves', m.id, moveLabel_(m, item), null, m);
  // Also file it under the item, so the item's history shows its stock movements.
  audit_('add', 'Inventory', item.id, moveLabel_(m, item), null, m);
  return res;
}

function moveLabel_(m, item) {
  const kind = { IN: 'Stock in', OUT: 'Stock out', ADJUST: 'Adjustment' }[m.type] || m.type;
  return kind + ': ' + item.name + ' ' + m.qty + ' ' + item.unit + ' (' + m.date + ')';
}

function appendMove_(m) {
  m.id = Utilities.getUuid();
  m.createdAt = new Date();
  m.createdBy = actorName_();
  sheet_(TABS.MOVE).appendRow(toRow_(TABS.MOVE, m));
  return { id: m.id, txnId: m.txnId };
}

function moves_(itemId) {
  return readRows_(TABS.MOVE)
    .filter(m => !itemId || String(m.itemId) === String(itemId))
    .map(m => ({
      id: String(m.id),
      date: String(m.date).slice(0, 10),
      itemId: String(m.itemId),
      type: String(m.type).toUpperCase(),
      qty: Number(m.qty) || 0,
      unitPrice: Number(m.unitPrice) || 0,
      reference: String(m.reference),
      note: String(m.note),
      txnId: String(m.txnId),
      createdAt: String(m.createdAt),
      createdBy: String(m.createdBy || ''),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function deleteMove_(id) {
  const row = findRow_(TABS.MOVE, id);
  const old = readRow_(TABS.MOVE, row);
  const txnId = String(old.txnId || '');
  let item = { id: String(old.itemId), name: 'item', unit: '' };
  try { item = cleanItem_(readRow_(TABS.ITEM, findRow_(TABS.ITEM, old.itemId))); } catch (e) { /* item gone */ }
  sheet_(TABS.MOVE).deleteRow(row);
  const label = 'Deleted ' + moveLabel_(Object.assign({}, old, { type: String(old.type).toUpperCase() }), item).toLowerCase();
  audit_('delete', 'StockMoves', id, label, old, null);
  audit_('delete', 'Inventory', item.id, label, old, null);
  if (txnId) {
    try { deleteTxn_(txnId); } catch (e) { /* cash entry was already deleted */ }
  }
  return { deleted: true };
}

// ───────────────────────────── Employees, attendance & salary ─────────────────────────────

function cleanEmp_(r) {
  const flag = v => v !== false && String(v).toUpperCase() !== 'FALSE';
  return {
    id: String(r.id),
    name: String(r.name),
    designation: String(r.designation),
    basicSalary: Number(r.basicSalary) || 0,
    phone: String(r.phone),
    joinDate: r.joinDate ? String(r.joinDate).slice(0, 10) : '',
    trackAttendance: flag(r.trackAttendance),
    active: flag(r.active),
    sortOrder: Number(r.sortOrder) || 0,
    updatedBy: String(r.updatedBy || ''),
    updatedAt: String(r.updatedAt || ''),
  };
}

function employees_() {
  return readRows_(TABS.EMP).map(cleanEmp_).sort((a, b) => a.sortOrder - b.sortOrder);
}

function saveEmployee_(x) {
  x = x || {};
  const e = {
    id: str_(x.id, 64),
    name: str_(x.name, 100),
    designation: str_(x.designation, 100),
    basicSalary: num_(x.basicSalary),
    phone: str_(x.phone, 40),
    joinDate: str_(x.joinDate, 10),
    trackAttendance: x.trackAttendance !== false,
    active: x.active !== false,
  };
  if (!e.name) throw new Error('Employee name is required.');
  if (e.basicSalary < 0) throw new Error('Basic salary cannot be negative.');
  if (e.joinDate && !isDate_(e.joinDate)) throw new Error('Invalid joining date.');
  const sh = sheet_(TABS.EMP);
  const now = new Date();
  e.updatedBy = actorName_();
  if (e.id) {
    const row = findRow_(TABS.EMP, e.id);
    const old = readRow_(TABS.EMP, row);
    e.sortOrder = old.sortOrder;
    e.createdAt = old.createdAt;
    e.updatedAt = now;
    sh.getRange(row, 1, 1, TABS.EMP.headers.length).setValues([toRow_(TABS.EMP, e)]);
    const o = cleanEmp_(old);
    const summary = o.active && !e.active ? 'Removed employee: ' : !o.active && e.active ? 'Restored employee: ' : 'Employee: ';
    audit_('edit', 'Employees', e.id, summary + e.name, o, e);
  } else {
    e.id = Utilities.getUuid();
    e.sortOrder = employees_().reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;
    e.createdAt = now;
    e.updatedAt = now;
    sh.appendRow(toRow_(TABS.EMP, e));
    audit_('add', 'Employees', e.id, 'New employee: ' + e.name, null, e);
  }
  return cleanEmp_(e);
}

function deleteEmployee_(id) {
  const row = findRow_(TABS.EMP, id);
  const used = readRows_(TABS.ATT).some(a => String(a.employeeId) === String(id) && a.status) ||
    readRows_(TABS.PAY).some(p => String(p.employeeId) === String(id));
  const old = cleanEmp_(readRow_(TABS.EMP, row));
  if (used) {
    // Keep attendance and payment history: archive instead of deleting.
    sheet_(TABS.EMP).getRange(row, TABS.EMP.headers.indexOf('active') + 1).setValue(false);
    audit_('edit', 'Employees', id, 'Removed employee: ' + old.name, old, Object.assign({}, old, { active: false }));
    return { archived: true };
  }
  sheet_(TABS.EMP).deleteRow(row);
  audit_('delete', 'Employees', id, 'Deleted employee: ' + old.name, old, null);
  return { deleted: true };
}

function salaryMonth_(month, user) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('Invalid month.');
  const seesPay = !user || can_(user, ['salary'], 'view');
  return {
    month: month,
    employees: employees_().map(e => (user ? hideSalary_(user, e) : e)),
    attendance: readRows_(TABS.ATT)
      .filter(a => String(a.date).slice(0, 7) === month && a.status)
      .map(a => ({
        date: String(a.date).slice(0, 10), employeeId: String(a.employeeId), status: String(a.status), note: String(a.note),
        updatedBy: String(a.updatedBy || ''), updatedAt: String(a.updatedAt || ''),
      })),
    payments: !seesPay ? [] : readRows_(TABS.PAY)
      .filter(p => String(p.month) === month)
      .map(cleanPay_)
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function saveAttendance_(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Nothing to save.');
  if (records.length > 3000) throw new Error('Too many changes at once. Save in smaller batches.');
  const ids = {};
  employees_().forEach(e => { ids[e.id] = true; });
  const names = {};
  employees_().forEach(e => { names[e.id] = e.name; });
  const sh = sheet_(TABS.ATT);
  const at = {};
  const was = {};
  readRows_(TABS.ATT).forEach(r => {
    at[String(r.key)] = r._row;
    was[String(r.key)] = String(r.status || '');
  });
  const now = new Date();
  const appends = [];
  const changes = {};
  records.forEach(x => {
    const a = {
      date: str_(x.date, 10), employeeId: str_(x.employeeId, 64), status: str_(x.status, 1).toUpperCase(), note: str_(x.note, 200),
      updatedAt: now, updatedBy: actorName_(),
    };
    if (!isDate_(a.date)) throw new Error('Invalid attendance date.');
    if (!ids[a.employeeId]) throw new Error('Unknown employee in attendance.');
    if (ATT_STATUSES.indexOf(a.status) < 0) throw new Error('Unknown attendance status: ' + a.status);
    a.key = a.date + '|' + a.employeeId;
    const row = toRow_(TABS.ATT, a);
    if (at[a.key]) sh.getRange(at[a.key], 1, 1, row.length).setValues([row]);
    else if (a.status) appends.push(row);
    const from = was[a.key] || '';
    if (from !== a.status) {
      const month = a.date.slice(0, 7);
      (changes[month] = changes[month] || []).push({ date: a.date, employee: names[a.employeeId] || a.employeeId, from: from, to: a.status });
    }
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, appends[0].length).setValues(appends);
  // One log line per month saved, listing every changed day (filed under the month, e.g. "2026-10").
  Object.keys(changes).forEach(month => {
    const list = changes[month];
    audit_('edit', 'Attendance', month, list.length + ' attendance change' + (list.length === 1 ? '' : 's') + ' for ' + month, null, list);
  });
  return { saved: records.length };
}

function cleanPay_(p) {
  return {
    id: String(p.id),
    date: String(p.date).slice(0, 10),
    employeeId: String(p.employeeId),
    month: String(p.month),
    type: String(p.type).toUpperCase(),
    amount: Number(p.amount) || 0,
    method: String(p.method),
    note: String(p.note),
    txnId: String(p.txnId),
    source: String(p.source),
    createdBy: String(p.createdBy || ''),
  };
}

function addSalaryPayment_(req) {
  const x = req.payment || {};
  const s = readSettings_();
  const p = {
    date: str_(x.date, 10),
    employeeId: str_(x.employeeId, 64),
    month: str_(x.month, 7),
    type: str_(x.type, 10).toUpperCase(),
    amount: num_(x.amount),
    method: str_(x.method, 30),
    note: str_(x.note, 200),
    txnId: '',
    source: 'app',
  };
  if (!isDate_(p.date)) throw new Error('Choose a valid date.');
  if (!/^\d{4}-\d{2}$/.test(p.month)) throw new Error('Choose the salary month.');
  if (PAY_TYPES.indexOf(p.type) < 0) throw new Error('Unknown payment type.');
  if (!(p.amount > 0)) throw new Error('Amount must be more than 0.');
  if (s.methods.indexOf(p.method) < 0) throw new Error('Unknown payment method: ' + p.method);
  const emp = cleanEmp_(readRow_(TABS.EMP, findRow_(TABS.EMP, p.employeeId)));

  if (req.cash) {
    const cat = readCategories_().OUT.find(c => c.toLowerCase() === 'salary') || 'Salary';
    const mon = MONTHS_[Number(p.month.slice(5, 7)) - 1];
    const txn = saveTxn_({
      date: p.date,
      type: 'OUT',
      description: emp.name.toUpperCase() + ' ' + mon + (p.type === 'ADVANCE' ? ' ADV' : ' SALARY') + ' (SALARY)',
      category: cat,
      amount: p.amount,
      method: p.method,
      note: p.note || 'From salary tracker',
    }, false);
    p.txnId = txn.id;
  }
  p.id = Utilities.getUuid();
  p.createdAt = new Date();
  p.createdBy = actorName_();
  sheet_(TABS.PAY).appendRow(toRow_(TABS.PAY, p));
  audit_('add', 'SalaryPayments', p.id, payLabel_(p, emp.name), null, Object.assign({ employee: emp.name }, p));
  return { id: p.id, txnId: p.txnId };
}

function payLabel_(p, name) {
  return (p.type === 'ADVANCE' ? 'Advance' : 'Salary') + ' to ' + name + ' ৳' + p.amount + ' for ' + p.month;
}
const MONTHS_ = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function deleteSalaryPayment_(id) {
  const row = findRow_(TABS.PAY, id);
  const old = cleanPay_(readRow_(TABS.PAY, row));
  let name = old.employeeId;
  try { name = cleanEmp_(readRow_(TABS.EMP, findRow_(TABS.EMP, old.employeeId))).name; } catch (e) { /* employee gone */ }
  sheet_(TABS.PAY).deleteRow(row);
  audit_('delete', 'SalaryPayments', id, 'Deleted ' + payLabel_(old, name).toLowerCase(), Object.assign({ employee: name }, old), null);
  if (old.txnId) {
    try { deleteTxn_(old.txnId); } catch (e) { /* cash entry was already deleted */ }
  }
  return { deleted: true };
}

/**
 * Copies employees (and the advances already taken) from an existing
 * "Monthly Salary Sheet". Employees are matched by name and updated.
 * Advances are not added to the cash book because they are usually there already.
 */
function importSalarySheet() {
  const ui = SpreadsheetApp.getUi();
  ensureTabs_();
  const urlRes = ui.prompt('Import salary sheet', 'Paste the link of the Google Sheet that has the salary sheet:', ui.ButtonSet.OK_CANCEL);
  if (urlRes.getSelectedButton() !== ui.Button.OK) return;
  const monthRes = ui.prompt('Import salary sheet', 'Which month are the advances for? (YYYY-MM, e.g. ' + today_().slice(0, 7) + ')', ui.ButtonSet.OK_CANCEL);
  if (monthRes.getSelectedButton() !== ui.Button.OK) return;
  const month = monthRes.getResponseText().trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    ui.alert('The month must look like 2026-10. Nothing was imported.');
    return;
  }

  let found = null;
  SpreadsheetApp.openByUrl(urlRes.getResponseText().trim()).getSheets().some(sh => {
    const v = sh.getDataRange().getValues();
    const h = v.findIndex(r => r.some(c => /employee name/i.test(String(c))));
    if (h < 0) return false;
    found = { values: v, head: h };
    return true;
  });
  if (!found) {
    ui.alert('No tab with an "Employee Name" column was found in that sheet.');
    return;
  }
  const head = found.values[found.head].map(c => String(c).toLowerCase());
  const col = re => head.findIndex(c => re.test(c));
  const cName = col(/employee name/), cDes = col(/designation/), cBasic = col(/basic/), cAdv = col(/advance/);

  const people = [];
  for (let i = found.head + 1; i < found.values.length; i++) {
    const r = found.values[i];
    const name = String(r[cName]).trim();
    if (!name || /^total$/i.test(name)) continue;
    people.push({
      name: name,
      designation: cDes >= 0 ? String(r[cDes]).trim() : '',
      basicSalary: cBasic >= 0 ? num_(r[cBasic]) : 0,
      advance: cAdv >= 0 ? num_(r[cAdv]) : 0,
    });
  }
  const ok = ui.alert('Import salary sheet',
    'Found ' + people.length + ' employees. Employees with the same name are updated, others are added. ' +
    'Heads of department and investors are set to no absence deduction. ' +
    'Advances are recorded for ' + month + ' (replacing any earlier import for that month) but not added to the cash book. Continue?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  ACTOR = { id: '', name: 'Salary sheet import' };
  withLock_(() => {
    const byName = {};
    employees_().forEach(e => { byName[e.name.toLowerCase()] = e; });
    const s = readSettings_();
    const payRows = readRows_(TABS.PAY).filter(p => !(String(p.source) === 'import' && String(p.month) === month));
    const now = new Date();
    people.forEach(p => {
      const old = byName[p.name.toLowerCase()];
      const emp = saveEmployee_({
        id: old ? old.id : '',
        name: p.name,
        designation: p.designation,
        basicSalary: p.basicSalary,
        phone: old ? old.phone : '',
        joinDate: old ? old.joinDate : '',
        // Investors and heads of department are paid in full regardless of attendance.
        trackAttendance: old ? old.trackAttendance : !NO_DEDUCTION.test(p.designation),
        active: true,
      });
      if (p.advance > 0) {
        payRows.push({
          id: Utilities.getUuid(), date: month + '-01', employeeId: emp.id, month: month, type: 'ADVANCE', amount: p.advance,
          method: s.methods[0], note: 'Imported from salary sheet', txnId: '', source: 'import', createdAt: now,
        });
      }
    });
    const sh = sheet_(TABS.PAY);
    const H = TABS.PAY.headers;
    const n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 1, n - 1, H.length).clearContent();
    if (payRows.length) sh.getRange(2, 1, payRows.length, H.length).setValues(payRows.map(p => toRow_(TABS.PAY, p)));
    audit_('add', 'SalaryPayments', 'import-' + month, 'Imported ' + people.length + ' employees and their advances for ' + month, null, null);
  });
  ui.alert('Imported ' + people.length + ' employees.');
}

// ───────────────────────────── Import old daily sheets ─────────────────────────────

/**
 * Reads every tab laid out like the old "DAILY CASH FLOW LEDGER" sheets and copies their rows into
 * Transactions. Running it again replaces the earlier import, so it is safe to repeat.
 *
 * Tabs named "Day1", "Day2", … take their date from the name (in the month of Day1's DATE cell),
 * because copied templates often keep an old date in the DATE cell.
 */
function importLegacySheets() {
  const ui = SpreadsheetApp.getUi();
  ensureTabs_();
  const plan = planLegacyImport_(readLegacyTabs_(), readSettings_(), readCategories_());
  if (!plan.days.length) {
    ui.alert('No daily ledger sheets with entries were found.');
    return;
  }
  const lines = [
    'Found ' + plan.days.length + ' day(s) with entries, ' + plan.first + ' to ' + plan.last + ': ' + plan.txns.length + ' entries' +
      (plan.transfers ? ' (including ' + plan.transfers + ' transfer(s) between accounts)' : '') + '.',
  ];
  if (plan.dateFixes.length) lines.push('\nDates taken from the tab name (the DATE cell said otherwise): ' + plan.dateFixes.join(', ') + '.');
  if (plan.skipped.length) lines.push('\nSkipped because there is no amount:\n• ' + plan.skipped.slice(0, 12).join('\n• ') + (plan.skipped.length > 12 ? '\n• …and ' + (plan.skipped.length - 12) + ' more' : ''));
  if (plan.mismatches.length) lines.push('\nTotals that don\'t match the sheet\'s TOTAL row:\n• ' + plan.mismatches.join('\n• '));
  lines.push('\nUncategorized entries: ' + plan.uncategorized + ' (you can fix these later in the app).');
  lines.push('\nThis replaces anything imported before (entries added in the app are kept) and sets the opening balances for ' + plan.first + '. Continue?');
  const ok = ui.alert('Import old daily sheets', lines.join('\n'), ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  withLock_(() => {
    const H = TABS.TXN.headers;
    const sh = sheet_(TABS.TXN);
    const keep = readRows_(TABS.TXN).filter(r => String(r.source).indexOf('legacy:') !== 0);
    const rows = keep.concat(plan.txns).map(t => toRow_(TABS.TXN, t));
    const n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 1, n - 1, H.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, H.length).setValues(rows);

    const settings = { startDate: plan.first, methods: plan.methods };
    Object.keys(plan.opening).forEach(m => { settings['opening_' + m] = plan.opening[m]; });
    ACTOR = { id: '', name: 'Old sheet import' };
    saveSettings_(settings);
    saveCategories_(plan.categories);
    audit_('add', 'Transactions', 'import', 'Imported ' + plan.txns.length + ' entries from ' + plan.days.length + ' old daily sheet(s), ' + plan.first + ' to ' + plan.last, null, null);
  });
  ui.alert('Imported ' + plan.txns.length + ' entries. Your old sheets were not changed.');
}

/** Raw rows of every old-style ledger tab: { sheet, cellDate, rows, totalIn, totalOut }. */
function readLegacyTabs_() {
  const tz = tz_();
  const ours = Object.keys(TABS).map(k => TABS[k].name);
  const tabs = [];
  SpreadsheetApp.getActive().getSheets().forEach(sh => {
    if (ours.indexOf(sh.getName()) >= 0) return;
    const v = sh.getDataRange().getValues();
    if (!v.some(r => /DAILY CASH FLOW/i.test(String(r[0])))) return;
    const headRow = v.findIndex(r => String(r[0]).trim().toUpperCase() === 'SL');
    const dateRow = v.findIndex(r => /^DATE/i.test(String(r[0]).trim()));
    if (headRow < 0) return;
    const rawDate = dateRow >= 0 ? v[dateRow].slice(1).find(c => c instanceof Date) : null;
    const rows = [];
    let i = headRow + 1;
    for (; i < v.length && String(v[i][0]).trim().toUpperCase() !== 'TOTAL'; i++) rows.push(v[i]);
    const total = v[i] || [];
    tabs.push({
      sheet: sh.getName(),
      cellDate: rawDate ? Utilities.formatDate(rawDate, tz, 'yyyy-MM-dd') : '',
      rows: rows,
      totalIn: Number(total[3]) || 0,
      totalOut: Number(total[9]) || 0,
    });
  });
  return tabs;
}

/**
 * Turns raw ledger tabs into transactions. Pure: no sheet access, so it can be tested.
 * Columns: cash in B–E (invoice, description, amount, method), cash out H–K.
 */
function planLegacyImport_(tabs, s, catsIn) {
  const cats = { IN: catsIn.IN.slice(), OUT: catsIn.OUT.slice() };
  const methods = s.methods.slice();
  const dayNo = name => {
    const m = String(name).match(/^\s*day\s*0?(\d{1,2})\s*$/i);
    return m ? Number(m[1]) : 0;
  };
  // Month for "DayN" tabs: from Day1's DATE cell, else the most common month among DATE cells.
  const day1 = tabs.find(t => dayNo(t.sheet) === 1 && t.cellDate);
  const months = {};
  tabs.forEach(t => { if (t.cellDate) months[t.cellDate.slice(0, 7)] = (months[t.cellDate.slice(0, 7)] || 0) + 1; });
  const anchor = day1 ? day1.cellDate.slice(0, 7) : Object.keys(months).sort((a, b) => months[b] - months[a])[0];
  const dateFixes = [];
  const dated = tabs.map(t => {
    const n = dayNo(t.sheet);
    let date = t.cellDate;
    if (n && anchor) {
      const lastDay = new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0).getDate();
      if (n <= lastDay) {
        date = anchor + '-' + String(n).padStart(2, '0');
        if (t.cellDate && t.cellDate !== date) dateFixes.push(t.sheet + ' → ' + date);
      }
    }
    return Object.assign({}, t, { date: date });
  }).filter(t => t.date);

  const methodOf = raw => {
    const r = String(raw).trim();
    if (!r) return methods[0];
    const hit = methods.find(m => m.toLowerCase() === r.toLowerCase());
    if (hit) return hit;
    methods.push(r);
    return r;
  };

  const opening = {};
  const txns = [];
  const skipped = [];
  const mismatches = [];
  const usedDays = {};
  let transfers = 0;
  const now = new Date();
  const first = dated.map(t => t.date).sort()[0];

  dated.sort((a, b) => a.date.localeCompare(b.date) || a.sheet.localeCompare(b.sheet)).forEach(d => {
    const day = [];
    let sumIn = 0, sumOut = 0;
    d.rows.forEach(r => {
      [['IN', 1], ['OUT', 7]].forEach(spec => {
        const type = spec[0], c = spec[1];
        const desc = String(r[c + 1] === undefined ? '' : r[c + 1]).trim();
        const amount = Number(r[c + 2]);
        if (!(amount > 0)) {
          if (desc && !/^friday$/i.test(desc)) skipped.push(d.sheet + ': ' + desc);
          return;
        }
        if (type === 'IN') sumIn += amount; else sumOut += amount;
        const method = methodOf(r[c + 3]);
        if (type === 'IN' && /^OPENING\b/i.test(desc)) {
          // Opening balances become settings, not income; later days carry forward automatically.
          if (d.date === first) opening[method] = (opening[method] || 0) + amount;
          return;
        }
        day.push({ type: type, invoice: String(r[c] === undefined ? '' : r[c]).trim(), desc: desc, amount: amount, method: method });
      });
    });
    if (d.totalIn && Math.abs(d.totalIn - sumIn) > 0.5) mismatches.push(d.sheet + ' cash in: sheet says ' + d.totalIn + ', rows add up to ' + sumIn);
    if (d.totalOut && Math.abs(d.totalOut - sumOut) > 0.5) mismatches.push(d.sheet + ' cash out: sheet says ' + d.totalOut + ', rows add up to ' + sumOut);

    // "BKASH TO CASH" written once as cash out (from bKash) and once as cash in (to cash) is a transfer.
    const done = {};
    day.forEach((e, i) => {
      if (done[i] || e.type !== 'OUT') return;
      const m = e.desc.match(/^\s*(\w+)\s+TO\s+(\w+)\s*$/i);
      if (!m) return;
      const from = methods.find(x => x.toLowerCase() === m[1].toLowerCase());
      const to = methods.find(x => x.toLowerCase() === m[2].toLowerCase());
      if (!from || !to || from === to || e.method !== from) return;
      const j = day.findIndex((x, k) => !done[k] && k !== i && x.type === 'IN' && x.amount === e.amount && x.method === to &&
        x.desc.replace(/\s+/g, ' ').toUpperCase() === e.desc.replace(/\s+/g, ' ').toUpperCase());
      if (j < 0) return;
      done[i] = done[j] = true;
      transfers++;
      txns.push(legacyTxn_(d, { type: 'TRANSFER', invoice: '', desc: from + ' → ' + to, amount: e.amount, method: from, toMethod: to, category: 'Transfer' }, now));
    });
    day.forEach((e, i) => {
      if (done[i]) return;
      txns.push(legacyTxn_(d, Object.assign({}, e, { toMethod: '', category: legacyCategory_(e.desc, e.type, cats, e.invoice) }), now));
    });
    if (day.length) usedDays[d.date] = true;
  });

  const dayList = Object.keys(usedDays).sort();
  return {
    days: dayList, first: first, last: dayList[dayList.length - 1], txns: txns, opening: opening, methods: methods,
    categories: cats, dateFixes: dateFixes, skipped: skipped, mismatches: mismatches, transfers: transfers,
    uncategorized: txns.filter(t => t.category === 'Uncategorized').length,
  };
}

function legacyTxn_(d, e, now) {
  return {
    id: Utilities.getUuid(), date: d.date, type: e.type, invoice: e.invoice, description: e.desc || '(no description)',
    category: e.category, amount: e.amount, method: e.method, toMethod: e.toMethod || '', note: '',
    source: 'legacy:' + d.sheet, createdAt: now, updatedAt: now, createdBy: 'Old sheet import', updatedBy: '',
  };
}

/**
 * Category from an old description. Looks at every "(…)" in it, e.g. "MOBILE RECHARGE (UTILITY) - STAFF",
 * tolerating small typos ("(WORSHOP)", "(WORKSHOPO)"). New single-word labels become new categories.
 * Cash out with no category but an invoice number goes under "Invoice" (parts and work bought for a job).
 * `cats` is updated in place when a new category is created.
 */
function legacyCategory_(desc, type, cats, invoice) {
  const list = cats[type];
  const norm = x => String(x).toUpperCase().replace(/[^A-Z]/g, '');
  const groups = (String(desc).match(/\(([^()]*)\)/g) || []).map(g => g.slice(1, -1).trim());
  for (let i = 0; i < groups.length; i++) {
    const g = norm(groups[i]);
    if (g.length < 3) continue;
    const hit = list.find(c => {
      const n = norm(c);
      return n === g || (g.length >= 5 && (n.indexOf(g) === 0 || g.indexOf(n) === 0)) || (g.length >= 5 && editDistance_(n, g) <= 2);
    });
    if (hit) return hit;
  }
  if (type === 'OUT') {
    const fresh = groups.find(g => /^[A-Za-z]{3,20}$/.test(g));
    if (fresh) {
      const name = fresh.charAt(0).toUpperCase() + fresh.slice(1).toLowerCase();
      list.push(name);
      return name;
    }
    const d = String(desc).toUpperCase();
    const pick = name => list.find(c => c.toLowerCase() === name.toLowerCase());
    if (/COMMIS/.test(d) && pick('Commission')) return pick('Commission');
    if (String(invoice || '').trim()) {
      if (!pick('Invoice')) list.push('Invoice');
      return pick('Invoice');
    }
    return 'Uncategorized';
  }
  return list.indexOf('Customer Payment') >= 0 ? 'Customer Payment' : list[0];
}

function editDistance_(a, b) {
  const dp = [];
  for (let i = 0; i <= a.length; i++) dp.push([i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ───────────────────────────── Helpers ─────────────────────────────

function sheet_(tab) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tab.name);
  if (!sh) throw new Error('The "' + tab.name + '" tab is missing. In the Google Sheet, run M&M App → Set up / repair tabs.');
  return sh;
}

function readRows_(tab) {
  const sh = sheet_(tab);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const tz = tz_();
  return sh.getRange(2, 1, n, tab.headers.length).getValues()
    .map((r, i) => {
      const o = { _row: i + 2 };
      tab.headers.forEach((h, j) => { o[h] = cell_(r[j], tz); });
      return o;
    })
    .filter(o => o[tab.headers[0]] !== '');
}

function readRow_(tab, row) {
  const tz = tz_();
  const r = sheet_(tab).getRange(row, 1, 1, tab.headers.length).getValues()[0];
  const o = { _row: row };
  tab.headers.forEach((h, j) => { o[h] = cell_(r[j], tz); });
  return o;
}

function findRow_(tab, id) {
  const sh = sheet_(tab);
  const n = sh.getLastRow() - 1;
  if (id && n > 0) {
    const ids = sh.getRange(2, 1, n, 1).getValues();
    for (let i = 0; i < n; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  }
  throw new Error('That record was not found. It may have been deleted; refresh and try again.');
}

function deleteRowById_(tab, id) {
  sheet_(tab).deleteRow(findRow_(tab, id));
  return { deleted: true };
}

function toRow_(tab, obj) {
  return tab.headers.map(h => safe_(obj[h], h));
}

/** Keeps text as text: stops Sheets turning "1/2" into a date or "=..." into a formula. */
function safe_(v, field) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || DATE_FIELDS.indexOf(field) >= 0) return v;
  return v === '' ? v : "'" + v;
}

function cell_(v, tz) {
  if (v instanceof Date) {
    const t = Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
    return t.slice(10) === 'T00:00:00' ? t.slice(0, 10) : t;
  }
  return v;
}

function str_(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function tz_() {
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone();
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function codeError_(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
