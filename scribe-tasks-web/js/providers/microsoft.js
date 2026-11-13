/**
 * Microsoft To Do – Anmeldung über MSAL.js (Auth-Code-Flow mit PKCE, SPA)
 * und Microsoft Graph.
 *
 * - Nur Redirect-Anmeldung: Popups funktionieren im Home-Bildschirm-Modus von
 *   iOS nicht zuverlässig. Der Entwurf liegt vorher bereits in localStorage.
 * - To Do zeigt die Uhrzeit von dueDateTime nicht an. Deshalb wird bei einer
 *   Uhrzeit zusätzlich eine Erinnerung (reminderDateTime) gesetzt.
 */
import { CONFIG, isPlaceholder } from '../../config.js';
import { AuthError, ConfigError, apiFetch, appUrl, loadScript } from './common.js';
import { TIME_ZONE } from '../parser.js';

const SCOPES = ['Tasks.ReadWrite', 'User.Read'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

let pca = null;
let initPromise = null;

export const id = 'microsoft';
export const label = 'Microsoft To Do';
export const isConfigured = () => !isPlaceholder(CONFIG.microsoftClientId);

function requireConfig() {
  if (!isConfigured()) {
    throw new ConfigError('Für Microsoft fehlt die Client-ID in config.js (microsoftClientId).');
  }
}

/** Lädt MSAL (lokal aus vendor/), initialisiert es und verarbeitet eine Redirect-Antwort. */
export function prepare() {
  if (!isConfigured()) return Promise.resolve(null);
  if (!initPromise) {
    initPromise = (async () => {
      await loadScript(new URL('../../vendor/msal-browser.min.js', import.meta.url).href);
      pca = new window.msal.PublicClientApplication({
        auth: {
          clientId: CONFIG.microsoftClientId,
          authority: CONFIG.microsoftAuthority,
          redirectUri: appUrl(),
          postLogoutRedirectUri: appUrl(),
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await pca.initialize();
      const result = await pca.handleRedirectPromise();
      if (result?.account) pca.setActiveAccount(result.account);
      if (!pca.getActiveAccount()) {
        const [first] = pca.getAllAccounts();
        if (first) pca.setActiveAccount(first);
      }
      return result;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** Wertet beim Start eine Microsoft-Redirect-Antwort aus. */
export async function handleRedirect() {
  if (!isConfigured()) return false;
  try {
    const result = await prepare();
    return Boolean(result?.account);
  } catch (err) {
    return describeMsalError(err);
  }
}

function describeMsalError(err) {
  const code = err?.errorCode || '';
  const msg = err?.errorMessage || err?.message || String(err);
  if (/AADSTS65001|AADSTS90094|consent/i.test(msg)) {
    return 'Dein Firmenkonto braucht die Zustimmung eines Administrators für diese App. '
      + 'Bitte die IT fragen oder ein persönliches Microsoft-Konto verwenden.';
  }
  if (code === 'user_cancelled' || /AADSTS65004/.test(msg)) return 'Anmeldung abgebrochen.';
  return `Microsoft-Anmeldung fehlgeschlagen: ${msg.split('\n')[0]}`;
}

const account = () => pca?.getActiveAccount() || null;

export const isConnected = () => Boolean(account());
export const hasValidToken = () => Boolean(account()); // MSAL erneuert Token still
export const accountLabel = () => account()?.username || account()?.name || 'Microsoft-Konto verbunden';

/** Anmelden bzw. neu anmelden (verlässt die Seite per Redirect). */
export async function connect() {
  requireConfig();
  await prepare();
  const request = { scopes: SCOPES, prompt: 'select_account' };
  if (account()) {
    await pca.acquireTokenRedirect({ scopes: SCOPES, account: account() });
  } else {
    await pca.loginRedirect(request);
  }
  return new Promise(() => {}); // Seite wird verlassen
}

export async function disconnect() {
  await prepare();
  const acc = account();
  if (!acc) return;
  // Nur lokal abmelden (kein Redirect zur Microsoft-Abmeldeseite)
  await pca.clearCache({ account: acc });
  pca.setActiveAccount(null);
}

async function token() {
  requireConfig();
  await prepare();
  const acc = account();
  if (!acc) throw new AuthError('Nicht mit Microsoft verbunden');
  try {
    const result = await pca.acquireTokenSilent({ scopes: SCOPES, account: acc });
    return result.accessToken;
  } catch (err) {
    if (err instanceof window.msal.InteractionRequiredAuthError
      || /interaction_required|login_required|consent_required|no_tokens_found|refresh_token_expired/i.test(err?.errorCode || '')) {
      throw new AuthError('Microsoft-Anmeldung abgelaufen');
    }
    throw new Error(describeMsalError(err));
  }
}

async function getAll(url) {
  const items = [];
  let next = url;
  const t = await token();
  while (next) {
    const data = await apiFetch(next, t);
    items.push(...(data.value || []));
    next = data['@odata.nextLink'] || null;
  }
  return items;
}

/** @returns {Promise<{id: string, name: string}[]>} */
export async function getLists() {
  const lists = await getAll(`${GRAPH}/me/todo/lists`);
  // Standardliste ("Aufgaben") nach oben
  lists.sort((a, b) => (b.wellknownListName === 'defaultList') - (a.wellknownListName === 'defaultList'));
  return lists.map((l) => ({ id: l.id, name: l.displayName }));
}

/** Titel aller offenen Aufgaben einer Liste (für die Duplikatprüfung). */
export async function getOpenTitles(listId) {
  const filter = encodeURIComponent("status ne 'completed'");
  const items = await getAll(`${GRAPH}/me/todo/lists/${encodeURIComponent(listId)}/tasks?$filter=${filter}&$select=title&$top=100`);
  return items.map((t) => t.title || '');
}

/** Baut die Graph-Darstellung einer Aufgabe (exportiert für Tests). */
export function toGraphTask({ title, date, time }) {
  const body = { title };
  if (date) {
    body.dueDateTime = { dateTime: `${date}T00:00:00`, timeZone: TIME_ZONE };
    if (time) {
      body.isReminderOn = true;
      body.reminderDateTime = { dateTime: `${date}T${time}:00`, timeZone: TIME_ZONE };
    }
  }
  return body;
}

export async function createTask(listId, task) {
  return apiFetch(`${GRAPH}/me/todo/lists/${encodeURIComponent(listId)}/tasks`, await token(), {
    method: 'POST',
    body: JSON.stringify(toGraphTask(task)),
  });
}
