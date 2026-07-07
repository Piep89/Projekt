# Anforderungsprofil: Raumbuch- und Projektabwicklungs-Software für die Großgeräte-Implementierung

**Arbeitstitel:** „GGP“ – Großgeräte-Projektabwicklung
**Zielgruppe:** Fachplanung Medizintechnik / Großgeräteimplementierung an Universitätskliniken
**Fachliche Basis:** Checkliste & Leitfaden „Beschaffung und Implementierung medizinischer Großgeräte“ (Stand 07/2026, 281 Checkpunkte, 15 Gewerke, 67 Dokumente)
**Dokumentstatus:** Entwurf zur Abstimmung · Version 1.0 · Juli 2026

> **Einordnung:** Dieses Anforderungsprofil beschreibt fachlich und prüfbar, WAS die Software leisten
> muss (Lastenheft-Charakter). Es legt bewusst nicht fest, WIE (Technologie, Produkt) die Umsetzung
> erfolgt, und eignet sich damit gleichermaßen als Grundlage für eine Eigenentwicklung, einen
> Marktvergleich oder eine Ausschreibung. Priorisierung nach MoSCoW: **MUSS** (zwingend),
> **SOLL** (wichtig, in Ausnahmefällen verhandelbar), **KANN** (wünschenswert).

---

## 1 Ausgangslage und Zielsetzung

**Ausgangslage:** Die Implementierung medizinischer Großgeräte (MRT, CT, Angiographie, Hybrid-OP u. a.) an einer Universitätsklinik ist ein interdisziplinäres Projekt über 15 Gewerke, typischerweise 12–36 Monate Laufzeit, mit 281 wiederkehrenden Prüf- und Arbeitspunkten, einem gewerkeübergreifenden Raumbuch und 67 nachzuweisenden Dokumenten je Projekt. Heute erfolgt die Abwicklung verteilt über Word-Checklisten, Excel-Listen, E-Mail, Papierprotokolle und persönliche Notizen. Das führt zu Medienbrüchen, unklaren Bearbeitungsständen, verlorenem Besprechungswissen und aufwendiger Nachweisführung gegenüber Behörden, Sachverständigen und Fördergebern.

**Ziel:** Eine webbasierte Anwendung, in der der Fachplaner Projekte anlegt, die Checkliste Punkt für Punkt bewertet und abarbeitet, das Raumbuch strukturiert erstellt und fortschreibt, Besprechungen protokolliert, Dokumente nachhält und das Projekt vollständig — vom Bedarf bis zur Übergabe in den Betrieb — an einem Ort abwickelt und dokumentiert.

**Messbare Projektziele:**

| Ziel | Messgröße |
|---|---|
| Ein Ablageort je Projekt | 100 % der Checkpunkte, Protokolle, Raumdaten und Dokumentnachweise im System, keine Schatten-Excel-Listen |
| Auskunftsfähigkeit | Projektstatus (offene Punkte je Gewerk, Dokumentenstand) in < 1 Minute abrufbar und als Bericht exportierbar |
| Nachweisführung | Lückenloser, unveränderlicher Verlauf (Audit-Trail) je Punkt, Protokoll und Dokument |
| Wiederverwendung | Neues Projekt aus Vorlage in < 15 Minuten arbeitsfähig angelegt |
| Besprechungseffizienz | Agenda aus offenen Punkten automatisch erzeugbar; Protokollpunkte werden ohne Doppelerfassung zu Aufgaben |

**Abgrenzung (Out of Scope):** Die Software ist ausdrücklich **kein** Medizinprodukt, **kein** CAD-/BIM-Autorensystem, **kein** vollwertiges Dokumentenmanagementsystem (DMS), **kein** CAFM-System und **kein** Ersatz für die Vergabeplattform. Sie verarbeitet **keine Patientendaten**. Zu bestehenden Systemen werden Schnittstellen bzw. Verweise vorgesehen (Kapitel 9).

---

## 2 Leitprinzipien und Systemidee

**Vorlagenprinzip:** Herzstück ist die versionierte Master-Vorlage (Checkliste mit Phasen 0–14, Gewerke-Zuordnung, Dokumentenliste, Raumbuch-Attributkataloge). Ein Projekt wird als Instanz einer Vorlage angelegt und kann anschließend projektspezifisch angepasst werden, ohne die Vorlage zu verändern. Erkenntnisse aus Projekten fließen als neue Vorlagenversion zurück (lernende Organisation).

**Bewerten statt nur abhaken:** Jeder Checkpunkt wird zuerst bewertet (relevant / nicht relevant für dieses Projekt, mit Pflicht-Begründung bei „nicht relevant“) und erst dann abgearbeitet. So entsteht automatisch die Dokumentation, warum ein Punkt entfiel — entscheidend für spätere Nachfragen von Behörden, Revision oder Nachfolgern.

**Gewerke als durchgängige Dimension:** Die 15 Gewerke (PL, VG, AR, MT, IT, ELT, MSR, HZG, LÜF, KÄL, SAN, StrS, AS, HYG, BS) mit ihren Farben ziehen sich als Filter- und Auswertedimension durch alle Module: Checkpunkte, Raumbuch-Attribute, Protokollpunkte, Aufgaben und Berichte.

**Getrennte Sphären:** Offizielle Projektdokumentation (Protokolle, Punktstatus, Journal) und private Arbeitsorganisation (persönliche Notizen, Entwürfe, Merklisten) sind strikt getrennt. Private Inhalte sind ausschließlich für den Ersteller sichtbar, erscheinen in keinem Export und sind auch für Administratoren nicht lesbar.

**Baustellentauglich:** Bedienung auf Tablet und Smartphone, Offline-Erfassung (Journal, Fotos, Punktstatus) mit späterer Synchronisation, Fotodokumentation mit direktem Raum- und Punktbezug.

**Kein Daten-Lock-in:** Sämtliche Projektdaten sind jederzeit vollständig und in offenen Formaten exportierbar (PDF für Nachweise, Excel/CSV und JSON für Daten). Die Projektakte muss auch nach Ablösung der Software mindestens 10 Jahre lesbar bleiben.

---

## 3 Begriffe

| Begriff | Definition |
|---|---|
| Projekt | Ein Großgeräte-Vorhaben (z. B. „Ersatz MRT 2, Gebäude 4010“) mit Stammdaten, Laufzeit und Status |
| Vorlage | Versionierter Master-Datensatz aus Checkliste, Phasen, Gewerken, Dokumentenliste und Attributkatalogen |
| Phase | Gliederungsebene der Checkliste (Phase 0 bis Kapitel 14 gemäß Leitfaden), projektspezifisch anpassbar |
| Checkpunkt | Einzelner Prüf-/Arbeitspunkt mit Gewerk(en), Status, Verantwortlichem, Termin, Bewertung und Verlauf |
| Gewerk | Fachdisziplin mit Kürzel und Farbe (15 Stück gemäß Leitfaden), erweiterbar |
| Raumbuch | Strukturierte Beschreibung aller Projekträume mit gewerkeweisen Soll-Anforderungen und Planständen |
| Raum | Einzelraum mit Stammdaten (Nummer, Funktion, Flächen, Raumklasse) und Attributen je Gewerk |
| Planstand | Eingefrorener Bearbeitungsstand des Raumbuchs (Vorplanung / Entwurf / Ausführung / As built) |
| Dokumentenregister | Projektinstanz der Master-Dokumentenliste (Kapitel 14) mit Benötigt/Erhalten-Status und Ablage |
| Besprechung | Termin (Planungs-, Bau-, Lenkungsbesprechung) mit Agenda, Teilnehmern und Protokoll |
| Protokollpunkt | Nummerierter Beschluss-/Aufgabenpunkt eines Protokolls mit Verantwortlichem und Termin |
| Aufgabe | Terminierte Tätigkeit; entsteht frei, aus Protokollpunkten oder aus Checkpunkten |
| Journal | Chronologisches Projekttagebuch (Bautagebuch-Funktion) mit Einträgen, Fotos und Anwesenheit |
| Private Notiz | Persönlicher Inhalt des Erstellers, ohne Projektöffentlichkeit, ohne Export |
| Audit-Trail | Unveränderliche, zeitgestempelte Änderungshistorie an fachlichen Objekten |

---

## 4 Nutzer, Rollen und Rechte

Die Software wird in Ausbaustufe 1 primär von einer Person (Fachplaner Medizintechnik) genutzt, ist aber von Beginn an mehrbenutzerfähig ausgelegt (Ausbaustufe 3).

| ID | Anforderung | Prio |
|---|---|---|
| ROL-01 | Das System muss ein Rollenmodell mit mindestens folgenden Rollen bereitstellen: Administrator, Projektleiter, Bearbeiter (gewerkebezogen einschränkbar), Leser. | MUSS |
| ROL-02 | Rechte müssen je Projekt vergeben werden (Projektmitgliedschaft); ohne Mitgliedschaft ist ein Projekt unsichtbar. | MUSS |
| ROL-03 | Die Rolle „Bearbeiter“ muss auf ein oder mehrere Gewerke einschränkbar sein (z. B. ELT-Fachplaner sieht und bearbeitet nur ELT-Punkte und ELT-Raumattribute, liest aber das Gesamtprojekt). | SOLL |
| ROL-04 | Externe Teilnehmer (z. B. Herstellervertreter) müssen als Kontakte ohne Login geführt werden können; ein optionaler Gastzugriff mit stark eingeschränkten Rechten ist vorzusehen. | KANN |
| ROL-05 | Private Notizen müssen technisch so gespeichert werden, dass ausschließlich der Ersteller sie lesen kann; sie erscheinen in keiner Suche, keinem Bericht und keinem Export anderer Nutzer. Administratoren haben keinen Lesezugriff. | MUSS |
| ROL-06 | Jede schreibende Aktion an fachlichen Objekten muss mit Nutzer und Zeitstempel im Audit-Trail protokolliert werden; der Audit-Trail ist nicht editierbar und nicht löschbar. | MUSS |
| ROL-07 | Die Anmeldung muss in Ausbaustufe 3 an das Verzeichnis der Klinik anbindbar sein (SSO, z. B. Entra ID/LDAP); bis dahin lokale Konten mit starken Passwörtern und optionaler MFA. | SOLL |

---

## 5 Fachliches Datenmodell (Kernentitäten)

Das Datenmodell bildet die Struktur des Leitfadens 1:1 ab und verknüpft alle Objekte miteinander, sodass jede Information genau einmal erfasst und überall referenziert wird.

| Entität | Wesentliche Inhalte und Beziehungen |
|---|---|
| Projekt | Stammdaten (Bezeichnung, Gerätetyp MRT/CT/Angio/…, Gebäude/Ebene, Budgetrahmen, Meilensteintermine, Status aktiv/pausiert/archiviert), Beteiligte, verwendete Vorlagenversion |
| Phase | Reihenfolge, Bezeichnung, Fortschritt (berechnet aus Checkpunkten) |
| Checkpunkt | Text, Phase, Gewerk(e) mit Federführung, Relevanzbewertung (+ Begründung), Status, Verantwortlicher, Termin, Priorität, Kommentare, Anhänge, Verknüpfungen zu Räumen, Dokumenten, Protokollpunkten und Aufgaben, Verlauf |
| Gewerk | Kürzel, Langname, Farbe; zentral gepflegt, projektübergreifend einheitlich |
| Raum | Raumnummer, Bezeichnung, Funktion (DIN 13080), Flächen/Höhen, Raumgruppe nach DIN VDE 0100-710, Strahlenschutz-/HF-Anforderung, Bemerkungen |
| Raumattribut | Merkmal je Raum und Gewerk aus konfigurierbarem Katalog (z. B. ELT: Steckdosen AV/SV/ZSV, Potentialausgleich; LÜF: Luftwechsel, Temperatur-/Feuchtefenster; KÄL: Kühllast; SAN: Medien/Entnahmestellen; IT: Datendosen; MT: Geräteliste; StrS: Bleigleichwerte) mit Soll-Wert, Ist-Wert, Status und Quelle |
| Planstand | Eingefrorener Snapshot des Raumbuchs mit Bezeichnung, Datum, Freigabevermerk; Delta-Ansicht zwischen Planständen |
| Dokumenteintrag | Position aus Dokumentenliste (Bereich A–F), Gewerk, Benötigt (ja/nein/entfällt + Begründung), Erhalten (Datum, Version), Ablage (Datei-Upload oder Link/Ablageort), Fälligkeit |
| Besprechung | Typ (Planung/Bau/Lenkung/Sonstige), Serie, Datum/Ort, Teilnehmer (aus Kontakten), Agenda, Protokollstatus (Entwurf/versandt/festgestellt) |
| Protokollpunkt | Projektweit eindeutige Nummer (z. B. PB-014), Text, Typ (Information/Beschluss/Aufgabe), Gewerk, Verantwortlicher, Termin, Status; offene Punkte laufen automatisch in die Folgebesprechung |
| Aufgabe | Titel, Beschreibung, Quelle (frei/Protokoll/Checkpunkt), Verantwortlicher, Termin, Status, Erinnerung |
| Journaleintrag | Datum, Verfasser, Kategorie (Baustelle/Planung/Telefonat/Begehung), Text, Wetter/Anwesende (optional), Fotos mit Raum-/Punktbezug |
| Private Notiz | Freitext/Skizze des Erstellers, optional mit Projekt- oder Objektbezug, niemals projektöffentlich |
| Kontakt | Person/Firma, Rolle, Gewerk, Erreichbarkeit; Verteilerlisten für Protokolle |
| Mangel | Mangelbeschreibung, Ort/Raum, Gewerk, Verursacher, Frist, Status, Fotos; Mängelliste zur Abnahme |

**Verknüpfungsprinzip (MUSS):** Checkpunkte, Raumattribute, Dokumenteinträge, Protokollpunkte, Aufgaben, Journaleinträge und Mängel müssen sich gegenseitig referenzieren können; von jedem Objekt aus sind die verknüpften Objekte mit einem Klick erreichbar (z. B. vom Checkpunkt „HF-Kabine Zwischenmessung“ zum Messprotokoll im Dokumentenregister, zum Raum „Untersuchungsraum“ und zum Protokollpunkt der Baubesprechung).

---

## 6 Funktionale Anforderungen

### M1 – Projekt- und Vorlagenverwaltung

| ID | Anforderung | Prio |
|---|---|---|
| PRJ-01 | Das System muss Projekte über einen Assistenten anlegen: Auswahl Gerätetyp und Vorlagenversion → automatische Instanziierung aller Phasen, Checkpunkte, Dokumenteinträge und Attributkataloge. | MUSS |
| PRJ-02 | Ein Projekt-Dashboard muss je Projekt anzeigen: Fortschritt gesamt und je Phase, offene/überfällige Punkte je Gewerk (farbcodiert), Dokumentenstand (benötigt/erhalten), nächste Termine und Besprechungen, letzte Journaleinträge. | MUSS |
| PRJ-03 | Meilensteine (Vergabe, Baubeginn, Lieferung, Abnahme, Go-Live) müssen je Projekt gepflegt und in einer einfachen Zeitleiste dargestellt werden. | SOLL |
| PRJ-04 | Projekte müssen kopierbar (als Ausgangspunkt ähnlicher Vorhaben) und archivierbar sein; archivierte Projekte sind schreibgeschützt, aber vollständig les- und exportierbar. | MUSS |
| PRJ-05 | Die Master-Vorlage (Checkliste, Dokumentenliste, Attributkataloge, Gewerke) muss versioniert pflegbar sein; laufende Projekte behalten ihre Version, neue Punkte einer Vorlagenversion können optional in laufende Projekte übernommen werden. | MUSS |
| PRJ-06 | Aus einem abgeschlossenen Projekt müssen ausgewählte Ergänzungen (neue Punkte, geänderte Formulierungen) als Vorschlag in die nächste Vorlagenversion übernommen werden können (Lessons Learned). | SOLL |
| PRJ-07 | Eine projektübergreifende Übersicht (Portfolio) muss alle aktiven Projekte mit Status, nächstem Meilenstein und überfälligen Punkten zeigen. | SOLL |

### M2 – Checklisten-Abwicklung

| ID | Anforderung | Prio |
|---|---|---|
| CHK-01 | Jeder Checkpunkt muss die Statuswerte „Offen“, „In Bearbeitung“, „Erledigt“, „Nicht relevant“ und „Blockiert“ führen; „Nicht relevant“ erzwingt eine Begründung, „Blockiert“ einen Verweis auf den Blocker (Punkt, Aufgabe oder Freitext). | MUSS |
| CHK-02 | Statuswechsel, Verantwortlichen- und Terminänderungen müssen im Verlauf des Punktes mit Nutzer/Zeit dokumentiert werden; das Wiedereröffnen erledigter Punkte ist möglich und wird protokolliert. | MUSS |
| CHK-03 | Die Punktliste muss filter- und kombinierbar sein nach Phase, Gewerk, Status, Verantwortlichem, Termin (überfällig/diese Woche), Relevanz und Freitext; Filter müssen als persönliche Ansichten speicherbar sein. | MUSS |
| CHK-04 | Gewerke müssen als farbige Kürzel-Badges (gemäß Leitfaden) an jedem Punkt sichtbar sein. | MUSS |
| CHK-05 | Punkte müssen Kommentare, Datei-Anhänge und Verknüpfungen (Raum, Dokument, Protokollpunkt, Aufgabe) aufnehmen können. | MUSS |
| CHK-06 | Projektspezifische Zusatzpunkte müssen in jeder Phase anlegbar sein und werden als solche gekennzeichnet. | MUSS |
| CHK-07 | Massenbearbeitung (z. B. mehrere Punkte einem Verantwortlichen zuweisen oder auf „Nicht relevant“ setzen) muss unterstützt werden. | SOLL |
| CHK-08 | Eine geführte Erstbewertung („Projekt-Setup-Modus“) soll die Punkte phasenweise durchblättern und je Punkt nur Relevanz, Verantwortlichen und Termin abfragen. | SOLL |
| CHK-09 | Wiedervorlagen/Erinnerungen zu Terminen müssen einstellbar sein (In-App, optional E-Mail). | SOLL |

### M3 – Raumbuch

| ID | Anforderung | Prio |
|---|---|---|
| RB-01 | Räume müssen einzeln und per Tabellenimport (Excel/CSV) angelegt werden können; Pflichtfelder: Raumnummer, Bezeichnung; weitere Stammdaten gemäß Datenmodell. | MUSS |
| RB-02 | Attributkataloge je Gewerk müssen zentral konfigurierbar sein (Attributname, Datentyp Zahl/Text/Auswahl/Ja-Nein, Einheit, Hilfetext); Raumtypen können Kataloge vorbelegen (z. B. „MRT-Untersuchungsraum“). | MUSS |
| RB-03 | Die Raumbuch-Bearbeitung muss zwei Sichten bieten: raumweise (alle Gewerke eines Raums) und gewerkeweise (ein Gewerk über alle Räume, tabellarisch für effiziente Massenpflege). | MUSS |
| RB-04 | Je Attribut müssen Soll-Wert, Ist-Wert, Status (offen/festgelegt/bestätigt/abweichend) und Quelle/Kommentar geführt werden; Abweichungen Soll/Ist müssen auswertbar sein. | MUSS |
| RB-05 | Planstände (Vorplanung, Entwurf, Ausführung, As built) müssen als eingefrorene Snapshots mit Freigabevermerk erzeugt werden; eine Delta-Ansicht zeigt Änderungen zwischen zwei Planständen. | MUSS |
| RB-06 | Der Raumbuch-Export muss je Raum und gesamt als PDF und Word (formatiert, mit Kopf „Projekt/Planstand/Datum“) sowie als Excel (Datentabelle) erfolgen. | MUSS |
| RB-07 | Checkpunkte und Mängel müssen Räumen zugeordnet werden können; die Raumansicht zeigt zugehörige offene Punkte, Fotos und Mängel. | SOLL |
| RB-08 | Ein „As built“-Export soll die Übergabe an CAFM/Betrieb unterstützen (strukturierte Excel-/CSV-Ausgabe aller Ist-Werte). | SOLL |

### M4 – Dokumentenregister

| ID | Anforderung | Prio |
|---|---|---|
| DOK-01 | Das Dokumentenregister muss die Master-Dokumentenliste (Bereiche A–F) projektbezogen instanziieren; je Eintrag: Benötigt (ja/nein/entfällt mit Begründung), Erhalten (Datum, Version, wer geliefert), Fälligkeit, Gewerk. | MUSS |
| DOK-02 | Je Eintrag muss wahlweise eine Datei hochgeladen ODER ein Ablageverweis (Pfad/URL auf DMS/Netzlaufwerk) hinterlegt werden; mehrere Versionen je Eintrag mit Historie. | MUSS |
| DOK-03 | Ein Vollständigkeitsbericht muss auf Knopfdruck zeigen: alle als benötigt markierten, noch nicht erhaltenen Dokumente, gruppiert nach Bereich und Gewerk, mit Fälligkeiten (z. B. als Vorbereitung der Sachverständigenprüfung oder Abnahme). | MUSS |
| DOK-04 | Zusätzliche projektspezifische Dokumenteinträge müssen anlegbar sein. | MUSS |
| DOK-05 | Erinnerungen bei überschrittener Fälligkeit; Zuordnung eines Einforderungs-Verantwortlichen je Eintrag. | SOLL |
| DOK-06 | Virenprüfung beim Upload sowie Beschränkung auf konfigurierbare Dateitypen und -größen. | SOLL |

### M5 – Besprechungen und Protokolle

| ID | Anforderung | Prio |
|---|---|---|
| PRO-01 | Besprechungen müssen als Einzeltermin oder Serie (z. B. Baubesprechung wöchentlich) mit Typ, Teilnehmern (aus Kontakten) und Ort/Videolink angelegt werden. | MUSS |
| PRO-02 | Die Agenda muss automatisch vorbefüllbar sein aus: offenen Protokollpunkten der Vorbesprechung, überfälligen Aufgaben und wählbaren offenen Checkpunkten; manuelle TOPs ergänzbar. | MUSS |
| PRO-03 | Protokollpunkte erhalten eine projektweit eindeutige, fortlaufende Nummer je Besprechungstyp (z. B. PB-014, BB-102) und führen Typ (Info/Beschluss/Aufgabe), Gewerk, Verantwortlichen, Termin und Status. | MUSS |
| PRO-04 | Offene Protokollpunkte müssen automatisch in das Folgeprotokoll der Serie übernommen werden, bis sie erledigt sind („alte Punkte zuerst“). | MUSS |
| PRO-05 | Das Protokoll muss als formatiertes PDF exportierbar sein (Kopf mit Projekt, Nr., Datum, Teilnehmern; Punkte mit Nummer, Gewerk-Badge, Verantwortlichem, Termin); Status „Entwurf → versandt → festgestellt“ mit Sperrung nach Feststellung (Änderungen nur als Nachtrag). | MUSS |
| PRO-06 | Protokollpunkte vom Typ „Aufgabe“ müssen ohne Doppelerfassung in der Aufgabenliste des Verantwortlichen erscheinen und rückwirkend synchron bleiben (Erledigung an einer Stelle genügt). | MUSS |
| PRO-07 | Versand des Protokoll-PDF an den Teilnehmer-/Verteilerkreis per E-Mail direkt aus dem System. | SOLL |
| PRO-08 | Anwesenheitserfassung (anwesend/entschuldigt/Verteiler) je Besprechung. | SOLL |

### M6 – Aufgaben, Notizen und Journal

| ID | Anforderung | Prio |
|---|---|---|
| NOT-01 | Eine persönliche Aufgabenübersicht („Mein Tag/Meine Woche“) muss alle eigenen Aufgaben, Wiedervorlagen und überfälligen Punkte projektübergreifend bündeln. | MUSS |
| NOT-02 | Private Notizen müssen frei oder mit Objektbezug (Projekt, Punkt, Raum, Besprechung) erstellbar sein; Sichtbarkeit gemäß ROL-05. Eine private Notiz muss per Klick in einen offiziellen Kommentar/Journaleintrag umgewandelt werden können (bewusste Veröffentlichung). | MUSS |
| NOT-03 | Das Projektjournal (Bautagebuch) muss chronologische Einträge mit Kategorie, Text, optional Wetter/Anwesenden und Fotos unterstützen; Einträge sind nach Abschluss des Folgetages unveränderlich (Korrektur nur als Nachtrag). | MUSS |
| NOT-04 | Fotos müssen per Kamera (Mobilgerät) oder Upload erfasst, automatisch mit Zeitstempel versehen und Räumen/Punkten/Mängeln zugeordnet werden können; eine Galerie je Raum und je Projekt ist bereitzustellen. | MUSS |
| NOT-05 | Journal- und Fotoberichte müssen als PDF für Zeiträume exportierbar sein (z. B. „Bautagebuch KW 32–35“). | SOLL |
| NOT-06 | Sprachnotiz-Erfassung mit automatischer Transkription als Journalentwurf. | KANN |

### M7 – Mängelmanagement

| ID | Anforderung | Prio |
|---|---|---|
| MGL-01 | Mängel müssen mit Beschreibung, Raum, Gewerk, Verursacher/zuständiger Firma, Frist, Fotos und Status (offen/in Behebung/behoben/abgenommen) erfasst werden. | MUSS |
| MGL-02 | Eine Mängelliste je Abnahme (Firma/Gewerk/Frist gefiltert) muss als PDF exportierbar sein; Nachverfolgung bis Statuswechsel „abgenommen“. | MUSS |
| MGL-03 | Mängel sollen aus Journaleinträgen/Fotos heraus mit einem Klick erzeugt werden können (Baustellenrundgang). | SOLL |

### M8 – Berichte, Exporte und Suche

| ID | Anforderung | Prio |
|---|---|---|
| REP-01 | Statusbericht (PDF) auf Knopfdruck: Projektsteckbrief, Fortschritt je Phase, offene/überfällige Punkte je Gewerk, Dokumentenstand, anstehende Termine, Top-Risiken/Blockierer — geeignet für Lenkungskreise. | MUSS |
| REP-02 | Gewerke-Auszug: alle offenen Punkte, Raumattribute und Protokollpunkte eines Gewerks als PDF/Excel (Arbeitsgrundlage für Fachplaner-Gespräche). | MUSS |
| REP-03 | Vollexport der Projektakte: alle Daten als strukturiertes JSON/CSV plus alle Dateien plus generierte PDF-Sammelmappe (Protokolle, Raumbuch, Journal, Dokumentenregister) in einem Archiv. | MUSS |
| REP-04 | Volltextsuche über Punkte, Protokolle, Journal, Räume, Dokumente und Kontakte projektbezogen und global (private Notizen nur für den Ersteller durchsuchbar). | MUSS |
| REP-05 | Konfigurierbare Berichtsköpfe (Kliniklogo, Absender). | KANN |

**Gewerke-Kürzel:** In allen Modulen, Filtern und Berichten werden die Gewerke einheitlich mit Kürzel und Farbe dargestellt; der Katalog ist zentral pflegbar und entspricht initial dem Leitfaden.

---

## 7 Workflow: Projektabwicklung im System

Der Sollablauf folgt dem Leitfaden und macht das System zum roten Faden des Projekts:

**Schritt 1 – Projekt anlegen (15 Minuten):** Assistent starten, Gerätetyp und Vorlagenversion wählen, Stammdaten und Meilensteine erfassen. Das System erzeugt Phasen 0–14 mit allen Checkpunkten, das Dokumentenregister A–F und die Attributkataloge. Beteiligte als Kontakte anlegen bzw. übernehmen.

**Schritt 2 – Erstbewertung (Setup-Modus):** Alle Punkte phasenweise durchgehen und je Punkt Relevanz (mit Begründung bei „entfällt“ — z. B. HF-Kabine bei einem CT-Projekt), Verantwortlichen und Zieltermin setzen. Ergebnis: ein realistischer, projektspezifischer Arbeitsvorrat; das Dashboard zeigt ab jetzt echten Fortschritt.

**Schritt 3 – Planungsphase führen:** Punkte der Phasen 0–3 abarbeiten; parallel Räume anlegen und das Raumbuch gewerkeweise füllen (Soll-Werte aus Herstellerunterlagen und Fachplanung). Planungsbesprechungen als Serie anlegen; Agenda speist sich aus offenen Punkten; Beschlüsse und Aufgaben entstehen als Protokollpunkte und fließen automatisch in Aufgabenlisten. Planstand „Entwurf“ einfrieren, wenn die Entwurfsplanung freigegeben ist.

**Schritt 4 – Dokumente einsammeln:** Mit der Vergabe die Cybersecurity- und Herstellerdokumente im Register anfordern und beim Eingang abhaken (Benötigt → Erhalten). Der Vollständigkeitsbericht zeigt jederzeit die Lücken — insbesondere vor Behördenanzeige und Sachverständigenprüfung.

**Schritt 5 – Bauphase begleiten:** Baubesprechungsserie mit automatischer Punkteverfolgung; tägliche/wöchentliche Journaleinträge mit Fotos direkt vom Tablet (offlinefähig); Zwischenabnahme-Punkte (Bleieinbau, HF-Zwischenmessung, Druckproben) abhaken und Messprotokolle im Register ablegen; Mängel mit Foto und Frist erfassen. Planstand „Ausführung“ fortschreiben.

**Schritt 6 – Abnahme und Inbetriebnahme:** Punkte der Kapitel 12 abarbeiten; das System prüft auf Knopfdruck die Abnahmereife (offene MUSS-relevante Punkte? fehlende benötigte Dokumente? offene Mängel mit Frist vor Übergabe?). Einweisungsnachweise und Prüfprotokolle im Register ablegen; Raumbuch als „As built“ einfrieren.

**Schritt 7 – Abschluss und Übergabe:** Statusbericht final erzeugen, Lessons Learned als Vorlagen-Vorschläge erfassen, Vollexport der Projektakte erstellen (Aufbewahrung), As-built-Raumbuch an Betrieb/CAFM übergeben, Projekt archivieren.

**Statusmodell Checkpunkt:** Offen → In Bearbeitung → Erledigt; Seitenstatus „Nicht relevant“ (nur aus Offen, mit Begründung, reversibel) und „Blockiert“ (aus Offen/In Bearbeitung, mit Blocker-Verweis). Jeder Übergang wird protokolliert; „Erledigt“ kann mit Pflichtkommentar wiedereröffnet werden.

---

## 8 Nichtfunktionale Anforderungen

### 8.1 Betrieb, Plattform und Performance

| ID | Anforderung | Prio |
|---|---|---|
| NFA-01 | Webanwendung ohne Client-Installation; Unterstützung der jeweils aktuellen Versionen von Chrome, Edge, Firefox und Safari. | MUSS |
| NFA-02 | Responsives Design für Desktop, Tablet und Smartphone; Kernfunktionen der Baustellennutzung (Journal, Fotos, Punktstatus, Mängel) sind für Tablet optimiert. | MUSS |
| NFA-03 | Offline-Fähigkeit (PWA): Lesen des Projekts sowie Erfassen von Journal, Fotos, Punktstatus und Mängeln ohne Netz; automatische Synchronisation mit Konfliktbehandlung (letzte Änderung gewinnt, Konflikte werden protokolliert und angezeigt). | SOLL |
| NFA-04 | Antwortzeiten: Seitenwechsel und Filteroperationen < 1 s bei Referenzmengengerüst; Berichte/Exporte < 30 s. | SOLL |
| NFA-05 | Datenhaltung serverseitig in einer Datenbank; tägliche automatische Backups, Wiederherstellungsziel RPO ≤ 24 h, RTO ≤ 8 h; Restore-Test mindestens jährlich. | MUSS |
| NFA-06 | Betrieb wahlweise On-Premise im Klinikrechenzentrum oder in einer EU-Cloud; bei Cloud-Betrieb Nachweis BSI C5 oder gleichwertig, Datenhaltung ausschließlich in Deutschland/EU. | MUSS |
| NFA-07 | Verfügbarkeit im Regelbetrieb ≥ 99 % (werktags 06–20 Uhr); Wartungsfenster außerhalb. | SOLL |

### 8.2 Informationssicherheit und Datenschutz

| ID | Anforderung | Prio |
|---|---|---|
| SEC-01 | Transportverschlüsselung TLS 1.2+; Verschlüsselung der Datenhaltung (at rest); Passwort-Speicherung nach Stand der Technik. | MUSS |
| SEC-02 | Entwicklung und Betrieb nach anerkannten Sicherheitsstandards (u. a. OWASP Top 10 berücksichtigt); regelmäßige Sicherheitsupdates; Update-Politik dokumentiert. | MUSS |
| SEC-03 | Rollenbasierte Zugriffskontrolle gemäß Kapitel 4; Sitzungs-Timeout; Protokollierung sicherheitsrelevanter Ereignisse (Logins, Rechteänderungen, Exporte). | MUSS |
| SEC-04 | Freigabe durch die Klinik-IT/ISB vor Produktivsetzung; das System fügt sich in bestehende Sicherheitskonzepte ein (B3S-Kontext) und liefert die dafür nötigen Unterlagen (Architektur, Schnittstellen, Betriebs- und Berechtigungskonzept). | MUSS |
| DSG-01 | DSGVO-Konformität: Verarbeitungsverzeichnis-Beitrag, AVV bei externem Betrieb, Rollen-/Löschkonzept; personenbezogene Daten beschränken sich auf Projektbeteiligte (Kontakte, Nutzer, Teilnehmerlisten). | MUSS |
| DSG-02 | Es werden keine Patientendaten verarbeitet; Upload-Hinweis und organisatorische Regelung stellen dies sicher. | MUSS |
| DSG-03 | Löschkonzept: personenbezogene Daten nach Projektarchivierung + Aufbewahrungsfrist löschbar; Projektfachdaten bleiben mindestens 10 Jahre exportierbar erhalten. | MUSS |
| DSG-04 | Beteiligung von Personalrat und Datenschutzbeauftragtem vor Einführung (Auswertungen mit Personenbezug, z. B. Aufgabenstatistiken, werden auf das Erforderliche beschränkt). | MUSS |

### 8.3 Bedienbarkeit und Qualität

| ID | Anforderung | Prio |
|---|---|---|
| UX-01 | Deutschsprachige Oberfläche; Fachbegriffe gemäß Leitfaden; konsistente Gewerke-Farbcodierung. | MUSS |
| UX-02 | Einarbeitungsziel: Kernabläufe (Punkt bearbeiten, Protokoll schreiben, Raum pflegen) ohne Schulung anhand kurzer Inline-Hilfen nutzbar. | SOLL |
| UX-03 | Barrierearme Gestaltung in Anlehnung an EN 301 549/BITV (Kontraste, Tastaturbedienung); Farben nie als einziges Unterscheidungsmerkmal (Kürzel immer sichtbar). | SOLL |
| UX-04 | Undo für destruktive Aktionen bzw. Papierkorb mit 30 Tagen Aufbewahrung. | SOLL |

---

## 9 Schnittstellen

| ID | Schnittstelle | Beschreibung | Prio |
|---|---|---|---|
| INT-01 | Excel/CSV-Import | Raumlisten, Kontaktlisten und Zusatz-Checkpunkte tabellarisch importieren (mit Vorschau und Fehlerbericht). | MUSS |
| INT-02 | PDF/Word/Excel-Export | Alle Berichte gemäß M8; Raumbuch zusätzlich als Word. | MUSS |
| INT-03 | E-Mail-Versand | Protokolle und Berichte an Verteiler; Absender konfigurierbar (SMTP der Klinik). | SOLL |
| INT-04 | Kalender (ICS) | Besprechungen und Meilensteine als ICS-Abo/-Datei für Outlook. | SOLL |
| INT-05 | Verzeichnisdienst | SSO/Nutzerbezug via Entra ID/LDAP (Ausbaustufe 3). | SOLL |
| INT-06 | DMS/Ablage-Verweise | Verlinkung auf bestehende Ablagen (Netzlaufwerk/DMS) statt Dublettenhaltung. | MUSS |
| INT-07 | REST-API | Lesender/schreibender Zugriff auf Kernobjekte für spätere Integrationen (z. B. CAFM-Übergabe); dokumentiert und versioniert. | KANN |

---

## 10 Mengengerüst und Rahmenbedingungen (Referenz)

| Größe | Annahme |
|---|---|
| Parallele aktive Projekte | 5–15 |
| Checkpunkte je Projekt | 280–400 (inkl. Zusatzpunkte) |
| Räume je Projekt | 5–30, je Raum 20–80 Attribute |
| Besprechungen je Projekt | 30–120, je Protokoll 5–40 Punkte |
| Fotos je Projekt | 200–2.000 (Richtwert Speicher: bis 10 GB je Projekt) |
| Nutzer | Stufe 1: 1–3; Stufe 3: bis 50 (davon ~10 gleichzeitig) |
| Aufbewahrung Projektakte | ≥ 10 Jahre (exportierbar, siehe DSG-03) |

---

## 11 Abnahmekriterien (Prüfszenarien)

Die folgenden End-to-End-Szenarien müssen bei der Abnahme vollständig und ohne Workaround funktionieren:

- [ ] Projekt „MRT-Ersatz Testprojekt“ aus Vorlage anlegen → alle Phasen 0–14, sämtliche Checkpunkte mit korrekten Gewerke-Badges und das Dokumentenregister A–F sind vorhanden; Anlage dauert unter 15 Minuten.
- [ ] Setup-Modus: 20 Punkte bewerten, davon 3 als „Nicht relevant“ → ohne Begründung ist Speichern nicht möglich; Begründungen erscheinen im Verlauf und im Statusbericht-Anhang.
- [ ] Filter „Gewerk = ELT, Status = Offen“ liefert ausschließlich passende Punkte; die Ansicht ist speicherbar und nach Neuanmeldung verfügbar.
- [ ] Raum „Untersuchungsraum“ anlegen, ELT-/LÜF-Attribute pflegen, Planstand „Entwurf“ einfrieren, danach einen Soll-Wert ändern → Delta-Ansicht zeigt genau diese Änderung; PDF- und Excel-Export enthalten Planstand und Freigabevermerk.
- [ ] Baubesprechung als Serie anlegen; in Sitzung 1 zwei Aufgaben-Protokollpunkte erfassen; eine bleibt offen → sie erscheint automatisch in der Agenda von Sitzung 2 und in der Aufgabenliste des Verantwortlichen; Erledigung in der Aufgabenliste setzt den Protokollpunkt auf erledigt.
- [ ] Protokoll feststellen → PDF wird erzeugt, nachträgliche Änderung ist gesperrt und nur als gekennzeichneter Nachtrag möglich.
- [ ] Dokumentenregister: 5 Einträge auf „Benötigt“ setzen, 2 als „Erhalten“ mit Datei/Verweis → Vollständigkeitsbericht zeigt exakt die 3 offenen mit Bereich, Gewerk und Fälligkeit.
- [ ] Journaleintrag mit 3 Fotos vom Tablet erfassen (Testfall Offline: Flugmodus, später synchronisieren) → Eintrag inkl. Fotos vollständig vorhanden, Zeitstempel korrekt, Konfliktfall wird angezeigt.
- [ ] Private Notiz anlegen → für zweiten Testnutzer und im Vollexport des zweiten Nutzers nicht auffindbar; Umwandlung in offiziellen Kommentar macht sie sichtbar.
- [ ] Mangel mit Foto, Frist und Gewerk erfassen → Mängelliste-PDF gefiltert nach Gewerk enthält ihn; Statuswechsel bis „abgenommen“ wird im Verlauf dokumentiert.
- [ ] Statusbericht-PDF erzeugen → enthält Fortschritt je Phase, überfällige Punkte je Gewerk (farbig), Dokumentenstand und nächste Meilensteine; Erzeugung < 30 s.
- [ ] Vollexport ausführen → Archiv enthält JSON/CSV aller Objekte, alle Dateien und die PDF-Sammelmappe; Stichprobe: ein Checkpunkt ist mit Verlauf, Verknüpfungen und Kommentaren im JSON nachvollziehbar.
- [ ] Audit-Trail: Statuswechsel eines Punkts durch Nutzer A und B → beide Änderungen mit Nutzer/Zeit unveränderlich einsehbar; Manipulationsversuch (Bearbeitung des Verlaufs) ist nicht möglich.
- [ ] Projekt archivieren → schreibgeschützt, aber les- und exportierbar; Portfolio zeigt es unter „archiviert“.

---

## 12 Ausbaustufen und Priorisierung

| Stufe | Umfang | Zielaussage |
|---|---|---|
| Stufe 1 (MVP) | M1, M2, M4, M5, M6 (ohne Offline), M8 (REP-01/02/04), Rollen Basis, alle MUSS aus Kap. 8/9 | Ein Fachplaner wickelt ein reales Projekt vollständig im System ab |
| Stufe 2 | M3 Raumbuch vollständig inkl. Planstände, M7 Mängel, Offline/PWA (NFA-03), NOT-05, REP-03 Vollexport | Baustellentaugliche Gesamtdokumentation inkl. Raumbuch |
| Stufe 3 | Mehrbenutzer/Gewerke-Rollen (ROL-03), SSO (ROL-07/INT-05), Portfolio (PRJ-07), API (INT-07), Gastzugriff | Teamnutzung und Integration in die Kliniklandschaft |

---

## 13 Getroffene Festlegungen und Annahmen

Im Auftrag „fehlende Informationen selbst entscheiden“ wurden folgende Festlegungen getroffen; sie sind bei Bedarf einzeln revidierbar:

1. **Kein Medizinprodukt, keine Patientendaten:** Die Software dient ausschließlich der Projekt- und Baudokumentation. Damit entfallen MDR-Anforderungen an die Software selbst; DSG-02 sichert dies organisatorisch ab.
2. **Einzelnutzer-first, teamfähig by design:** Stufe 1 optimiert den Alltag eines Fachplaners; das Datenmodell (Rollen, Audit, Projektmitgliedschaft) ist von Beginn an mehrbenutzerfähig, um spätere Umbauten zu vermeiden.
3. **Vorlage als „Single Source of Truth“:** Die Checkliste aus dem Leitfaden ist Vorlagenversion 1.0; Änderungen laufen über Vorlagenversionen statt über Kopien.
4. **Begründungspflicht bei „Nicht relevant“:** bewusst als harte Regel definiert — der kurzfristige Mehraufwand erzeugt die später wertvollste Dokumentation.
5. **Verweis statt Dublette:** Das Dokumentenregister verwaltet Nachweise wahlweise als Upload oder als Link auf die führende Ablage; das System konkurriert nicht mit dem DMS.
6. **Protokoll-Logik der Baupraxis:** fortlaufende Punktnummern je Besprechungstyp, automatische Übernahme offener Punkte, Feststellungs-Sperre — entspricht der etablierten Baubesprechungspraxis.
7. **Hosting-Präferenz:** On-Premise im Klinik-RZ oder EU-Cloud mit C5-Nachweis (konsistent zur Cybersecurity-Dokumentenabfrage des Leitfadens, Kap. 8.2).
8. **Offene Exporte statt Migrationsversprechen:** REP-03/DSG-03 stellen sicher, dass die Projektakte das Werkzeug überlebt.
9. **Namenskonvention:** „GGP“ ist Arbeitstitel; die Namensfindung ist nicht Teil dieses Profils.

---

*Dieses Anforderungsprofil basiert auf dem Leitfaden „Beschaffung und Implementierung medizinischer Großgeräte“ (Stand 07/2026) und ist mit dessen Struktur (Phasen, Gewerke, Dokumentenliste) synchron zu halten.*
