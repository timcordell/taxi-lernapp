/**
 * Sendet markierte Aufgaben nacheinander an einen Dienst.
 * - Duplikate (gleicher normalisierter Titel unter den offenen Aufgaben der
 *   Zielliste oder bereits in diesem Durchlauf gesendet) werden still übersprungen.
 * - Fehler betreffen nur die einzelne Aufgabe; sie bleibt für einen Retry stehen.
 * - Ein AuthError bricht den Durchlauf ab; nicht gesendete Aufgaben bleiben unverändert.
 */
import { AuthError } from './providers/common.js';

/** Normalisiert Titel für den Duplikatvergleich. */
export function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFKC')
    .replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, '') // Uhrzeit-Suffix aus Google Tasks
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * @param {object} opts
 * @param {{id: string, title: string, date: ?string, time: ?string}[]} opts.items
 * @param {{getOpenTitles: Function, createTask: Function}} opts.provider
 * @param {string} opts.listId
 * @param {(id: string, status: string, error?: string) => void} [opts.onStatus]
 * @returns {Promise<{added: number, duplicates: number, failed: number, authError: ?AuthError}>}
 */
export async function sendTasks({ items, provider, listId, onStatus = () => {} }) {
  const summary = { added: 0, duplicates: 0, failed: 0, authError: null };
  if (!items.length) return summary;

  let existing;
  try {
    existing = new Set((await provider.getOpenTitles(listId)).map(normalizeTitle));
  } catch (err) {
    if (err instanceof AuthError) {
      summary.authError = err;
      return summary;
    }
    items.forEach((item) => onStatus(item.id, 'error', `Zielliste nicht lesbar: ${err.message}`));
    summary.failed = items.length;
    return summary;
  }

  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (existing.has(key)) {
      summary.duplicates += 1;
      onStatus(item.id, 'duplicate');
      continue;
    }
    onStatus(item.id, 'sending');
    try {
      await provider.createTask(listId, item);
      existing.add(key);
      summary.added += 1;
      onStatus(item.id, 'done');
    } catch (err) {
      if (err instanceof AuthError) {
        onStatus(item.id, 'idle');
        summary.authError = err;
        break;
      }
      summary.failed += 1;
      onStatus(item.id, 'error', err.message || String(err));
    }
  }
  return summary;
}
