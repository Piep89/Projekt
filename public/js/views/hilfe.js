// Hilfe & erste Schritte (UX-02): Kernabläufe ohne Schulung nutzbar machen.
// Exportiert zusätzlich hilfeKnopf(schluessel) für die Kontext-Hilfe in den Modul-Kopfzeilen.
import { h, clear, kopfzeile, modal } from '../ui.js';

const ABSCHNITTE = [
  {
    schluessel: 'start',
    titel: '🚀 Erste Schritte',
    punkte: [
      ['Projekt anlegen', 'Startseite → „+ Neues Projekt": Gerätetyp und Vorlage wählen. GGP erzeugt automatisch alle Phasen (0–14), die komplette Checkliste und das Dokumentenregister A–F.'],
      ['Erstbewertung im Setup-Modus', 'Direkt nach der Anlage öffnet sich der Setup-Modus: Jeden Punkt einmal bewerten — Relevant (mit Verantwortlichem und Termin) oder Nicht relevant (mit Pflicht-Begründung). Erst danach zeigt das Dashboard echten Fortschritt.'],
      ['Kontakte anlegen', 'Projekt → Kontakte: Alle Beteiligten (Fachplaner, Firmen, Herstellervertreter) erfassen — sie stehen dann überall als Verantwortliche und Besprechungsteilnehmer zur Auswahl.'],
      ['Passwort ändern', 'Oben rechts auf Ihren Namen klicken → „Passwort ändern". Bitte gleich nach der ersten Anmeldung erledigen.'],
    ],
  },
  {
    schluessel: 'checkliste',
    titel: '📋 Checkliste',
    punkte: [
      ['Bewerten statt abhaken', 'Jeder Punkt hat eine Relevanz (bewertet im Setup) und einen Status: Offen → In Bearbeitung → Erledigt. „Blockiert" braucht einen Blocker-Verweis, das Wiedereröffnen einen Pflichtkommentar — so bleibt der Verlauf lückenlos nachvollziehbar.'],
      ['Filter speichern', 'Filterkombinationen (z. B. „Gewerk ELT, offen") über „Ansicht speichern" ablegen — sie stehen nach jeder Anmeldung wieder bereit.'],
      ['Massenbearbeitung', 'Mehrere Punkte ankreuzen → Leiste erscheint: Verantwortlichen, Termin oder Status für alle auf einmal setzen.'],
      ['Verknüpfungen', 'Im Punkt-Detail unten: Kommentare, Datei-Anhänge und Verknüpfungen zu Räumen, Dokumenten, Protokollpunkten — alles mit einem Klick erreichbar.'],
    ],
  },
  {
    schluessel: 'raumbuch',
    titel: '🏗 Raumbuch',
    punkte: [
      ['Zwei Sichten', '„Räume" zeigt alle Gewerke eines Raums; die „Gewerke-Sicht" ein Gewerk über alle Räume als Tabelle — ideal für die Massenpflege mit dem Fachplaner.'],
      ['Raumtyp nutzen', 'Beim Anlegen einen Raumtyp (z. B. „MRT-Untersuchungsraum") wählen — der vollständige Merkmalskatalog aller Gewerke wird automatisch vorbelegt, passend zum Gerätetyp des Projekts.'],
      ['Geführte Abfrage', '„▶ Abfrage" führt Punkt für Punkt durch alle offenen Merkmale eines Raums — mit Hilfetext, Soll-Vorschlag und Fortschrittsanzeige. Jeder Punkt wird beantwortet, auf „Später" gelegt oder mit Begründung als nicht relevant markiert. Funktioniert auch offline bei Begehungen.'],
      ['Prüfmodus', 'Im Assistenten auf „Ist prüfen" umschalten: das Soll wird angezeigt, der Ist-Wert erfasst. Bei Übereinstimmung wird der Punkt bestätigt, bei Abweichung direkt ein Mangel oder eine Aufgabe angelegt. Das Raumdatenblatt-PDF fasst alles mit Unterschriftenblock für die Abnahme zusammen.'],
      ['Planstände einfrieren', 'Zu jedem Meilenstein (Entwurf, Ausführung, As built) den Stand einfrieren. Die Delta-Ansicht zeigt später jede Änderung zwischen zwei Ständen.'],
    ],
  },
  {
    schluessel: 'besprechungen',
    titel: '🤝 Besprechungen',
    punkte: [
      ['Serie anlegen', 'Baubesprechungen als Serie führen: Offene Punkte laufen automatisch in jede Folgebesprechung („alte Punkte zuerst"), bis sie erledigt sind.'],
      ['Punkte statt Doppelerfassung', 'Protokollpunkte vom Typ „Aufgabe" erscheinen automatisch in der Aufgabenliste des Verantwortlichen — Erledigung an einer Stelle genügt.'],
      ['Feststellen', 'Entwurf → Versandt → Festgestellt. Nach der Feststellung sind Änderungen nur noch als gekennzeichneter Nachtrag möglich (Baupraxis-Standard).'],
    ],
  },
  {
    schluessel: 'journal',
    titel: '📔 Journal & Baustelle',
    punkte: [
      ['Bautagebuch', 'Einträge mit Fotos direkt vom Tablet (Kamera-Knopf). Einträge sind nach Ablauf des Folgetages unveränderlich — Korrekturen als Nachtrag.'],
      ['Offline arbeiten', 'Ohne Netz (Technikraum, Baustelle): Journal, Fotos, Punktstatus und Mängel werden lokal gespeichert und automatisch synchronisiert, sobald wieder Verbindung besteht. Status oben in der Leiste.'],
      ['Mängel', 'Mit Foto, Frist und Gewerk erfassen; Statuskette bis „Abgenommen". Die Mängelliste als PDF ist die Grundlage für Abnahmen.'],
    ],
  },
  {
    schluessel: 'dokumente',
    titel: '📄 Dokumente & Berichte',
    punkte: [
      ['Dokumentenregister', 'Je Eintrag: Benötigt? (Entfällt nur mit Begründung) → Erhalten (Datei hochladen oder Verweis aufs DMS/Netzlaufwerk). Der Vollständigkeitsbericht zeigt jederzeit alle Lücken.'],
      ['Statusbericht', 'Ein Klick unter „Berichte & Export" — fertiges PDF für den Lenkungskreis inkl. Begründungen aller entfallenen Punkte im Anhang.'],
      ['Abnahmereife', 'Vor der Abnahme prüfen: offene Punkte, fehlende Dokumente, offene Mängel auf einen Blick.'],
      ['Vollexport', 'Die komplette Projektakte als ZIP (Daten, Dateien, PDF-Sammelmappe) — revisionssicher für mindestens 10 Jahre, unabhängig von dieser Software.'],
    ],
  },
  {
    schluessel: 'notizen',
    titel: '🔒 Private Notizen',
    punkte: [
      ['Nur für Sie', 'Private Notizen sind verschlüsselt und ausschließlich für Sie sichtbar — in keiner Suche, keinem Bericht, keinem Export anderer Nutzer, auch nicht für Administratoren.'],
      ['Bewusst veröffentlichen', 'Eine Notiz kann per Klick in einen offiziellen Journaleintrag oder Kommentar überführt werden — erst dann sehen andere sie.'],
    ],
  },
];

export async function renderHilfe(el) {
  clear(el);
  el.append(kopfzeile('Hilfe & erste Schritte'));
  el.append(h('p', { class: 'muted' },
    'GGP führt ein Großgeräte-Projekt vom Bedarf bis zur Übergabe: Checkliste bewerten und abarbeiten, Raumbuch pflegen, Besprechungen protokollieren, Dokumente nachhalten — alles an einem Ort, alles nachweisbar.'));
  const raster = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' } });
  el.append(raster);
  for (const abschnitt of ABSCHNITTE) {
    raster.append(h('div', { class: 'karte' },
      h('h2', {}, abschnitt.titel),
      abschnitt.punkte.map(([begriff, text]) => h('p', { style: { margin: '0 0 .6rem' } },
        h('strong', {}, begriff + ': '), text))));
  }
}

// Kontext-Hilfe: kleines „?" für Modul-Kopfzeilen; öffnet den passenden Hilfe-Abschnitt
export function hilfeKnopf(schluessel) {
  const abschnitt = ABSCHNITTE.find((a) => a.schluessel === schluessel);
  if (!abschnitt) return null;
  return h('button', {
    class: 'btn-icon hilfe-knopf', title: 'Hilfe zu diesem Modul', 'aria-label': 'Hilfe zu diesem Modul',
    onclick: () => modal({
      title: abschnitt.titel,
      wide: true,
      body: h('div', {},
        abschnitt.punkte.map(([begriff, text]) => h('p', { style: { margin: '0 0 .6rem' } },
          h('strong', {}, begriff + ': '), text)),
        h('p', { style: { marginTop: '.8rem' } }, h('a', { href: '#/hilfe' }, 'Alle Hilfe-Themen ansehen'))),
    }),
  }, '?');
}
