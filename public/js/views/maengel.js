// M7 – Mängelmanagement: Erfassung mit Fotos, Statusverfolgung bis Abnahme, Mängelliste-PDF
import { get, post, patch, upload } from '../api.js';
import {
  h, clear, kopfzeile, table, modal, toast, fehlerToast, feld, textInput, textArea, dateInput,
  select, gewerkSelect, gewerkBadge, statusBadge, label, terminZelle, laden, dropzone,
} from '../ui.js';
import { hilfeKnopf } from './hilfe.js';
import { objektZusatz } from '../objekt.js';
import { istOffline, merken } from '../offline.js';

const STATUS_FOLGE = ['offen', 'in_behebung', 'behoben', 'abgenommen'];

export async function renderMaengel(el, params, query) {
  const projektId = Number(params.projektId);
  el.append(laden());
  let projekt, rooms = [], firmen = [];
  try {
    projekt = await get(`/projects/${projektId}`);
    try { rooms = await get(`/projects/${projektId}/rooms`); } catch { rooms = []; }
    try { firmen = await get(`/projects/${projektId}/maengel-firmen`); } catch { firmen = []; }
  } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';
  const filter = { gewerk: '', firma: '', status: '', raum: '' };

  const kennzahlen = h('div', { class: 'karten-reihe' });
  const listeBereich = h('div');

  async function ladeListe() {
    clear(listeBereich).append(laden());
    try {
      const alle = await get(`/projects/${projektId}/maengel`);
      clear(kennzahlen);
      for (const s of STATUS_FOLGE) {
        const n = alle.filter((d) => d.status === s).length;
        kennzahlen.append(h('div', { class: 'karte kennzahl' },
          h('div', { class: `wert ${s === 'abgenommen' ? 'gruen' : (n && s === 'offen' ? 'rot' : '')}` }, String(n)),
          h('div', { class: 'beschriftung' }, label(s))));
      }
      const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const rows = qs ? await get(`/projects/${projektId}/maengel?${qs}`) : alle;
      clear(listeBereich).append(table([
        { label: 'Nr.', key: 'code', class: 'schmal' },
        { label: 'Beschreibung', render: (d) => d.beschreibung.length > 90 ? d.beschreibung.slice(0, 90) + '…' : d.beschreibung },
        { label: 'Raum', render: (d) => d.raum_nummer || '—', class: 'schmal' },
        { label: 'Gewerk', render: (d) => d.gewerk ? gewerkBadge(d.gewerk) : '—', class: 'schmal' },
        { label: 'Firma', key: 'firma' },
        { label: 'Frist', render: (d) => terminZelle(d.frist, d.status), class: 'schmal' },
        { label: 'Status', render: (d) => statusBadge(d.status), class: 'schmal' },
        { label: '📷', render: (d) => String(d.foto_anzahl || 0), class: 'schmal' },
      ], rows, { empty: 'Keine Mängel erfasst.', onRowClick: (d) => oeffneMangel(d.id) }));
    } catch (e) { fehlerToast(e); }
  }

  async function oeffneMangel(id) {
    let d;
    try { d = await get(`/maengel/${id}`); } catch (e) { return fehlerToast(e); }
    const beschreibung = textArea({ value: d.beschreibung, disabled: readonly });
    const gewerk = gewerkSelect({ value: d.gewerk || '', attrs: { disabled: readonly } });
    const firma = textInput({ value: d.firma || '', disabled: readonly });
    const frist = dateInput({ value: d.frist || '', disabled: readonly });
    const raum = select([{ value: '', label: '— kein Raum —' },
      ...rooms.map((r) => ({ value: String(r.id), label: `${r.nummer} ${r.bezeichnung}`, selected: d.room_id === r.id }))], { disabled: readonly });

    const naechste = STATUS_FOLGE[STATUS_FOLGE.indexOf(d.status) + 1];
    const statusButtons = [];
    if (!readonly && naechste) {
      statusButtons.push(h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try { await patch(`/maengel/${d.id}`, { status: naechste }); toast(`Status: ${label(naechste)}`); m.close(); ladeListe(); }
          catch (e) { fehlerToast(e); }
        },
      }, `→ ${label(naechste)}`));
    }
    if (!readonly && d.status === 'behoben') {
      statusButtons.push(h('button', {
        class: 'btn', onclick: async () => {
          try { await patch(`/maengel/${d.id}`, { status: 'in_behebung' }); toast('Zur Nachbesserung zurückgestuft'); m.close(); ladeListe(); }
          catch (e) { fehlerToast(e); }
        },
      }, 'Nachbesserung nötig'));
    }

    const fotoInput = h('input', { type: 'file', class: 'input', multiple: true, accept: 'image/*', capture: 'environment' });
    const fotoZone = dropzone(fotoInput, { hinweis: 'Fotos hierher ziehen oder einfügen (Strg+V)' });
    const detailBody = h('div', {},
        h('div', { class: 'zeile', style: { marginBottom: '.6rem' } }, statusBadge(d.status), ...statusButtons),
        feld('Beschreibung', beschreibung),
        h('div', { class: 'formular-spalten' },
          feld('Gewerk', gewerk), feld('Verursacher / Firma', firma), feld('Frist', frist), feld('Raum', raum)),
        readonly ? null : h('button', {
          class: 'btn', onclick: async () => {
            try {
              await patch(`/maengel/${d.id}`, {
                beschreibung: beschreibung.value, gewerk: gewerk.value || null, firma: firma.value || null,
                frist: frist.value || null, room_id: raum.value ? Number(raum.value) : null,
              });
              toast('Gespeichert'); m.close(); ladeListe();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Speichern'),
        h('h3', {}, `Fotos (${(d.fotos || []).length})`),
        (d.fotos || []).length ? h('div', { class: 'galerie' }, d.fotos.map((f) =>
          h('div', { class: 'foto' },
            h('img', { src: `/api/photos/${f.id}/datei`, alt: f.beschreibung || f.filename, loading: 'lazy' }),
            h('div', { class: 'foto-info' }, f.beschreibung || f.filename)))) : h('p', { class: 'muted' }, 'Keine Fotos.'),
        readonly ? null : h('div', { style: { marginTop: '.5rem' } }, fotoZone,
          h('button', {
            class: 'btn', style: { marginTop: '.4rem' }, onclick: async () => {
              if (!fotoInput.files.length) return;
              const fd = new FormData();
              for (const f of fotoInput.files) fd.append('fotos', f);
              fd.append('mangel_id', String(d.id));
              try { await upload(`/projects/${projektId}/photos`, fd); toast('Fotos hochgeladen'); m.close(); oeffneMangel(d.id); }
              catch (e) { fehlerToast(e); }
            },
          }, 'Fotos hochladen')),
        objektZusatz('defect', d.id, { projectId: projektId, readonly }));
    if (!readonly) detailBody.addEventListener('paste', (ev) => { if (fotoZone.einfuegen(ev.clipboardData)) ev.preventDefault(); });
    const m = modal({
      title: `${d.code} · ${statusBadge(d.status).textContent}`,
      wide: true,
      body: detailBody,
    });
  }

  function neuerMangel() {
    const beschreibung = textArea({ placeholder: 'Was ist mangelhaft? Wo genau?' });
    const gewerk = gewerkSelect({});
    const firma = textInput({ placeholder: 'Verursacher / zuständige Firma' });
    const frist = dateInput();
    const raum = select([{ value: '', label: '— kein Raum —' }, ...rooms.map((r) => ({ value: String(r.id), label: `${r.nummer} ${r.bezeichnung}` }))]);
    const fotos = h('input', { type: 'file', class: 'input', multiple: true, accept: 'image/*', capture: 'environment' });
    const zone = dropzone(fotos, { hinweis: 'Fotos hierher ziehen, einfügen (Strg+V) – oder unten auswählen' });
    const neuBody = h('div', {},
      feld('Beschreibung *', beschreibung),
      h('div', { class: 'formular-spalten' },
        feld('Gewerk', gewerk), feld('Verursacher / Firma', firma), feld('Frist zur Behebung', frist), feld('Raum', raum)),
      feld('Fotos', zone));
    neuBody.addEventListener('paste', (ev) => { if (zone.einfuegen(ev.clipboardData)) ev.preventDefault(); });
    const m = modal({
      title: 'Mangel erfassen',
      wide: true,
      body: neuBody,
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async (ev) => {
          ev.target.disabled = true;
          const daten = {
            beschreibung: beschreibung.value, gewerk: gewerk.value || null, firma: firma.value || null,
            frist: frist.value || null, room_id: raum.value ? Number(raum.value) : null,
          };
          // NFA-03: Mangel auch ohne Netz erfassbar (Fotos bitte nach Synchronisation ergänzen)
          const offlineMerken = () => merken({
            typ: 'json', methode: 'POST', pfad: `/projects/${projektId}/maengel`, body: daten,
            beschreibung: `Mangel: ${String(daten.beschreibung).slice(0, 60)}`,
          }).then(() => { m.close(); });
          if (istOffline()) { await offlineMerken(); return; }
          try {
            const r = await post(`/projects/${projektId}/maengel`, daten);
            if (fotos.files.length) {
              const fd = new FormData();
              for (const f of fotos.files) fd.append('fotos', f);
              fd.append('mangel_id', String(r.id));
              await upload(`/projects/${projektId}/photos`, fd);
            }
            toast(`Mangel ${r.code} erfasst`);
            m.close(); ladeListe();
          } catch (e) {
            ev.target.disabled = false;
            if (e instanceof TypeError) { await offlineMerken(); return; }
            fehlerToast(e);
          }
        },
      }, 'Erfassen')],
    });
  }

  // Filterleiste
  const gewerkSel = gewerkSelect({ leer: 'Alle Gewerke' });
  const firmaSel = select([{ value: '', label: 'Alle Firmen' }, ...firmen.map((f) => ({ value: f, label: f }))]);
  const statusSel = select([{ value: '', label: 'Alle Status' }, ...STATUS_FOLGE.map((s) => ({ value: s, label: label(s) }))]);
  const raumSel = select([{ value: '', label: 'Alle Räume' }, ...rooms.map((r) => ({ value: String(r.id), label: `${r.nummer}` }))]);
  const anwenden = () => {
    filter.gewerk = gewerkSel.value; filter.firma = firmaSel.value; filter.status = statusSel.value; filter.raum = raumSel.value;
    ladeListe();
  };
  for (const s of [gewerkSel, firmaSel, statusSel, raumSel]) s.addEventListener('change', anwenden);

  clear(el);
  el.append(kopfzeile('Mängel', hilfeKnopf('journal'),
    h('button', {
      class: 'btn', onclick: () => {
        const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        window.open(`/api/projects/${projektId}/maengelliste.pdf${qs ? '?' + qs : ''}`, '_blank');
      },
    }, 'Mängelliste (PDF)'),
    readonly ? null : h('button', { class: 'btn btn-primary', onclick: neuerMangel }, '+ Mangel')));
  el.append(kennzahlen);
  el.append(h('div', { class: 'filter-leiste' },
    feld('Gewerk', gewerkSel), feld('Firma', firmaSel), feld('Status', statusSel), feld('Raum', raumSel)));
  el.append(listeBereich);
  await ladeListe();
  if (query.mangel) oeffneMangel(Number(query.mangel));
}
