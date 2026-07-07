// Portfolio: alle Projekte mit Status, Fortschritt, nächstem Meilenstein (PRJ-07)
// + Anlage-Assistent (PRJ-01)
import { get, post } from '../api.js';
import {
  h, clear, kopfzeile, table, statusBadge, formatDate, modal, feld, textInput,
  textArea, dateInput, select, fehlerToast, toast, laden,
} from '../ui.js';

export async function renderPortfolio(el) {
  el.append(laden());
  try {
    const projekte = await get('/projects');
    clear(el);
    el.append(kopfzeile('Projekte',
      h('button', { class: 'btn btn-primary', onclick: () => assistentOeffnen() }, '+ Neues Projekt')));

    const aktive = projekte.filter((p) => p.status !== 'archiviert');
    const archivierte = projekte.filter((p) => p.status === 'archiviert');

    // Onboarding: freundlicher Einstieg, solange noch kein Projekt existiert
    if (!projekte.length) {
      el.append(h('div', { class: 'karte', style: { maxWidth: '720px', margin: '2rem auto', textAlign: 'center', padding: '2rem' } },
        h('h2', {}, 'Willkommen bei GGP!'),
        h('p', { class: 'muted' }, 'In drei Schritten zum arbeitsfähigen Großgeräte-Projekt:'),
        h('div', { style: { textAlign: 'left', maxWidth: '480px', margin: '1rem auto' } },
          h('p', {}, h('strong', {}, '1. Projekt anlegen'), ' – Gerätetyp wählen; Checkliste (Phasen 0–14) und Dokumentenregister entstehen automatisch aus der Vorlage.'),
          h('p', {}, h('strong', {}, '2. Erstbewertung'), ' – im Setup-Modus jeden Punkt einmal bewerten: relevant oder begründet nicht relevant.'),
          h('p', {}, h('strong', {}, '3. Loslegen'), ' – Kontakte anlegen, Besprechungsserie starten, Raumbuch füllen.')),
        h('button', { class: 'btn btn-primary', style: { fontSize: '1.05rem' }, onclick: () => assistentOeffnen() }, '+ Erstes Projekt anlegen'),
        h('p', { style: { marginTop: '.8rem' } }, h('a', { href: '#/hilfe' }, 'Hilfe & erste Schritte lesen'))));
      return;
    }

    el.append(projektTabelle(aktive, 'Keine aktiven Projekte. Legen Sie über „Neues Projekt“ das erste an.'));
    if (archivierte.length) {
      el.append(h('h2', { style: { marginTop: '1.5rem' } }, 'Archiviert'));
      el.append(projektTabelle(archivierte, ''));
    }
  } catch (e) { fehlerToast(e); }
}

function projektTabelle(rows, empty) {
  return table([
    { label: 'Projekt', render: (p) => h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, `${p.geraetetyp}${p.gebaeude ? ' · Geb. ' + p.gebaeude : ''}`)) },
    { label: 'Status', render: (p) => statusBadge(p.status), class: 'schmal' },
    {
      label: 'Fortschritt', render: (p) => h('div', { class: 'fortschritt-zeile' },
        h('div', { class: 'fortschritt', style: { width: '90px' } }, h('div', { style: { width: `${p.fortschritt}%` } })),
        h('span', { class: 'prozent' }, `${p.fortschritt} %`)),
    },
    { label: 'Punkte (erledigt/relevant)', render: (p) => `${p.punkte_erledigt} / ${p.punkte_relevant}`, class: 'schmal' },
    {
      label: 'Überfällig', class: 'schmal',
      render: (p) => p.punkte_ueberfaellig ? h('span', { class: 'ueberfaellig' }, String(p.punkte_ueberfaellig)) : '0',
    },
    {
      label: 'Nächster Meilenstein',
      render: (p) => p.naechster_meilenstein ? `${p.naechster_meilenstein.name} (${formatDate(p.naechster_meilenstein.datum)})` : '—',
    },
  ], rows, { empty, onRowClick: (p) => { window.location.hash = `#/projekt/${p.id}`; } });
}

async function assistentOeffnen() {
  try {
    const meta = await get('/projects/meta');
    const name = textInput({ placeholder: 'z. B. Ersatz MRT 2, Gebäude 4010' });
    const typ = select(meta.geraetetypen.map((g) => ({ value: g, label: g })));
    const vorlage = select(meta.vorlagen.map((v, i) => ({ value: String(v.id), label: `${v.name} (Version ${v.version})`, selected: i === 0 })));
    const gebaeude = textInput(); const ebene = textInput(); const budget = textInput({ placeholder: 'z. B. 3,2 Mio. €' });
    const beschreibung = textArea({ rows: 2 });
    const msFelder = ['Vergabe', 'Baubeginn', 'Lieferung Großgerät', 'Abnahme', 'Go-Live']
      .map((n) => ({ name: n, input: dateInput() }));

    const m = modal({
      title: 'Neues Projekt anlegen',
      wide: true,
      body: h('div', {},
        h('p', { class: 'muted' }, 'Das Projekt wird aus der gewählten Vorlage erzeugt: alle Phasen, Checkpunkte und das Dokumentenregister werden automatisch angelegt (PRJ-01).'),
        h('div', { class: 'formular-spalten' },
          feld('Projektname *', name),
          feld('Gerätetyp *', typ),
          feld('Vorlage *', vorlage),
          feld('Gebäude', gebaeude),
          feld('Ebene', ebene),
          feld('Budgetrahmen', budget)),
        feld('Beschreibung', beschreibung),
        h('h3', {}, 'Meilensteine (optional, später änderbar)'),
        h('div', { class: 'formular-spalten' }, msFelder.map((f) => feld(f.name, f.input)))),
      actions: [
        h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        h('button', {
          class: 'btn btn-primary',
          onclick: async (e) => {
            const knopf = e.target; knopf.disabled = true;
            try {
              const res = await post('/projects', {
                name: name.value, geraetetyp: typ.value, template_id: Number(vorlage.value),
                gebaeude: gebaeude.value || null, ebene: ebene.value || null,
                budget: budget.value || null, beschreibung: beschreibung.value || null,
                meilensteine: msFelder.map((f) => ({ name: f.name, datum: f.input.value || null })),
              });
              m.close();
              toast(`Projekt angelegt: ${res.punkte} Checkpunkte, ${res.dokumente} Dokumenteinträge`);
              window.location.hash = `#/projekt/${res.id}/setup`;
            } catch (err) { knopf.disabled = false; fehlerToast(err); }
          },
        }, 'Projekt anlegen'),
      ],
    });
  } catch (e) { fehlerToast(e); }
}
