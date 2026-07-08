# Raumbuch 2.0 – Konzept: Geführte Vollabfrage aller Raum-Merkmale

Stand: Juli 2026 · Status: **Vorschlag zur Abstimmung** · Umsetzung über die
Arbeitspakete AP-16 bis AP-18 im [Build-Plan](build-plan.md).

## 1. Ausgangslage

Das heutige Raumbuch (RB-01…RB-05) kann bereits:

- Räume mit Grunddaten anlegen (Nummer, Bezeichnung, Funktion nach DIN 13080,
  Fläche, Höhe, Raumgruppe nach DIN VDE 0100-710, Strahlenschutz, HF-Anforderung),
- je Raum beliebige Merkmale mit Gewerk, Soll, Ist, Status
  (offen → festgelegt → bestätigt / abweichend) und Quelle führen,
- bei der Raumanlage Merkmal-**Namen** aus 9 Raumtyp-Vorlagen vorbelegen
  (MRT-Untersuchungsraum, CT-Untersuchungsraum, Angio/Hybrid-OP, Technikraum,
  Bedien-/Schaltraum, Vorbereitung, Umkleide, Wartebereich, Befundraum),
- Planstände als Schnappschüsse einfrieren und Deltas anzeigen,
- Raumbuch als PDF/CSV/DOC exportieren.

**Was fehlt für ein „richtiges" Raumbuch:** Die Vorlagen liefern nur Namen –
kein Datentyp, keine Einheit, kein Soll-Vorschlag, keine Hilfe, keine Pflicht-
Kennzeichnung. Und es gibt keine **geführte Abfrage**, die sicherstellt, dass
wirklich *jeder* Punkt je Raum beantwortet (oder bewusst als nicht relevant
begründet) wurde – analog zur Relevanz-Logik der Checkliste (CHK-02).

## 2. Zielbild

> Für jeden Raum wird ein vollständiger, gerätetyp-spezifischer Merkmalskatalog
> Punkt für Punkt abgefragt. Jeder Punkt endet in genau einem von drei Zuständen:
> **beantwortet** (Soll erfasst, später Ist geprüft), **nicht relevant**
> (mit Pflicht-Begründung) oder **offen** (sichtbar als Restarbeit).
> Vollständigkeit ist messbar – je Raum, je Gewerk, je Projekt.

Damit wird das Raumbuch vom Datencontainer zum Arbeitsinstrument für
Planungsbesprechungen, Begehungen und die Abnahme.

## 3. Merkmalskatalog (Inhalt)

Der Katalog wird Teil der Mastervorlage (wie die 281 Checklistenpunkte) und je
Raumtyp gepflegt. Jedes Merkmal erhält:

| Feld | Beispiel |
| --- | --- |
| Gewerk | KÄL (eines der 15: PL, VG, AR, MT, IT, ELT, MSR, HZG, LÜF, KÄL, SAN, StrS, AS, HYG, BS) |
| Name | Kaltwasserleistung Chiller |
| Datentyp | `zahl` (weitere: `text`, `ja_nein`, `auswahl`, `datum`) |
| Einheit | kW |
| Soll-Vorschlag | „lt. Herstellerdatenblatt" oder konkreter Vorgabewert |
| Auswahl-Optionen | nur bei `auswahl`, z. B. „AV / ZSV / BSV" |
| Hilfetext | Worauf achten, typische Fallstricke, Normbezug |
| Pflicht | ja/nein – Pflichtpunkte blockieren die „Vollständig"-Meldung |
| Gerätetypen | CSV-Filter wie bei der Checkliste (MRT, CT, Angio, Hybrid-OP, PET-CT, Linearbeschleuniger) |

### Beispielausschnitt MRT-Untersuchungsraum (Zielumfang ~70–90 Punkte)

- **AR (Architektur/Bau):** Bodenbelastung Magnet (t), Lastverteilplatte,
  lichte Raumhöhe (m), Einbringöffnung B×H, Einbringweg geprüft,
  Schwingungsentkopplung lt. Herstellervorgabe, Bodenbelag (leitfähig, fugenarm),
  Türbreite lichte Öffnung.
- **StrS (Strahlenschutz/HF):** HF-Kabine Schirmdämpfung (dB bei Messfrequenz),
  5-Gauss-Linie innerhalb kontrollierten Bereichs, Kennzeichnung/Zutrittsregelung,
  magnetische Störer im Umfeld (Aufzüge, Stahlbau, Fahrwege), Abnahmemessung HF-Kabine.
- **KÄL:** Kaltwasserleistung Chiller (kW), Vor-/Rücklauftemperatur, Glykolanteil,
  Redundanz/Notkühlung, Betrieb bei Netzausfall (Helium-Kompressor an ZSV?).
- **LÜF:** Luftwechsel Magnetraum, Quench-Abluftszenario, Raumtemperatur-Sollband,
  Feuchte-Sollband, Quenchrohr (Querschnitt, Führung, Ausblasort, Schneelast/Vogelschutz).
- **ELT:** Anschlussleistung Gerät (kVA), Netzform/Absicherung, AV/ZSV/BSV-Zuordnung,
  Potentialausgleich, Filterdurchführungen HF-Kabine, MR-taugliche Beleuchtung,
  Not-Aus-/Run-Down-Unit-Position.
- **MSR:** Sauerstoffüberwachung Magnetraum inkl. Alarmierungsweg, GLT-Aufschaltung
  Kaltwasser/Lüftung, Störmeldekonzept.
- **MT:** Medizinische Gase (O2/AIR/VAC, Entnahmestellen), MR-taugliches
  Anästhesie-/Monitoring-Equipment berücksichtigt, Deckenversorgungseinheit.
- **IT:** Netzwerkdosen Anzahl/Kategorie, LWL bis Technikraum, PACS/RIS/DICOM-
  Anbindung, WLAN-Konzept (HF-Kabine!).
- **BS:** Brandmeldung MR-tauglich, Feuerwehr-Einsatzplan mit 5-Gauss-Hinweis.
- **HYG/SAN/AS/HZG/VG/PL:** analog (desinfizierbare Oberflächen, Handwaschplatz,
  Fluchtwege, Estrich-/Heizlast, vergaberelevante Schnittstellen, …).

CT, Angio und Hybrid-OP erhalten eigene Ausprägungen (z. B. Deckenstatik
C-Bogen, Bleigleichwert, RLT-Klasse Ia mit TAV-Feld im Hybrid-OP); Nebenräume
schlankere Kataloge (15–30 Punkte). Quellen: Herstellervorgaben (Site Planning
Guides), DIN 13080, DIN VDE 0100-710, StrlSchG/StrlSchV, ASR – als Hilfetext
je Punkt hinterlegt, nicht als Normzitat-Sammlung.

## 4. Geführte Abfrage (Erfassungsassistent)

Neuer Einstieg im Raumbuch: Schaltfläche **„Abfrage starten"** je Raum
(und „Alle offenen Punkte des Projekts abfragen" für Begehungen).

- Vollbild-Dialog, gruppiert nach Gewerk, ein Merkmal pro Schritt mit
  Hilfetext und passendem Eingabefeld je Datentyp; Fortschritt sichtbar
  („Punkt 12 von 74 · ELT 3/9").
- Je Punkt drei Aktionen: **Speichern & weiter** (Soll bzw. Ist erfassen),
  **Nicht relevant** (Pflicht-Begründung, analog CHK-02),
  **Später** (bleibt offen, Sprung zum nächsten).
- Filter „nur offene Punkte" und „nur Gewerk X" – damit kann z. B. der
  ELT-Fachplaner gezielt seine Punkte durcharbeiten (Gewerke-Schreibrecht
  der Bearbeiter-Rolle greift unverändert).
- **Offline-fähig** wie Journal/Mängel (NFA-03): Antworten landen im
  Ausgangskorb und synchronisieren später – wichtig für Begehungen im Rohbau.
- Tastatur: Enter = speichern & weiter, damit die Abfrage „durchtippbar" ist.

## 5. Zwei Durchläufe: Soll-Erfassung und Ist-Prüfung

Der Statusworkflow bleibt, bekommt aber zwei Assistent-Modi:

1. **Soll-Modus** (Planungsphase): fragt Soll-Werte ab → Status `festgelegt`.
2. **Prüf-Modus** (Ausführung/Abnahme): zeigt den Soll-Wert und fragt den
   Ist-Wert ab. Bei Übereinstimmung → `bestätigt`; bei Abweichung → `abweichend`
   **plus Direktaktion**: „Mangel anlegen" (vorbefüllt mit Raum, Gewerk,
   Soll/Ist-Text, verknüpft mit dem Merkmal) oder „Aufgabe anlegen" –
   über die bestehende Verknüpfungslogik, kein neuer Mechanismus.

## 6. Auswertung und Ausgaben

- **Vollständigkeits-Kennzahl** je Raum und Gewerk:
  beantwortet + nicht relevant = 100 % (Pflichtpunkte gesondert ausgewiesen);
  Ampelspalte in der Raumliste, Kachel im Dashboard, Aufnahme in den
  Statusbericht und den Zeitraumbericht.
- **Raumdatenblatt-PDF** je Raum: Kopf mit Raumgrunddaten, je Gewerk eine
  Tabelle (Merkmal, Soll, Ist, Status, Quelle), Unterschriftenzeile für die
  Abnahme – das Blatt, das man in die Planungsbesprechung mitnimmt.
- Bestehende Exporte (Raumbuch-PDF/CSV, Planstände, Vollexport) übernehmen
  die neuen Felder automatisch; Planstand-Deltas zeigen damit künftig auch
  Relevanz-Änderungen.

## 7. Datenmodell (rein additiv, bestandsverträglich)

- `template_room_types.attribut_namen` (JSON) wird je Eintrag erweitert um
  `datentyp, einheit, soll_vorschlag, optionen, hilfetext, pflicht, geraetetypen`
  – alte Einträge ohne diese Felder bleiben gültig (Default `text`, optional).
- `room_attributes` erhält per ALTER-TABLE-Guard: `relevanz`
  (`relevant`/`nicht_relevant`, Default relevant), `relevanz_begruendung`,
  `pflicht`, `hilfetext`, `optionen`.
- Neue Endpunkte: `GET /rooms/:id/abfrage` (nächste offene Punkte + Fortschritt),
  `PATCH /room-attributes/:id` erweitert um Relevanz (Begründungspflicht wie
  CHK-02 serverseitig erzwungen), `GET /rooms/:id/datenblatt.pdf`.
- Audit-Trail wie überall: jede Antwort mit `{feld:{von,nach}}`.

## 8. Arbeitspakete (Umsetzung in Etappen, token-schonend)

| Paket | Inhalt | Größe |
| --- | --- | --- |
| **AP-16** | Datenmodell + Merkmalskatalog in der Mastervorlage (alle 9 Raumtypen mit Datentypen, Einheiten, Hilfetexten, Gerätetyp-Filtern; Übernahme bei Raumanlage; Vorlagen-Generator erweitert) | M |
| **AP-17** | Erfassungsassistent (Soll-Modus) mit Fortschritt, Nicht-relevant-Begründung, Gewerk-Filter, Offline-Ausgangskorb | M |
| **AP-18** | Prüf-Modus (Ist gegen Soll) mit Abweichung → Mangel/Aufgabe, Raumdatenblatt-PDF, Vollständigkeits-Kennzahlen in Raumliste/Dashboard/Berichten | M |

Reihenfolge ist verbindlich (17 und 18 bauen auf 16 auf). Jedes Paket ist in
einer Sitzung schaffbar und endet mit grüner Testsuite, neuem E2E-Test und
UI-Rundgang – Details im Build-Plan.

## 9. Offene Fragen an den Nutzer (vor AP-16 klären, keine Blocker)

1. Gibt es einen **hausinternen Raumbuch-Standard** oder Hersteller-Site-Planning-
   Unterlagen, die als Katalogquelle dienen sollen? (Analog AP-05 einfach als
   Datei bereitstellen – ich arbeite sie ein.)
2. Sollen Nebenräume (Warten, Umkleide) den vollen Assistenten bekommen oder
   reicht dort die bisherige freie Erfassung? (Vorschlag: Assistent überall,
   Kataloge dort bewusst klein.)
3. Reichen die 15 Gewerke als Gliederung der Abfrage, oder wird zusätzlich
   nach Leistungsphasen (Soll früh / Ist spät) getrennt? (Vorschlag: Gewerke
   reichen, die Phase ergibt sich aus Soll-/Prüf-Modus.)
