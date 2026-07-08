# GGP Build-Plan: Arbeitspakete für Agenten-Sitzungen

Dieser Plan zerlegt die verbleibende Arbeit in **eigenständige Arbeitspakete (AP)**.
Jedes Paket ist so geschnitten, dass **eine Sitzung** es ohne Vorwissen aus früheren
Sitzungen abschließen kann. Empfohlener Auftrag an einen Agenten:

> „Lies docs/build-plan.md und arbeite AP-XX ab. Halte dich an die Startroutine und die Definition of Done."

**Aufwandsklassen:** S ≈ überschaubar (eine kurze Sitzung) · M ≈ halbe Sitzung · L ≈ volle Sitzung.

---

## Startroutine (für jede Sitzung, ~5 Minuten)

1. `docs/entwicklung.md` lesen (verbindliche Konventionen, Endpunkt-Verträge).
2. Bei Frontend-Arbeit zusätzlich: `public/js/ui.js` (Bausteine) und eine Referenz-View
   (`public/js/views/dashboard.js`) überfliegen. Bei Backend-Arbeit: `server/schema.sql`
   und eine Referenz-Route (`server/routes/projects.js`).
3. Funktionsprüfung der Umgebung:
   ```bash
   npm install                # falls node_modules fehlt
   npm test                   # muss vollständig grün sein, BEVOR du beginnst
   ```

## Definition of Done (für jedes Paket)

- Alle MUSS-Punkte des Pakets funktionieren end-to-end (API **und** Oberfläche).
- `npm test` vollständig grün; für neue Funktionalität mindestens ein neuer Test in `test/api.test.js`.
- Bei Frontend-Änderungen: UI-Rundgang ohne JS-Fehler (Playwright-Skript siehe unten) und
  **Service-Worker-Version in `public/sw.js` hochzählen** (sonst sehen Bestandsnutzer die Änderung nicht).
- Deutsche UI-Texte und Fehlermeldungen; jede schreibende Aktion ruft `audit(...)`.
- Commit auf Branch `claude/ggp-medical-device-software-vqr6di` (niemals andere Branches),
  aussagekräftige deutsche Commit-Botschaft, `git push`.
- **Keinen** Mac-Build ausführen, außer das Paket verlangt es ausdrücklich.

UI-Rundgang (Chromium liegt unter /opt/pw-browsers, playwright-core ggf. in Scratch-Verzeichnis installieren):
Server mit Demodaten starten (`GGP_DATA_DIR=<tmp> GGP_ADMIN_PASSWORD=test-passwort-123 PORT=3100 npm start` +
`GGP_DATA_DIR=<tmp> npm run seed:demo`), dann alle Hash-Routen laden und `pageerror`/Konsole-Fehler prüfen.

## Statusstand (zur Einordnung)

Umgesetzt und getestet (23 E2E-Tests): alle MUSS- und SOLL-Anforderungen des
Anforderungsprofils außer SSO/MFA (Stufe 3) und Virenscan-Hook; zusätzlich PWA/Offline,
E-Mail-Versand, Papierkorb, dunkles Design, REST-API-Doku, macOS-App-Paketierung.
Offen sind die folgenden Pakete.

---

## AP-01 · Mac-App-Artefakt aktualisieren (S)

**Ziel:** Das im Repo eingecheckte `desktop/dist/GGP-macOS-AppleSilicon-v0.1.0.zip` auf den
aktuellen Code-Stand bringen (es hinkt dem Code einige Commits hinterher).
**Schritte:** `bash tools/mac-app/bauen.sh` (lädt Node von nodejs.org; GitHub ist in der
Umgebung evtl. gesperrt — nodejs.org funktioniert). Danach
`git add -f desktop/dist/GGP-macOS-AppleSilicon-v0.1.0.zip`, committen, pushen.
**Abnahme:** Zip im Repo aktualisiert; Bundle-Stichprobe: `unzip -l` zeigt GGP.app; die
eingebettete App startet mit Linux-Node (`node GGP.app/Contents/Resources/app/server/index.js`).

## AP-02 · Windows-Desktop-Paket (M)

**Ziel:** Analog zur Mac-App ein Windows-Paket: Zip mit Startskript (`GGP.bat`/PowerShell),
eingebettetem Node für Windows (nodejs.org: `node-vX-win-x64.zip`) und der App.
**Kontext:** `tools/mac-app/bauen.sh` als Vorlage; neues `tools/win-app/bauen.ps1-oder-.sh`
(Cross-Bau unter Linux: nur Dateien zusammenpacken, keine Ausführung nötig).
**Umfang:** Startskript (Port 41780, Datenverzeichnis `%APPDATA%\GGP\daten`, Browser öffnen,
Erstpasswort-Datei öffnen), Icon optional (ICO aus `tools/mac-app/icons` ableitbar), README-Abschnitt.
**Abnahme:** `npm run dist:win` erzeugt `desktop/dist/GGP-Windows-x64-vX.zip`; Zip-Struktur geprüft
(node.exe vorhanden, Skript referenziert korrekte Pfade). Ausführung auf Windows kann nicht getestet
werden — Skript-Logik daher besonders sorgfältig gegenlesen.

## AP-03 · Drag-&-Drop- und Einfüge-Uploads (M) — ✅ erledigt

**Ziel:** Dateien/Fotos per Ziehen auf die Fläche und per Zwischenablage (Strg+V) hochladen.
**Kontext:** `public/js/objekt.js` (Anhänge-Reiter), `public/js/views/journal.js` (Foto-Upload),
`public/js/views/dokumente.js` (Versions-Upload), `public/js/views/maengel.js`.
**Umfang:** Wiederverwendbarer Baustein `dropzone()` in `ui.js` (gestrichelte Zone, Hover-Zustand,
Datei-Callback), eingebaut an den vier Stellen; Paste-Handler für Bilder im Journal.
Serverseitig ist alles vorhanden (multipart-Endpunkte).
**Abnahme:** UI-Rundgang fehlerfrei; manueller Playwright-Test: `page.setInputFiles` bleibt als
Fallback funktionsfähig (Datei-Input weiterhin vorhanden!).

## AP-04 · Kontext-Hilfe je Modul (S) — ✅ erledigt

**Ziel:** Kleines „?" in der Kopfzeile jedes Moduls, das den passenden Abschnitt der
Hilfe (`public/js/views/hilfe.js`) als Modal zeigt (UX-02 vertiefen).
**Umfang:** Hilfetexte aus `hilfe.js` exportieren (Schlüssel je Modul), `kopfzeile()` in `ui.js`
um optionalen Hilfe-Schlüssel erweitern, in allen Views setzen.
**Abnahme:** Jede Modul-Kopfzeile hat das „?"; Modal zeigt den richtigen Abschnitt; Rundgang fehlerfrei.

## AP-05 · Original-Leitfaden als Vorlage 2.0 (M — **braucht Zuarbeit des Nutzers**)

**Ziel:** Die echten 281 Checkpunkte/67 Dokumente des Klinik-Leitfadens ersetzen die
fachlich generierte Erstausstattung.
**Voraussetzung:** Nutzer stellt den Leitfaden bereit (Tabelle/Word/PDF im Repo oder Chat).
**Kontext:** `tools/vorlage/` (Generator mit Validierung), `server/seed/template-loader.js`.
**Umfang:** Inhalte in `tools/vorlage/teil1–4.js` einpflegen, `node tools/vorlage/generieren.js`,
Version auf `2.0`, per Admin-Import oder als neue `template.json` einchecken.
**Abnahme:** Generator-Validierung fehlerfrei (Anzahl, Gewerke-Kürzel, eindeutige Nummern);
Testprojekt je Gerätetyp zeigt plausible Punktzahlen.

## AP-06 · Gastzugriff (ROL-04, KANN) (M)

**Ziel:** Zeitlich begrenzte, stark eingeschränkte Lese-Links für Externe (z. B. Hersteller):
Token-URL zeigt EIN Projekt read-only (Dashboard, Checkliste, Berichte-Downloads), keine Suche,
keine Notizen, kein Export der Gesamtakte.
**Umfang:** Tabelle `gast_links` (token, project_id, ablauf, erstellt_von), Middleware
(Token als Query/Cookie → synthetischer Leser-Zugriff nur für dieses Projekt), UI in
Projekt-Einstellungen (Link erzeugen/widerrufen), Audit bei Erzeugung/Nutzung.
**Achtung:** Sicherheitskritisch — Token zufällig (32 Byte), Ablauf erzwingen, alle anderen
Routen für Gast-Sessions sperren. Tests für Sperrverhalten sind Pflicht.

## AP-07 · SSO mit Entra ID / OIDC (L, Stufe 3)

**Ziel:** Anmeldung über den Klinik-IdP (OpenID Connect Authorization Code Flow), lokale Konten
bleiben als Fallback.
**Umfang:** Konfiguration per Env (`GGP_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/REDIRECT`),
Login-Knopf „Mit Klinik-Konto anmelden", Callback-Route, Nutzer-Provisionierung
(users.username = E-Mail/UPN, Rolle Standard `user`), Doku in README + api.md.
**Ohne echten IdP testen:** Mock-OIDC-Server im Test (kleiner Express-Stub mit /token,/userinfo).

## AP-08 · MFA/TOTP für lokale Konten (M)

**Ziel:** Optionale Zwei-Faktor-Anmeldung (ROL-07): TOTP nach RFC 6238, Einrichtung per QR
(otpauth-URL als QR im Frontend rendern — kleine reine JS-QR-Routine oder Daten-URL-SVG),
Backup-Codes.
**Umfang:** Spalten `totp_secret`, `totp_aktiv` an users (Schema erweitern), Verifikation beim
Login (zweiter Schritt), Einrichtungsdialog im Benutzermenü, Tests mit selbst erzeugten Codes
(`node:crypto` HMAC, keine neue Abhängigkeit).

## AP-09 · Virenscan-Hook (DOK-06) (S)

**Ziel:** Optionale Prüfung aller Uploads über ClamAV (clamd TCP), konfiguriert per
`GGP_CLAMAV_HOST/PORT`; ohne Konfiguration unverändertes Verhalten.
**Kontext:** `server/routes/core.js` (multer-Upload), `server/routes/journal.js` (Fotos).
**Umfang:** Nach dem Upload Datei per INSTREAM an clamd senden; bei Befund: Datei löschen,
400 mit Meldung, Audit-Eintrag. Test mit Mini-clamd-Mock (net-Server, antwortet „stream: OK"
bzw. EICAR → „FOUND").

## AP-10 · Lasttest Mengengerüst + Indexe (M)

**Ziel:** NFA-04 nachweisen: 15 Projekte × ~350 Punkte, 30 Räume × 60 Attribute, 100 Besprechungen,
1000 Fotos-Metadaten → Filteroperationen < 1 s, Statusbericht < 30 s.
**Umfang:** Seed-Skript `tools/lasttest.js` (direkte DB-Inserts), Messskript (fetch-Timings),
fehlende Indexe ergänzen (`schema.sql`), Ergebnisse in `docs/lasttest.md`.

## AP-11 · Playwright-UI-Tests in die Testsuite (M)

**Ziel:** Die bislang manuell gepflegten UI-Rundgänge (Login, Module, Offline-Ablauf,
Dark-Mode) als `test/ui.test.js` reproduzierbar machen.
**Hinweis:** playwright-core als devDependency aufnehmen; Browserpfad `/opt/pw-browsers/chromium`
per Env übersteuerbar (`GGP_CHROMIUM`), Tests überspringen sich sauber, wenn kein Browser vorhanden
(`t.skip`) — CI-freundlich.

## AP-12 · Barrierefreiheits-Durchgang (UX-03) (M)

**Ziel:** EN 301 549-Basics: Fokus-Reihenfolge, aria-Labels für Icon-Knöpfe, Kontraste
(hell+dunkel) prüfen, Tastaturbedienung der Modale (Fokusfalle), Tabellen-Header-Zuordnung.
**Umfang:** Audit mit axe-core (per Playwright einbindbar), Befunde fixen, Kurzbericht in
`docs/barrierefreiheit.md`.

## AP-13 · Betriebspaket: Backup, systemd, Docker (S/M)

**Ziel:** NFA-05/NFA-06 operationalisieren.
**Umfang:** `tools/backup.sh` (SQLite-Online-Backup via `VACUUM INTO` + Uploads-rsync,
Aufbewahrung), `deploy/ggp.service` (systemd), `deploy/Dockerfile` + `compose.yml`
(Volume für GGP_DATA_DIR), README-Abschnitt „Betrieb" erweitern (RPO/RTO-Hinweise, Restore-Test).

## AP-14 · Release 1.0: PR und Änderungsliste (S)

**Ziel:** Stand auf den Hauptbranch bringen.
**Schritte:** `CHANGELOG.md` aus der Commit-Historie verdichten, Version in `package.json`
auf `1.0.0`, Pull Request von `claude/ggp-medical-device-software-vqr6di` auf den Default-Branch
mit Zusammenfassung und Testnachweis. **Nur auf ausdrücklichen Nutzerwunsch mergen.**

## AP-15 · Wochenbericht als E-Mail-Abo (S/M, optional)

**Ziel:** Der Zeitraumbericht (bereits vorhanden: `/api/projects/:id/reports/zeitraum.pdf`)
wöchentlich automatisch an einen Verteiler (nutzt `server/mail.js`; Zeitsteuerung z. B. beim
Serverstart geplanter Intervall-Timer + `settings`-Eintrag je Projekt mit Empfängerliste).

## AP-16 · Raumbuch 2.0: Merkmalskatalog und Datenmodell (M) — ✅ erledigt

**Ziel:** Vollständige, gerätetyp-spezifische Merkmalskataloge je Raumtyp als Grundlage der
geführten Abfrage. Konzept: [docs/raumbuch-konzept.md](raumbuch-konzept.md), Kap. 3 + 7.
**Umfang:** `template_room_types.attribut_namen`-JSON je Eintrag erweitern
(`datentyp, einheit, soll_vorschlag, optionen, hilfetext, pflicht, geraetetypen`; alte Einträge
bleiben gültig), `room_attributes` per ALTER-Guard um `relevanz, relevanz_begruendung, pflicht,
hilfetext, optionen` ergänzen, Übernahme bei Raumanlage (inkl. Gerätetyp-Filter wie Checkliste),
Vorlagen-Generator (`tools/vorlage/`) erweitern, Kataloginhalte für alle 9 Raumtypen
(MRT/CT/Angio/Hybrid-OP-Räume ~70–90 Punkte, Nebenräume 15–30).
**Abnahme:** Neuer Raum vom Typ „MRT-Untersuchungsraum" erhält den vollen Katalog mit
Datentypen/Hilfetexten; Bestandsdatenbank läuft unverändert; E2E-Test für Katalog-Übernahme.

## AP-17 · Raumbuch 2.0: Erfassungsassistent (M — baut auf AP-16 auf) — ✅ erledigt

**Ziel:** Geführte Punkt-für-Punkt-Abfrage je Raum („Abfrage starten"), Konzept Kap. 4.
**Umfang:** `GET /rooms/:id/abfrage` (offene Punkte + Fortschritt), Assistent-Dialog
(Gruppierung nach Gewerk, Eingabefeld je Datentyp, Hilfetext, Fortschrittsanzeige,
Enter = speichern & weiter), Aktionen Speichern/Nicht relevant (Pflicht-Begründung,
serverseitig erzwungen wie CHK-02)/Später, Filter „nur offene"/„nur Gewerk X"
(Gewerke-Schreibrecht beachten), Offline-Ausgangskorb wie Journal.
**Abnahme:** Kompletter Durchlauf eines Raums im UI-Rundgang; Begründungspflicht getestet;
Fortschritt korrekt; Rundgang fehlerfrei.

## AP-18 · Raumbuch 2.0: Prüfmodus, Abweichungen, Raumdatenblatt (M — baut auf AP-17 auf)

**Ziel:** Ist-Prüfung gegen Soll mit Direktaktion und Auswertung, Konzept Kap. 5 + 6.
**Umfang:** Prüf-Modus im Assistenten (Soll anzeigen, Ist erfassen → bestätigt/abweichend),
bei Abweichung „Mangel anlegen"/„Aufgabe anlegen" (vorbefüllt, verknüpft),
`GET /rooms/:id/datenblatt.pdf` (Raumdatenblatt mit Unterschriftenzeile),
Vollständigkeits-Kennzahl je Raum/Gewerk (Ampel in Raumliste, Dashboard-Kachel,
Aufnahme in Status- und Zeitraumbericht).
**Abnahme:** Abweichung erzeugt verknüpften Mangel; Datenblatt-PDF öffnet fehlerfrei;
Kennzahlen stimmen mit Testdaten überein; Testsuite grün.

---

## Hinweise für parallele Bearbeitung

- Pakete sind unabhängig, **außer**: AP-11 vor AP-12 (Audit nutzt die UI-Tests), AP-01 nach
  jedem Paket mit Frontend-Änderungen sinnvoll.
- Dateibesitz beachten: Nie gleichzeitig zwei Pakete anfassen, die dieselben Dateien ändern
  (`ui.js` wird von AP-03 und AP-04 berührt → nacheinander).
- Schema-Änderungen (AP-06, AP-08, AP-16) nur additiv (`CREATE TABLE IF NOT EXISTS` / neue Spalten
  über `ALTER TABLE`-Guard im Code), damit Bestandsdatenbanken weiterlaufen.
- Raumbuch 2.0 strikt in der Reihenfolge AP-16 → AP-17 → AP-18.
