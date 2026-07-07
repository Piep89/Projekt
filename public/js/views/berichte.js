// M8 – Berichte & Export: Abnahmereife, Statusbericht, Gewerke-Auszug, Raumbuch, Bautagebuch,
// Mängelliste, Vollständigkeit, Vollexport
import { get, state } from '../api.js';
import {
  h, clear, kopfzeile, feld, dateInput, select, gewerkSelect, formatDate, laden, fehlerToast,
} from '../ui.js';

export async function renderBerichte(el, params) {
  const projektId = Number(params.projektId);
  el.append(laden());
  let planstaende = [];
  try { planstaende = await get(`/projects/${projektId}/planstaende`); } catch { planstaende = []; }
  clear(el);
  el.append(kopfzeile('Berichte & Export'));

  // ---------- Abnahmereife (Workflow Schritt 6) ----------
  const ergebnis = h('div');
  el.append(h('div', { class: 'karte' },
    h('h2', {}, 'Abnahmereife-Prüfung'),
    h('p', { class: 'muted' }, 'Prüft auf Knopfdruck: offene relevante Checkpunkte, fehlende benötigte Dokumente, offene Mängel.'),
    h('button', {
      class: 'btn btn-primary', onclick: async (ev) => {
        ev.target.disabled = true;
        clear(ergebnis).append(laden());
        try {
          const a = await get(`/projects/${projektId}/abnahmereife`);
          clear(ergebnis);
          if (a.bereit) {
            ergebnis.append(h('p', { style: { color: 'var(--gruen)', fontWeight: 700, fontSize: '1.1rem' } }, '✓ Abnahmereif: keine offenen Punkte, Dokumente oder Mängel.'));
          } else {
            const block = (titel, eintraege, link) => !eintraege.length ? null : h('div', { style: { marginBottom: '.6rem' } },
              h('h3', { style: { color: 'var(--rot)' } }, `${titel} (${eintraege.length})`),
              h('ul', { style: { paddingLeft: '1.1rem' } }, eintraege.slice(0, 10).map((e) => h('li', {}, h('a', { href: link(e) }, e.nr ? `${e.nr} ${e.text || e.titel}` : (e.beschreibung || e.titel))))),
              eintraege.length > 10 ? h('p', { class: 'muted' }, `… und ${eintraege.length - 10} weitere`) : null);
            ergebnis.append(
              block('Offene relevante Checkpunkte', a.offene_punkte, (e) => `#/projekt/${projektId}/checkliste?punkt=${e.id}`),
              block('Fehlende benötigte Dokumente', a.fehlende_dokumente, (e) => `#/projekt/${projektId}/dokumente?eintrag=${e.id}`),
              block('Offene Mängel', a.offene_maengel, (e) => `#/projekt/${projektId}/maengel?mangel=${e.id}`));
          }
        } catch (e) { fehlerToast(e); }
        ev.target.disabled = false;
      },
    }, 'Jetzt prüfen'),
    ergebnis));

  const raster = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' } });
  el.append(raster);
  const karte = (titel, beschreibung, ...inhalt) => raster.append(h('div', { class: 'karte' },
    h('h2', {}, titel), h('p', { class: 'muted' }, beschreibung), ...inhalt));

  karte('Statusbericht (REP-01)',
    'Projektsteckbrief, Fortschritt je Phase, offene/überfällige Punkte je Gewerk, Dokumentenstand, Blocker – für Lenkungskreise. Anhang: Begründungen nicht relevanter Punkte.',
    h('a', { class: 'btn btn-primary', href: `/api/projects/${projektId}/reports/statusbericht.pdf`, target: '_blank' }, 'PDF erzeugen'));

  const gewerkSel = gewerkSelect({ value: state.gewerke[0]?.kuerzel || '' });
  karte('Gewerke-Auszug (REP-02)',
    'Alle offenen Punkte, Raumbuch-Attribute und Protokollpunkte eines Gewerks – Arbeitsgrundlage für Fachplaner-Gespräche.',
    feld('Gewerk', gewerkSel),
    h('div', { class: 'zeile' },
      h('button', { class: 'btn', onclick: () => window.open(`/api/projects/${projektId}/reports/gewerk/${encodeURIComponent(gewerkSel.value)}.pdf`, '_blank') }, 'PDF'),
      h('button', { class: 'btn', onclick: () => { window.location.href = `/api/projects/${projektId}/reports/gewerk/${encodeURIComponent(gewerkSel.value)}.csv`; } }, 'Excel/CSV')));

  const planstandSel = select([{ value: '', label: 'Aktueller Stand' },
    ...planstaende.map((p) => ({ value: String(p.id), label: `${p.name} (${formatDate(p.datum)})` }))]);
  const psQuery = () => planstandSel.value ? `?planstand=${planstandSel.value}` : '';
  karte('Raumbuch (RB-06/RB-08)',
    'Komplettes Raumbuch je Raum mit Soll/Ist je Gewerk – als PDF, Excel/CSV (as-built-tauglich) oder Word.',
    feld('Stand', planstandSel),
    h('div', { class: 'zeile' },
      h('button', { class: 'btn', onclick: () => window.open(`/api/projects/${projektId}/raumbuch.pdf${psQuery()}`, '_blank') }, 'PDF'),
      h('button', { class: 'btn', onclick: () => { window.location.href = `/api/projects/${projektId}/raumbuch.csv${psQuery()}`; } }, 'Excel/CSV'),
      h('button', { class: 'btn', onclick: () => { window.location.href = `/api/projects/${projektId}/raumbuch.doc${psQuery()}`; } }, 'Word')));

  const von = dateInput(); const bis = dateInput();
  karte('Bautagebuch (NOT-05)',
    'Journaleinträge mit eingebetteten Fotos für einen Zeitraum.',
    h('div', { class: 'zeile' }, feld('Von', von), feld('Bis', bis)),
    h('button', {
      class: 'btn', onclick: () => {
        const qs = [von.value && `von=${von.value}`, bis.value && `bis=${bis.value}`].filter(Boolean).join('&');
        window.open(`/api/projects/${projektId}/journal.pdf${qs ? '?' + qs : ''}`, '_blank');
      },
    }, 'PDF erzeugen'));

  const mGewerk = gewerkSelect({ leer: 'Alle Gewerke' });
  const mStatus = select([{ value: '', label: 'Alle Status' },
    ...[['offen', 'Offen'], ['in_behebung', 'In Behebung'], ['behoben', 'Behoben'], ['abgenommen', 'Abgenommen']].map(([v, l]) => ({ value: v, label: l }))]);
  karte('Mängelliste (MGL-02)',
    'Gefilterte Mängelliste, z. B. je Firma oder Gewerk zur Abnahme.',
    h('div', { class: 'zeile' }, feld('Gewerk', mGewerk), feld('Status', mStatus)),
    h('button', {
      class: 'btn', onclick: () => {
        const qs = [mGewerk.value && `gewerk=${encodeURIComponent(mGewerk.value)}`, mStatus.value && `status=${mStatus.value}`].filter(Boolean).join('&');
        window.open(`/api/projects/${projektId}/maengelliste.pdf${qs ? '?' + qs : ''}`, '_blank');
      },
    }, 'PDF erzeugen'));

  karte('Dokumenten-Vollständigkeit (DOK-03)',
    'Alle als benötigt markierten, noch nicht erhaltenen Dokumente – z. B. zur Vorbereitung der Sachverständigenprüfung.',
    h('a', { class: 'btn', href: `/api/projects/${projektId}/reports/vollstaendigkeit.pdf`, target: '_blank' }, 'PDF erzeugen'));

  karte('Vollexport der Projektakte (REP-03)',
    'Alle Daten als JSON/CSV, alle Dateien und die PDF-Sammelmappe (Statusbericht, Raumbuch, Protokolle, Bautagebuch, Mängelliste) in einem ZIP-Archiv – für Aufbewahrung ≥ 10 Jahre ohne Daten-Lock-in. Private Notizen sind nicht enthalten.',
    h('a', { class: 'btn btn-primary', href: `/api/projects/${projektId}/export` }, 'ZIP herunterladen'));
}
