// M2 – Checklisten-Abwicklung: Filter, gespeicherte Ansichten, Detail, Massenbearbeitung
import { get, post, patch, del, state } from '../api.js';
import {
  h, clear, kopfzeile, modal, confirmModal, toast, fehlerToast, feld, textInput, textArea,
  dateInput, select, gewerkSelect, gewerkeMehrfach, gewerkeBadges, statusBadge, badge, label,
  terminZelle, laden, leerHinweis,
} from '../ui.js';
import { objektZusatz } from '../objekt.js';

export async function renderCheckliste(el, params, query) {
  const projektId = Number(params.projektId);
  const filter = {
    phase_id: query.phase || '', gewerk: query.gewerk || '', status: query.status || '',
    relevanz: query.relevanz || '', verantwortlich: '', termin: query.termin || '', q: query.q || '',
  };
  const auswahl = new Set();
  let projekt, phasen, kontakte = [];

  el.append(laden());
  try {
    [projekt, phasen] = await Promise.all([get(`/projects/${projektId}`), get(`/projects/${projektId}/phases`)]);
    try { kontakte = await get(`/projects/${projektId}/contacts`); } catch { kontakte = []; }
  } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';

  const liste = h('div');
  const aktionsleiste = h('div');

  async function ladeListe() {
    auswahl.clear();
    clear(aktionsleiste);
    clear(liste).append(laden());
    try {
      const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const punkte = await get(`/projects/${projektId}/checkpoints${qs ? '?' + qs : ''}`);
      clear(liste);
      if (!punkte.length) return liste.append(leerHinweis('Keine Punkte für die gewählten Filter.'));
      const jePhase = new Map();
      for (const p of punkte) {
        if (!jePhase.has(p.phase_id)) jePhase.set(p.phase_id, { name: p.phase_name, punkte: [] });
        jePhase.get(p.phase_id).punkte.push(p);
      }
      for (const [, gruppe] of jePhase) {
        const erledigt = gruppe.punkte.filter((p) => p.status === 'erledigt').length;
        liste.append(h('h2', { style: { marginTop: '1rem' } }, `${gruppe.name} `, h('span', { class: 'muted' }, `(${erledigt}/${gruppe.punkte.length} erledigt)`)));
        liste.append(h('div', { class: 'tabelle-umbruch' }, h('table', { class: 'tabelle' },
          h('thead', {}, h('tr', {},
            h('th', { class: 'schmal' }, ''), h('th', { class: 'schmal' }, 'Nr.'), h('th', {}, 'Punkt'),
            h('th', {}, 'Gewerke'), h('th', {}, 'Status'), h('th', {}, 'Verantwortlich'), h('th', {}, 'Termin'))),
          h('tbody', {}, gruppe.punkte.map((p) => punktZeile(p))))));
      }
    } catch (e) { fehlerToast(e); }
  }

  function punktZeile(p) {
    const cb = h('input', {
      type: 'checkbox', 'aria-label': `Punkt ${p.nr} auswählen`,
      onclick: (e) => { e.stopPropagation(); e.target.checked ? auswahl.add(p.id) : auswahl.delete(p.id); zeigeAktionsleiste(); },
    });
    return h('tr', { class: 'zeile-klickbar', onclick: () => oeffnePunkt(p.id) },
      h('td', { class: 'schmal', onclick: (e) => e.stopPropagation() }, readonly ? '' : cb),
      h('td', { class: 'schmal' }, p.nr),
      h('td', { title: p.hinweis || '' },
        p.relevanz === 'nicht_relevant' ? h('s', { class: 'muted' }, p.text) : p.text,
        p.is_custom ? [' ', badge('Zusatzpunkt')] : null),
      h('td', {}, gewerkeBadges(p.gewerke)),
      h('td', {},
        p.relevanz === 'nicht_relevant' ? statusBadge('nicht_relevant')
          : [statusBadge(p.status), p.relevanz === 'unbewertet' ? [' ', statusBadge('unbewertet')] : null]),
      h('td', {}, p.verantwortlich_name || '—'),
      h('td', {}, terminZelle(p.termin, p.relevanz === 'nicht_relevant' ? 'nicht_relevant' : p.status)));
  }

  function zeigeAktionsleiste() {
    clear(aktionsleiste);
    if (!auswahl.size) return;
    aktionsleiste.append(h('div', { class: 'karte zeile' },
      h('strong', {}, `${auswahl.size} Punkte ausgewählt:`),
      h('button', { class: 'btn', onclick: () => bulk('verantwortlich') }, 'Verantwortlichen setzen'),
      h('button', { class: 'btn', onclick: () => bulk('termin') }, 'Termin setzen'),
      h('button', { class: 'btn', onclick: () => bulk('status') }, 'Status setzen'),
      h('button', { class: 'btn', onclick: () => bulk('nicht_relevant') }, 'Nicht relevant …')));
  }

  async function bulk(art) {
    const ids = [...auswahl];
    const senden = async (patchDaten) => {
      try {
        const r = await post('/checkpoints/bulk', { ids, patch: patchDaten });
        toast(`${r.ok} Punkte geändert${r.fehler.length ? `, ${r.fehler.length} Fehler` : ''}`);
        if (r.fehler.length) console.warn(r.fehler);
        ladeListe();
      } catch (e) { fehlerToast(e); }
    };
    if (art === 'verantwortlich') {
      const sel = kontaktSelect();
      const m = modal({
        title: 'Verantwortlichen setzen', body: feld('Verantwortlicher', sel),
        actions: [h('button', { class: 'btn btn-primary', onclick: () => { m.close(); senden({ verantwortlich_kontakt_id: sel.value ? Number(sel.value) : null }); } }, 'Übernehmen')],
      });
    } else if (art === 'termin') {
      const inp = dateInput();
      const m = modal({
        title: 'Termin setzen', body: feld('Termin', inp),
        actions: [h('button', { class: 'btn btn-primary', onclick: () => { m.close(); senden({ termin: inp.value || null }); } }, 'Übernehmen')],
      });
    } else if (art === 'status') {
      const sel = select(['offen', 'in_bearbeitung', 'erledigt'].map((s) => ({ value: s, label: label(s) })));
      const m = modal({
        title: 'Status setzen', body: feld('Status', sel),
        actions: [h('button', { class: 'btn btn-primary', onclick: () => { m.close(); senden({ status: sel.value }); } }, 'Übernehmen')],
      });
    } else if (art === 'nicht_relevant') {
      const begr = textArea({ placeholder: 'Begründung (Pflicht) – gilt für alle ausgewählten Punkte' });
      const m = modal({
        title: 'Punkte auf „Nicht relevant" setzen',
        body: h('div', {}, h('p', { class: 'muted' }, 'Die Begründung wird bei jedem Punkt dokumentiert (CHK-01).'), feld('Begründung *', begr)),
        actions: [h('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!begr.value.trim()) return toast('Begründung ist Pflicht', 'fehler');
            m.close(); senden({ relevanz: 'nicht_relevant', relevanz_begruendung: begr.value.trim() });
          },
        }, 'Übernehmen')],
      });
    }
  }

  function kontaktSelect(value = '') {
    return select([
      { value: '', label: '— kein Verantwortlicher —', selected: !value },
      ...kontakte.map((k) => ({ value: String(k.id), label: k.name + (k.firma ? ` (${k.firma})` : ''), selected: Number(value) === k.id })),
    ]);
  }

  // ---------------- Detail-Modal ----------------
  async function oeffnePunkt(id) {
    let p;
    try { p = await get(`/checkpoints/${id}`); } catch (e) { return fehlerToast(e); }
    const kannBearbeiten = !readonly && p.relevanz !== 'nicht_relevant';

    const verantwortlich = kontaktSelect(p.verantwortlich_kontakt_id || '');
    const termin = dateInput({ value: p.termin || '' });
    const prio = select(['hoch', 'normal', 'niedrig'].map((x) => ({ value: x, label: label(x), selected: p.prio === x })));

    const speichern = async (daten, meldung = 'Gespeichert') => {
      try { await patch(`/checkpoints/${p.id}`, daten); toast(meldung); m.close(); ladeListe(); }
      catch (e) { fehlerToast(e); }
    };

    const statusAktionen = [];
    if (kannBearbeiten) {
      if (p.status === 'offen') statusAktionen.push(h('button', { class: 'btn', onclick: () => speichern({ status: 'in_bearbeitung' }) }, 'In Bearbeitung'));
      if (['offen', 'in_bearbeitung', 'blockiert'].includes(p.status)) statusAktionen.push(h('button', { class: 'btn btn-primary', onclick: () => speichern({ status: 'erledigt' }, 'Punkt erledigt') }, '✓ Erledigt'));
      if (['offen', 'in_bearbeitung'].includes(p.status)) statusAktionen.push(h('button', { class: 'btn', onclick: () => blockierenDialog() }, 'Blockiert …'));
      if (p.status === 'blockiert') statusAktionen.push(h('button', { class: 'btn', onclick: () => speichern({ status: 'in_bearbeitung', blocker_text: null, blocker_ref_typ: null, blocker_ref_id: null }, 'Blockade aufgehoben') }, 'Blockade aufheben'));
      if (p.status === 'erledigt') statusAktionen.push(h('button', { class: 'btn', onclick: () => wiedereroeffnenDialog() }, 'Wiedereröffnen …'));
      if (p.status === 'offen' && p.relevanz !== 'nicht_relevant') statusAktionen.push(h('button', { class: 'btn', onclick: () => nichtRelevantDialog() }, 'Nicht relevant …'));
    }
    if (!readonly && p.relevanz === 'nicht_relevant') {
      statusAktionen.push(h('button', { class: 'btn', onclick: () => speichern({ relevanz: 'relevant' }, 'Punkt ist wieder relevant') }, 'Wieder relevant setzen'));
    }

    function blockierenDialog() {
      const grund = textArea({ placeholder: 'Was blockiert diesen Punkt? (Pflicht, alternativ Verweis auf Punkt/Aufgabe über Verknüpfungen)' });
      const d = modal({
        title: `Punkt ${p.nr} blockieren`, body: feld('Blocker *', grund),
        actions: [h('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!grund.value.trim()) return toast('Blocker-Angabe ist Pflicht', 'fehler');
            d.close(); speichern({ status: 'blockiert', blocker_text: grund.value.trim() }, 'Punkt blockiert');
          },
        }, 'Blockieren')],
      });
    }
    function wiedereroeffnenDialog() {
      const kommentar = textArea({ placeholder: 'Warum wird der Punkt wiedereröffnet? (Pflichtkommentar, CHK-02)' });
      const d = modal({
        title: `Punkt ${p.nr} wiedereröffnen`, body: feld('Kommentar *', kommentar),
        actions: [h('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!kommentar.value.trim()) return toast('Kommentar ist Pflicht', 'fehler');
            d.close(); speichern({ status: 'offen', kommentar: kommentar.value.trim() }, 'Punkt wiedereröffnet');
          },
        }, 'Wiedereröffnen')],
      });
    }
    function nichtRelevantDialog() {
      const begr = textArea({ placeholder: 'Warum entfällt dieser Punkt in diesem Projekt? (Pflicht, CHK-01)' });
      const d = modal({
        title: `Punkt ${p.nr} als „Nicht relevant" bewerten`, body: feld('Begründung *', begr),
        actions: [h('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!begr.value.trim()) return toast('Begründung ist Pflicht', 'fehler');
            d.close(); speichern({ relevanz: 'nicht_relevant', relevanz_begruendung: begr.value.trim() }, 'Als nicht relevant bewertet');
          },
        }, 'Übernehmen')],
      });
    }

    const m = modal({
      title: `${p.nr} · ${p.phase_name}`,
      wide: true,
      body: h('div', {},
        h('p', { style: { fontSize: '1.05rem' } }, p.text, p.is_custom ? [' ', badge('Zusatzpunkt')] : null),
        p.hinweis ? h('p', { class: 'muted' }, `Hinweis: ${p.hinweis}`) : null,
        h('div', { class: 'zeile', style: { marginBottom: '.8rem' } },
          gewerkeBadges(p.gewerke),
          p.relevanz === 'nicht_relevant' ? statusBadge('nicht_relevant') : statusBadge(p.status),
          p.relevanz === 'unbewertet' ? statusBadge('unbewertet') : null),
        p.relevanz === 'nicht_relevant' && p.relevanz_begruendung
          ? h('p', { class: 'muted' }, `Begründung: ${p.relevanz_begruendung}`) : null,
        p.status === 'blockiert' ? h('p', { style: { color: 'var(--rot)' } },
          `Blockiert durch: ${p.blocker_text || p.blocker_label || '—'}`) : null,
        h('div', { class: 'zeile', style: { marginBottom: '1rem' } }, statusAktionen),
        kannBearbeiten ? h('div', { class: 'formular-spalten' },
          feld('Verantwortlicher', verantwortlich),
          feld('Termin', termin),
          feld('Priorität', prio),
          h('div', { style: { alignSelf: 'end', marginBottom: '.8rem' } },
            h('button', {
              class: 'btn', onclick: () => speichern({
                verantwortlich_kontakt_id: verantwortlich.value ? Number(verantwortlich.value) : null,
                termin: termin.value || null, prio: prio.value,
              }),
            }, 'Zuordnung speichern'))) : null,
        !readonly && p.is_custom ? h('div', { style: { marginTop: '.4rem' } },
          h('button', {
            class: 'btn btn-gefahr', onclick: async () => {
              if (!(await confirmModal('Diesen Zusatzpunkt löschen?'))) return;
              try { await del(`/checkpoints/${p.id}`); toast('Zusatzpunkt gelöscht'); m.close(); ladeListe(); }
              catch (e) { fehlerToast(e); }
            },
          }, 'Zusatzpunkt löschen')) : null,
        objektZusatz('checkpoint', p.id, { projectId: projektId, readonly })),
    });
  }

  // ---------------- Zusatzpunkt / Import ----------------
  function zusatzpunktDialog() {
    const phase = select(phasen.map((ph) => ({ value: String(ph.id), label: ph.name })));
    const text = textArea({ placeholder: 'Prüf-/Arbeitspunkt' });
    const gewerke = gewerkeMehrfach('');
    const termin = dateInput();
    const m = modal({
      title: 'Projektspezifischen Zusatzpunkt anlegen',
      wide: true,
      body: h('div', {}, feld('Phase *', phase), feld('Text *', text), feld('Gewerke', gewerke.element), feld('Termin', termin)),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await post(`/projects/${projektId}/checkpoints`, {
              phase_id: Number(phase.value), text: text.value, gewerke: gewerke.getValue(), termin: termin.value || null,
            });
            toast('Zusatzpunkt angelegt'); m.close(); ladeListe();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Anlegen')],
    });
  }

  function importDialog() {
    const csv = textArea({ rows: 8, placeholder: 'Phase;Text;Gewerke;Prio;Termin\n4;Zusätzliche Abstimmung Statik;AR,MT;hoch;2026-09-01' });
    const vorschau = h('div');
    const m = modal({
      title: 'Zusatzpunkte aus CSV importieren',
      wide: true,
      body: h('div', {}, feld('CSV-Inhalt (Spalten: Phase;Text;Gewerke;Prio;Termin)', csv), vorschau),
      actions: [
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              const r = await post(`/projects/${projektId}/checkpoints/import`, { csv: csv.value, commit: false });
              clear(vorschau).append(
                h('p', {}, `${r.ok.length} Zeilen gültig, ${r.fehler.length} fehlerhaft.`),
                r.fehler.length ? h('ul', {}, r.fehler.map((f) => h('li', { style: { color: 'var(--rot)' } }, `Zeile ${f.zeile}: ${f.grund}`))) : null);
            } catch (e) { fehlerToast(e); }
          },
        }, 'Vorschau'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            try {
              const r = await post(`/projects/${projektId}/checkpoints/import`, { csv: csv.value, commit: true });
              toast(`${r.importiert ?? r.ok?.length ?? 0} Punkte importiert`);
              m.close(); ladeListe();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Importieren')],
    });
  }

  // ---------------- Gespeicherte Ansichten (CHK-03) ----------------
  const ansichtenSelect = h('select', { class: 'input', 'aria-label': 'Gespeicherte Ansichten' });
  async function ladeAnsichten() {
    try {
      const ansichten = await get('/views?modul=checkliste');
      clear(ansichtenSelect).append(
        h('option', { value: '' }, '— Gespeicherte Ansichten —'),
        ...ansichten.map((a) => h('option', { value: String(a.id), dataset: { filter: a.filter } }, a.name)));
    } catch { /* Ansichten sind optional */ }
  }
  ansichtenSelect.addEventListener('change', () => {
    const opt = ansichtenSelect.selectedOptions[0];
    if (!opt || !opt.dataset.filter) return;
    try {
      Object.assign(filter, JSON.parse(opt.dataset.filter));
      filterFelder();
      ladeListe();
    } catch { /* defekte Ansicht ignorieren */ }
  });

  // ---------------- Filterleiste ----------------
  const filterLeiste = h('div', { class: 'filter-leiste' });
  function filterFelder() {
    const phaseSel = select([{ value: '', label: 'Alle Phasen', selected: !filter.phase_id },
      ...phasen.map((ph) => ({ value: String(ph.id), label: ph.name, selected: String(filter.phase_id) === String(ph.id) }))]);
    const gewerkSel = gewerkSelect({ value: filter.gewerk, leer: 'Alle Gewerke' });
    const statusSel = select([{ value: '', label: 'Alle Status', selected: !filter.status },
      ...['offen', 'in_bearbeitung', 'erledigt', 'blockiert'].map((s) => ({ value: s, label: label(s), selected: filter.status === s }))]);
    const relevanzSel = select([{ value: '', label: 'Alle Relevanzen', selected: !filter.relevanz },
      ...['unbewertet', 'relevant', 'nicht_relevant'].map((s) => ({ value: s, label: label(s), selected: filter.relevanz === s }))]);
    const verantwortlichSel = select([{ value: '', label: 'Alle Verantwortlichen', selected: !filter.verantwortlich },
      ...kontakte.map((k) => ({ value: String(k.id), label: k.name, selected: String(filter.verantwortlich) === String(k.id) }))]);
    const terminSel = select([
      { value: '', label: 'Alle Termine', selected: !filter.termin },
      { value: 'ueberfaellig', label: 'Überfällig', selected: filter.termin === 'ueberfaellig' },
      { value: 'woche', label: 'Diese Woche', selected: filter.termin === 'woche' },
    ]);
    const suche = textInput({ value: filter.q, placeholder: 'Freitext …' });
    suche.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filter.q = suche.value; ladeListe(); } });
    const anwenden = () => {
      filter.phase_id = phaseSel.value; filter.gewerk = gewerkSel.value; filter.status = statusSel.value;
      filter.relevanz = relevanzSel.value; filter.verantwortlich = verantwortlichSel.value;
      filter.termin = terminSel.value; filter.q = suche.value;
      ladeListe();
    };
    for (const s of [phaseSel, gewerkSel, statusSel, relevanzSel, verantwortlichSel, terminSel]) s.addEventListener('change', anwenden);

    clear(filterLeiste).append(
      feld('Phase', phaseSel), feld('Gewerk', gewerkSel), feld('Status', statusSel),
      feld('Relevanz', relevanzSel), feld('Verantwortlich', verantwortlichSel), feld('Termin', terminSel),
      feld('Suche', suche),
      h('button', {
        class: 'btn', title: 'Aktuelle Filter als persönliche Ansicht speichern', onclick: async () => {
          const name = prompt('Name der Ansicht:');
          if (!name) return;
          try { await post('/views', { modul: 'checkliste', name, filter }); toast('Ansicht gespeichert'); ladeAnsichten(); }
          catch (e) { fehlerToast(e); }
        },
      }, 'Ansicht speichern'),
      ansichtenSelect);
  }

  clear(el);
  el.append(kopfzeile('Checkliste',
    h('a', { class: 'btn', href: `#/projekt/${projektId}/setup` }, 'Setup-Modus'),
    readonly ? null : h('button', { class: 'btn', onclick: importDialog }, 'CSV-Import'),
    readonly ? null : h('button', { class: 'btn btn-primary', onclick: zusatzpunktDialog }, '+ Zusatzpunkt')));
  el.append(filterLeiste, aktionsleiste, liste);
  filterFelder();
  ladeAnsichten();
  await ladeListe();
  if (query.punkt) oeffnePunkt(Number(query.punkt));
}
