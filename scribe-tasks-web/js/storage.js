/**
 * Dünne Hülle um localStorage. Alles bleibt auf dem Gerät; Fehler (z. B. privater
 * Modus, Speicher voll) werden geschluckt, damit die App weiter funktioniert.
 */
const PREFIX = 'scribe-tasks:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignorieren */
  }
}

const DEFAULT_SETTINGS = {
  provider: 'microsoft',  // 'microsoft' | 'google'
  lists: {},               // { microsoft: {id, name}, google: {id, name} }
  defaultTime: '',         // '' = keine Standard-Uhrzeit, sonst 'HH:MM'
};

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...load('settings', {}) });
export const saveSettings = (settings) => save('settings', settings);

/** Entwurf = Eingabetext + Kontrollliste; wird bei jeder Änderung gesichert. */
export const loadDraft = () => load('draft', { text: '', tasks: [] });
export const saveDraft = (draft) => save('draft', draft);
