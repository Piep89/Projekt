// M6 – Projektjournal (Bautagebuch, NOT-03) und Fotogalerie (NOT-04)
import { get, post, patch, upload } from '../api.js';
import {
  h, clear, kopfzeile, modal, toast, fehlerToast, feld, textInput, textArea, dateInput,
  select, label, formatDate, formatDateTime, laden, leerHinweis,
} from '../ui.js';
import { istOffline, merken } from '../offline.js';

const KATEGORIEN = ['baustelle', 'planung', 'telefonat', 'begehung', 'sonstig'];

export async function renderJournal(el, params, query) {
  const projektId = Number(params.projektId);
  el.append(laden());
  let projekt, rooms = [];
  try {
    projekt = await get(`/projects/${projektId}`);
    try { rooms = await get(`/projects/${projektId}/rooms`); } catch { rooms = []; }
  } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';
  const filter = { von: '', bis: '', kategorie: '', q: '' };

  let aktiverTab = 'journal';
  const inhalt = h('div');
  const tabLeiste = h('div', { class: 'tab-leiste' }, [['journal', 'Journal'], ['galerie', 'Fotogalerie']].map(([key, text]) =>
    h('button', {
      class: `tab ${key === aktiverTab ? 'tab-aktiv' : ''}`,
      onclick: (e) => {
        aktiverTab = key;
        tabLeiste.querySelectorAll('.tab').forEach((b) => b.classList.remove('tab-aktiv'));
        e.target.classList.add('tab-aktiv');
        key === 'journal' ? zeigeJournal() : zeigeGalerie();
      },
    }, text)));

  clear(el);
  const exportVon = dateInput({ 'aria-label': 'Export von' });
  const exportBis = dateInput({ 'aria-label': 'Export bis' });
  el.append(kopfzeile('Journal & Fotos',
    exportVon, exportBis,
    h('button', {
      class: 'btn', onclick: () => {
        const qs = [exportVon.value && `von=${exportVon.value}`, exportBis.value && `bis=${exportBis.value}`].filter(Boolean).join('&');
        window.open(`/api/projects/${projektId}/journal.pdf${qs ? '?' + qs : ''}`, '_blank');
      },
    }, 'Bautagebuch-PDF')));
  el.append(tabLeiste, inhalt);

  // ---------------- Journal ----------------
  async function zeigeJournal() {
    clear(inhalt).append(laden());
    try {
      const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const eintraege = await get(`/projects/${projektId}/journal${qs ? '?' + qs : ''}`);
      clear(inhalt);

      // Neuer Eintrag
      if (!readonly) inhalt.append(neuerEintragKarte());

      // Filter
      const von = dateInput({ value: filter.von }); const bis = dateInput({ value: filter.bis });
      const kat = select([{ value: '', label: 'Alle Kategorien', selected: !filter.kategorie },
        ...KATEGORIEN.map((k) => ({ value: k, label: label(k), selected: filter.kategorie === k }))]);
      const suche = textInput({ value: filter.q, placeholder: 'Freitext … (Enter)' });
      const anwenden = () => { filter.von = von.value; filter.bis = bis.value; filter.kategorie = kat.value; filter.q = suche.value; zeigeJournal(); };
      for (const f of [von, bis, kat]) f.addEventListener('change', anwenden);
      suche.addEventListener('keydown', (e) => { if (e.key === 'Enter') anwenden(); });
      inhalt.append(h('div', { class: 'filter-leiste' }, feld('Von', von), feld('Bis', bis), feld('Kategorie', kat), feld('Suche', suche)));

      if (!eintraege.length) inhalt.append(leerHinweis('Keine Journaleinträge im gewählten Zeitraum.'));
      for (const e of eintraege) inhalt.append(eintragKarte(e));
    } catch (e) { fehlerToast(e); }
  }

  function neuerEintragKarte() {
    const datum = dateInput({ value: new Date().toISOString().slice(0, 10) });
    const kategorie = select(KATEGORIEN.map((k) => ({ value: k, label: label(k) })));
    const text = textArea({ placeholder: 'Was ist heute passiert? (Baustelle, Telefonat, Begehung …)', rows: 3 });
    const wetter = textInput({ placeholder: 'z. B. 24 °C, trocken' });
    const anwesende = textInput({ placeholder: 'z. B. Fa. Schmidt (2), Bauleitung' });
    const fotos = h('input', { type: 'file', class: 'input', multiple: true, accept: 'image/*', capture: 'environment' });
    return h('div', { class: 'karte' },
      h('h2', {}, 'Neuer Eintrag'),
      feld('Text *', text),
      h('div', { class: 'formular-spalten' },
        feld('Datum', datum), feld('Kategorie', kategorie), feld('Wetter', wetter), feld('Anwesende', anwesende)),
      feld('Fotos (Kamera oder Datei, automatischer Zeitstempel)', fotos),
      h('button', {
        class: 'btn btn-primary', onclick: async (ev) => {
          ev.target.disabled = true;
          const eintrag = {
            datum: datum.value, kategorie: kategorie.value, text: text.value,
            wetter: wetter.value || null, anwesende: anwesende.value || null,
          };
          // NFA-03: ohne Netz in den Ausgangskorb (inkl. Fotos), Synchronisation später
          const offlineMerken = async () => merken({
            typ: 'journal', projektId, eintrag,
            beschreibung: `Journaleintrag ${eintrag.datum}`,
            fotos: await Promise.all([...fotos.files].map(async (f) => ({
              name: f.name, type: f.type, blob: new Blob([await f.arrayBuffer()], { type: f.type }),
            }))),
          });
          try {
            if (!text.value.trim()) throw new Error('Text ist Pflicht');
            if (istOffline()) { await offlineMerken(); ev.target.disabled = false; return; }
            const r = await post(`/projects/${projektId}/journal`, eintrag);
            if (fotos.files.length) {
              const fd = new FormData();
              for (const f of fotos.files) fd.append('fotos', f);
              fd.append('journal_id', String(r.id));
              await upload(`/projects/${projektId}/photos`, fd);
            }
            toast('Journaleintrag angelegt');
            zeigeJournal();
          } catch (e) {
            ev.target.disabled = false;
            if (e instanceof TypeError) { await offlineMerken(); return; } // Netzausfall während des Sendens
            fehlerToast(e);
          }
        },
      }, 'Eintrag speichern'));
  }

  function eintragKarte(e) {
    const hervorgehoben = query.eintrag && Number(query.eintrag) === e.id;
    return h('div', { class: 'karte', style: hervorgehoben ? { borderColor: 'var(--primaer)', borderWidth: '2px' } : {} },
      h('div', { class: 'zeile', style: { justifyContent: 'space-between' } },
        h('div', {},
          h('strong', {}, formatDate(e.datum)), ` · ${label(e.kategorie)} `,
          e.editierbar ? null : h('span', { title: 'Eintrag ist abgeschlossen (Folgetag beendet) – Korrektur nur als Nachtrag' }, '🔒')),
        h('span', { class: 'muted' }, e.verfasser_name)),
      (e.wetter || e.anwesende) ? h('div', { class: 'muted' },
        [e.wetter && `Wetter: ${e.wetter}`, e.anwesende && `Anwesend: ${e.anwesende}`].filter(Boolean).join(' · ')) : null,
      h('p', { style: { whiteSpace: 'pre-line' } }, e.text),
      e.fotos?.length ? h('div', { class: 'galerie' }, e.fotos.map((f) => fotoKachel(f))) : null,
      (e.nachtraege || []).map((n) => h('div', { style: { borderLeft: '3px solid var(--rand)', paddingLeft: '.7rem', marginTop: '.5rem' } },
        h('div', { class: 'muted' }, `Nachtrag vom ${formatDate(n.datum)} · ${n.verfasser_name || ''}`),
        h('p', { style: { whiteSpace: 'pre-line', margin: '.2rem 0' } }, n.text))),
      readonly ? null : h('div', { class: 'zeile', style: { marginTop: '.4rem' } },
        e.editierbar ? h('button', { class: 'btn', onclick: () => bearbeiten(e) }, 'Bearbeiten') : null,
        h('button', { class: 'btn', onclick: () => nachtrag(e) }, 'Nachtrag'),
        h('button', { class: 'btn', onclick: () => fotosNachtragen(e) }, '+ Fotos')));
  }

  function bearbeiten(e) {
    const text = textArea({ value: e.text, rows: 4 });
    const wetter = textInput({ value: e.wetter || '' });
    const anwesende = textInput({ value: e.anwesende || '' });
    const m = modal({
      title: `Eintrag vom ${formatDate(e.datum)} bearbeiten`,
      body: h('div', {}, feld('Text *', text), feld('Wetter', wetter), feld('Anwesende', anwesende)),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await patch(`/journal/${e.id}`, { text: text.value, wetter: wetter.value || null, anwesende: anwesende.value || null });
            toast('Gespeichert'); m.close(); zeigeJournal();
          } catch (err) { fehlerToast(err); }
        },
      }, 'Speichern')],
    });
  }

  function nachtrag(e) {
    const text = textArea({ placeholder: 'Ergänzung / Korrektur zum ursprünglichen Eintrag', rows: 3 });
    const m = modal({
      title: `Nachtrag zum Eintrag vom ${formatDate(e.datum)}`,
      body: feld('Text *', text),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try { await post(`/journal/${e.id}/nachtrag`, { text: text.value }); toast('Nachtrag angelegt'); m.close(); zeigeJournal(); }
          catch (err) { fehlerToast(err); }
        },
      }, 'Anlegen')],
    });
  }

  function fotosNachtragen(e) {
    const fotos = h('input', { type: 'file', class: 'input', multiple: true, accept: 'image/*', capture: 'environment' });
    const m = modal({
      title: 'Fotos zum Eintrag hochladen',
      body: feld('Fotos', fotos),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          if (!fotos.files.length) return;
          const fd = new FormData();
          for (const f of fotos.files) fd.append('fotos', f);
          fd.append('journal_id', String(e.id));
          try { await upload(`/projects/${projektId}/photos`, fd); toast('Fotos hochgeladen'); m.close(); zeigeJournal(); }
          catch (err) { fehlerToast(err); }
        },
      }, 'Hochladen')],
    });
  }

  // ---------------- Fotogalerie (NOT-04) ----------------
  async function zeigeGalerie() {
    clear(inhalt).append(laden());
    const raumSel = select([{ value: '', label: 'Alle Räume' },
      ...rooms.map((r) => ({ value: String(r.id), label: `${r.nummer} ${r.bezeichnung}` }))]);
    async function ladeFotos() {
      try {
        const fotos = await get(`/projects/${projektId}/photos${raumSel.value ? `?room_id=${raumSel.value}` : ''}`);
        clear(galerieBereich).append(fotos.length
          ? h('div', { class: 'galerie' }, fotos.map((f) => fotoKachel(f)))
          : leerHinweis('Keine Fotos vorhanden.'));
      } catch (e) { fehlerToast(e); }
    }
    const galerieBereich = h('div');
    raumSel.addEventListener('change', ladeFotos);
    clear(inhalt).append(h('div', { class: 'filter-leiste' }, feld('Raum', raumSel)), galerieBereich);
    await ladeFotos();
  }

  function fotoKachel(f) {
    return h('div', { class: 'foto', style: { cursor: 'pointer' }, onclick: () => fotoModal(f) },
      h('img', { src: `/api/photos/${f.id}/datei`, alt: f.beschreibung || f.filename, loading: 'lazy' }),
      h('div', { class: 'foto-info' }, formatDateTime(f.aufnahme_zeit)));
  }

  function fotoModal(f) {
    const beschreibung = textInput({ value: f.beschreibung || '', disabled: readonly });
    const raum = select([{ value: '', label: '— kein Raum —' },
      ...rooms.map((r) => ({ value: String(r.id), label: `${r.nummer} ${r.bezeichnung}`, selected: f.room_id === r.id }))], { disabled: readonly });
    const m = modal({
      title: f.filename,
      wide: true,
      body: h('div', {},
        h('img', { src: `/api/photos/${f.id}/datei`, alt: f.beschreibung || f.filename, style: { maxWidth: '100%', maxHeight: '55vh', display: 'block', margin: '0 auto .8rem' } }),
        h('p', { class: 'muted' }, `Aufgenommen: ${formatDateTime(f.aufnahme_zeit)}`),
        h('div', { class: 'formular-spalten' }, feld('Beschreibung', beschreibung), feld('Raum-Zuordnung', raum))),
      actions: readonly ? [] : [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await patch(`/photos/${f.id}`, { beschreibung: beschreibung.value || null, room_id: raum.value ? Number(raum.value) : null });
            toast('Gespeichert'); m.close();
            aktiverTab === 'journal' ? zeigeJournal() : zeigeGalerie();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Speichern')],
    });
  }

  await zeigeJournal();
}
