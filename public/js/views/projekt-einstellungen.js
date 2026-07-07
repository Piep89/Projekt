// Projekt-Einstellungen: Stammdaten, Meilensteine, Mitglieder, Status, Lessons Learned, Vorlagen-Delta
import { get, post, patch, del } from '../api.js';
import {
  h, clear, kopfzeile, modal, confirmModal, toast, fehlerToast, feld, textInput, textArea,
  dateInput, select, gewerkeMehrfach, gewerkeBadges, statusBadge, label, formatDate, laden, leerHinweis,
} from '../ui.js';

export async function renderProjektEinstellungen(el, params) {
  const projektId = Number(params.projektId);
  el.append(laden());
  let projekt, meta;
  try {
    [projekt, meta] = await Promise.all([get(`/projects/${projektId}`), get('/projects/meta')]);
  } catch (e) { return fehlerToast(e); }
  const istPL = projekt.zugriff.rolle === 'projektleiter';
  const archiviert = projekt.status === 'archiviert';
  const neuLaden = () => { clear(el); renderProjektEinstellungen(el, params); };

  clear(el);
  el.append(kopfzeile('Projekt-Einstellungen', statusBadge(projekt.status)));
  const raster = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' } });
  el.append(raster);

  // ---------- Stammdaten ----------
  const felder = {
    name: textInput({ value: projekt.name, disabled: !istPL || archiviert }),
    geraetetyp: select(meta.geraetetypen.map((g) => ({ value: g, label: g, selected: projekt.geraetetyp === g })), { disabled: !istPL || archiviert }),
    gebaeude: textInput({ value: projekt.gebaeude || '', disabled: !istPL || archiviert }),
    ebene: textInput({ value: projekt.ebene || '', disabled: !istPL || archiviert }),
    budget: textInput({ value: projekt.budget || '', disabled: !istPL || archiviert }),
    beschreibung: textArea({ value: projekt.beschreibung || '', disabled: !istPL || archiviert }),
  };
  raster.append(h('div', { class: 'karte' },
    h('h2', {}, 'Stammdaten'),
    h('div', { class: 'formular-spalten' },
      feld('Projektname', felder.name), feld('Gerätetyp', felder.geraetetyp),
      feld('Gebäude', felder.gebaeude), feld('Ebene', felder.ebene), feld('Budgetrahmen', felder.budget)),
    feld('Beschreibung', felder.beschreibung),
    istPL && !archiviert ? h('button', {
      class: 'btn btn-primary', onclick: async () => {
        try {
          await patch(`/projects/${projektId}`, {
            name: felder.name.value, geraetetyp: felder.geraetetyp.value, gebaeude: felder.gebaeude.value || null,
            ebene: felder.ebene.value || null, budget: felder.budget.value || null, beschreibung: felder.beschreibung.value || null,
          });
          toast('Stammdaten gespeichert');
        } catch (e) { fehlerToast(e); }
      },
    }, 'Speichern') : null));

  // ---------- Meilensteine (PRJ-03) ----------
  const msKarte = h('div', { class: 'karte' }, h('h2', {}, 'Meilensteine'));
  raster.append(msKarte);
  for (const m of projekt.meilensteine) {
    const datum = dateInput({ value: m.datum || '', disabled: archiviert });
    const erledigt = h('input', { type: 'checkbox', checked: Boolean(m.erledigt), disabled: archiviert, title: 'erreicht' });
    const speichern = async () => {
      try { await patch(`/milestones/${m.id}`, { datum: datum.value || null, erledigt: erledigt.checked }); toast('Meilenstein gespeichert'); }
      catch (e) { fehlerToast(e); }
    };
    datum.addEventListener('change', speichern);
    erledigt.addEventListener('change', speichern);
    msKarte.append(h('div', { class: 'zeile', style: { marginBottom: '.3rem' } },
      erledigt, h('span', { style: { flex: 1 } }, m.name), datum,
      archiviert ? null : h('button', {
        class: 'btn-icon', title: 'Löschen', onclick: async () => {
          if (!(await confirmModal(`Meilenstein „${m.name}" löschen?`))) return;
          try { await del(`/milestones/${m.id}`); neuLaden(); } catch (e) { fehlerToast(e); }
        },
      }, '✕')));
  }
  if (!archiviert) {
    const neuName = textInput({ placeholder: 'Neuer Meilenstein' });
    const neuDatum = dateInput();
    msKarte.append(h('div', { class: 'zeile', style: { marginTop: '.5rem' } }, neuName, neuDatum,
      h('button', {
        class: 'btn', onclick: async () => {
          if (!neuName.value.trim()) return;
          try { await post(`/projects/${projektId}/milestones`, { name: neuName.value.trim(), datum: neuDatum.value || null }); neuLaden(); }
          catch (e) { fehlerToast(e); }
        },
      }, '+')));
  }

  // ---------- Mitglieder (ROL-02/03) ----------
  const mitgliederKarte = h('div', { class: 'karte' }, h('h2', {}, 'Mitglieder und Rollen'));
  raster.append(mitgliederKarte);
  try {
    const mitglieder = await get(`/projects/${projektId}/members`);
    for (const m of mitglieder) {
      mitgliederKarte.append(h('div', { class: 'zeile', style: { marginBottom: '.3rem' } },
        h('span', { style: { flex: 1 } }, h('strong', {}, m.display_name), h('span', { class: 'muted' }, ` (${m.username})`)),
        h('span', { class: 'badge' }, label(m.role) === m.role ? { projektleiter: 'Projektleiter', bearbeiter: 'Bearbeiter', leser: 'Leser' }[m.role] : label(m.role)),
        m.gewerke ? gewerkeBadges(m.gewerke) : null,
        istPL ? h('button', {
          class: 'btn-icon', title: 'Entfernen', onclick: async () => {
            if (!(await confirmModal(`${m.display_name} aus dem Projekt entfernen?`))) return;
            try { await del(`/projects/${projektId}/members/${m.user_id}`); neuLaden(); } catch (e) { fehlerToast(e); }
          },
        }, '✕') : null));
    }
    if (istPL) {
      const username = textInput({ placeholder: 'Benutzername' });
      const rolle = select([['projektleiter', 'Projektleiter'], ['bearbeiter', 'Bearbeiter'], ['leser', 'Leser']].map(([v, l]) => ({ value: v, label: l, selected: v === 'bearbeiter' })));
      const gewerke = gewerkeMehrfach('');
      const gewerkeBereich = h('div', {}, feld('Gewerke-Einschränkung (nur Rolle Bearbeiter; leer = alle Gewerke)', gewerke.element));
      rolle.addEventListener('change', () => { gewerkeBereich.style.display = rolle.value === 'bearbeiter' ? '' : 'none'; });
      mitgliederKarte.append(h('div', { style: { marginTop: '.6rem', borderTop: '1px solid var(--rand)', paddingTop: '.6rem' } },
        h('div', { class: 'zeile' }, username, rolle,
          h('button', {
            class: 'btn', onclick: async () => {
              if (!username.value.trim()) return;
              try {
                await post(`/projects/${projektId}/members`, {
                  username: username.value.trim(), role: rolle.value,
                  gewerke: rolle.value === 'bearbeiter' ? (gewerke.getValue() || null) : null,
                });
                toast('Mitglied hinzugefügt'); neuLaden();
              } catch (e) { fehlerToast(e); }
            },
          }, 'Hinzufügen')),
        gewerkeBereich));
    }
  } catch { mitgliederKarte.append(leerHinweis('Mitglieder konnten nicht geladen werden.')); }

  // ---------- Projektstatus (PRJ-04) ----------
  const statusKarte = h('div', { class: 'karte' }, h('h2', {}, 'Projektstatus'));
  raster.append(statusKarte);
  const setzeStatus = async (status, frage) => {
    if (frage && !(await confirmModal(frage, { okLabel: 'Fortfahren' }))) return;
    try { await patch(`/projects/${projektId}`, { status }); toast(`Projekt ist jetzt: ${label(status)}`); neuLaden(); }
    catch (e) { fehlerToast(e); }
  };
  statusKarte.append(h('div', { class: 'zeile' },
    statusBadge(projekt.status),
    istPL && projekt.status === 'aktiv' ? h('button', { class: 'btn', onclick: () => setzeStatus('pausiert') }, 'Pausieren') : null,
    istPL && projekt.status === 'pausiert' ? h('button', { class: 'btn', onclick: () => setzeStatus('aktiv') }, 'Fortsetzen') : null,
    istPL && projekt.status !== 'archiviert' ? h('button', {
      class: 'btn btn-gefahr',
      onclick: () => setzeStatus('archiviert', 'Projekt archivieren? Es wird schreibgeschützt, bleibt aber vollständig les- und exportierbar (PRJ-04).'),
    }, 'Archivieren') : null,
    istPL && projekt.status === 'archiviert' ? h('button', { class: 'btn', onclick: () => setzeStatus('aktiv') }, 'Reaktivieren') : null));
  statusKarte.append(h('div', { style: { marginTop: '.8rem' } },
    h('button', {
      class: 'btn', onclick: () => {
        const name = textInput({ value: `${projekt.name} (Kopie)` });
        const m = modal({
          title: 'Projekt kopieren',
          body: h('div', {},
            h('p', { class: 'muted' }, 'Struktur, Relevanzbewertungen, Räume (Soll-Werte), Dokumentbewertungen, Meilensteine und Kontakte werden übernommen; Bearbeitungsstände werden zurückgesetzt.'),
            feld('Name des neuen Projekts', name)),
          actions: [h('button', {
            class: 'btn btn-primary', onclick: async () => {
              try {
                const r = await post(`/projects/${projektId}/copy`, { name: name.value });
                toast('Projekt kopiert'); m.close();
                window.location.hash = `#/projekt/${r.id}`;
              } catch (e) { fehlerToast(e); }
            },
          }, 'Kopieren')],
        });
      },
    }, 'Projekt kopieren'),
    ' ',
    h('a', { class: 'btn', href: `/api/projects/${projektId}/export` }, 'Vollexport (ZIP)')));

  // ---------- Lessons Learned (PRJ-06) ----------
  const llKarte = h('div', { class: 'karte' }, h('h2', {}, 'Lessons Learned → Vorlage'));
  raster.append(llKarte);
  try {
    const vorschlaege = await get(`/projects/${projektId}/template-suggestions`);
    if (vorschlaege.length) {
      llKarte.append(h('ul', { style: { paddingLeft: '1.1rem' } }, vorschlaege.map((v) =>
        h('li', {}, h('strong', {}, { neuer_punkt: 'Neuer Punkt', aenderung: 'Änderung', neues_dokument: 'Neues Dokument', sonstiges: 'Sonstiges' }[v.typ] || v.typ), `: ${v.text} `, statusBadge(v.status)))));
    } else {
      llKarte.append(h('p', { class: 'muted' }, 'Noch keine Vorschläge aus diesem Projekt.'));
    }
    if (!archiviert) {
      const typ = select([['neuer_punkt', 'Neuer Checkpunkt'], ['aenderung', 'Änderung an bestehendem Punkt'], ['neues_dokument', 'Neues Dokument'], ['sonstiges', 'Sonstiges']].map(([v, l]) => ({ value: v, label: l })));
      const text = textArea({ placeholder: 'Was sollte in die nächste Vorlagenversion einfließen?', rows: 2 });
      llKarte.append(feld('Typ', typ), feld('Vorschlag *', text),
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              await post(`/projects/${projektId}/template-suggestions`, { typ: typ.value, text: text.value });
              toast('Vorschlag erfasst'); neuLaden();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Vorschlag einreichen'));
    }
  } catch { llKarte.append(h('p', { class: 'muted' }, 'Vorlagen-Vorschläge sind nicht verfügbar.')); }

  // ---------- Papierkorb (UX-04) ----------
  const pkKarte = h('div', { class: 'karte' }, h('h2', {}, 'Papierkorb'));
  raster.append(pkKarte);
  try {
    const pk = await get(`/projects/${projektId}/papierkorb`);
    pkKarte.append(h('p', { class: 'muted' },
      `Gelöschte Objekte bleiben ${pk.aufbewahrung_tage} Tage wiederherstellbar.`));
    if (!pk.eintraege.length) {
      pkKarte.append(h('p', { class: 'muted' }, 'Der Papierkorb ist leer.'));
    } else {
      for (const e of pk.eintraege) {
        pkKarte.append(h('div', { class: 'zeile', style: { marginBottom: '.3rem' } },
          h('span', { style: { flex: 1 } }, e.bezeichnung,
            h('span', { class: 'muted' }, ` · gelöscht ${formatDate(e.geloescht_am)}${e.geloescht_von ? ' von ' + e.geloescht_von : ''}`)),
          archiviert ? null : h('button', {
            class: 'btn', onclick: async () => {
              try {
                await post(`/papierkorb/${e.id}/wiederherstellen`);
                toast('Wiederhergestellt');
                neuLaden();
              } catch (err) { fehlerToast(err); }
            },
          }, 'Wiederherstellen')));
      }
    }
  } catch { pkKarte.append(h('p', { class: 'muted' }, 'Papierkorb nicht verfügbar.')); }

  // ---------- Vorlagen-Aktualisierung (PRJ-05) ----------
  const deltaKarte = h('div', { class: 'karte' }, h('h2', {}, 'Neue Vorlagenpunkte übernehmen'));
  raster.append(deltaKarte);
  try {
    const delta = await get(`/projects/${projektId}/vorlagen-delta`);
    const neuePunkte = delta.neue_punkte || [];
    const neueDokumente = delta.neue_dokumente || [];
    if (!neuePunkte.length && !neueDokumente.length) {
      deltaKarte.append(h('p', { class: 'muted' }, 'Das Projekt ist auf dem Stand der aktuellen Vorlage.'));
    } else if (!archiviert) {
      const boxen = [];
      const liste = (titel, eintraege, art) => !eintraege.length ? null : h('div', {},
        h('h3', {}, titel),
        eintraege.map((e) => {
          const cb = h('input', { type: 'checkbox' });
          boxen.push({ cb, id: e.id, art });
          return h('label', { style: { display: 'block' } }, cb, ` ${e.nr} ${e.text || e.titel}`);
        }));
      deltaKarte.append(
        h('p', { class: 'muted' }, `Vorlage ${delta.vorlage?.version || ''} enthält Einträge, die diesem Projekt fehlen (PRJ-05).`),
        liste('Neue Checkpunkte', neuePunkte, 'punkt'),
        liste('Neue Dokumenteinträge', neueDokumente, 'dokument'),
        h('button', {
          class: 'btn btn-primary', style: { marginTop: '.5rem' }, onclick: async () => {
            const checkpoint_ids = boxen.filter((b) => b.cb.checked && b.art === 'punkt').map((b) => b.id);
            const dokument_ids = boxen.filter((b) => b.cb.checked && b.art === 'dokument').map((b) => b.id);
            if (!checkpoint_ids.length && !dokument_ids.length) return toast('Nichts ausgewählt', 'fehler');
            try {
              await post(`/projects/${projektId}/vorlagen-uebernahme`, { template_id: delta.vorlage?.id, checkpoint_ids, dokument_ids });
              toast('In das Projekt übernommen'); neuLaden();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Auswahl übernehmen'));
    }
  } catch { deltaKarte.append(h('p', { class: 'muted' }, 'Kein Vorlagen-Abgleich verfügbar.')); }
}
