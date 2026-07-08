// REP-04 – Volltextsuche projektbezogen und global; private Notizen nur für den Ersteller
import { get } from '../api.js';
import { h, clear, kopfzeile, feld, textInput, select, laden, leerHinweis, fehlerToast, statusBadge } from '../ui.js';

const GRUPPEN = [
  ['checkpoints', 'Checkpunkte', (t) => `#/projekt/${t.project_id}/checkliste?punkt=${t.id}`, (t) => `${t.nr} ${t.text}`],
  ['protocol_items', 'Protokollpunkte', (t) => `#/besprechung/${t.meeting_id}?punkt=${t.id}`, (t) => `${t.code} ${t.text}`],
  ['journal', 'Journal', (t) => `#/projekt/${t.project_id}/journal?eintrag=${t.id}`, (t) => `${t.datum}: ${t.text}`],
  ['rooms', 'Räume', (t) => `#/projekt/${t.project_id}/raumbuch?raum=${t.id}`, (t) => `${t.nummer} ${t.bezeichnung}`],
  ['documents', 'Dokumente', (t) => `#/projekt/${t.project_id}/dokumente?eintrag=${t.id}`, (t) => `${t.nr} ${t.titel}`],
  ['contacts', 'Kontakte', (t) => `#/projekt/${t.project_id}/kontakte`, (t) => `${t.name}${t.firma ? ` (${t.firma})` : ''}`],
  ['tasks', 'Aufgaben', () => '#/aufgaben', (t) => t.titel],
  ['defects', 'Mängel', (t) => `#/projekt/${t.project_id}/maengel?mangel=${t.id}`, (t) => `M-${String(t.nummer).padStart(3, '0')} ${t.beschreibung}`],
  ['meetings', 'Besprechungen', (t) => `#/besprechung/${t.id}`, (t) => `${t.titel} (${t.datum})`],
];

export async function renderSuche(el, params, query) {
  let projekte = [];
  try { projekte = await get('/projects'); } catch { projekte = []; }

  const suchfeld = textInput({ value: query.q || '', placeholder: 'Suchbegriff (mind. 2 Zeichen) …' });
  const projektSel = select([{ value: '', label: 'Alle meine Projekte' },
    ...projekte.map((p) => ({ value: String(p.id), label: p.name }))]);
  const ergebnisse = h('div');

  async function suchen() {
    const q = suchfeld.value.trim();
    if (q.length < 2) return;
    window.location.hash = `#/suche?q=${encodeURIComponent(q)}`;
    clear(ergebnisse).append(laden());
    try {
      const [offiziell, notizen] = await Promise.all([
        get(`/search?q=${encodeURIComponent(q)}${projektSel.value ? `&projekt=${projektSel.value}` : ''}`),
        get(`/notes?q=${encodeURIComponent(q)}`).catch(() => []),
      ]);
      clear(ergebnisse);
      let treffer = 0;
      for (const [key, titel, link, text] of GRUPPEN) {
        const liste = offiziell[key] || [];
        if (!liste.length) continue;
        treffer += liste.length;
        ergebnisse.append(h('div', { class: 'karte' },
          h('h2', {}, `${titel} (${liste.length})`),
          h('ul', { style: { paddingLeft: '1.1rem', margin: 0 } }, liste.map((t) => h('li', { style: { marginBottom: '.25rem' } },
            h('a', { href: link(t) }, kurz(text(t), 120)),
            t.status ? [' ', statusBadge(t.status)] : null,
            h('span', { class: 'muted' }, ` · ${t.projekt_name}`))))));
      }
      if (notizen.length) {
        treffer += notizen.length;
        ergebnisse.append(h('div', { class: 'karte hinweis-karte' },
          h('h2', {}, `🔒 Private Notizen (${notizen.length}) – nur für Sie sichtbar`),
          h('ul', { style: { paddingLeft: '1.1rem', margin: 0 } }, notizen.map((n) => h('li', {},
            h('a', { href: '#/notizen' }, kurz(`${n.titel}: ${n.text}`, 120)))))));
      }
      if (!treffer) ergebnisse.append(leerHinweis(`Keine Treffer für „${q}".`));
    } catch (e) { fehlerToast(e); }
  }

  suchfeld.addEventListener('keydown', (e) => { if (e.key === 'Enter') suchen(); });
  projektSel.addEventListener('change', suchen);

  clear(el);
  el.append(kopfzeile('Suche'));
  el.append(h('div', { class: 'filter-leiste' },
    feld('Suchbegriff', suchfeld), feld('Projekt', projektSel),
    h('button', { class: 'btn btn-primary', onclick: suchen }, 'Suchen')));
  el.append(ergebnisse);
  if (query.q && query.q.length >= 2) await suchen();
}

function kurz(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
