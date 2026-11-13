// Tests für Sende-Logik und API-Abbildung. Ausführen mit: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTasks, normalizeTitle } from '../js/sender.js';
import { AuthError } from '../js/providers/common.js';
import { toGoogleTask } from '../js/providers/google.js';
import { toGraphTask } from '../js/providers/microsoft.js';

const item = (id, title, date = null, time = null) => ({ id, title, date, time });

function fakeProvider({ open = [], failOn = [], authOn = [] } = {}) {
  const created = [];
  return {
    created,
    getOpenTitles: async () => open,
    createTask: async (_listId, task) => {
      if (authOn.includes(task.title)) throw new AuthError();
      if (failOn.includes(task.title)) throw new Error('Serverfehler');
      created.push(task.title);
    },
  };
}

test('normalizeTitle ignoriert Groß-/Kleinschreibung, Satzzeichen und Uhrzeit-Suffix', () => {
  assert.equal(normalizeTitle('  Mama   anrufen! '), 'mama anrufen');
  assert.equal(normalizeTitle('Arzt anrufen (17:00)'), normalizeTitle('arzt anrufen'));
});

test('Duplikate in der Zielliste und im Durchlauf werden übersprungen', async () => {
  const provider = fakeProvider({ open: ['Mama anrufen'] });
  const statuses = {};
  const res = await sendTasks({
    items: [item('1', 'mama anrufen'), item('2', 'Brot kaufen'), item('3', 'Brot kaufen.')],
    provider, listId: 'L', onStatus: (id, s) => { statuses[id] = s; },
  });
  assert.deepEqual(provider.created, ['Brot kaufen']);
  assert.deepEqual(res, { added: 1, duplicates: 2, failed: 0, authError: null });
  assert.deepEqual(statuses, { 1: 'duplicate', 2: 'done', 3: 'duplicate' });
});

test('Fehlgeschlagene Aufgaben werden markiert, der Rest läuft weiter', async () => {
  const provider = fakeProvider({ failOn: ['B'] });
  const statuses = {};
  const res = await sendTasks({
    items: [item('a', 'A'), item('b', 'B'), item('c', 'C')],
    provider, listId: 'L', onStatus: (id, s) => { statuses[id] = s; },
  });
  assert.equal(res.failed, 1);
  assert.equal(statuses.b, 'error');
  assert.deepEqual(provider.created, ['A', 'C']);
});

test('AuthError bricht ab und lässt Rest unverändert', async () => {
  const provider = fakeProvider({ authOn: ['B'] });
  const statuses = {};
  const res = await sendTasks({
    items: [item('a', 'A'), item('b', 'B'), item('c', 'C')],
    provider, listId: 'L', onStatus: (id, s) => { statuses[id] = s; },
  });
  assert.ok(res.authError instanceof AuthError);
  assert.deepEqual(statuses, { a: 'done', b: 'idle' });
});

test('Google: Uhrzeit in Titel-Suffix und Notizen, Fälligkeit nur Datum', () => {
  assert.deepEqual(toGoogleTask(item('1', 'Arzt anrufen', '2026-11-14', '17:00')), {
    title: 'Arzt anrufen (17:00)', due: '2026-11-14T00:00:00.000Z', notes: 'Uhrzeit: 17:00 Uhr',
  });
  assert.deepEqual(toGoogleTask(item('1', 'Ohne Datum')), { title: 'Ohne Datum' });
});

test('Microsoft: dueDateTime in Europe/Berlin, Erinnerung nur mit Uhrzeit', () => {
  assert.deepEqual(toGraphTask(item('1', 'Dienstplan', '2026-11-14', '17:00')), {
    title: 'Dienstplan',
    dueDateTime: { dateTime: '2026-11-14T00:00:00', timeZone: 'Europe/Berlin' },
    isReminderOn: true,
    reminderDateTime: { dateTime: '2026-11-14T17:00:00', timeZone: 'Europe/Berlin' },
  });
  assert.deepEqual(toGraphTask(item('1', 'Nur Datum', '2026-11-27')), {
    title: 'Nur Datum',
    dueDateTime: { dateTime: '2026-11-27T00:00:00', timeZone: 'Europe/Berlin' },
  });
});
