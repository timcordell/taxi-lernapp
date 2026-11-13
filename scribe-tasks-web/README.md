# Scribe Tasks

Installierbare Web-App (PWA) für das iPhone: Text diktieren oder tippen, daraus
mehrere Aufgaben mit Fälligkeit erkennen und in **Microsoft To Do** oder
**Google Tasks** anlegen.

- Kein Server, keine KI, keine API-Schlüssel, keine Kosten.
- Statisches Hosting auf GitHub Pages; Text, Entwürfe und Einstellungen bleiben im Browser (localStorage).
- Kein Tracking, keine Analytics. Netzwerkverkehr gibt es nur zum gewählten Dienst.

## Bedienung

1. Text ins große Feld tippen oder mit der **Mikrofon-Taste der iPhone-Tastatur** diktieren.
   Der Mikrofon-Button der App (Web Speech API) erscheint nur, wenn der Browser ihn anbietet.
   In der installierten Home-Bildschirm-App funktioniert er unter iOS oft nicht.
2. **Aufgaben erkennen**: Jede Aufgabe wird zur Karte mit Kästchen, Titel, Datum, Uhrzeit und Löschen.
3. **N hinzufügen**: Die Aufgaben werden nacheinander gesendet, mit Fortschrittsanzeige.
   Duplikate (gleicher Titel unter den offenen Aufgaben der Zielliste) werden still übersprungen.
   Fehlgeschlagene Einträge bleiben stehen und lassen sich mit „Erneut senden“ wiederholen.
4. Ist die Anmeldung abgelaufen, erscheint „Neu anmelden“. Der Entwurf bleibt gespeichert.

### Was der Parser erkennt

| Eingabe | Ergebnis |
|---|---|
| `Ich muss morgen um 17 Uhr den Dienstplan erledigen` | „Den Dienstplan erledigen“, morgen 17:00 |
| `Peter Lustig am 27. nochmal im Laden besuchen` | nächster 27. |
| `übermorgen`, `heute`, `morgen früh` | relatives Datum |
| `Freitag`, `am Freitag` | nächster Freitag (heute eingeschlossen) |
| `nächsten Freitag` | nächster Freitag **nach** heute |
| `Ende der Woche` / `Ende nächster Woche` | Freitag dieser / nächster Woche |
| `am 3.12.`, `20. Dezember`, `in 3 Tagen`, `nächste Woche` | Datum |
| `um 17 Uhr`, `um 9:30`, `um halb 5`, `5 Uhr nachmittags` | Uhrzeit (ohne Datum: heute bzw. morgen, falls vorbei) |

Neue Aufgaben beginnen an Satzzeichen und an den Wörtern *außerdem, und dann, dann noch,
als Nächstes, ach ja, neue Aufgabe, nächste Aufgabe, zusätzlich*. An einem bloßen „und“
wird **nicht** getrennt („Brot und Milch kaufen“ bleibt eine Aufgabe).

### Wie die Fälligkeit beim Dienst ankommt

- **Microsoft To Do:** `dueDateTime` (Europe/Berlin). Mit Uhrzeit zusätzlich eine Erinnerung
  (`isReminderOn`, `reminderDateTime`), weil To Do die Uhrzeit der Fälligkeit nicht anzeigt.
- **Google Tasks:** Fälligkeit nur als Datum. Die Uhrzeit steht in den Notizen und als
  Suffix im Titel, z. B. „Arzt anrufen (17:00)“.

## Einrichtung

Die Client-IDs stehen in [`config.js`](config.js). Sie sind öffentlich und kein Geheimnis.
Ein Client-**Secret** wird nie gebraucht. Solange dort Platzhalter stehen, zeigt die App
für den Dienst einen Hinweis.

Im Folgenden ist `https://NUTZER.github.io/scribe-tasks/` die Pages-URL.

### 1. GitHub Pages

Repository → *Settings → Pages → Build and deployment*: *Deploy from a branch*,
Branch `main`, Ordner `/ (root)`. Die Datei `.nojekyll` ist schon vorhanden.

### 2. Google (Projekt „Scribe“ in der Google Cloud Console)

1. *APIs & Dienste → Bibliothek*: **Google Tasks API** aktivieren.
2. *OAuth-Zustimmungsbildschirm*: Nutzertyp „Extern“, Status „Testen“, eigene Google-Adresse
   als **Testnutzer** eintragen, Scope `…/auth/tasks` hinzufügen.
3. *Anmeldedaten → OAuth-Client-ID → Webanwendung*:
   - **Autorisierte JavaScript-Quellen:** `https://NUTZER.github.io` (nur der Ursprung, ohne Pfad)
   - **Autorisierte Weiterleitungs-URIs:** `https://NUTZER.github.io/scribe-tasks/`
     (für die Anmeldung per Redirect in der Home-Bildschirm-App)
4. Client-ID in `config.js` bei `googleClientId` eintragen.

### 3. Microsoft Entra

1. *Microsoft Entra ID → App-Registrierungen → Neue Registrierung*.
2. Kontotypen: **Konten in einem beliebigen Organisationsverzeichnis und persönliche
   Microsoft-Konten**.
3. Umleitungs-URI: Plattform **Single-Page-Application (SPA)**, `https://NUTZER.github.io/scribe-tasks/`.
4. *API-Berechtigungen*: Microsoft Graph, delegiert: `Tasks.ReadWrite`, `User.Read`.
5. Anwendungs-ID (Client-ID) in `config.js` bei `microsoftClientId` eintragen.

> **Firmenkonten:** Ein Tenant-Administrator kann die Zustimmung für fremde Apps blockieren.
> Dann meldet die App „Zustimmung eines Administrators nötig“. Abhilfe schafft nur die IT
> oder ein persönliches Microsoft-Konto.

### iPhone

Seite in **Safari** öffnen → *Teilen* → **Zum Home-Bildschirm**. Die installierte App hat
einen eigenen Speicher, also dort einmal neu anmelden. Ein Google-Token gilt etwa eine Stunde;
danach erscheint „Neu anmelden“. Microsoft erneuert sich still im Hintergrund.

## Entwicklung

Es gibt keinen Build-Schritt. Die Seite läuft direkt aus den Dateien im Repository.
Bibliotheken kommen per npm und werden nach `vendor/` bzw. `fonts/` kopiert (und eingecheckt).

```bash
npm install
npm test            # Parser- und Sende-Tests (node --test)
npm run assets      # vendor/, fonts/, Icons und precache-manifest.js neu erzeugen
npm run precache    # nach jeder Dateiänderung: Service-Worker-Cache-Version aktualisieren
python3 -m http.server 8080   # lokal testen: http://localhost:8080
```

| Datei | Aufgabe |
|---|---|
| `js/parser.js` | Aufgabenerkennung (eigene Regeln + chrono-node `de`) |
| `js/sender.js` | Senden, Duplikatprüfung, Fehler/Retry, Abbruch bei 401 |
| `js/providers/google.js` | Google Identity Services + Tasks API |
| `js/providers/microsoft.js` | MSAL.js (PKCE, Redirect) + Microsoft Graph To Do |
| `js/app.js` | Oberfläche, Entwurf, Einstellungen |
| `sw.js`, `precache-manifest.js` | Offline-App-Shell |
| `scripts/` | Vendor-Kopie, Icon-Erzeugung, Precache-Liste |

Hinweis: Google Identity Services gibt es nicht als npm-Paket. Google erlaubt das Laden nur
von `accounts.google.com`. Das Skript wird deshalb erst geladen, wenn Google gewählt ist.
Im Home-Bildschirm-Modus nutzt die App stattdessen den OAuth-Redirect ohne Skript.

Lizenzen der eingebundenen Bibliotheken: `vendor/chrono-node/LICENSE.txt` (MIT),
`vendor/msal-browser.LICENSE` (MIT), `fonts/LICENSE` (OFL).
