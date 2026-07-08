# GGP – Großgeräte-Projektabwicklung

Raumbuch- und Projektabwicklungs-Software für die Beschaffung und Implementierung
medizinischer Großgeräte (MRT, CT, Angiographie, Hybrid-OP u. a.) an Universitätskliniken.

Umsetzung des [Anforderungsprofils](docs/anforderungsprofil.md) (Stufe 1 MVP inkl. großer
Teile von Stufe 2/3): Checklisten-Abwicklung mit Relevanzbewertung, Raumbuch mit Planständen,
Dokumentenregister, Besprechungen mit Protokoll-Logik der Baupraxis, Bautagebuch mit Fotos,
Mängelmanagement, private Notizen, Berichte/PDF-Exporte, Vollexport und Volltextsuche —
durchgängig mehrbenutzerfähig mit Rollen, Projektmitgliedschaft und unveränderlichem Audit-Trail.

## Schnellstart

Voraussetzung: **Node.js ≥ 22.5** (nutzt das eingebaute `node:sqlite` — keine nativen Abhängigkeiten).

```bash
npm install
npm start            # startet auf http://localhost:3000
```

Beim ersten Start werden automatisch angelegt:
- die **15 Gewerke** des Leitfadens (PL, VG, AR, MT, IT, ELT, MSR, HZG, LÜF, KÄL, SAN, StrS, AS, HYG, BS) mit Farben,
- das **Admin-Konto** `admin` — das generierte Erstpasswort steht in der Konsole und in `data/ADMIN-PASSWORT.txt`
  (alternativ vorab per Umgebungsvariable `GGP_ADMIN_PASSWORD` setzen),
- die **Mastervorlage 1.0** „Leitfaden Beschaffung und Implementierung medizinischer Großgeräte (07/2026)"
  mit 281 Checkpunkten in den Phasen 0–14, 67 Dokumenten (Bereiche A–F), 70 Raumbuch-Attributen und 9 Raumtypen.

Optional ein Demo-Projekt mit Beispieldaten:

```bash
npm run seed:demo
```

Tests (End-to-End gegen die Abnahmekriterien aus Kap. 11 des Anforderungsprofils):

```bash
npm test
```

## Arbeitsablauf (Kap. 7 des Anforderungsprofils)

1. **Projekt anlegen**: Assistent wählt Gerätetyp + Vorlagenversion → Phasen, Checkpunkte
   (gerätetypspezifisch gefiltert, z. B. HF-Kabine nur bei MRT) und Dokumentenregister werden instanziiert.
2. **Setup-Modus**: geführte Erstbewertung aller Punkte — „Nicht relevant" nur mit Pflicht-Begründung.
3. **Planungsphase**: Checkliste abarbeiten, Raumbuch füllen (Raum- und Gewerke-Sicht),
   Planstand „Entwurf" einfrieren; Besprechungsserien mit automatischer Agenda und Punkteverfolgung.
4. **Dokumente einsammeln**: Register mit Benötigt/Erhalten, Upload oder Ablageverweis (DMS),
   Vollständigkeitsbericht auf Knopfdruck.
5. **Bauphase**: Bautagebuch mit Fotos (Tablet-Kamera), Mängel mit Fristen und Statuskette.
6. **Abnahme**: Abnahmereife-Prüfung (offene Punkte / fehlende Dokumente / offene Mängel),
   Raumbuch „As built" einfrieren.
7. **Abschluss**: Statusbericht, Lessons Learned als Vorlagen-Vorschläge, Vollexport (ZIP),
   Projekt archivieren (schreibgeschützt, aber les- und exportierbar).

## Technik

| Bereich | Umsetzung |
|---|---|
| Backend | Node.js + Express, SQLite über eingebautes `node:sqlite` (WAL) |
| Frontend | No-Build-SPA (ES-Module, Vanilla JS), deutschsprachig, responsiv |
| Offline (NFA-03) | PWA mit Service Worker: Projekt ohne Netz lesbar (letzter Stand); Journal (inkl. Fotos), Punktstatus und Mängel offline erfassbar über IndexedDB-Ausgangskorb mit automatischer Synchronisation; Konflikte („letzte Änderung gewinnt") werden protokolliert und unter „Mein Tag" angezeigt |
| PDF | pdfkit (Statusbericht, Protokoll, Raumbuch, Mängelliste, Bautagebuch, Vollständigkeit) |
| Exporte | CSV (Excel-kompatibel), Word (.doc) fürs Raumbuch, ZIP-Vollexport (archiver), ICS-Kalender |
| E-Mail (INT-03/PRO-07) | Protokoll-PDF direkt an Teilnehmer über das Klinik-SMTP (Umgebungsvariablen `GGP_SMTP_*`) |
| Komfort | Hilfe & erste Schritte (#/hilfe), Benutzermenü mit Passwort-Selbstbedienung, Papierkorb mit 30-Tage-Wiederherstellung (UX-04), Tastaturkürzel (Esc, „/") |
| Sicherheit | scrypt-Passwörter, HttpOnly-Session-Cookies mit Timeout, Rollen + Projektmitgliedschaft, Gewerke-beschränkte Bearbeiter (ROL-03), private Notizen AES-256-GCM-verschlüsselt |
| Nachweis | Append-only-Audit-Trail, per SQLite-Trigger gegen UPDATE/DELETE geschützt |

### Konfiguration (Umgebungsvariablen)

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | HTTP-Port | `3000` |
| `GGP_DATA_DIR` | Datenverzeichnis (Datenbank, Uploads) | `./data` |
| `GGP_ADMIN_PASSWORD` | Erstpasswort des Admin-Kontos | generiert |
| `GGP_MAX_FILE_MB` | Upload-Größenlimit | `50` |

### Projektstruktur

```
server/           Express-Server
  schema.sql      Datenmodell (alle Kernentitäten aus Kap. 5)
  auth.js         Anmeldung, Rollen, Projektmitgliedschaft
  audit.js        Unveränderlicher Audit-Trail (ROL-06)
  routes/         Ein Router je Fachmodul (M1–M8)
  pdf/            Berichts-Builder (pdfkit)
  seed/           Grunddaten, Mastervorlage (template.json), Demo-Daten
public/           Frontend (index.html, js/views/* je Modul)
tools/vorlage/    Generator/Quelldaten der Mastervorlage (für neue Versionen)
test/             End-to-End-Tests der Abnahmekriterien
docs/             Anforderungsprofil, Entwicklungskonventionen, REST-API-Dokumentation (api.md)
```

## macOS-Programm (Desktop-App)

GGP lässt sich als eigenständiges Mac-Programm paketieren — ein `.app`-Bundle mit
eingebettetem Node.js-Server (~45 MB), Daten unter `~/Library/Application Support/GGP/daten`:

```bash
npm run dist:mac      # erzeugt desktop/dist/GGP-macOS-{AppleSilicon,Intel}-vX.zip
```

Installation auf dem Mac: Zip entpacken, `GGP.app` nach „Programme" ziehen. Da die App nicht
signiert ist, beim ersten Start **Rechtsklick → Öffnen** (oder `xattr -dc /Applications/GGP.app`).
Der erste Start öffnet automatisch die Anmeldedaten (`admin` + generiertes Erstpasswort).
Beim Doppelklick startet der lokale Server (Port 41780) und die Oberfläche öffnet sich im Browser;
läuft GGP bereits, wird nur ein neues Fenster geöffnet.

Alternativ liegt unter `desktop/` ein Electron-Wrapper (eigenes App-Fenster statt Browser);
dieser Bauweg benötigt einen Mac bzw. Zugriff auf GitHub-Releases:
`cd desktop && npm install && npm run dist:mac`.

## Vorlagenpflege (PRJ-05/06)

Die Mastervorlage ist versioniert. Pflegezyklus: In der Administration die Vorlage als JSON
exportieren → fachlich überarbeiten (neue Versionsnummer) → als neue Version importieren.
Laufende Projekte behalten ihre Version; neue Punkte lassen sich projektweise übernehmen
(Projekt-Einstellungen → „Neue Vorlagenpunkte übernehmen"). Erkenntnisse aus Projekten werden
als Lessons-Learned-Vorschläge erfasst und in der Administration gesichtet.

## Bewusste Abgrenzungen (Stufe-1-Stand)

- **ROL-07/INT-05 SSO (Entra ID/LDAP)**: Ausbaustufe 3; lokale Konten mit starken Passwörtern
  (Selbstbedienung „Passwort ändern" im Benutzermenü).
- **DOK-06 Virenprüfung**: Dateityp-/Größenbeschränkung ist aktiv; ein Virenscanner-Hook ist
  betreiberseitig vor dem Upload-Verzeichnis vorzusehen.
- **NOT-06 Sprachnotizen**, **ROL-04 Gastzugriff**: KANN-Anforderungen, nicht enthalten.
- Die Checkpunkt-Texte der Mastervorlage 1.0 sind eine fachlich fundierte Erstausstattung
  und über die Vorlagenpflege vollständig anpassbar, sobald der Original-Leitfaden eingepflegt wird.

## Betrieb

Für den Klinikbetrieb (NFA-05/06, SEC-01): Betrieb hinter TLS-terminierendem Reverse-Proxy,
tägliche Sicherung von `GGP_DATA_DIR` (SQLite-Datei + Uploads), Datenhaltung on-premise oder
in EU-Cloud. Der Vollexport (REP-03) stellt die langfristige Lesbarkeit der Projektakte ohne
die Software sicher (JSON/CSV/PDF, ≥ 10 Jahre gemäß DSG-03).
