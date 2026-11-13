// Tests für den Aufgaben-Parser. Ausführen mit: npm test  (oder: node --test test/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks, splitSegments, cleanTitle, berlinNow } from '../js/parser.js';

// Feste Referenz: Freitag, 13.11.2026, 10:00 Uhr (Berlin)
const NOW = { y: 2026, m: 11, d: 13, h: 10, mi: 0 };
const parse = (text, now = NOW) => parseTasks(text, { now });
const one = (text, now) => {
  const tasks = parse(text, now);
  assert.equal(tasks.length, 1, `genau eine Aufgabe erwartet: ${JSON.stringify(tasks)}`);
  return tasks[0];
};

test('Pflicht: "Ich muss morgen um 17 Uhr den Dienstplan erledigen"', () => {
  assert.deepEqual(one('Ich muss morgen um 17 Uhr den Dienstplan erledigen'),
    { title: 'Den Dienstplan erledigen', date: '2026-11-14', time: '17:00' });
});

test('Pflicht: "am 27." ergibt das nächste Auftreten des 27.', () => {
  assert.deepEqual(one('Peter Lustig am 27. nochmal im Laden besuchen'),
    { title: 'Peter Lustig nochmal im Laden besuchen', date: '2026-11-27', time: null });
});

test('"am 27." nach dem 27. springt in den Folgemonat', () => {
  assert.equal(one('Peter Lustig am 27. besuchen', { ...NOW, d: 28 }).date, '2026-12-27');
});

test('"am 27." am 27. selbst bleibt heute', () => {
  assert.equal(one('am 27. Peter besuchen', { ...NOW, d: 27 }).date, '2026-11-27');
});

test('"am 31." überspringt Monate ohne 31. Tag', () => {
  assert.equal(one('am 31. Miete prüfen', { ...NOW, m: 11, d: 1 }).date, '2026-12-31');
});

test('Pflicht: Signalwörter und Komma ergeben drei Aufgaben', () => {
  const tasks = parse('Angebot schreiben, außerdem Freitag Bestellung prüfen und dann Mama anrufen');
  assert.deepEqual(tasks, [
    { title: 'Angebot schreiben', date: null, time: null },
    { title: 'Bestellung prüfen', date: '2026-11-13', time: null },
    { title: 'Mama anrufen', date: null, time: null },
  ]);
});

test('Pflicht: Aufgabe ohne Datum bleibt ohne Fälligkeit', () => {
  assert.deepEqual(one('Steuererklärung vorbereiten'),
    { title: 'Steuererklärung vorbereiten', date: null, time: null });
});

test('Ein bloßes "und" trennt nicht', () => {
  assert.equal(one('Brot und Milch kaufen').title, 'Brot und Milch kaufen');
});

test('übermorgen', () => {
  assert.deepEqual(one('übermorgen Reifen wechseln'),
    { title: 'Reifen wechseln', date: '2026-11-15', time: null });
});

test('"nächsten Freitag" ist strikt nach heute (heute ist Freitag)', () => {
  assert.equal(one('nächsten Freitag Zahnarzt anrufen').date, '2026-11-20');
});

test('"nächsten Freitag" an einem Mittwoch ist der kommende Freitag', () => {
  assert.equal(one('nächsten Freitag Zahnarzt anrufen', { ...NOW, d: 11 }).date, '2026-11-13');
});

test('"um 17 Uhr" ohne Datum → heute', () => {
  assert.deepEqual(one('um 17 Uhr Chef anrufen'), { title: 'Chef anrufen', date: '2026-11-13', time: '17:00' });
});

test('Uhrzeit, die heute schon vorbei ist → morgen', () => {
  assert.deepEqual(one('um 8 Uhr Chef anrufen'), { title: 'Chef anrufen', date: '2026-11-14', time: '08:00' });
});

test('"Ende der Woche" → Freitag dieser Woche', () => {
  assert.equal(one('Bericht bis Ende der Woche abgeben', { ...NOW, d: 10 }).date, '2026-11-13');
  assert.equal(one('Bericht bis Ende der Woche abgeben', { ...NOW, d: 10 }).title, 'Bericht abgeben');
});

test('Füllphrasen werden entfernt', () => {
  assert.equal(one('Erinnere mich daran die Blumen zu gießen').title, 'Die Blumen zu gießen');
  assert.equal(one('nicht vergessen: Müll rausbringen').title, 'Müll rausbringen');
  assert.equal(one('Bitte Rechnung bezahlen').title, 'Rechnung bezahlen');
  assert.equal(one('Ich soll den Keller aufräumen').title, 'Den Keller aufräumen');
});

test('Explizites Datum mit Uhrzeit', () => {
  assert.deepEqual(one('am 3.12. um 9:30 Termin beim Amt'),
    { title: 'Termin beim Amt', date: '2026-12-03', time: '09:30' });
});

test('Datum mit Monatsname', () => {
  assert.equal(one('Geschenk kaufen bis 20. Dezember').date, '2026-12-20');
});

test('Vergangenes Datum ohne Jahr → nächstes Jahr', () => {
  assert.equal(one('am 2.1. Inventur').date, '2027-01-02');
});

test('Weitere Signalwörter trennen', () => {
  const text = 'Auto waschen. Ach ja, Brief einwerfen. Neue Aufgabe Fenster putzen zusätzlich Garage aufräumen als Nächstes Rasen mähen dann noch Katze füttern';
  assert.deepEqual(parse(text).map((t) => t.title),
    ['Auto waschen', 'Brief einwerfen', 'Fenster putzen', 'Garage aufräumen', 'Rasen mähen', 'Katze füttern']);
});

test('"am Morgen" ist kein Datum', () => {
  assert.deepEqual(one('am Morgen joggen gehen'), { title: 'Am Morgen joggen gehen', date: null, time: null });
});

test('chrono-Rückfallebene: "in 3 Tagen" und "nächste Woche"', () => {
  assert.equal(one('in 3 Tagen Paket abholen').date, '2026-11-16');
  assert.equal(one('nächste Woche Urlaub planen').date, '2026-11-16');
});

test('Datum-Segment ohne Titel wird an die nächste Aufgabe weitergegeben', () => {
  assert.deepEqual(parse('Morgen. Müll rausbringen'),
    [{ title: 'Müll rausbringen', date: '2026-11-14', time: null }]);
});

test('Abkürzungen mit Punkt trennen nicht', () => {
  assert.deepEqual(splitSegments('Dr. Müller anrufen'), ['Dr. Müller anrufen']);
});

test('Leerer Text ergibt keine Aufgaben', () => {
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse('  ,. und dann  '), []);
});

test('cleanTitle setzt den ersten Buchstaben groß', () => {
  assert.equal(cleanTitle('  äpfel kaufen '), 'Äpfel kaufen');
});

test('berlinNow rechnet in Europe/Berlin (Sommer- und Winterzeit)', () => {
  assert.deepEqual(berlinNow(new Date('2026-07-01T22:30:00Z')), { y: 2026, m: 7, d: 2, h: 0, mi: 30 });
  assert.deepEqual(berlinNow(new Date('2026-12-31T23:15:00Z')), { y: 2027, m: 1, d: 1, h: 0, mi: 15 });
});
