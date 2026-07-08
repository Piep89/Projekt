// Projekt-Dashboard (PRJ-02): Fortschritt, offene/überfällige Punkte je Gewerk,
// Dokumentenstand, Termine, Journal, Meilenstein-Zeitleiste (PRJ-03)
import { get } from '../api.js';
import {
  h, clear, kopfzeile, gewerkBadge, statusBadge, formatDate, laden, fehlerToast, label,
} from '../ui.js';
import { hilfeKnopf } from './hilfe.js';
import { state } from '../api.js';

export async function renderDashboard(el, params) {
  el.append(laden());
  try {
    const p = await get(`/projects/${params.projektId}`);
    clear(el);
    const basis = `#/projekt/${p.id}`;

    el.append(kopfzeile(p.name, hilfeKnopf('start'),
      statusBadge(p.status),
      h('a', { class: 'btn', href: `${basis}/berichte` }, 'Statusbericht')));

    el.append(h('div', { class: 'muted', style: { marginTop: '-.6rem', marginBottom: '1rem' } },
      `${p.geraetetyp}${p.gebaeude ? ' · Gebäude ' + p.gebaeude : ''}${p.ebene ? ' · Ebene ' + p.ebene : ''}${p.budget ? ' · Budget ' + p.budget : ''}`));

    // Deutlicher Einstieg, solange die Erstbewertung läuft (CHK-08)
    if (p.punkte.unbewertet > 0 && p.status === 'aktiv') {
      el.append(h('div', { class: 'karte hinweis-karte' },
        h('div', { class: 'zeile', style: { justifyContent: 'space-between' } },
          h('div', {},
            h('strong', {}, `Erstbewertung: noch ${p.punkte.unbewertet} Punkte unbewertet. `),
            'Erst nach der Bewertung zeigt das Dashboard den echten Arbeitsvorrat.'),
          h('a', { class: 'btn btn-primary', href: `${basis}/setup` }, 'Erstbewertung fortsetzen'))));
    }

    // Schnellaktionen für den Alltag
    el.append(h('div', { class: 'zeile', style: { marginBottom: '1rem' } },
      h('a', { class: 'btn', href: `${basis}/journal` }, '+ Journaleintrag'),
      h('a', { class: 'btn', href: `${basis}/maengel` }, '+ Mangel'),
      h('a', { class: 'btn', href: `${basis}/besprechungen` }, '+ Besprechung'),
      h('a', { class: 'btn', href: `${basis}/checkliste?termin=ueberfaellig` }, 'Überfällige Punkte'),
      h('a', { class: 'btn', href: `${basis}/berichte` }, 'Abnahmereife prüfen')));

    // Kennzahlen
    el.append(h('div', { class: 'karten-reihe' },
      kennzahl(`${p.fortschritt} %`, 'Fortschritt (relevante Punkte)'),
      kennzahl(String(p.punkte.unbewertet || 0), 'Punkte unbewertet', p.punkte.unbewertet ? '' : 'gruen', `${basis}/setup`),
      kennzahl(String(sumUeberfaellig(p.je_gewerk)), 'Punkte überfällig', sumUeberfaellig(p.je_gewerk) ? 'rot' : 'gruen', `${basis}/checkliste?termin=ueberfaellig`),
      kennzahl(`${p.dokumente.erhalten || 0} / ${p.dokumente.benoetigt || 0}`, 'Dokumente erhalten / benötigt', '', `${basis}/dokumente`),
      kennzahl(String(p.offene_maengel), 'Offene Mängel', p.offene_maengel ? 'rot' : 'gruen', `${basis}/maengel`)));

    // Meilenstein-Zeitleiste
    if (p.meilensteine.length) {
      el.append(h('div', { class: 'karte' },
        h('h2', {}, 'Meilensteine'),
        h('div', { class: 'zeitleiste' }, p.meilensteine.map((m) => h('div', { class: `meilenstein ${m.erledigt ? 'erledigt' : ''}` },
          h('div', { class: 'm-name' }, m.name),
          h('div', { class: 'm-datum' }, formatDate(m.datum)))))));
    }

    const zweispaltig = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } });
    el.append(zweispaltig);

    // Fortschritt je Phase
    zweispaltig.append(h('div', { class: 'karte' },
      h('h2', {}, 'Fortschritt je Phase'),
      p.phasen.map((ph) => {
        const prozent = ph.relevant ? Math.round((ph.erledigt / ph.relevant) * 100) : 0;
        return h('a', {
          href: `${basis}/checkliste?phase=${ph.id}`, class: 'fortschritt-zeile',
          style: { marginBottom: '.45rem', color: 'inherit' },
        },
          h('span', { style: { flex: '0 0 55%', fontSize: '.88rem' } }, ph.name),
          h('div', { class: 'fortschritt', style: { flex: '1' } }, h('div', { style: { width: `${prozent}%` } })),
          h('span', { class: 'prozent' }, ph.relevant ? `${ph.erledigt}/${ph.relevant}` : '—'));
      })));

    // Offene Punkte je Gewerk (farbcodiert)
    const gewerkeSortiert = state.gewerke.map((g) => g.kuerzel).filter((k) => p.je_gewerk[k]);
    zweispaltig.append(h('div', { class: 'karte' },
      h('h2', {}, 'Offene Punkte je Gewerk'),
      gewerkeSortiert.length ? h('table', { class: 'tabelle' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Gewerk'), h('th', {}, 'Offen'), h('th', {}, 'Überfällig'), h('th', {}, 'Blockiert'))),
        h('tbody', {}, gewerkeSortiert.map((k) => {
          const s = p.je_gewerk[k];
          return h('tr', { class: 'zeile-klickbar', onclick: () => { window.location.hash = `${basis.slice(1)}/checkliste?gewerk=${encodeURIComponent(k)}&status=offen`; window.location.hash = `${basis}/checkliste?gewerk=${encodeURIComponent(k)}`; } },
            h('td', {}, gewerkBadge(k)),
            h('td', {}, String(s.offen)),
            h('td', {}, s.ueberfaellig ? h('span', { class: 'ueberfaellig' }, String(s.ueberfaellig)) : '0'),
            h('td', {}, s.blockiert ? h('span', { class: 'ueberfaellig' }, String(s.blockiert)) : '0'));
        })))
        : h('div', { class: 'leer-hinweis' }, 'Keine offenen Punkte – oder noch keine Bewertung (Setup-Modus).')));

    // Nächste Termine (Punkte) + Besprechungen
    zweispaltig.append(h('div', { class: 'karte' },
      h('h2', {}, 'Nächste Termine'),
      p.naechste_termine.length ? h('ul', { style: { paddingLeft: '1.1rem', margin: 0 } },
        p.naechste_termine.map((t) => h('li', { style: { marginBottom: '.3rem' } },
          h('strong', {}, formatDate(t.termin)), ' – ',
          h('a', { href: `${basis}/checkliste?punkt=${t.id}` }, `${t.nr} ${kurz(t.text, 70)}`))))
        : h('div', { class: 'leer-hinweis' }, 'Keine terminierten Punkte.'),
      h('h2', { style: { marginTop: '1rem' } }, 'Nächste Besprechungen'),
      p.naechste_besprechungen.length ? h('ul', { style: { paddingLeft: '1.1rem', margin: 0 } },
        p.naechste_besprechungen.map((b) => h('li', {},
          h('a', { href: `#/besprechung/${b.id}` }, `${formatDate(b.datum)} – ${b.titel}`), ' ', statusBadge(b.status))))
        : h('div', { class: 'leer-hinweis' }, 'Keine anstehenden Besprechungen.')));

    // Letzte Journaleinträge
    zweispaltig.append(h('div', { class: 'karte' },
      h('h2', {}, 'Letzte Journaleinträge'),
      p.letzte_journaleintraege.length ? p.letzte_journaleintraege.map((j) => h('div', { style: { marginBottom: '.5rem' } },
        h('div', { class: 'muted' }, `${formatDate(j.datum)} · ${label(j.kategorie)}`),
        h('a', { href: `${basis}/journal?eintrag=${j.id}` }, kurz(j.text, 110))))
        : h('div', { class: 'leer-hinweis' }, 'Noch keine Einträge.'),
      h('a', { class: 'btn', href: `${basis}/journal`, style: { marginTop: '.4rem' } }, 'Zum Journal')));
  } catch (e) { fehlerToast(e); }
}

function kennzahl(wert, beschriftung, klasse = '', href = null) {
  const inhalt = h('div', { class: 'karte kennzahl', style: href ? { cursor: 'pointer' } : {} },
    h('div', { class: `wert ${klasse}` }, wert),
    h('div', { class: 'beschriftung' }, beschriftung));
  if (href) inhalt.addEventListener('click', () => { window.location.hash = href; });
  return inhalt;
}

function sumUeberfaellig(jeGewerk) {
  // Punkte können mehreren Gewerken zugeordnet sein; für die Kachel reicht die Summe der Anzeige
  return Object.values(jeGewerk).reduce((a, s) => a + (s.ueberfaellig || 0), 0);
}

function kurz(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
