/**
 * Google Tasks – Anmeldung über Google Identity Services (Token-Modell).
 *
 * Besonderheiten:
 * - GIS gibt es nicht als npm-Paket; Google erlaubt nur das Laden von
 *   accounts.google.com. Das Skript wird deshalb erst geladen, wenn Google
 *   als Dienst gewählt ist.
 * - Im Home-Bildschirm-Modus von iOS sind Popups unzuverlässig. Dort (oder wenn
 *   GIS nicht lädt) nutzen wir denselben OAuth-Token-Ablauf per Redirect.
 * - Google Tasks speichert nur ein Fälligkeitsdatum. Eine Uhrzeit landet in den
 *   Notizen und als Suffix im Titel, z. B. "Arzt anrufen (17:00)".
 */
import { CONFIG, isPlaceholder } from '../../config.js';
import { AuthError, ConfigError, apiFetch, appUrl, isStandalone, loadScript } from './common.js';
import { load, save, remove } from '../storage.js';

const SCOPE = 'https://www.googleapis.com/auth/tasks';
const API = 'https://tasks.googleapis.com/tasks/v1';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'google-token';
const STATE_KEY = 'google-oauth-state';

let tokenClient = null;
let pending = null; // { resolve, reject } für den laufenden Popup-Login

export const id = 'google';
export const label = 'Google Tasks';
export const isConfigured = () => !isPlaceholder(CONFIG.googleClientId);

function requireConfig() {
  if (!isConfigured()) {
    throw new ConfigError('Für Google fehlt die Client-ID in config.js (googleClientId).');
  }
}

function storeToken(accessToken, expiresInSec) {
  // 60 s Puffer, damit kein Token kurz vor Ablauf benutzt wird
  save(TOKEN_KEY, { accessToken, expiresAt: Date.now() + (Number(expiresInSec) - 60) * 1000 });
}

function currentToken() {
  const t = load(TOKEN_KEY, null);
  return t && t.expiresAt > Date.now() ? t.accessToken : null;
}

/** Wurde jemals verbunden? (Token kann trotzdem abgelaufen sein.) */
export const isConnected = () => load(TOKEN_KEY, null) !== null;
export const hasValidToken = () => currentToken() !== null;
export const accountLabel = () => (hasValidToken() ? 'Google-Konto verbunden' : 'Anmeldung abgelaufen');

/** Lädt GIS vorab, damit der Login-Klick das Popup ohne Verzögerung öffnen kann. */
export async function prepare() {
  if (!isConfigured() || tokenClient || isStandalone()) return;
  try {
    await loadScript(GIS_SRC);
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) {
          pending?.reject(new Error(`Google-Anmeldung fehlgeschlagen: ${resp.error}`));
        } else {
          storeToken(resp.access_token, resp.expires_in);
          pending?.resolve();
        }
        pending = null;
      },
      error_callback: (err) => {
        pending?.reject(new Error(err?.type === 'popup_closed'
          ? 'Anmeldefenster wurde geschlossen'
          : 'Google-Anmeldung fehlgeschlagen (Popup blockiert?)'));
        pending = null;
      },
    });
  } catch {
    tokenClient = null; // Redirect-Ablauf als Rückfallebene
  }
}

/** Startet den Redirect-Ablauf (verlässt die Seite). */
function redirectLogin() {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  save(STATE_KEY, state); // Safari kann sessionStorage beim Redirect verlieren
  const params = new URLSearchParams({
    client_id: CONFIG.googleClientId,
    redirect_uri: appUrl(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  return new Promise(() => {}); // Seite wird verlassen
}

/**
 * Wertet beim App-Start eine Redirect-Antwort von Google aus (#access_token=…).
 * @returns {boolean|string} true bei Erfolg, Fehlermeldung bei Fehler, false wenn nichts da war
 */
export function handleRedirect() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  const state = params.get('state');
  const expected = sessionStorage.getItem(STATE_KEY) || load(STATE_KEY, null);
  if (!state || state !== expected) return false; // nicht unsere Antwort (z. B. Microsoft)

  sessionStorage.removeItem(STATE_KEY);
  remove(STATE_KEY);
  history.replaceState(null, '', window.location.pathname + window.location.search);

  if (params.get('error')) return `Google-Anmeldung abgebrochen: ${params.get('error')}`;
  storeToken(params.get('access_token'), params.get('expires_in') || 3600);
  return true;
}

/** Anmelden bzw. neu anmelden. Muss direkt aus einem Klick heraus aufgerufen werden. */
export function connect() {
  requireConfig();
  if (!tokenClient) return redirectLogin();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    // prompt '' = kein erneutes Einverständnis, wenn bereits erteilt
    tokenClient.requestAccessToken({ prompt: isConnected() ? '' : 'consent' });
  });
}

export async function disconnect() {
  const token = load(TOKEN_KEY, null)?.accessToken;
  remove(TOKEN_KEY);
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch { /* offline: Token läuft ohnehin nach einer Stunde ab */ }
  }
}

function token() {
  requireConfig();
  const t = currentToken();
  if (!t) throw new AuthError('Google-Anmeldung abgelaufen');
  return t;
}

/** @returns {Promise<{id: string, name: string}[]>} */
export async function getLists() {
  const items = [];
  let pageToken = '';
  do {
    const data = await apiFetch(`${API}/users/@me/lists?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`, token());
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items.map((l) => ({ id: l.id, name: l.title }));
}

/** Titel aller offenen Aufgaben einer Liste (für die Duplikatprüfung). */
export async function getOpenTitles(listId) {
  const titles = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ showCompleted: 'false', showHidden: 'false', maxResults: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await apiFetch(`${API}/lists/${encodeURIComponent(listId)}/tasks?${q}`, token());
    titles.push(...(data.items || []).map((t) => t.title || ''));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return titles;
}

/** Baut die Google-Darstellung einer Aufgabe (exportiert für Tests). */
export function toGoogleTask({ title, date, time }) {
  const body = { title: time ? `${title} (${time})` : title };
  // Google wertet nur den Datumsteil aus; Mitternacht UTC verhindert Verschiebungen.
  if (date) body.due = `${date}T00:00:00.000Z`;
  if (time) body.notes = `Uhrzeit: ${time} Uhr`;
  return body;
}

export async function createTask(listId, task) {
  return apiFetch(`${API}/lists/${encodeURIComponent(listId)}/tasks`, token(), {
    method: 'POST',
    body: JSON.stringify(toGoogleTask(task)),
  });
}
