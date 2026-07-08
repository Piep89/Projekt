# GGP REST-API (INT-07)

Dokumentation der HTTP-Schnittstelle für Integrationen (z. B. CAFM-Übergabe, Auswertungen).
**Version:** v0 (Pfadpräfix `/api`, unversioniert bis Stufe 3; Änderungen werden in diesem Dokument geführt).

## Grundlagen

- **Basis-URL:** `http://<server>:<port>/api`
- **Format:** JSON (Anfrage und Antwort), Zeichensatz UTF-8. Datumsfelder als `JJJJ-MM-TT`, Zeitstempel als ISO 8601 (UTC).
- **Authentifizierung:** Sitzungs-Cookie. `POST /auth/login` liefert `Set-Cookie: ggp_session=…` (HttpOnly);
  das Cookie bei allen Folgeaufrufen mitsenden. Sitzungs-Timeout 12 h (gleitend).
- **Fehler:** immer `{ "error": "deutsche Meldung" }` mit passendem HTTP-Status
  (400 Validierung, 401 nicht angemeldet, 403 keine Berechtigung, 404 nicht gefunden/unsichtbar, 409 Konflikt, 503 nicht konfiguriert).
- **Rechte:** Projekte sind nur für Mitglieder sichtbar (ROL-02). Rollen je Projekt:
  `projektleiter` (alles), `bearbeiter` (schreiben, optional auf Gewerke eingeschränkt), `leser`.
  Globale Rolle `admin` sieht alle Projekte und verwaltet Nutzer/Gewerke/Vorlagen/Einstellungen.
  Archivierte Projekte sind für alle schreibgeschützt (Lesen/Exporte erlaubt).
- **Audit:** Jede schreibende Aktion wird im unveränderlichen Audit-Trail protokolliert (ROL-06).

## Anmeldung und Nutzer

| Methode & Pfad | Zweck |
|---|---|
| `POST /auth/login` `{username, password}` | Anmelden → `{user}` + Cookie |
| `POST /auth/logout` | Abmelden |
| `GET /auth/me` | Angemeldeter Nutzer oder `{user: null}` |
| `POST /auth/passwort` `{altes_passwort, neues_passwort}` | Eigenes Passwort ändern (min. 10 Zeichen) |
| `GET /users` · `POST /users` · `PATCH /users/:id` | Nutzerverwaltung (nur Admin) |

## Projekte (M1)

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects` | Portfolio: alle sichtbaren Projekte mit Fortschritt, Überfälligen, nächstem Meilenstein |
| `POST /projects` `{name, geraetetyp, template_id?, gebaeude?, ebene?, budget?, beschreibung?, meilensteine?}` | Projekt aus Vorlage instanziieren (Phasen, Checkpunkte gerätetypgefiltert, Dokumentenregister) |
| `GET /projects/meta` | Gerätetypen + verfügbare Vorlagen |
| `GET /projects/:id` | Dashboard-Daten (Fortschritt je Phase, offene Punkte je Gewerk, Dokumentenstand, Termine, `zugriff`) |
| `PATCH /projects/:id` | Stammdaten/Status (`aktiv`/`pausiert`/`archiviert`; nur Projektleiter) |
| `POST /projects/:id/copy` `{name?}` | Kopie: Struktur + Bewertungen bleiben, Bearbeitungsstand wird zurückgesetzt |
| `GET/POST /projects/:id/milestones` · `PATCH/DELETE /milestones/:id` | Meilensteine |
| `GET/POST /projects/:id/members` · `DELETE /projects/:id/members/:userId` | Mitglieder; `POST` akzeptiert `{username|user_id, role, gewerke?}` |
| `GET /projects/:id/abnahmereife` | Offene relevante Punkte, fehlende benötigte Dokumente, offene Mängel |

## Checkliste (M2)

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects/:id/phases` | Phasen des Projekts |
| `GET /projects/:id/checkpoints?phase_id&gewerk&status&relevanz&verantwortlich&termin&q` | Punktliste; `termin=ueberfaellig\|woche`; Filter kombinierbar |
| `GET /checkpoints/:id` | Punkt mit Phase, Verantwortlichem, Blocker |
| `POST /projects/:id/checkpoints` | Projektspezifischer Zusatzpunkt (Nr. `<phase>.Z<lfd>`) |
| `POST /projects/:id/checkpoints/import` `{csv, commit}` | CSV-Import mit Vorschau (`commit=false`) und Fehlerbericht |
| `PATCH /checkpoints/:id` | Statusmodell: `relevanz='nicht_relevant'` erfordert `relevanz_begruendung`; `status='blockiert'` erfordert `blocker_text` oder `blocker_ref_*`; Wiedereröffnen von `erledigt` erfordert `kommentar` |
| `POST /checkpoints/bulk` `{ids, patch}` | Massenbearbeitung → `{ok, fehler:[{id, grund}]}` |
| `DELETE /checkpoints/:id` | Nur Zusatzpunkte; landet im Papierkorb |

Statuswerte: `offen · in_bearbeitung · erledigt · blockiert`; Relevanz: `unbewertet · relevant · nicht_relevant`.

## Raumbuch (M3)

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects/:id/rooms` | Räume mit Attribut-/Abweichungs-/Mängel-/Fotozählern |
| `POST /projects/:id/rooms` | Raum anlegen; `raumtyp` belegt Attribute aus dem Vorlagenkatalog vor |
| `POST /projects/:id/rooms/import` `{csv, commit}` | CSV-Import mit Vorschau/Fehlerbericht |
| `GET /rooms/:id` · `PATCH /rooms/:id` · `DELETE /rooms/:id` | Raumdetail (inkl. verknüpfter Punkte/Mängel/Fotos); Löschen → Papierkorb |
| `GET /projects/:id/attribut-katalog` | Attributkatalog + Raumtypen der Projektvorlage |
| `POST /rooms/:id/attributes` | Attribute ergänzen: `{katalog_ids:[…]}` oder frei `{gewerk, name, datentyp, einheit}` |
| `PATCH /room-attributes/:id` `{soll, ist, status, quelle}` | Status: `offen · festgelegt · bestaetigt · abweichend` |
| `GET /projects/:id/room-matrix?gewerk=ELT` | Gewerke-Sicht: Räume × Attribute |
| `GET /projects/:id/abweichungen` | Alle Soll/Ist-Abweichungen |
| `GET/POST /projects/:id/planstaende` | Planstände einfrieren (`typ`: vorplanung/entwurf/ausfuehrung/as_built/sonstig) |
| `GET /planstaende/:id` | Planstand mit Snapshot |
| `GET /projects/:id/planstaende/delta?von=<id>&bis=<id\|aktuell>` | Delta-Ansicht |

## Dokumentenregister (M4)

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects/:id/documents?bereich&gewerk&benoetigt&stand&q` | Register; `stand=offen\|erhalten\|ueberfaellig` |
| `GET /documents/:id` | Eintrag mit Versionshistorie |
| `POST /projects/:id/documents` | Projektspezifischer Zusatzeintrag |
| `PATCH /documents/:id` | `benoetigt='entfaellt'` erfordert `begruendung`; Fälligkeit, Einforderungs-Verantwortlicher |
| `POST /documents/:id/versions` | Neue Version: multipart (`datei`) **oder** JSON `{link}` (Ablageverweis, INT-06); setzt `erhalten_am` |
| `DELETE /document-versions/:id` | Nur Projektleiter |
| `GET /projects/:id/documents/vollstaendigkeit` | Fehlende benötigte Dokumente, gruppiert nach Bereich |

## Besprechungen und Protokolle (M5)

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects/:id/meetings` · `GET /projects/:id/meeting-series` | Besprechungen/Serien |
| `POST /projects/:id/meetings` | Anlegen; `serie: {titel, rhythmus} \| {id} \| null`, `teilnehmer: [contact_ids]` |
| `POST /meetings/:id/folgetermin` `{datum, titel?}` | Folgetermin der Serie (Teilnehmer werden übernommen) |
| `GET /meetings/:id` | Detail inkl. `uebernommene_punkte` (offene Punkte früherer Serientermine, „alte zuerst") |
| `PATCH /meetings/:id` | Felder + Statusfluss `geplant→entwurf→versandt→festgestellt` (nur vorwärts; danach Inhalte gesperrt) |
| `PUT /meetings/:id/teilnehmer` `{contact_id, status}` | Anwesenheit: eingeladen/anwesend/entschuldigt/verteiler |
| `GET /meetings/:id/agenda-vorschlag?q` | Agenda-Vorbefüllung (offene Punkte, überfällige Aufgaben, Checkpunkte) |
| `POST /meetings/:id/agenda-uebernehmen` `{tops}` | TOPs übernehmen |
| `POST /meetings/:id/items` | Protokollpunkt; Code fortlaufend je Typ (`PB/BB/LK/SO-NNN`); `typ='aufgabe'` erzeugt automatisch eine Aufgabe |
| `PATCH /protocol-items/:id` | Status immer, Inhalte nur bis Feststellung; synchronisiert die verknüpfte Aufgabe |
| `POST /protocol-items/:id/nachtrag` `{text}` | Nachtrag (auch nach Feststellung) |
| `DELETE /protocol-items/:id` | Bis Feststellung; landet im Papierkorb |
| `POST /meetings/:id/versenden` | Protokoll-PDF an Teilnehmer mit E-Mail-Adresse (braucht `GGP_SMTP_*`) |
| `GET /projects/:id/termine.ics` | Besprechungen + Meilensteine als iCalendar (INT-04) |

## Aufgaben, Journal, Notizen (M6)

| Methode & Pfad | Zweck |
|---|---|
| `GET /tasks?projekt&status&quelle` | Projektaufgaben |
| `GET /my/overview` | „Mein Tag": überfällig/heute/Woche/Erinnerungen + überfällige Punkte, Protokollpunkte, Dokumente projektübergreifend |
| `POST /tasks` · `GET/PATCH/DELETE /tasks/:id` | Aufgaben; Statuswechsel synchronisiert Protokollpunkt (Quelle `protokoll`) |
| `GET/POST /projects/:id/journal` | Bautagebuch; Einträge nach Ablauf des Folgetages unveränderlich |
| `PATCH /journal/:id` · `POST /journal/:id/nachtrag` | Bearbeiten nur solange editierbar, sonst Nachtrag |
| `POST /projects/:id/photos` | multipart `fotos[]` + Bezüge (`journal_id`, `room_id`, `checkpoint_id`, `mangel_id`); automatischer Zeitstempel |
| `GET /projects/:id/photos?room_id&…` · `GET /photos/:id/datei` · `PATCH/DELETE /photos/:id` | Galerie/Auslieferung/Zuordnung |
| `GET/POST /notes` · `PATCH/DELETE /notes/:id` | **Private Notizen**: verschlüsselt, strikt erstellergebunden — tauchen in keiner anderen Schnittstelle auf |
| `POST /notes/:id/veroeffentlichen` `{ziel: 'journal'\|'kommentar'}` | Bewusste Veröffentlichung; Notiz wird danach gelöscht |

## Mängel (M7) und Kontakte

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects/:id/maengel?gewerk&firma&status&raum` · `GET /maengel/:id` | Mängel (`code` = `M-NNN`) |
| `POST /projects/:id/maengel` | Anlegen; `photo_ids` ordnet vorhandene Fotos zu (MGL-03) |
| `PATCH /maengel/:id` | Statuskette `offen→in_behebung→behoben→abgenommen` (nur vorwärts; Ausnahme behoben→in_behebung) |
| `GET /projects/:id/maengel-firmen` | Firmenliste für Filter |
| `GET/POST /projects/:id/contacts` · `PATCH/DELETE /contacts/:id` | Kontakte; Löschen geschützt bei Referenzen, sonst Papierkorb |
| `POST /projects/:id/contacts/import` `{csv, commit}` | CSV-Import mit Vorschau/Fehlerbericht |

## Berichte, Exporte, Suche (M8)

| Methode & Pfad | Zweck |
|---|---|
| `GET /projects/:id/reports/statusbericht.pdf` | Statusbericht inkl. Anhang „Nicht relevante Punkte mit Begründung" |
| `GET /projects/:id/reports/gewerk/:kuerzel.pdf` / `.csv` | Gewerke-Auszug |
| `GET /projects/:id/raumbuch.pdf` / `.csv` / `.doc` `?planstand=<id>` | Raumbuch (aktuell oder eingefrorener Stand) |
| `GET /meetings/:id/protokoll.pdf` | Protokoll (ENTWURF-Wasserzeichen bis Feststellung) |
| `GET /projects/:id/maengelliste.pdf?gewerk&firma&status` | Mängelliste |
| `GET /projects/:id/journal.pdf?von&bis` | Bautagebuch mit eingebetteten Fotos |
| `GET /projects/:id/reports/vollstaendigkeit.pdf` | Dokumenten-Vollständigkeit |
| `GET /projects/:id/export` | **Vollexport** (ZIP): `daten/*.json+csv`, `dateien/`, `pdf/`-Sammelmappe, `LIESMICH.txt`; ohne private Notizen |
| `GET /search?q&projekt` | Volltextsuche über alle Fachobjekte (ohne private Notizen) |

**CAFM-Übergabe (RB-08):** `GET /projects/:id/raumbuch.csv?planstand=<As-built-Planstand>` liefert die
strukturierte Ist-Daten-Tabelle `Raum;Bezeichnung;Gewerk;Attribut;Soll;Ist;Status;Quelle`.

## Querschnitt

| Methode & Pfad | Zweck |
|---|---|
| `GET /gewerke` · `POST/PATCH /gewerke/:id` | Gewerke-Katalog (Pflege nur Admin) |
| `GET/POST /comments?object_typ&object_id` | Kommentare an beliebigen Fachobjekten |
| `POST /attachments` (multipart) · `GET /attachments?object_typ&object_id` · `GET /attachments/:id/download` | Datei-Anhänge |
| `GET /links?typ&id` · `POST /links` · `DELETE /links/:id` | Objekt-Verknüpfungen (Verknüpfungsprinzip Kap. 5) |
| `GET /projects/:id/link-targets?typ&q` | Zielsuche für Verknüpfungen |
| `GET/POST /views` · `DELETE /views/:id` | Persönliche Filteransichten |
| `GET /audit?object_typ&object_id` bzw. `?project_id` | Audit-Trail-Einsicht |
| `GET /projects/:id/papierkorb` · `POST /papierkorb/:id/wiederherstellen` | Papierkorb (30 Tage, UX-04) |
| `GET /settings` · `PUT /settings` | Berichtskopf/Absender (Schreiben nur Admin) |
| `GET/POST /templates` · `GET /templates/:id` · `GET /templates/:id/export` · `PATCH /templates/:id` | Vorlagenversionen (PRJ-05) |
| `GET /projects/:id/vorlagen-delta` · `POST /projects/:id/vorlagen-uebernahme` | Neue Vorlagenpunkte in laufende Projekte übernehmen |
| `GET/POST /projects/:id/template-suggestions` · `GET/PATCH /template-suggestions/:id` | Lessons Learned (PRJ-06) |

Objekttypen für `comments`/`attachments`/`links`/`audit`:
`checkpoint, room, document, meeting, protocol_item, task, defect, journal, contact, photo, planstand, project`.

## Beispiel: Sitzung aufbauen und Statusbericht laden

```bash
# 1. Anmelden (Cookie speichern)
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "…"}'

# 2. Projekte auflisten
curl -b cookies.txt http://localhost:3000/api/projects

# 3. Statusbericht als PDF speichern
curl -b cookies.txt -o statusbericht.pdf \
  http://localhost:3000/api/projects/1/reports/statusbericht.pdf
```
