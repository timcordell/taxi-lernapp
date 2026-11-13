/**
 * Scribe Tasks – lokaler, deterministischer Aufgaben-Parser.
 *
 * Zerlegt diktierten oder getippten Freitext in einzelne Aufgaben und erkennt
 * Fälligkeitsdatum und Uhrzeit. Eigene Regeln laufen zuerst (sie decken die
 * typischen deutschen Diktier-Formulierungen exakt ab), chrono-node (Locale de)
 * dient als Rückfallebene für alles Weitere ("in 3 Wochen", "3. Dezember" …).
 *
 * Alle Datumswerte sind Wandzeit in Europe/Berlin und werden als einfache
 * Strings zurückgegeben: date = "YYYY-MM-DD" | null, time = "HH:MM" | null.
 * So gibt es keine Zeitzonen-Verschiebungen zwischen Parser, UI und API.
 */
import * as chronoDe from '../vendor/chrono-node/locales/de/index.js';

export const TIME_ZONE = 'Europe/Berlin';

/* ------------------------------------------------------------------ */
/* Datums-Hilfen (rechnen auf UTC-Basis, damit Sommerzeit egal ist)    */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const toUTC = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d));
const fromUTC = (dt) => ({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
const addDays = (day, n) => {
  const dt = toUTC(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
};
const weekdayOf = (day) => toUTC(day).getUTCDay(); // 0 = Sonntag
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const compareDay = (a, b) => toUTC(a) - toUTC(b);

export const formatDate = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
export const formatTime = ({ h, mi }) => `${pad(h)}:${pad(mi)}`;

/** Aktuelle Wandzeit in Europe/Berlin als {y, m, d, h, mi}. */
export function berlinNow(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

/* ------------------------------------------------------------------ */
/* Wortlisten und Regex-Bausteine                                      */
/* ------------------------------------------------------------------ */

// Wortgrenzen, die auch Umlaute korrekt behandeln (\b kennt kein "ä").
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
// Optionale Präpositionen vor einer Datumsangabe; werden mit entfernt.
const PRE = '(?:(?:bis|ab|für|fuer|spätestens|spaetestens|noch|am|zum|vom)\\s+)*';

const WEEKDAYS = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6,
};
const WD = `(${Object.keys(WEEKDAYS).join('|')})`;

const MONTHS = {
  januar: 1, jan: 1, jänner: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4,
  mai: 5, juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};
const MONTH_RE = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})`;

const NUMBER_WORDS = { ein: 1, einem: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };
const toNumber = (s) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()]);

/** Signalwörter, an denen eine neue Aufgabe beginnt (längere zuerst). Kein bloßes "und"! */
const SPLIT_WORDS = [
  'und außerdem', 'und ausserdem', 'und zusätzlich', 'und dann noch', 'und dann',
  'dann noch', 'als nächstes', 'als nächste', 'ach ja', 'neue aufgabe', 'nächste aufgabe',
  'zusätzlich', 'außerdem', 'ausserdem',
];
const SPLIT_RE = new RegExp(`${B}(?:${SPLIT_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})${E}`, 'giu');

/** Füllphrasen am Anfang eines Titels (längere zuerst). */
const LEADING_FILLERS = [
  'erinnere mich bitte daran dass ich', 'erinnere mich daran dass ich', 'erinner mich daran dass ich',
  'erinnere mich bitte daran', 'erinnere mich daran', 'erinner mich daran', 'erinnere mich',
  'nicht vergessen', 'vergiss nicht', 'denk daran', 'denke daran',
  'ich muss unbedingt', 'ich muss noch', 'ich muss', 'ich müsste', 'ich soll', 'ich sollte',
  'ich will', 'ich möchte', 'wir müssen', 'muss noch', 'bitte', 'noch', 'dass ich', 'und', 'dann',
  'also', 'okay', 'ok', 'ähm', 'äh',
];
const LEADING_RE = new RegExp(
  `^(?:${LEADING_FILLERS.map((w) => w.replace(/ /g, '[\\s,]+')).join('|')})${E}[\\s,:;-]*`, 'iu');
const TRAILING_RE = /[\s,]*(?:bitte|nicht vergessen)[\s.!]*$/iu;
const DANGLING_RE = new RegExp(`(?:^|\\s)(?:am|um|bis|ab|für|zum|vom|gegen|den)\\s*$`, 'iu');

/* ------------------------------------------------------------------ */
/* Datumsregeln                                                        */
/* ------------------------------------------------------------------ */

/** Nächstes Auftreten eines Wochentags; includeToday=false → strikt nach heute. */
function nextWeekday(today, wd, includeToday) {
  let diff = (wd - weekdayOf(today) + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(today, diff);
}

/** Nächstes Auftreten eines Tages im Monat (heute eingeschlossen), z. B. "am 27.". */
function nextDayOfMonth(today, d) {
  let { y, m } = today;
  for (let i = 0; i < 24; i++) {
    if (d <= daysInMonth(y, m) && (i > 0 || d >= today.d)) return { y, m, d };
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return null;
}

/** Datum mit Tag und Monat, ohne Jahr → dieses Jahr, falls schon vorbei nächstes Jahr. */
function nextDayMonth(today, d, m, yRaw) {
  let y = yRaw ? Number(yRaw) : today.y;
  if (yRaw && yRaw.length === 2) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  const candidate = { y, m, d };
  if (!yRaw && compareDay(candidate, today) < 0) {
    if (d > daysInMonth(y + 1, m)) return null;
    return { y: y + 1, m, d };
  }
  return candidate;
}

const DATE_RULES = [
  { // 03.12. / 3.12.2026 / 3.12.26
    re: `${B}${PRE}(?:den\\s+)?(\\d{1,2})\\.\\s?(\\d{1,2})\\.(?:\\s?(\\d{4}|\\d{2})${E})?`,
    date: (mt, t) => nextDayMonth(t, Number(mt[1]), Number(mt[2]), mt[3]),
  },
  { // 27. Dezember / 3. Jan 2027
    re: `${B}${PRE}(?:den\\s+)?(\\d{1,2})\\.?\\s*${MONTH_RE}\\.?(?:\\s+(\\d{4}))?${E}`,
    date: (mt, t) => nextDayMonth(t, Number(mt[1]), MONTHS[mt[2].toLowerCase()], mt[3]),
  },
  { // am 27. → nächstes Auftreten dieses Tages
    re: `${B}(?:(?:bis|ab|spätestens)\\s+)?(?:am|zum|den|dem)\\s+(\\d{1,2})\\.(?!\\s?\\d)`,
    date: (mt, t) => (Number(mt[1]) >= 1 && Number(mt[1]) <= 31 ? nextDayOfMonth(t, Number(mt[1])) : null),
  },
  {
    re: `${B}${PRE}übermorgen${E}`,
    date: (_, t) => addDays(t, 2),
  },
  { // "heute", auch "heute Abend", "heute Morgen"
    re: `${B}${PRE}heute(?:\\s+(?:morgen|früh|vormittag|mittag|nachmittag|abend|nacht))?${E}`,
    date: (_, t) => t,
  },
  { // "morgen", aber nicht "am Morgen" / "guten Morgen"
    re: `${B}${PRE}(?<!(?:am|jeden|guten|den|heute)\\s)morgen(?:\\s+(?:früh|vormittag|mittag|nachmittag|abend))?${E}`,
    date: (_, t) => addDays(t, 1),
  },
  { // Ende der Woche → Freitag dieser Woche (am Wochenende: der Sonntag)
    re: `${B}(?:bis\\s+)?(?:zum\\s+|am\\s+)?ende\\s+(?:der|dieser)\\s+woche${E}`,
    date: (_, t) => {
      const wd = weekdayOf(t);
      if (wd >= 1 && wd <= 5) return addDays(t, 5 - wd);
      return wd === 6 ? addDays(t, 1) : t;
    },
  },
  { // Ende nächster Woche → Freitag der nächsten Woche
    re: `${B}(?:bis\\s+)?(?:zum\\s+|am\\s+)?ende\\s+(?:der\\s+)?(?:nächsten|nächster|kommenden)\\s+woche${E}`,
    date: (_, t) => addDays(nextWeekday(t, 1, false), 4),
  },
  { // (am) Wochenende → Samstag
    re: `${B}${PRE}(?:dieses\\s+|diesem\\s+|nächstes\\s+|nächsten\\s+)?wochenende${E}`,
    date: (mt, t) => {
      const sat = nextWeekday(t, 6, true);
      return /nächst/i.test(mt[0]) && weekdayOf(t) !== 6 && weekdayOf(t) !== 0 ? addDays(sat, 7) : sat;
    },
  },
  { // nächste Woche → Montag der nächsten Woche
    re: `${B}${PRE}(?:anfang\\s+)?(?:nächste|nächster|kommende)\\s+woche${E}`,
    date: (_, t) => nextWeekday(t, 1, false),
  },
  { // nächsten Freitag → nächstes Auftreten strikt nach heute
    re: `${B}${PRE}(?:nächsten|nächste|nächster|kommenden|kommende)\\s+${WD}${E}`,
    date: (mt, t) => nextWeekday(t, WEEKDAYS[mt[1].toLowerCase()], false),
  },
  { // Freitag / am Freitag / diesen Freitag → nächstes Auftreten, heute eingeschlossen
    re: `${B}${PRE}(?:diesen\\s+|diese\\s+)?${WD}${E}`,
    date: (mt, t) => nextWeekday(t, WEEKDAYS[mt[1].toLowerCase()], true),
  },
  { // in 3 Tagen / in zwei Wochen
    re: `${B}(?:in|binnen)\\s+(\\d+|ein|einem|einer|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\\s+(tag|tagen|woche|wochen)${E}`,
    date: (mt, t) => addDays(t, toNumber(mt[1]) * (/^woche/i.test(mt[2]) ? 7 : 1)),
  },
].map((r) => ({ ...r, re: new RegExp(r.re, 'iu') }));

/* ------------------------------------------------------------------ */
/* Uhrzeitregeln                                                       */
/* ------------------------------------------------------------------ */

const PM_WORDS = /^(nachmittags|abends)$/i;

const TIME_RULES = [
  { // um 17 Uhr / 17:30 Uhr / um 5 Uhr nachmittags
    re: `${B}(?:(?:um|gegen|ab|bis)\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*uhr(?:\\s+(morgens|früh|vormittags|nachmittags|abends|nachts))?${E}`,
    time: (mt) => {
      let h = Number(mt[1]);
      if (mt[3] && PM_WORDS.test(mt[3]) && h < 12) h += 12;
      return { h, mi: Number(mt[2] || 0) };
    },
  },
  { // um 9:30 / gegen 14.15
    re: `${B}(?:um|gegen|ab|bis)\\s+(\\d{1,2})[:.](\\d{2})${E}(?!\\.)`,
    time: (mt) => ({ h: Number(mt[1]), mi: Number(mt[2]) }),
  },
  { // um halb 5 → 16:30 (kleine Stunden werden als Nachmittag gelesen)
    re: `${B}(?:um|gegen)\\s+halb\\s+(\\d{1,2})${E}`,
    time: (mt) => {
      let h = Number(mt[1]) - 1;
      if (h < 7) h += 12;
      return { h, mi: 30 };
    },
  },
].map((r) => ({ ...r, re: new RegExp(r.re, 'iu') }));

const validTime = (t) => t && t.h >= 0 && t.h <= 23 && t.mi >= 0 && t.mi <= 59;

/* ------------------------------------------------------------------ */
/* Text-Hilfen                                                         */
/* ------------------------------------------------------------------ */

const removeSpan = (text, mt) => `${text.slice(0, mt.index)} ${text.slice(mt.index + mt[0].length)}`;
const squash = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();

/** Entfernt Füllphrasen, Restpräpositionen und Satzzeichen; setzt den ersten Buchstaben groß. */
export function cleanTitle(raw) {
  let s = squash(raw).replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, '');
  for (let i = 0; i < 10; i++) {
    const before = s;
    s = s.replace(LEADING_RE, '').replace(TRAILING_RE, '').replace(DANGLING_RE, '');
    s = s.replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, '');
    if (s === before) break;
  }
  s = s.replace(/[.]+$/, '').trim();
  if (!s) return '';
  return s.charAt(0).toLocaleUpperCase('de-DE') + s.slice(1);
}

// Platzhalter für Punkte, an denen nicht getrennt werden darf (27. / 3.12. / Dr.)
const DOT = '\u0001';
const ABBREVIATIONS = /(?<![\p{L}])(dr|hr|fr|nr|ca|bzw|usw|str|st|tel|evtl|ggf|inkl|z\.\s?b|u\.\s?a|d\.\s?h)\./giu;

/** Zerlegt einen Text in Roh-Segmente (eine Aufgabe pro Segment). */
export function splitSegments(text) {
  const protectedText = String(text || '')
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, DOT))
    .replace(/(\d)\./g, `$1${DOT}`);
  return protectedText
    .split(/[.;!?\n\r•]+|,/)
    .flatMap((part) => part.split(SPLIT_RE))
    .map((part) => part.replaceAll(DOT, '.').trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

/* ------------------------------------------------------------------ */
/* Einzelnes Segment                                                   */
/* ------------------------------------------------------------------ */

function chronoFallback(text, now, needDate, needTime) {
  const ref = new Date(now.y, now.m - 1, now.d, now.h, now.mi);
  const results = chronoDe.parse(text, ref, { forwardDate: true });
  for (const r of results) {
    // "am Morgen" / "jeden Morgen" meint die Tageszeit, nicht "morgen" (= nächster Tag).
    if (/^morgen/i.test(r.text) && /(?:am|jeden|guten|den|heute)\s+$/i.test(text.slice(0, r.index))) continue;
    const s = r.start;
    const hasDate = s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month');
    const hasTime = s.isCertain('hour');
    if ((needDate && hasDate) || (needTime && hasTime)) {
      return {
        text: r.text,
        index: r.index,
        date: hasDate ? { y: s.get('year'), m: s.get('month'), d: s.get('day') } : null,
        time: hasTime ? { h: s.get('hour'), mi: s.get('minute') || 0 } : null,
      };
    }
  }
  return null;
}

/**
 * Analysiert ein Segment: erkennt Datum/Uhrzeit, entfernt sie aus dem Text
 * und bereinigt den Titel.
 */
export function parseSegment(segment, now) {
  const today = { y: now.y, m: now.m, d: now.d };
  let text = ` ${segment} `;
  let date = null;
  let time = null;

  for (const rule of DATE_RULES) {
    const mt = rule.re.exec(text);
    if (!mt) continue;
    const found = rule.date(mt, today);
    if (found) {
      date = found;
      text = removeSpan(text, mt);
      break;
    }
  }

  for (const rule of TIME_RULES) {
    const mt = rule.re.exec(text);
    if (!mt) continue;
    const found = rule.time(mt);
    if (validTime(found)) {
      time = found;
      text = removeSpan(text, mt);
      break;
    }
  }

  if (!date || !time) {
    const fb = chronoFallback(text, now, !date, !time);
    if (fb) {
      let used = false;
      if (!date && fb.date) { date = fb.date; used = true; }
      if (!time && fb.time) { time = fb.time; used = true; }
      if (used) text = `${text.slice(0, fb.index)} ${text.slice(fb.index + fb.text.length)}`;
    }
  }

  // Nur Uhrzeit genannt → heute, oder morgen, falls die Uhrzeit schon vorbei ist.
  if (time && !date) {
    const passed = time.h < now.h || (time.h === now.h && time.mi <= now.mi);
    date = passed ? addDays(today, 1) : today;
  }

  return {
    title: cleanTitle(text),
    date: date ? formatDate(date) : null,
    time: time ? formatTime(time) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

/**
 * Erkennt Aufgaben in einem Freitext.
 * @param {string} text  diktierter oder getippter Text
 * @param {{now?: {y,m,d,h,mi}}} [options]  Referenzzeit (Berlin-Wandzeit), Standard: jetzt
 * @returns {{title: string, date: string|null, time: string|null}[]}
 */
export function parseTasks(text, options = {}) {
  const now = options.now || berlinNow();
  const tasks = [];
  let carry = null; // Datum aus einem Segment ohne Titel ("Morgen. Müll rausbringen")

  for (const segment of splitSegments(text)) {
    const task = parseSegment(segment, now);
    if (!task.title) {
      if (task.date) carry = { date: task.date, time: task.time };
      continue;
    }
    if (carry && !task.date) {
      task.date = carry.date;
      task.time = task.time || carry.time;
    }
    carry = null;
    tasks.push(task);
  }
  return tasks;
}
