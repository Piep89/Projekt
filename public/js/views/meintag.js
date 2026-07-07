// NOT-01 – Mein Tag / Meine Woche: persönliche Aufgaben und Wiedervorlagen projektübergreifend
import { get, post, patch } from '../api.js';
import {
  h, clear, kopfzeile, modal, toast, fehlerToast, feld, textInput, textArea, dateInput,
  select, badge, formatDate, terminZelle, laden, leerHinweis,
} from '../ui.js';

export async function renderMeinTag(el) {
  el.append(laden());
  let daten, projekte = [];
  try {
    [daten, projekte] = await Promise.all([get('/my/overview'), get('/projects')]);
  } catch (e) { return fehlerToast(e); }

  clear(el);
  el.append(kopfzeile('Mein Tag / Meine Woche',
    h('button', { class: 'btn btn-primary', onclick: neueAufgabe }, '+ Aufgabe')));

  function aufgabenListe(aufgaben, { rot = false } = {}) {
    if (!aufgaben.length) return leerHinweis('Nichts vorhanden.');
    return h('div', {}, aufgaben.map((t) => {
      const cb = h('input', {
        type: 'checkbox', checked: t.status === 'erledigt', 'aria-label': `Aufgabe ${t.titel} erledigen`,
        onchange: async () => {
          try {
            await patch(`/tasks/${t.id}`, { status: cb.checked ? 'erledigt' : 'offen' });
            toast(cb.checked ? 'Aufgabe erledigt' : 'Aufgabe wieder offen');
          } catch (e) { fehlerToast(e); cb.checked = !cb.checked; }
        },
      });
      return h('div', { class: 'zeile', style: { padding: '.3rem 0', borderBottom: '1px solid var(--rand)' } },
        cb,
        h('span', { style: { flex: 1, textDecoration: t.status === 'erledigt' ? 'line-through' : 'none' } },
          t.titel,
          t.quelle_label ? [' ', badge(t.quelle_label)] : null,
          t.projekt_name ? h('span', { class: 'muted' }, ` · ${t.projekt_name}`) : null),
        h('span', { class: rot ? 'ueberfaellig' : 'muted' }, t.termin ? formatDate(t.termin) : ''));
    }));
  }

  const abschnitte = [
    ['Überfällig', daten.ueberfaellig, { rot: true }],
    ['Heute', daten.heute, {}],
    ['Diese Woche', daten.diese_woche, {}],
    ['Erinnerungen / Wiedervorlagen', daten.erinnerungen, {}],
    ['Später / ohne Termin', daten.spaeter_oder_ohne_termin, {}],
  ];
  const raster = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' } });
  el.append(raster);
  for (const [titel, liste, opts] of abschnitte) {
    if (!liste || (!liste.length && titel !== 'Heute')) continue;
    raster.append(h('div', { class: 'karte' },
      h('h2', {}, titel, ' ', h('span', { class: 'muted' }, `(${liste.length})`)),
      aufgabenListe(liste, opts)));
  }

  if (daten.ueberfaellige_punkte?.length) {
    raster.append(h('div', { class: 'karte' },
      h('h2', {}, 'Überfällige Checkpunkte in meinen Projekten'),
      h('ul', { style: { paddingLeft: '1.1rem' } }, daten.ueberfaellige_punkte.map((p) => h('li', {},
        h('a', { href: `#/projekt/${p.project_id || p.projekt_id}/checkliste?punkt=${p.id}` }, `${p.nr} ${p.text}`),
        h('span', { class: 'ueberfaellig' }, ` ${formatDate(p.termin)}`),
        h('span', { class: 'muted' }, ` · ${p.projekt_name}`))))));
  }
  if (daten.offene_protokollpunkte?.length) {
    raster.append(h('div', { class: 'karte' },
      h('h2', {}, 'Überfällige Protokollpunkte'),
      h('ul', { style: { paddingLeft: '1.1rem' } }, daten.offene_protokollpunkte.map((p) => h('li', {},
        h('a', { href: `#/besprechung/${p.meeting_id}?punkt=${p.id}` }, `${p.code} ${p.text}`),
        h('span', { class: 'ueberfaellig' }, ` ${formatDate(p.termin)}`),
        h('span', { class: 'muted' }, ` · ${p.projekt_name}`))))));
  }

  function neueAufgabe() {
    const titel = textInput();
    const beschreibung = textArea({ rows: 2 });
    const projekt = select([{ value: '', label: '— ohne Projekt (persönlich) —' },
      ...projekte.filter((p) => p.status !== 'archiviert').map((p) => ({ value: String(p.id), label: p.name }))]);
    const termin = dateInput();
    const erinnerung = dateInput();
    const m = modal({
      title: 'Neue Aufgabe',
      body: h('div', {}, feld('Titel *', titel), feld('Beschreibung', beschreibung), feld('Projekt', projekt),
        h('div', { class: 'formular-spalten' }, feld('Termin', termin), feld('Erinnerung (Wiedervorlage)', erinnerung))),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await post('/tasks', {
              titel: titel.value, beschreibung: beschreibung.value || null,
              project_id: projekt.value ? Number(projekt.value) : null,
              termin: termin.value || null, erinnerung: erinnerung.value || null,
            });
            toast('Aufgabe angelegt'); m.close(); clear(el); renderMeinTag(el);
          } catch (e) { fehlerToast(e); }
        },
      }, 'Anlegen')],
    });
  }
}
