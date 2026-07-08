// CHK-08 – Geführte Erstbewertung (Projekt-Setup-Modus):
// Punkt für Punkt Relevanz, Verantwortlichen und Termin festlegen.
import { get, patch } from '../api.js';
import {
  h, clear, kopfzeile, feld, textArea, dateInput, select, gewerkeBadges, toast, fehlerToast, laden,
} from '../ui.js';
import { hilfeKnopf } from './hilfe.js';

export async function renderSetup(el, params) {
  const projektId = Number(params.projektId);
  el.append(laden());

  let punkte = [], kontakte = [], gesamt = 0;
  try {
    punkte = (await get(`/projects/${projektId}/checkpoints?relevanz=unbewertet`));
    const alle = await get(`/projects/${projektId}/checkpoints`);
    gesamt = alle.length;
    try { kontakte = await get(`/projects/${projektId}/contacts`); } catch { kontakte = []; }
  } catch (e) { return fehlerToast(e); }

  let index = 0;
  const inhalt = h('div');
  clear(el);
  el.append(kopfzeile('Setup-Modus: Erstbewertung', hilfeKnopf('checkliste'),
    h('a', { class: 'btn', href: `#/projekt/${projektId}/checkliste` }, 'Zur Checkliste')));
  el.append(h('p', { class: 'muted' },
    'Bewerten Sie jeden Punkt: Ist er für dieses Projekt relevant? Bei „Nicht relevant" ist eine Begründung Pflicht – sie dokumentiert für Behörden, Revision und Nachfolger, warum der Punkt entfiel.'));
  el.append(inhalt);

  function fertig() {
    clear(inhalt).append(h('div', { class: 'karte', style: { textAlign: 'center', padding: '2rem' } },
      h('h2', {}, 'Erstbewertung abgeschlossen'),
      h('p', {}, `Alle Punkte sind bewertet. Das Dashboard zeigt jetzt den echten Projektfortschritt.`),
      h('a', { class: 'btn btn-primary', href: `#/projekt/${projektId}/checkliste` }, 'Zur Checkliste'),
      ' ',
      h('a', { class: 'btn', href: `#/projekt/${projektId}` }, 'Zum Dashboard')));
  }

  function zeigePunkt() {
    if (index >= punkte.length) return fertig();
    const p = punkte[index];
    const verbleibend = punkte.length - index;

    const verantwortlich = select([
      { value: '', label: '— Verantwortlicher (optional) —' },
      ...kontakte.map((k) => ({ value: String(k.id), label: k.name + (k.firma ? ` (${k.firma})` : '') })),
    ]);
    const termin = dateInput();
    const begruendung = textArea({ placeholder: 'Begründung, warum dieser Punkt entfällt (Pflicht bei „Nicht relevant") …', rows: 2 });

    const bewerten = async (daten, meldung) => {
      try {
        await patch(`/checkpoints/${p.id}`, daten);
        toast(meldung);
        index++;
        zeigePunkt();
      } catch (e) { fehlerToast(e); }
    };

    clear(inhalt).append(h('div', { class: 'karte' },
      h('div', { class: 'zeile', style: { justifyContent: 'space-between' } },
        h('strong', {}, p.phase_name),
        h('span', { class: 'muted' }, `Noch ${verbleibend} von ${gesamt} Punkten unbewertet`)),
      h('div', { class: 'fortschritt', style: { margin: '.5rem 0 1rem' } },
        h('div', { style: { width: `${Math.round(((gesamt - verbleibend) / Math.max(1, gesamt)) * 100)}%` } })),
      h('h2', {}, `${p.nr} `, gewerkeBadges(p.gewerke)),
      h('p', { style: { fontSize: '1.1rem' } }, p.text),
      p.hinweis ? h('p', { class: 'muted' }, `Hinweis: ${p.hinweis}`) : null,
      h('div', { class: 'formular-spalten' }, feld('Verantwortlicher', verantwortlich), feld('Zieltermin', termin)),
      feld('Begründung bei „Nicht relevant"', begruendung),
      h('div', { class: 'zeile', style: { marginTop: '.6rem' } },
        h('button', {
          class: 'btn btn-primary', onclick: () => bewerten({
            relevanz: 'relevant',
            verantwortlich_kontakt_id: verantwortlich.value ? Number(verantwortlich.value) : null,
            termin: termin.value || null,
          }, 'Als relevant bewertet'),
        }, '✓ Relevant'),
        h('button', {
          class: 'btn', onclick: () => {
            if (!begruendung.value.trim()) return toast('Begründung ist bei „Nicht relevant" Pflicht', 'fehler');
            bewerten({ relevanz: 'nicht_relevant', relevanz_begruendung: begruendung.value.trim() }, 'Als nicht relevant bewertet');
          },
        }, 'Nicht relevant'),
        h('button', { class: 'btn', onclick: () => { index++; zeigePunkt(); } }, 'Überspringen →'))));
  }

  if (!punkte.length) fertig();
  else zeigePunkt();
}
