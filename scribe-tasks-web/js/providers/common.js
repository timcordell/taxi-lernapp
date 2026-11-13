/** Gemeinsame Hilfen für die Aufgaben-Dienste. */

/** Wird geworfen, wenn eine (Neu-)Anmeldung nötig ist (401, Token abgelaufen …). */
export class AuthError extends Error {
  constructor(message = 'Anmeldung erforderlich') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Fehlende Client-ID in config.js. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * fetch mit Bearer-Token und einheitlicher Fehlerbehandlung.
 * 401 → AuthError, sonst Error mit verständlicher Meldung.
 */
export async function apiFetch(url, token, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error(navigator.onLine === false ? 'Keine Internetverbindung' : 'Netzwerkfehler');
  }
  if (response.status === 401) throw new AuthError('Anmeldung abgelaufen');
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || body?.error_description || '';
    } catch { /* kein JSON */ }
    if (response.status === 403) throw new Error(`Keine Berechtigung (403)${detail ? `: ${detail}` : ''}`);
    if (response.status === 429) throw new Error('Zu viele Anfragen – kurz warten und erneut versuchen');
    throw new Error(`Fehler ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.status === 204 ? null : response.json();
}

/** Lädt ein Skript einmalig (für MSAL aus vendor/ und Google Identity Services). */
const scriptPromises = new Map();
export function loadScript(src) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        scriptPromises.delete(src);
        el.remove();
        reject(new Error(`Skript konnte nicht geladen werden: ${src}`));
      };
      document.head.append(el);
    }));
  }
  return scriptPromises.get(src);
}

/** Basis-URL der App (Ordner von index.html) – gleichzeitig Redirect-URI. */
export function appUrl() {
  const url = new URL('./', window.location.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

export const isStandalone = () =>
  window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
