# GGP – Entwicklungskonventionen

Verbindliche Konventionen für alle Module. Referenzimplementierung: Modul „Projekte"
(`server/routes/projects.js`, `public/js/views/portfolio.js`, `public/js/views/dashboard.js`).

## Architektur

- **Backend:** Node.js ≥ 22.5, Express, eingebautes `node:sqlite` (keine nativen Abhängigkeiten).
  Dateien: `server/db.js` (Zugriff), `server/schema.sql` (Schema), `server/auth.js` (Rollen/Rechte),
  `server/audit.js` (Audit-Trail), `server/routes/*.js` (ein Router je Fachmodul, gemountet unter `/api`).
- **Frontend:** No-Build-SPA, ES-Module unter `public/js/`, Hash-Router in `app.js`,
  ein View-Modul je Fachmodul unter `public/js/views/`.
- **PDF:** pdfkit, ausschließlich in `server/routes/reports.js` + `server/pdf/`.
- **Uploads:** multer über `require('./core').upload` (aus `server/routes/core.js`), Ablage in `UPLOAD_DIR`.

## Backend-Konventionen

```js
const express = require('express');
const { get, all, run, tx } = require('../db');          // prepared-statement-Helfer
const { now, today, ApiError, csvList } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireProject, canWriteGewerk } = require('../auth');

const router = express.Router();
router.use(requireAuth);                                   // alle Routen erfordern Anmeldung
```

- **Projektbezogene Routen:** `router.get('/projects/:projectId/…', requireProject('read'|'write'), …)`.
  `requireProject` prüft Mitgliedschaft (ROL-02), Schreibrechte (Rolle `leser` liest nur) und
  blockiert Schreiben in archivierte Projekte. Danach stehen `req.project` und `req.access`
  (`{memberRole, gewerke}`) zur Verfügung.
- **Objekt-Routen ohne projectId im Pfad** (z. B. `PATCH /checkpoints/:id`): Projekt-ID per
  Resolver ermitteln: `requireProject('write', (req) => get('SELECT project_id FROM … WHERE id = ?', Number(req.params.id))?.project_id ?? 0)`.
- **Gewerke-Einschränkung (ROL-03):** vor schreibenden Änderungen an gewerkegebundenen Objekten
  `if (!canWriteGewerk(req.access, objekt.gewerke)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk')`.
- **Fehler:** immer `throw new ApiError(status, 'deutsche Meldung')` bzw. `next(err)`. Antwortformat `{error}` kommt zentral.
- **Audit (ROL-06):** JEDE schreibende Aktion ruft `audit(req, projectId, objectTyp, objectId, action, details)`.
  Objekttypen: `checkpoint, room, planstand, document, meeting, protocol_item, task, journal, defect, contact, milestone, project, gewerk, user, template`.
  Aktionen: `erstellt, geaendert, status, kommentar, anhang, verknuepft, geloescht, …` –
  Statuswechsel mit `details = {status: {von, nach}}`, Feldänderungen `{feld: {von, nach}}`.
- **Pflicht-Begründungen hart erzwingen:** `nicht_relevant` ohne `relevanz_begruendung` → 400;
  Dokument `entfaellt` ohne `begruendung` → 400; Wiedereröffnen von `erledigt` ohne Kommentar → 400 (CHK-01/02, DOK-01).
- **Zeit:** `now()` (ISO-Zeitstempel) und `today()` (`YYYY-MM-DD`). Fachliche Datumsfelder als `YYYY-MM-DD`.
- **Gewerke-Mehrfachzuordnung:** CSV-Text (`'ELT,MT'`), Normalisierung mit `csvList()`.
- **Transaktionen:** mehrschrittige Schreibvorgänge in `tx(() => { … })`.
- **SQL:** ausschließlich Platzhalter `?`, niemals String-Interpolation von Nutzereingaben.
  Dynamische Filter: WHERE-Bedingungen und Parameter-Array parallel aufbauen.

## Frontend-Konventionen

```js
import { get, post, patch, del, upload, state } from '../api.js';
import { h, clear, kopfzeile, table, modal, confirmModal, toast, fehlerToast,
         feld, textInput, textArea, dateInput, select, gewerkSelect, gewerkeMehrfach,
         gewerkBadge, gewerkeBadges, statusBadge, badge, label, formatDate, formatDateTime,
         terminZelle, isOverdue, laden, leerHinweis } from '../ui.js';
import { objektZusatz } from '../objekt.js';

export async function renderModul(el, params, query) { … }   // Signatur aller Views
```

- `params` enthält Routen-Parameter (`params.projektId` als String), `query` die Query-Parameter
  des Hash (z. B. `#/projekt/3/checkliste?gewerk=ELT` → `query.gewerk === 'ELT'`).
- **Deep-Links:** Jede View öffnet bei passendem Query-Parameter direkt das Detail-Modal
  (`?punkt=ID`, `?raum=ID`, `?eintrag=ID`, `?mangel=ID`, `?aufgabe=ID`). Diese Links erzeugt `objekt.js`.
- **Detail-Modale:** `modal({title, body, actions, wide: true})`; unten immer
  `objektZusatz('<typ>', id, { projectId, readonly })` einbinden (Kommentare/Anhänge/Verknüpfungen/Verlauf).
- **Nach Änderungen:** `toast('…')` und Liste neu laden; Fehler mit `fehlerToast(e)`.
- **Schreibgeschützt:** Wenn Projekt `archiviert` oder Rolle `leser` ist (Dashboard liefert
  `zugriff.rolle`), Bearbeitungsknöpfe ausblenden bzw. `readonly` durchreichen. Server erzwingt zusätzlich.
- **Deutsch:** alle Beschriftungen deutsch, Status-Werte über `label()` übersetzen.
- Gewerke IMMER als farbige Badges (`gewerkeBadges(csv)`), nie nur als Farbe (UX-03).

## Datenkonventionen

- Statuswerte exakt wie in `server/schema.sql` (CHECK-Constraints) – siehe dort.
- Protokollpunkt-Codes: `PB` (planung), `BB` (bau), `LK` (lenkung), `SO` (sonstige) + `-` + dreistellige Nummer (`BB-014`), fortlaufend je Projekt und Typ (UNIQUE-Constraint nutzt `nummer`).
- Mangel-Nummern: fortlaufend je Projekt, Anzeige `M-001`.
- Aufgaben-Sync (PRO-06): Protokollpunkt `typ='aufgabe'` erzeugt eine Aufgabe
  (`quelle='protokoll'`, `quelle_id=<protocol_item.id>`, `task_id` am Punkt). Statuswechsel
  synchronisieren in BEIDE Richtungen (meetings.js: Punkt→Aufgabe; tasks.js: Aufgabe→Punkt) – Endlosschleifen vermeiden (nur bei tatsächlicher Statusänderung schreiben).
- Vereinbarte PDF-Endpunkte (alle in reports.js): `/api/projects/:projectId/reports/statusbericht.pdf`,
  `/api/projects/:projectId/reports/gewerk/:kuerzel.pdf` (+ `.csv`), `/api/projects/:projectId/raumbuch.pdf`
  (+ `.csv`, optional `?planstand=ID`), `/api/meetings/:meetingId/protokoll.pdf`,
  `/api/projects/:projectId/maengelliste.pdf?gewerk=&firma=&status=`,
  `/api/projects/:projectId/journal.pdf?von=&bis=`, `/api/projects/:projectId/export` (ZIP-Vollexport).

## Qualität

- Kein zusätzliches npm-Paket ohne Not; erlaubt sind express, multer, pdfkit, archiver.
- Keine TODO-Platzhalter in ausgelieferten Modulen; jede MUSS-Anforderung des Moduls funktioniert end-to-end.
- Servercode CommonJS (`require`), Frontend ES-Module (`import`).
