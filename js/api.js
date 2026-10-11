import { API_URL } from './config.js';
import { mockCall } from './mock.js';

const KEY = 'mm.session';

export const defaultApiUrl = API_URL;

export class ApiError extends Error {
  constructor(message, code = '') {
    super(message);
    this.code = code;
  }
}

// A session is { url, token, user } once signed in. `url` is 'demo' for the in-browser demo.
let memory = null;

export function getSession() {
  if (memory) return memory;
  for (const store of [localStorage, sessionStorage]) {
    try {
      const s = JSON.parse(store.getItem(KEY) || 'null');
      if (s && s.url && (s.token || s.url === 'demo')) return (memory = s);
    } catch { /* storage blocked */ }
  }
  return null;
}

let remembered = true;
export function saveSession(session, remember = remembered) {
  remembered = remember;
  clearSession();
  memory = session;
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
  } catch { /* storage blocked: session lasts until reload */ }
}

export function clearSession() {
  memory = null;
  for (const store of [localStorage, sessionStorage]) {
    try { store.removeItem(KEY); } catch { /* ignore */ }
  }
}

export const hasSession = () => !!getSession();
export const isDemo = () => getSession()?.url === 'demo';

/** Calls the server. Pass `server` to call before signing in (login, sign-up). */
export async function call(action, params = {}, server = null) {
  const session = server ? { url: server } : getSession();
  if (!session) throw new ApiError('Please sign in.', 'AUTH');
  if (session.url === 'demo') {
    try {
      return await mockCall(action, params);
    } catch (e) {
      throw new ApiError(e.message, e.code);
    }
  }
  let res;
  try {
    res = await fetch(session.url, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...params, action, token: session.token }),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your internet connection.', 'NETWORK');
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('The server sent an unexpected reply. Check the server URL.', 'BAD_RESPONSE');
  }
  if (!body.ok) throw new ApiError(body.error || 'Request failed.', body.code);
  return body.data;
}

export async function signOut() {
  try { await call('logout'); } catch { /* already signed out */ }
  clearSession();
}
