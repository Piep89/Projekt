// M5 – Besprechungsübersicht: Serien, Einzeltermine, Neuanlage
import { get, post } from '../api.js';
import {
  h, clear, kopfzeile, table, modal, toast, fehlerToast, feld, textInput, dateInput,
  select, statusBadge, label, formatDate, laden, leerHinweis,
} from '../ui.js';
import { hilfeKnopf } from './hilfe.js';

export async function renderBesprechungen(el, params, query) {
  const projektId = Number(params.projektId);
  el.append(laden());
  let meetings = [], serien = [], kontakte = [], projekt;
  try {
    [projekt, meetings, serien] = await Promise.all([
      get(`/projects/${projektId}`),
      get(`/projects/${projektId}/meetings`),
      get(`/projects/${projektId}/meeting-series`),
    ]);
    try { kontakte = await get(`/projects/${projektId}/contacts`); } catch { kontakte = []; }
  } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';

  // Deep-Link ?punkt=ID → zur richtigen Besprechung springen
  if (query.punkt) {
    for (const m of meetings) {
      try {
        const detail = await get(`/meetings/${m.id}`);
        if (detail.punkte.some((p) => p.id === Number(query.punkt))) {
          window.location.hash = `#/besprechung/${m.id}?punkt=${query.punkt}`;
          return;
        }
      } catch { /* weiter suchen */ }
    }
  }

  clear(el);
  el.append(kopfzeile('Besprechungen', hilfeKnopf('besprechungen'),
    h('a', { class: 'btn', href: `/api/projects/${projektId}/termine.ics`, title: 'Termine für Outlook (ICS)' }, 'Kalender (ICS)'),
    readonly ? null : h('button', { class: 'btn btn-primary', onclick: neuDialog }, '+ Besprechung')));

  const spalten = [
    { label: 'Datum', render: (m) => formatDate(m.datum), class: 'schmal' },
    { label: 'Titel', render: (m) => h('div', {}, h('strong', {}, m.titel), m.ort ? h('div', { class: 'muted' }, m.ort) : null) },
    { label: 'Typ', render: (m) => label(m.typ), class: 'schmal' },
    { label: 'Protokoll', render: (m) => statusBadge(m.status), class: 'schmal' },
    { label: 'Offene Punkte', render: (m) => m.offene_punkte_anzahl ? h('span', { class: 'ueberfaellig' }, String(m.offene_punkte_anzahl)) : '0', class: 'schmal' },
  ];
  const oeffnen = (m) => { window.location.hash = `#/besprechung/${m.id}`; };

  for (const serie of serien) {
    const eigene = meetings.filter((m) => m.serie_id === serie.id);
    if (!eigene.length) continue;
    el.append(h('h2', { style: { marginTop: '1rem' } }, serie.titel,
      serie.rhythmus ? h('span', { class: 'muted' }, ` · ${serie.rhythmus}`) : null));
    el.append(table(spalten, eigene, { onRowClick: oeffnen }));
  }
  const einzel = meetings.filter((m) => !m.serie_id);
  if (einzel.length) {
    el.append(h('h2', { style: { marginTop: '1rem' } }, 'Einzeltermine'));
    el.append(table(spalten, einzel, { onRowClick: oeffnen }));
  }
  if (!meetings.length) el.append(leerHinweis('Noch keine Besprechungen. Legen Sie z. B. eine Baubesprechungs-Serie an.'));

  function neuDialog() {
    const typ = select([['planung', 'Planungsbesprechung'], ['bau', 'Baubesprechung'], ['lenkung', 'Lenkungskreis'], ['sonstige', 'Sonstige']].map(([v, l]) => ({ value: v, label: l })));
    const titel = textInput({ placeholder: 'z. B. Baubesprechung Nr. 1' });
    const datum = dateInput();
    const ort = textInput();
    const videolink = textInput({ placeholder: 'optional' });
    const serieArt = select([
      { value: 'keine', label: 'Einzeltermin' },
      { value: 'neu', label: 'Neue Serie starten' },
      ...serien.map((s) => ({ value: String(s.id), label: `Serie: ${s.titel}` })),
    ]);
    const serieTitel = textInput({ placeholder: 'Serientitel, z. B. Baubesprechung' });
    const serieRhythmus = textInput({ placeholder: 'z. B. wöchentlich Di 09:00' });
    const serieFelder = h('div', { style: { display: 'none' } }, feld('Serientitel *', serieTitel), feld('Rhythmus', serieRhythmus));
    serieArt.addEventListener('change', () => { serieFelder.style.display = serieArt.value === 'neu' ? '' : 'none'; });

    const teilnehmerBoxen = kontakte.map((k) => {
      const cb = h('input', { type: 'checkbox' });
      return { cb, id: k.id, el: h('label', { style: { display: 'block' } }, cb, ` ${k.name}${k.firma ? ` (${k.firma})` : ''}`) };
    });

    const m = modal({
      title: 'Neue Besprechung',
      wide: true,
      body: h('div', {},
        h('div', { class: 'formular-spalten' },
          feld('Typ *', typ), feld('Datum *', datum), feld('Titel *', titel), feld('Ort', ort),
          feld('Videolink', videolink), feld('Serie', serieArt)),
        serieFelder,
        kontakte.length ? feld('Teilnehmer (aus Kontakten)', h('div', {}, teilnehmerBoxen.map((t) => t.el)))
          : h('p', { class: 'muted' }, 'Tipp: Legen Sie zuerst Kontakte an, um Teilnehmer zuzuordnen.')),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          let serie = null;
          if (serieArt.value === 'neu') {
            if (!serieTitel.value.trim()) return toast('Serientitel ist Pflicht', 'fehler');
            serie = { titel: serieTitel.value.trim(), rhythmus: serieRhythmus.value || null };
          } else if (serieArt.value !== 'keine') {
            serie = { id: Number(serieArt.value) };
          }
          try {
            const r = await post(`/projects/${projektId}/meetings`, {
              typ: typ.value, titel: titel.value, datum: datum.value, ort: ort.value || null,
              videolink: videolink.value || null, serie,
              teilnehmer: teilnehmerBoxen.filter((t) => t.cb.checked).map((t) => t.id),
            });
            toast('Besprechung angelegt');
            m.close();
            window.location.hash = `#/besprechung/${r.id}`;
          } catch (e) { fehlerToast(e); }
        },
      }, 'Anlegen')],
    });
  }
}
