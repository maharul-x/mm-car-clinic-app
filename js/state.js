import { call, getSession, saveSession } from './api.js';

export const state = { meta: null, user: null };

/** Loads settings + categories and refreshes the signed-in user's permissions. */
export async function loadMeta() {
  const [meta, me] = await Promise.all([call('meta'), call('me')]);
  state.meta = meta;
  state.user = me.user;
  const s = getSession();
  if (s) saveSession({ ...s, user: me.user });
  return meta;
}

export const settings = () => state.meta.settings;
export const methods = () => state.meta.settings.methods;
export const categories = type => state.meta.categories[type] || [];
export const methodLabel = m => (m === 'Cash' ? 'Cash in hand' : m === 'Bkash' ? 'bKash' : m);

export const SECTIONS = [
  ['cash', 'Cash book'],
  ['report', 'Monthly report'],
  ['inventory', 'Inventory'],
  ['attendance', 'Attendance'],
  ['salary', 'Salary sheet'],
  ['employees', 'Employees'],
  ['settings', 'Settings'],
];
const RANK = { none: 0, view: 1, edit: 2 };

/** Can the signed-in user do `level` ('view' | 'edit') in any of `sections`? Mirrors the server's check. */
export function can(sections, level = 'view') {
  const u = state.user;
  if (!u) return false;
  if (u.isAdmin) return true;
  return [].concat(sections).some(s => RANK[u.perms?.[s] || 'none'] >= RANK[level]);
}

export const isAdmin = () => !!state.user?.isAdmin;
