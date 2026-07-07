// M5 – Besprechungsdetail: Agenda, Protokollpunkte mit Übernahme, Feststellung, Nachtrag
import { get, post, patch, del, api } from '../api.js';
import {
  h, clear, kopfzeile, modal, confirmModal, toast, fehlerToast, feld, textInput, textArea,
  dateInput, select, gewerkSelect, gewerkBadge, statusBadge, badge, label, formatDate,
  terminZelle, laden, leerHinweis,
} from '../ui.js';
import { objektZusatz } from '../objekt.js';

export async function renderBesprechung(el, params, query) {
  const meetingId = Number(params.meetingId);
  el.append(laden());
  let m, kontakte = [];
  try {
    m = await get(`/meetings/${meetingId}`);
    try { kontakte = await get(`/projects/${m.project_id}/contacts`); } catch { kontakte = []; }
  } catch (e) { return fehlerToast(e); }
  const projektId = m.project_id;
  let projekt;
  try { projekt = await get(`/projects/${projektId}`); } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';
  const festgestellt = m.status === 'festgestellt';
  const neuLaden = () => { clear(el); renderBesprechung(el, params, {}); };

  const kontaktSelect = (value = '') => select([
    { value: '', label: '— Verantwortlicher —', selected: !value },
    ...kontakte.map((k) => ({ value: String(k.id), label: k.name + (k.firma ? ` (${k.firma})` : ''), selected: Number(value) === k.id })),
  ]);

  clear(el);

  // ---------- Kopf ----------
  const statusAktionen = [];
  if (!readonly) {
    const naechster = { geplant: 'entwurf', entwurf: 'versandt', versandt: 'festgestellt' }[m.status];
    if (naechster) {
      statusAktionen.push(h('button', {
        class: naechster === 'festgestellt' ? 'btn btn-primary' : 'btn',
        onclick: async () => {
          if (naechster === 'festgestellt' && !(await confirmModal('Protokoll feststellen? Nach der Feststellung sind inhaltliche Änderungen nur noch als gekennzeichneter Nachtrag möglich.', { okLabel: 'Feststellen' }))) return;
          try { await patch(`/meetings/${m.id}`, { status: naechster }); toast(`Protokoll: ${label(naechster)}`); neuLaden(); }
          catch (e) { fehlerToast(e); }
        },
      }, `→ ${label(naechster)}`));
    }
  }

  el.append(kopfzeile(`${m.titel}`,
    statusBadge(m.status),
    ...statusAktionen,
    h('a', { class: 'btn', href: `/api/meetings/${m.id}/protokoll.pdf`, target: '_blank' }, 'Protokoll-PDF'),
    readonly ? null : h('button', {
      class: 'btn', onclick: () => {
        const datum = dateInput();
        const dlg = modal({
          title: 'Folgetermin anlegen',
          body: h('div', {}, h('p', { class: 'muted' }, 'Typ, Ort und Teilnehmer werden übernommen; offene Punkte laufen automatisch mit (PRO-04).'), feld('Datum *', datum)),
          actions: [h('button', {
            class: 'btn btn-primary', onclick: async () => {
              try {
                const r = await post(`/meetings/${m.id}/folgetermin`, { datum: datum.value });
                toast('Folgetermin angelegt'); dlg.close();
                window.location.hash = `#/besprechung/${r.id}`;
              } catch (e) { fehlerToast(e); }
            },
          }, 'Anlegen')],
        });
      },
    }, 'Folgetermin')));

  el.append(h('div', { class: 'muted', style: { marginTop: '-.6rem', marginBottom: '1rem' } },
    `${label(m.typ)}${m.serie ? ` · ${m.serie.titel} Nr. ${m.nr_in_serie}` : ''} · ${formatDate(m.datum)}${m.ort ? ' · ' + m.ort : ''}`,
    ' · ', h('a', { href: `#/projekt/${projektId}/besprechungen` }, 'Alle Besprechungen')));

  const raster = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } });
  el.append(raster);

  // ---------- Teilnehmer (PRO-08) ----------
  const teilnehmerKarte = h('div', { class: 'karte' }, h('h2', {}, 'Teilnehmer'));
  raster.append(teilnehmerKarte);
  for (const t of m.teilnehmer) {
    const statusSel = select(['eingeladen', 'anwesend', 'entschuldigt', 'verteiler'].map((s) => ({ value: s, label: label(s), selected: t.status === s })), { disabled: readonly });
    statusSel.addEventListener('change', async () => {
      try { await api(`/meetings/${m.id}/teilnehmer`, { method: 'PUT', body: { contact_id: t.contact_id, status: statusSel.value } }); toast('Anwesenheit gespeichert'); }
      catch (e) { fehlerToast(e); }
    });
    teilnehmerKarte.append(h('div', { class: 'zeile', style: { marginBottom: '.3rem' } },
      h('span', { style: { flex: 1 } }, t.name, t.firma ? h('span', { class: 'muted' }, ` (${t.firma})`) : null),
      statusSel,
      readonly ? null : h('button', {
        class: 'btn-icon', title: 'Entfernen',
        onclick: async () => {
          try { await del(`/meetings/${m.id}/teilnehmer/${t.contact_id}`); neuLaden(); } catch (e) { fehlerToast(e); }
        },
      }, '✕')));
  }
  if (!readonly && kontakte.length) {
    const neu = kontaktSelect();
    teilnehmerKarte.append(h('div', { class: 'zeile', style: { marginTop: '.5rem' } }, neu,
      h('button', {
        class: 'btn', onclick: async () => {
          if (!neu.value) return;
          try { await api(`/meetings/${m.id}/teilnehmer`, { method: 'PUT', body: { contact_id: Number(neu.value), status: 'eingeladen' } }); neuLaden(); }
          catch (e) { fehlerToast(e); }
        },
      }, 'Hinzufügen')));
  }

  // ---------- Agenda (PRO-02) ----------
  const agendaKarte = h('div', { class: 'karte' }, h('h2', {}, 'Agenda'));
  raster.append(agendaKarte);
  if (m.agenda.length) {
    agendaKarte.append(h('ol', { style: { paddingLeft: '1.2rem', margin: '0 0 .5rem' } },
      m.agenda.map((topPunkt) => h('li', {}, topPunkt.titel))));
  } else {
    agendaKarte.append(h('p', { class: 'muted' }, 'Noch keine Agenda.'));
  }
  if (!readonly && !festgestellt) {
    agendaKarte.append(h('div', { class: 'zeile' },
      h('button', {
        class: 'btn', onclick: () => {
          const titel = textInput({ placeholder: 'TOP-Titel' });
          const dlg = modal({
            title: 'TOP manuell ergänzen', body: feld('Titel *', titel),
            actions: [h('button', {
              class: 'btn btn-primary', onclick: async () => {
                if (!titel.value.trim()) return;
                try { await post(`/meetings/${m.id}/agenda-uebernehmen`, { tops: [{ titel: titel.value.trim() }] }); dlg.close(); neuLaden(); }
                catch (e) { fehlerToast(e); }
              },
            }, 'Hinzufügen')],
          });
        },
      }, '+ TOP'),
      h('button', { class: 'btn', onclick: agendaVorschlag }, 'Agenda-Vorschlag laden')));
  }

  async function agendaVorschlag() {
    let vorschlag;
    try { vorschlag = await get(`/meetings/${m.id}/agenda-vorschlag`); } catch (e) { return fehlerToast(e); }
    const boxen = [];
    const gruppe = (titel, eintraege, mapFn) => !eintraege.length ? null : h('div', {},
      h('h3', {}, titel),
      eintraege.map((eintrag) => {
        const { text, top } = mapFn(eintrag);
        const cb = h('input', { type: 'checkbox' });
        boxen.push({ cb, top });
        return h('label', { style: { display: 'block' } }, cb, ` ${text}`);
      }));
    const suchfeld = textInput({ placeholder: 'Checkpunkte durchsuchen … (Enter)' });
    const checkpointBereich = h('div');
    const zeigeCheckpoints = (liste) => {
      clear(checkpointBereich).append(gruppe('Offene Checkpunkte (Auswahl)', liste, (c) => ({
        text: `${c.nr} ${c.text}`, top: { titel: `Checkpunkt ${c.nr}: ${c.text}`, quelle_typ: 'checkpoint', quelle_id: c.id },
      })) || leerHinweis('Keine Treffer.'));
    };
    suchfeld.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      try { const v = await get(`/meetings/${m.id}/agenda-vorschlag?q=${encodeURIComponent(suchfeld.value)}`); zeigeCheckpoints(v.offene_checkpoints); }
      catch (err) { fehlerToast(err); }
    });
    zeigeCheckpoints(vorschlag.offene_checkpoints);

    const dlg = modal({
      title: 'Agenda automatisch vorbefüllen (PRO-02)',
      wide: true,
      body: h('div', {},
        gruppe('Offene Protokollpunkte der Vorbesprechungen', vorschlag.offene_punkte, (p) => ({
          text: `${p.code} ${p.text}`, top: { titel: `${p.code}: ${p.text}`, quelle_typ: 'protocol_item', quelle_id: p.id },
        })) || h('p', { class: 'muted' }, 'Keine offenen Punkte aus Vorbesprechungen.'),
        gruppe('Überfällige Aufgaben', vorschlag.ueberfaellige_aufgaben, (t) => ({
          text: `${t.titel} (${formatDate(t.termin)})`, top: { titel: `Aufgabe: ${t.titel}`, quelle_typ: 'task', quelle_id: t.id },
        })),
        feld('Checkpunkte suchen', suchfeld),
        checkpointBereich),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const tops = boxen.filter((b) => b.cb.checked).map((b) => b.top);
          if (!tops.length) return toast('Nichts ausgewählt', 'fehler');
          try { await post(`/meetings/${m.id}/agenda-uebernehmen`, { tops }); toast(`${tops.length} TOPs übernommen`); dlg.close(); neuLaden(); }
          catch (e) { fehlerToast(e); }
        },
      }, 'In Agenda übernehmen')],
    });
  }

  // ---------- Protokollpunkte ----------
  function punktTabelle(punkte, { uebernommen = false } = {}) {
    if (!punkte.length) return leerHinweis(uebernommen ? 'Keine offenen Punkte aus früheren Besprechungen.' : 'Noch keine Punkte in dieser Besprechung.');
    return h('div', { class: 'tabelle-umbruch' }, h('table', { class: 'tabelle' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'schmal' }, 'Code'), h('th', { class: 'schmal' }, 'Typ'), h('th', {}, 'Punkt'),
        h('th', { class: 'schmal' }, 'Gewerk'), h('th', {}, 'Verantwortlich'), h('th', {}, 'Termin'), h('th', { class: 'schmal' }, 'Status'))),
      h('tbody', {}, punkte.map((p) => h('tr', {
        class: 'zeile-klickbar',
        style: query.punkt && Number(query.punkt) === p.id ? { background: '#fff3cd' } : {},
        onclick: () => punktDialog(p),
      },
        h('td', { class: 'schmal' }, h('strong', {}, p.code)),
        h('td', { class: 'schmal' }, label(p.typ)),
        h('td', {},
          p.nachtrag_zu_code ? badge(`Nachtrag zu ${p.nachtrag_zu_code}`) : null,
          p.nachtrag_zu_code ? ' ' : null, p.text,
          uebernommen ? h('div', { class: 'muted' }, `aus: ${p.uebernommen_aus.meeting_titel} (${formatDate(p.uebernommen_aus.meeting_datum)})`) : null),
        h('td', { class: 'schmal' }, p.gewerk ? gewerkBadge(p.gewerk) : '—'),
        h('td', {}, p.verantwortlich_name || '—'),
        h('td', {}, terminZelle(p.termin, p.status)),
        h('td', { class: 'schmal' }, statusBadge(p.status)))))));
  }

  function punktDialog(p) {
    const eigenes = p.meeting_id === m.id;
    const inhaltGesperrt = readonly || (festgestellt && eigenes) || !eigenes;
    const text = textArea({ value: p.text, disabled: inhaltGesperrt });
    const gewerk = gewerkSelect({ value: p.gewerk || '', attrs: { disabled: inhaltGesperrt } });
    const verantwortlich = kontaktSelect(p.verantwortlich_kontakt_id || '');
    verantwortlich.disabled = inhaltGesperrt;
    const termin = dateInput({ value: p.termin || '', disabled: inhaltGesperrt });

    const dlg = modal({
      title: `${p.code} · ${label(p.typ)}`,
      wide: true,
      body: h('div', {},
        inhaltGesperrt && !readonly ? h('p', { class: 'muted' }, eigenes
          ? 'Protokoll ist festgestellt – inhaltliche Änderungen nur als Nachtrag (PRO-05).'
          : 'Übernommener Punkt einer früheren Besprechung – Status kann hier gepflegt werden.') : null,
        feld('Text', text),
        h('div', { class: 'formular-spalten' },
          feld('Gewerk', gewerk), feld('Verantwortlicher', verantwortlich), feld('Termin', termin)),
        h('div', { class: 'zeile' },
          readonly ? null : h('button', {
            class: 'btn btn-primary', onclick: async () => {
              try {
                const daten = { status: p.status === 'offen' ? 'erledigt' : 'offen' };
                await patch(`/protocol-items/${p.id}`, daten);
                toast(daten.status === 'erledigt' ? 'Punkt erledigt' : 'Punkt wieder offen');
                dlg.close(); neuLaden();
              } catch (e) { fehlerToast(e); }
            },
          }, p.status === 'offen' ? '✓ Erledigt' : 'Wieder öffnen'),
          !inhaltGesperrt ? h('button', {
            class: 'btn', onclick: async () => {
              try {
                await patch(`/protocol-items/${p.id}`, {
                  text: text.value, gewerk: gewerk.value || null,
                  verantwortlich_kontakt_id: verantwortlich.value ? Number(verantwortlich.value) : null,
                  termin: termin.value || null,
                });
                toast('Gespeichert'); dlg.close(); neuLaden();
              } catch (e) { fehlerToast(e); }
            },
          }, 'Speichern') : null,
          readonly ? null : h('button', {
            class: 'btn', onclick: () => {
              const nt = textArea({ placeholder: 'Nachtrag / Korrektur zum Punkt' });
              const nd = modal({
                title: `Nachtrag zu ${p.code}`, body: feld('Text *', nt),
                actions: [h('button', {
                  class: 'btn btn-primary', onclick: async () => {
                    try { await post(`/protocol-items/${p.id}/nachtrag`, { text: nt.value }); toast('Nachtrag angelegt'); nd.close(); dlg.close(); neuLaden(); }
                    catch (e) { fehlerToast(e); }
                  },
                }, 'Anlegen')],
              });
            },
          }, 'Nachtrag …'),
          !readonly && !festgestellt && eigenes ? h('button', {
            class: 'btn btn-gefahr', onclick: async () => {
              if (!(await confirmModal(`Punkt ${p.code} löschen?`))) return;
              try { await del(`/protocol-items/${p.id}`); toast('Gelöscht'); dlg.close(); neuLaden(); }
              catch (e) { fehlerToast(e); }
            },
          }, 'Löschen') : null),
        objektZusatz('protocol_item', p.id, { projectId: projektId, readonly })),
    });
  }

  el.append(h('div', { class: 'karte' },
    h('h2', {}, 'Übernommene offene Punkte (alte zuerst)'),
    punktTabelle(m.uebernommene_punkte, { uebernommen: true })));
  el.append(h('div', { class: 'karte' },
    h('h2', {}, 'Punkte dieser Besprechung'),
    punktTabelle(m.punkte)));

  // ---------- Neuer Punkt ----------
  if (!readonly && !festgestellt) {
    const typ = select([['information', 'Information'], ['beschluss', 'Beschluss'], ['aufgabe', 'Aufgabe']].map(([v, l]) => ({ value: v, label: l })));
    const text = textArea({ placeholder: 'Beschluss, Information oder Aufgabe …', rows: 2 });
    const gewerk = gewerkSelect({});
    const verantwortlich = kontaktSelect();
    const termin = dateInput();
    el.append(h('div', { class: 'karte' },
      h('h2', {}, 'Neuer Protokollpunkt'),
      h('p', { class: 'muted' }, 'Punkte vom Typ „Aufgabe" erscheinen automatisch in der Aufgabenliste des Verantwortlichen (PRO-06).'),
      feld('Text *', text),
      h('div', { class: 'formular-spalten' },
        feld('Typ', typ), feld('Gewerk', gewerk), feld('Verantwortlicher', verantwortlich), feld('Termin', termin)),
      h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            const r = await post(`/meetings/${m.id}/items`, {
              typ: typ.value, text: text.value, gewerk: gewerk.value || null,
              verantwortlich_kontakt_id: verantwortlich.value ? Number(verantwortlich.value) : null,
              termin: termin.value || null,
            });
            toast(`Punkt ${r.code} angelegt`);
            neuLaden();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Punkt aufnehmen')));
  } else if (festgestellt) {
    el.append(h('p', { class: 'muted' }, 'Protokoll ist festgestellt. Neue Inhalte sind nur als Nachtrag zu bestehenden Punkten oder in der Folgebesprechung möglich.'));
  }
}
