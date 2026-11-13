/**
 * Scribe Tasks – Oberfläche.
 * Zustand: Eingabetext + Kontrollliste (in localStorage als Entwurf gesichert)
 * und Einstellungen (Dienst, Zielliste, Standard-Uhrzeit).
 */
import { parseTasks } from './parser.js';
import { sendTasks } from './sender.js';
import { AuthError, ConfigError, isStandalone } from './providers/common.js';
import * as google from './providers/google.js';
import * as microsoft from './providers/microsoft.js';
import { load, save, loadSettings, saveSettings, loadDraft, saveDraft } from './storage.js';

const PROVIDERS = { google, microsoft };

const $ = (sel) => document.querySelector(sel);
const el = {
  input: $('#input'),
  parse: $('#btn-parse'),
  clear: $('#btn-clear'),
  mic: $('#btn-mic'),
  interim: $('#interim'),
  review: $('#review'),
  list: $('#task-list'),
  checkAll: $('#check-all'),
  count: $('#review-count'),
  addManual: $('#btn-add-manual'),
  actionBar: $('#action-bar'),
  send: $('#btn-send'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressLabel: $('#progress-label'),
  chip: $('#target-chip'),
  authBanner: $('#auth-banner'),
  reauth: $('#btn-reauth'),
  installBanner: $('#install-banner'),
  settings: $('#settings'),
  settingsBtn: $('#btn-settings'),
  configWarning: $('#config-warning'),
  accountStatus: $('#account-status'),
  connect: $('#btn-connect'),
  disconnect: $('#btn-disconnect'),
  listSelect: $('#list-select'),
  loadLists: $('#btn-load-lists'),
  defaultTime: $('#default-time'),
  noDefaultTime: $('#btn-no-default-time'),
  msHint: $('#ms-hint'),
  googleHint: $('#google-hint'),
  summary: $('#summary'),
  summaryList: $('#summary-list'),
  summaryNote: $('#summary-note'),
  toast: $('#toast'),
  template: $('#task-template'),
};

let settings = loadSettings();
const draft = loadDraft();
const state = {
  text: draft.text || '',
  // Status "sending" überlebt keinen Neustart → wieder auf "idle"
  tasks: (draft.tasks || []).map((t) => ({ ...t, status: t.status === 'sending' ? 'idle' : t.status })),
  sending: false,
};

const provider = () => PROVIDERS[settings.provider] || google;

// Dienste ohne Client-ID in config.js sind nicht wählbar → auf einen eingerichteten wechseln
if (!provider().isConfigured()) {
  const fallback = Object.keys(PROVIDERS).find((key) => PROVIDERS[key].isConfigured());
  if (fallback) {
    settings.provider = fallback;
    saveSettings(settings);
  }
}
const targetList = () => settings.lists?.[settings.provider] || null;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/* ------------------------------------------------------------------ */
/* Persistenz                                                          */
/* ------------------------------------------------------------------ */

let saveTimer = null;
function persistDraft(immediate = false) {
  clearTimeout(saveTimer);
  const write = () => saveDraft({
    text: state.text,
    tasks: state.tasks.map(({ id, title, date, time, selected, status, error }) => ({ id, title, date, time, selected, status, error })),
  });
  if (immediate) write();
  else saveTimer = setTimeout(write, 250);
}
// Beim Wechsel in den Hintergrund (iOS beendet Web-Apps gern) sofort sichern
document.addEventListener('visibilitychange', () => { if (document.hidden) persistDraft(true); });
window.addEventListener('pagehide', () => persistDraft(true));

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(message, ms = 3200) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ */
/* Kontrollliste                                                       */
/* ------------------------------------------------------------------ */

const STATUS_TEXT = {
  idle: '',
  sending: 'Wird gesendet …',
  done: '✓ Hinzugefügt',
  duplicate: 'Schon vorhanden – übersprungen',
  error: 'Fehlgeschlagen',
};

const nodes = new Map(); // task.id → <li>

/** Lässt ein Textfeld mit seinem Inhalt wachsen. */
function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}
window.addEventListener('resize', () => document.querySelectorAll('.task-title').forEach(autoGrow));

function createTaskNode(task) {
  const li = el.template.content.firstElementChild.cloneNode(true);
  li.dataset.id = task.id;
  const q = (s) => li.querySelector(s);
  const get = () => state.tasks.find((t) => t.id === task.id);

  q('input[type="checkbox"]').addEventListener('change', (e) => {
    get().selected = e.target.checked;
    renderTasks();
    persistDraft();
  });
  const titleEl = q('.task-title');
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } // Titel bleibt einzeilig
  });
  titleEl.addEventListener('input', (e) => {
    autoGrow(titleEl);
    const t = get();
    t.title = e.target.value;
    if (t.status === 'error' || t.status === 'duplicate') t.status = 'idle';
    updateCounts();
    persistDraft();
  });
  q('.task-date').addEventListener('change', (e) => {
    const t = get();
    t.date = e.target.value || null;
    if (!t.date) t.time = null;
    renderTasks();
    persistDraft();
  });
  q('.task-time').addEventListener('change', (e) => {
    get().time = e.target.value || null;
    renderTasks();
    persistDraft();
  });
  q('.task-delete').addEventListener('click', () => {
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    renderTasks();
    persistDraft();
  });
  q('.task-retry').addEventListener('click', () => runSend([get()]));
  return li;
}

function renderTasks() {
  const ids = new Set(state.tasks.map((t) => t.id));
  for (const [id, node] of nodes) {
    if (!ids.has(id)) { node.remove(); nodes.delete(id); }
  }

  state.tasks.forEach((task, index) => {
    let li = nodes.get(task.id);
    if (!li) {
      li = createTaskNode(task);
      nodes.set(task.id, li);
    }
    if (el.list.children[index] !== li) el.list.insertBefore(li, el.list.children[index] || null);

    const q = (s) => li.querySelector(s);
    const busy = state.sending;
    li.dataset.status = task.status || 'idle';
    li.classList.toggle('unselected', !task.selected);

    const cb = q('input[type="checkbox"]');
    cb.checked = Boolean(task.selected);
    cb.disabled = busy;

    const title = q('.task-title');
    if (document.activeElement !== title && title.value !== task.title) title.value = task.title;
    title.disabled = busy;

    const date = q('.task-date');
    date.value = task.date || '';
    date.classList.toggle('has-value', Boolean(task.date));
    date.disabled = busy;

    const time = q('.task-time');
    time.value = task.time || '';
    time.classList.toggle('has-value', Boolean(task.time));
    time.disabled = busy || !task.date;
    time.title = task.date ? '' : 'Erst ein Datum wählen';

    q('.task-delete').disabled = busy;

    const status = q('.task-status');
    const text = task.status === 'error' && task.error ? `Fehlgeschlagen: ${task.error}` : STATUS_TEXT[task.status || 'idle'];
    status.hidden = !text;
    q('.status-text').textContent = text;
    q('.task-retry').hidden = task.status !== 'error' || busy;
  });

  el.review.hidden = state.tasks.length === 0;
  el.actionBar.hidden = state.tasks.length === 0;
  // Erst messen, wenn die Liste sichtbar ist (versteckt ist scrollHeight 0)
  nodes.forEach((li) => autoGrow(li.querySelector('.task-title')));
  updateCounts();
}

function updateCounts() {
  const total = state.tasks.length;
  const selected = state.tasks.filter((t) => t.selected).length;
  const sendable = sendableTasks().length;

  el.checkAll.checked = total > 0 && selected === total;
  el.checkAll.indeterminate = selected > 0 && selected < total;
  el.checkAll.disabled = state.sending;
  el.count.textContent = `${selected} von ${total} markiert`;
  if (!state.sending) {
    el.send.textContent = `${sendable} hinzufügen`;
    el.send.disabled = sendable === 0;
  }
}

const sendableTasks = () => state.tasks.filter((t) => t.selected && t.title.trim() && t.status !== 'done');

el.checkAll.addEventListener('change', () => {
  const allSelected = state.tasks.every((t) => t.selected);
  state.tasks.forEach((t) => { t.selected = !allSelected; });
  renderTasks();
  persistDraft();
});

el.addManual.addEventListener('click', () => {
  const task = { id: uid(), title: '', date: null, time: null, selected: true, status: 'idle' };
  state.tasks.push(task);
  renderTasks();
  persistDraft();
  nodes.get(task.id)?.querySelector('.task-title').focus();
});

/* ------------------------------------------------------------------ */
/* Eingabe und Erkennung                                               */
/* ------------------------------------------------------------------ */

el.input.value = state.text;
el.input.addEventListener('input', () => {
  state.text = el.input.value;
  persistDraft();
});

el.clear.addEventListener('click', () => {
  state.text = '';
  el.input.value = '';
  persistDraft(true);
  el.input.focus();
});

el.parse.addEventListener('click', () => {
  stopDictation();
  const found = parseTasks(el.input.value);
  if (!found.length) {
    toast('Keine Aufgaben erkannt. Schreib z. B. „Morgen Müll rausbringen“.');
    return;
  }
  state.tasks = found.map((t) => ({
    id: uid(),
    title: t.title,
    date: t.date,
    time: t.time || (t.date && settings.defaultTime) || null,
    selected: true,
    status: 'idle',
  }));
  renderTasks();
  persistDraft(true);
  el.input.blur();
  el.review.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ------------------------------------------------------------------ */
/* Spracheingabe (Web Speech API, nur wenn vorhanden)                  */
/* ------------------------------------------------------------------ */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function stopDictation() {
  if (recognition) recognition.stop();
}

if (Recognition) {
  el.mic.hidden = false;
  el.mic.addEventListener('click', () => {
    if (recognition) { stopDictation(); return; }
    try {
      recognition = new Recognition();
    } catch {
      toast('Spracheingabe nicht verfügbar – nutze die Mikrofon-Taste der Tastatur.');
      return;
    }
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = true;
    const base = el.input.value.trimEnd();
    let finalText = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += `${r[0].transcript.trim()} `;
        else interim += r[0].transcript;
      }
      el.input.value = [base, finalText.trim()].filter(Boolean).join(base ? ' ' : '');
      state.text = el.input.value;
      el.interim.textContent = interim;
      persistDraft();
    };
    recognition.onerror = (event) => {
      const msg = {
        'not-allowed': 'Mikrofon nicht erlaubt.',
        'service-not-allowed': 'Spracheingabe hier nicht verfügbar.',
        'no-speech': 'Nichts gehört.',
        network: 'Spracheingabe braucht Internet.',
      }[event.error] || 'Spracheingabe fehlgeschlagen.';
      toast(`${msg} Tipp: Mikrofon-Taste der iPhone-Tastatur nutzen.`, 4500);
    };
    recognition.onend = () => {
      recognition = null;
      el.interim.textContent = '';
      el.mic.setAttribute('aria-pressed', 'false');
      el.mic.setAttribute('aria-label', 'Spracheingabe starten');
    };
    try {
      recognition.start();
      el.mic.setAttribute('aria-pressed', 'true');
      el.mic.setAttribute('aria-label', 'Spracheingabe beenden');
    } catch {
      recognition = null;
      toast('Spracheingabe nicht verfügbar – nutze die Mikrofon-Taste der Tastatur.');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Senden                                                              */
/* ------------------------------------------------------------------ */

function setProgress(done, total) {
  el.progress.hidden = false;
  el.progressFill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  el.progressLabel.textContent = `${done} / ${total}`;
  el.send.textContent = `Sende ${Math.min(done + 1, total)} von ${total} …`;
}

/** Prüft Konfiguration, Verbindung und Zielliste; öffnet sonst die Einstellungen. */
function readyToSend() {
  const p = provider();
  if (!p.isConfigured()) {
    openSettings();
    toast(`Für ${p.label} fehlt die Client-ID in config.js.`, 4500);
    return false;
  }
  if (!p.isConnected()) {
    openSettings();
    toast(`Bitte zuerst mit ${p.label} verbinden.`);
    return false;
  }
  if (!p.hasValidToken()) {
    showAuthBanner();
    return false;
  }
  if (!targetList()) {
    openSettings();
    toast('Bitte eine Zielliste wählen.');
    return false;
  }
  return true;
}

async function runSend(items) {
  if (state.sending || !items.length || !readyToSend()) return;
  stopDictation();
  state.sending = true;
  hideAuthBanner();
  el.send.disabled = true;
  items.forEach((t) => { t.status = 'idle'; t.error = null; });
  renderTasks();

  let finished = 0;
  setProgress(0, items.length);
  const result = await sendTasks({
    items: items.map((t) => ({ ...t, title: t.title.trim() })),
    provider: provider(),
    listId: targetList().id,
    onStatus: (id, status, error) => {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      t.status = status;
      t.error = error || null;
      if (['done', 'duplicate', 'error'].includes(status)) finished += 1;
      setProgress(finished, items.length);
      renderTasks();
      persistDraft();
    },
  });

  state.sending = false;
  el.progress.hidden = true;

  // Erledigte und übersprungene Einträge verschwinden, fehlgeschlagene bleiben stehen.
  state.tasks = state.tasks.filter((t) => t.status !== 'done' && t.status !== 'duplicate');
  if (!state.tasks.length) {
    state.text = '';
    el.input.value = '';
  }
  renderTasks();
  persistDraft(true);

  if (result.authError) showAuthBanner();
  if (result.added || result.duplicates || result.failed) showSummary(result);
}

el.send.addEventListener('click', () => runSend(sendableTasks()));

function showSummary({ added, duplicates, failed, authError }) {
  const rows = [
    [added, added === 1 ? 'Aufgabe hinzugefügt' : 'Aufgaben hinzugefügt', '✓'],
    [duplicates, duplicates === 1 ? 'Duplikat übersprungen' : 'Duplikate übersprungen', '↷'],
    [failed, 'fehlgeschlagen', '!'],
  ].filter(([n]) => n > 0);
  el.summaryList.replaceChildren(...rows.map(([n, text, icon]) => {
    const li = document.createElement('li');
    li.textContent = `${icon}  `;
    const b = document.createElement('span');
    b.className = 'n';
    b.textContent = n;
    li.append(b, ` ${text}`);
    return li;
  }));
  const target = targetList();
  const notes = [];
  if (added && target) notes.push(`Ziel: ${provider().label} · ${target.name}.`);
  if (failed) notes.push('Fehlgeschlagene Einträge bleiben in der Liste – „Erneut senden“ tippen.');
  if (authError) notes.push('Die Anmeldung ist abgelaufen; der Rest wartet in der Liste.');
  el.summaryNote.textContent = notes.join(' ');
  $('#summary-title').textContent = failed || authError ? 'Teilweise erledigt' : 'Fertig';
  el.summary.showModal();
}

/* ------------------------------------------------------------------ */
/* Anmeldung abgelaufen                                                */
/* ------------------------------------------------------------------ */

function showAuthBanner() {
  el.authBanner.hidden = false;
  el.authBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideAuthBanner() { el.authBanner.hidden = true; }

el.reauth.addEventListener('click', () => connectProvider());

async function connectProvider() {
  persistDraft(true); // Redirect verlässt die Seite – Entwurf vorher sichern
  try {
    await provider().connect();
    hideAuthBanner();
    toast(`Mit ${provider().label} verbunden`);
    refreshSettingsUI();
    if (!targetList()) await loadLists();
  } catch (err) {
    toast(err.message, 4500);
  }
}

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

function updateChip() {
  const p = provider();
  const list = targetList();
  let text;
  if (!p.isConfigured()) text = `${p.label} · nicht eingerichtet`;
  else if (!p.isConnected()) text = `${p.label} · nicht verbunden`;
  else text = `${p.label} · ${list ? list.name : 'Liste wählen'}`;
  el.chip.textContent = `Ziel: ${text}`;
  el.chip.classList.toggle('attention', !p.isConfigured() || !p.isConnected() || !list);
}

function fillListSelect() {
  const cached = settings.listCache?.[settings.provider] || [];
  const current = targetList();
  const options = cached.length ? cached : current ? [current] : [];
  el.listSelect.replaceChildren(...(options.length
    ? options.map((l) => new Option(l.name, l.id, false, l.id === current?.id))
    : [new Option('– erst laden –', '')]));
  el.listSelect.disabled = !options.length;
}

function refreshSettingsUI() {
  const p = provider();
  document.querySelectorAll('input[name="provider"]').forEach((r) => {
    const configured = PROVIDERS[r.value].isConfigured();
    r.checked = r.value === settings.provider;
    r.disabled = !configured && r.value !== settings.provider;
    r.nextElementSibling.dataset.note = configured ? '' : 'bald verfügbar';
  });

  el.configWarning.hidden = p.isConfigured();
  el.configWarning.textContent = `Für ${p.label} ist noch keine Client-ID eingetragen (config.js). `
    + 'Die Einrichtung steht in der README.';

  const connected = p.isConfigured() && p.isConnected();
  el.accountStatus.textContent = connected ? p.accountLabel() : 'Nicht verbunden';
  el.connect.textContent = connected ? 'Neu anmelden' : 'Verbinden';
  el.connect.disabled = !p.isConfigured();
  el.connect.hidden = connected && p.hasValidToken() && settings.provider === 'microsoft';
  el.disconnect.hidden = !connected;
  el.loadLists.disabled = !connected;
  el.msHint.hidden = settings.provider !== 'microsoft';
  el.googleHint.hidden = settings.provider !== 'google';

  el.defaultTime.value = settings.defaultTime || '';
  el.defaultTime.classList.toggle('has-value', Boolean(settings.defaultTime));
  el.noDefaultTime.disabled = !settings.defaultTime;
  fillListSelect();
  updateChip();
}

function openSettings() {
  refreshSettingsUI();
  if (!el.settings.open) el.settings.showModal();
}

async function loadLists() {
  const p = provider();
  el.loadLists.disabled = true;
  el.loadLists.textContent = 'Lädt …';
  try {
    const lists = await p.getLists();
    settings.listCache = { ...(settings.listCache || {}), [settings.provider]: lists };
    const current = targetList();
    const keep = current && lists.find((l) => l.id === current.id);
    settings.lists = { ...settings.lists, [settings.provider]: keep || lists[0] || null };
    saveSettings(settings);
    toast(lists.length ? `${lists.length} ${lists.length === 1 ? 'Liste' : 'Listen'} geladen` : 'Keine Listen gefunden');
  } catch (err) {
    if (err instanceof AuthError) {
      toast('Anmeldung abgelaufen – bitte neu anmelden.');
      showAuthBanner();
    } else {
      toast(err.message, 4500);
    }
  } finally {
    el.loadLists.textContent = 'Laden';
    refreshSettingsUI();
  }
}

el.settingsBtn.addEventListener('click', openSettings);
el.chip.addEventListener('click', openSettings);

document.querySelectorAll('input[name="provider"]').forEach((radio) => {
  radio.addEventListener('change', async () => {
    settings.provider = radio.value;
    saveSettings(settings);
    hideAuthBanner();
    refreshSettingsUI();
    try {
      await provider().prepare();
    } catch (err) {
      toast(err.message, 4500);
    }
    refreshSettingsUI();
  });
});

el.connect.addEventListener('click', () => connectProvider());

el.disconnect.addEventListener('click', async () => {
  await provider().disconnect();
  settings.lists = { ...settings.lists, [settings.provider]: null };
  settings.listCache = { ...(settings.listCache || {}), [settings.provider]: [] };
  saveSettings(settings);
  refreshSettingsUI();
  toast('Konto getrennt');
});

el.loadLists.addEventListener('click', loadLists);

el.listSelect.addEventListener('change', () => {
  const cached = settings.listCache?.[settings.provider] || [];
  const chosen = cached.find((l) => l.id === el.listSelect.value) || null;
  settings.lists = { ...settings.lists, [settings.provider]: chosen };
  saveSettings(settings);
  updateChip();
});

el.defaultTime.addEventListener('change', () => {
  settings.defaultTime = el.defaultTime.value || '';
  saveSettings(settings);
  refreshSettingsUI();
});
el.noDefaultTime.addEventListener('click', () => {
  settings.defaultTime = '';
  saveSettings(settings);
  refreshSettingsUI();
});

document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => $(`#${btn.dataset.closeDialog}`).close());
});
el.settings.addEventListener('close', updateChip);

/* ------------------------------------------------------------------ */
/* Installations-Hinweis (einmalig, nur iOS-Safari im Browser-Modus)   */
/* ------------------------------------------------------------------ */

function maybeShowInstallBanner() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  if (!isIOS || !isSafari || isStandalone() || load('install-banner-shown', false)) return;
  el.installBanner.hidden = false;
  save('install-banner-shown', true);
}
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => { $(`#${btn.dataset.close}`).hidden = true; });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function start() {
  renderTasks();
  updateChip();
  maybeShowInstallBanner();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline-Modus optional */ });
  }

  // 1) Google-Redirect (#access_token=…) auswerten
  const g = google.handleRedirect();
  if (g === true) {
    settings.provider = 'google';
    saveSettings(settings);
    toast('Mit Google verbunden');
  } else if (typeof g === 'string') {
    toast(g, 5000);
  }

  // 2) Microsoft: MSAL initialisieren und ggf. Redirect-Antwort verarbeiten
  const hashLooksLikeMsal = /[#&](code|error)=/.test(window.location.hash);
  if (settings.provider === 'microsoft' || hashLooksLikeMsal) {
    const m = await microsoft.handleRedirect();
    if (m === true) {
      settings.provider = 'microsoft';
      saveSettings(settings);
      toast('Mit Microsoft verbunden');
    } else if (typeof m === 'string') {
      toast(m, 6000);
    }
  }

  // 3) Google Identity Services vorladen (Popup-Login braucht den direkten Klick)
  if (settings.provider === 'google') google.prepare();

  refreshSettingsUI();

  // Nach frischer Anmeldung direkt die Listen laden
  const p = provider();
  if (p.isConfigured() && p.isConnected() && p.hasValidToken() && !targetList()) {
    await loadLists();
  }

  if (!state.tasks.length) el.input.focus();
}

window.addEventListener('error', (e) => {
  if (e.error instanceof ConfigError) toast(e.error.message, 5000);
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (err instanceof ConfigError || err instanceof AuthError) {
    toast(err.message, 5000);
    e.preventDefault();
  }
});

start();
