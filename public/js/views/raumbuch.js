// M3 – Raumbuch: raumweise und gewerkeweise Sicht, Attributkataloge, Planstände mit Delta
import { get, post, patch, del, state } from '../api.js';
import {
  h, clear, kopfzeile, table, modal, confirmModal, toast, fehlerToast, feld, textInput,
  textArea, dateInput, select, gewerkSelect, statusBadge, label, formatDate, laden, leerHinweis, badge,
} from '../ui.js';
import { objektZusatz } from '../objekt.js';

export async function renderRaumbuch(el, params, query) {
  const projektId = Number(params.projektId);
  let projekt;
  el.append(laden());
  try { projekt = await get(`/projects/${projektId}`); } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';

  const inhalt = h('div');
  let aktiverTab = 'raeume';
  const tabs = [['raeume', 'Räume'], ['gewerke', 'Gewerke-Sicht'], ['plaene', 'Planstände']];
  const tabLeiste = h('div', { class: 'tab-leiste' }, tabs.map(([key, text]) => h('button', {
    class: `tab ${key === aktiverTab ? 'tab-aktiv' : ''}`,
    onclick: (e) => {
      aktiverTab = key;
      tabLeiste.querySelectorAll('.tab').forEach((b) => b.classList.remove('tab-aktiv'));
      e.target.classList.add('tab-aktiv');
      zeigeTab();
    },
  }, text)));

  clear(el);
  el.append(kopfzeile('Raumbuch',
    h('a', { class: 'btn', href: `/api/projects/${projektId}/raumbuch.pdf`, target: '_blank' }, 'PDF'),
    h('a', { class: 'btn', href: `/api/projects/${projektId}/raumbuch.csv` }, 'Excel/CSV'),
    h('a', { class: 'btn', href: `/api/projects/${projektId}/raumbuch.doc` }, 'Word'),
    readonly ? null : h('button', { class: 'btn', onclick: importDialog }, 'CSV-Import'),
    readonly ? null : h('button', { class: 'btn btn-primary', onclick: () => raumDialog() }, '+ Raum')));
  el.append(tabLeiste, inhalt);

  function zeigeTab() {
    if (aktiverTab === 'raeume') zeigeRaeume();
    else if (aktiverTab === 'gewerke') zeigeGewerkeSicht();
    else zeigePlaene();
  }

  // ================= Reiter 1: Räume =================
  async function zeigeRaeume() {
    clear(inhalt).append(laden());
    try {
      const rooms = await get(`/projects/${projektId}/rooms`);
      clear(inhalt).append(table([
        { label: 'Nummer', key: 'nummer', class: 'schmal' },
        { label: 'Bezeichnung', render: (r) => h('div', {}, h('strong', {}, r.bezeichnung), r.raumtyp ? h('div', { class: 'muted' }, r.raumtyp) : null) },
        { label: 'Funktion', key: 'funktion' },
        { label: 'Fläche', render: (r) => r.flaeche_m2 ? `${r.flaeche_m2} m²` : '—', class: 'schmal' },
        { label: 'Attribute', render: (r) => String(r.attribut_anzahl), class: 'schmal' },
        { label: 'Abweichungen', render: (r) => r.abweichungen ? h('span', { class: 'ueberfaellig' }, String(r.abweichungen)) : '0', class: 'schmal' },
        { label: 'Punkte/Mängel', render: (r) => `${r.offene_punkte} / ${r.offene_maengel}`, class: 'schmal' },
        { label: 'Fotos', render: (r) => String(r.fotos), class: 'schmal' },
      ], rooms, {
        empty: 'Noch keine Räume. Legen Sie Räume an oder nutzen Sie den CSV-Import.',
        onRowClick: (r) => oeffneRaum(r.id),
      }));
    } catch (e) { fehlerToast(e); }
  }

  async function oeffneRaum(id) {
    let raum;
    try { raum = await get(`/rooms/${id}`); } catch (e) { return fehlerToast(e); }
    const attribute = raum.attribute || [];
    const jeGewerk = {};
    for (const a of attribute) (jeGewerk[a.gewerk] = jeGewerk[a.gewerk] || []).push(a);

    const attributTabellen = Object.entries(jeGewerk).map(([gewerk, attrs]) =>
      h('div', { style: { marginBottom: '.8rem' } },
        h('h3', {}, gewerk, ' ', h('span', { class: 'muted' }, state.gewerkeMap[gewerk]?.name || '')),
        h('div', { class: 'tabelle-umbruch' }, h('table', { class: 'tabelle' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Attribut'), h('th', {}, 'Soll'), h('th', {}, 'Ist'), h('th', {}, 'Status'), h('th', {}, 'Quelle/Kommentar'), h('th', { class: 'schmal' }, ''))),
          h('tbody', {}, attrs.map((a) => attributZeile(a)))))));

    function attributZeile(a) {
      const soll = textInput({ value: a.soll || '', disabled: readonly });
      const ist = textInput({ value: a.ist || '', disabled: readonly });
      const status = select(['offen', 'festgelegt', 'bestaetigt', 'abweichend'].map((s) => ({ value: s, label: label(s), selected: a.status === s })), { disabled: readonly });
      const quelle = textInput({ value: a.quelle || '', disabled: readonly });
      const speichern = async () => {
        try {
          await patch(`/room-attributes/${a.id}`, { soll: soll.value, ist: ist.value, status: status.value, quelle: quelle.value });
          toast('Attribut gespeichert');
        } catch (e) { fehlerToast(e); }
      };
      if (!readonly) for (const f of [soll, ist, quelle]) f.addEventListener('change', speichern);
      if (!readonly) status.addEventListener('change', speichern);
      return h('tr', {},
        h('td', {}, a.name, a.einheit ? h('span', { class: 'muted' }, ` [${a.einheit}]`) : null),
        h('td', {}, soll), h('td', {}, ist), h('td', {}, status), h('td', {}, quelle),
        h('td', { class: 'schmal' }, readonly ? null : h('button', {
          class: 'btn-icon', title: 'Attribut entfernen',
          onclick: async () => {
            if (!(await confirmModal(`Attribut „${a.name}" entfernen?`))) return;
            try { await del(`/room-attributes/${a.id}`); toast('Entfernt'); m.close(); oeffneRaum(id); } catch (e) { fehlerToast(e); }
          },
        }, '✕')));
    }

    const m = modal({
      title: `Raum ${raum.nummer} – ${raum.bezeichnung}`,
      wide: true,
      body: h('div', {},
        h('div', { class: 'zeile', style: { marginBottom: '.6rem' } },
          readonly ? null : h('button', { class: 'btn', onclick: () => raumDialog(raum, () => { m.close(); oeffneRaum(id); }) }, 'Stammdaten bearbeiten'),
          readonly ? null : h('button', { class: 'btn', onclick: () => katalogDialog(raum, () => { m.close(); oeffneRaum(id); }) }, '+ Attribute aus Katalog'),
          readonly ? null : h('button', { class: 'btn', onclick: () => freiesAttributDialog(raum, () => { m.close(); oeffneRaum(id); }) }, '+ Freies Attribut'),
          h('a', { class: 'btn', href: `/api/projects/${projektId}/raumbuch.pdf`, target: '_blank' }, 'Raumbuch-PDF')),
        h('p', { class: 'muted' }, [
          raum.funktion && `Funktion: ${raum.funktion}`, raum.flaeche_m2 && `Fläche: ${raum.flaeche_m2} m²`,
          raum.hoehe_m && `Höhe: ${raum.hoehe_m} m`, raum.raumgruppe && `Raumgruppe: ${raum.raumgruppe}`,
          raum.strahlenschutz && `Strahlenschutz: ${raum.strahlenschutz}`, raum.hf_anforderung && `HF: ${raum.hf_anforderung}`,
        ].filter(Boolean).join(' · ') || 'Keine weiteren Stammdaten.'),
        attributTabellen.length ? attributTabellen : leerHinweis('Noch keine Attribute – aus dem Katalog übernehmen oder frei anlegen.'),
        // RB-07: zugehörige Punkte, Mängel, Fotos
        (raum.offene_checkpunkte || []).length ? h('div', {},
          h('h3', {}, 'Offene verknüpfte Checkpunkte'),
          h('ul', {}, raum.offene_checkpunkte.map((c) => h('li', {},
            h('a', { href: `#/projekt/${projektId}/checkliste?punkt=${c.id}` }, `${c.nr} ${c.text}`))))) : null,
        (raum.maengel || []).length ? h('div', {},
          h('h3', {}, 'Mängel in diesem Raum'),
          h('ul', {}, raum.maengel.map((d) => h('li', {},
            h('a', { href: `#/projekt/${projektId}/maengel?mangel=${d.id}` }, `M-${String(d.nummer).padStart(3, '0')} ${d.beschreibung}`), ' ', statusBadge(d.status))))) : null,
        (raum.fotos || []).length ? h('div', {},
          h('h3', {}, 'Fotos'),
          h('div', { class: 'galerie' }, raum.fotos.map((f) => h('div', { class: 'foto' },
            h('img', { src: `/api/photos/${f.id}/datei`, alt: f.beschreibung || f.filename, loading: 'lazy' }),
            h('div', { class: 'foto-info' }, f.beschreibung || f.filename))))) : null,
        objektZusatz('room', raum.id, { projectId: projektId, readonly })),
    });
  }

  function raumDialog(raum = null, nachher = null) {
    const felder = {
      nummer: textInput({ value: raum?.nummer || '' }),
      bezeichnung: textInput({ value: raum?.bezeichnung || '' }),
      funktion: textInput({ value: raum?.funktion || '', placeholder: 'z. B. Untersuchung (DIN 13080)' }),
      flaeche_m2: textInput({ value: raum?.flaeche_m2 ?? '', type: 'number', step: '0.1' }),
      hoehe_m: textInput({ value: raum?.hoehe_m ?? '', type: 'number', step: '0.05' }),
      raumgruppe: select([{ value: '', label: '—' }, ...['0', '1', '2'].map((g) => ({ value: g, label: `Gruppe ${g}`, selected: raum?.raumgruppe === g }))]),
      strahlenschutz: textInput({ value: raum?.strahlenschutz || '' }),
      hf_anforderung: textInput({ value: raum?.hf_anforderung || '' }),
      bemerkung: textArea({ value: raum?.bemerkung || '' }),
    };
    let raumtypSel = null;
    const raumtypContainer = h('div');
    if (!raum) {
      get(`/projects/${projektId}/attribut-katalog`).then((katalog) => {
        if (!katalog.raumtypen?.length) return;
        raumtypSel = select([{ value: '', label: '— Raumtyp (belegt Attribute vor) —' },
          ...katalog.raumtypen.map((rt) => ({ value: rt.name, label: rt.name }))]);
        raumtypContainer.append(feld('Raumtyp', raumtypSel));
      }).catch(() => {});
    }
    const m = modal({
      title: raum ? `Raum ${raum.nummer} bearbeiten` : 'Neuen Raum anlegen',
      wide: true,
      body: h('div', {},
        h('div', { class: 'formular-spalten' },
          feld('Raumnummer *', felder.nummer), feld('Bezeichnung *', felder.bezeichnung),
          feld('Funktion (DIN 13080)', felder.funktion), feld('Fläche (m²)', felder.flaeche_m2),
          feld('Lichte Höhe (m)', felder.hoehe_m), feld('Raumgruppe (DIN VDE 0100-710)', felder.raumgruppe),
          feld('Strahlenschutz-Anforderung', felder.strahlenschutz), feld('HF-Anforderung', felder.hf_anforderung)),
        raumtypContainer,
        feld('Bemerkung', felder.bemerkung)),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const daten = {
            nummer: felder.nummer.value, bezeichnung: felder.bezeichnung.value, funktion: felder.funktion.value || null,
            flaeche_m2: felder.flaeche_m2.value ? Number(felder.flaeche_m2.value) : null,
            hoehe_m: felder.hoehe_m.value ? Number(felder.hoehe_m.value) : null,
            raumgruppe: felder.raumgruppe.value || null, strahlenschutz: felder.strahlenschutz.value || null,
            hf_anforderung: felder.hf_anforderung.value || null, bemerkung: felder.bemerkung.value || null,
            raumtyp: raumtypSel?.value || raum?.raumtyp || null,
          };
          try {
            if (raum) { await patch(`/rooms/${raum.id}`, daten); toast('Raum gespeichert'); }
            else { await post(`/projects/${projektId}/rooms`, daten); toast('Raum angelegt'); }
            m.close();
            nachher ? nachher() : zeigeRaeume();
          } catch (e) { fehlerToast(e); }
        },
      }, raum ? 'Speichern' : 'Anlegen')],
    });
  }

  async function katalogDialog(raum, nachher) {
    let katalog;
    try { katalog = await get(`/projects/${projektId}/attribut-katalog`); } catch (e) { return fehlerToast(e); }
    const vorhandene = new Set((raum.attribute || []).map((a) => `${a.gewerk}|${a.name}`));
    const boxen = [];
    const jeGewerk = {};
    for (const a of katalog.attribute || []) (jeGewerk[a.gewerk] = jeGewerk[a.gewerk] || []).push(a);
    const body = h('div', {}, Object.entries(jeGewerk).map(([gewerk, attrs]) =>
      h('div', {},
        h('h3', {}, gewerk),
        attrs.map((a) => {
          const schonDa = vorhandene.has(`${a.gewerk}|${a.name}`);
          const cb = h('input', { type: 'checkbox', disabled: schonDa });
          boxen.push({ cb, id: a.id });
          return h('label', { style: { display: 'block', opacity: schonDa ? 0.5 : 1 } },
            cb, ` ${a.name}${a.einheit ? ` [${a.einheit}]` : ''}`,
            schonDa ? h('span', { class: 'muted' }, ' (vorhanden)') : null,
            a.hilfetext ? h('span', { class: 'muted' }, ` – ${a.hilfetext}`) : null);
        }))));
    const m = modal({
      title: `Attribute aus Katalog: Raum ${raum.nummer}`, wide: true, body,
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const ids = boxen.filter((b) => b.cb.checked).map((b) => b.id);
          if (!ids.length) return toast('Nichts ausgewählt', 'fehler');
          try { await post(`/rooms/${raum.id}/attributes`, { katalog_ids: ids }); toast(`${ids.length} Attribute übernommen`); m.close(); nachher(); }
          catch (e) { fehlerToast(e); }
        },
      }, 'Übernehmen')],
    });
  }

  function freiesAttributDialog(raum, nachher) {
    const gewerk = gewerkSelect({});
    const name = textInput();
    const datentyp = select([['text', 'Text'], ['zahl', 'Zahl'], ['auswahl', 'Auswahl'], ['janein', 'Ja/Nein']].map(([v, l]) => ({ value: v, label: l })));
    const einheit = textInput({ placeholder: 'z. B. Stk, kW' });
    const m = modal({
      title: `Freies Attribut: Raum ${raum.nummer}`,
      body: h('div', {}, feld('Gewerk *', gewerk), feld('Name *', name), feld('Datentyp', datentyp), feld('Einheit', einheit)),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await post(`/rooms/${raum.id}/attributes`, { gewerk: gewerk.value, name: name.value, datentyp: datentyp.value, einheit: einheit.value || null });
            toast('Attribut angelegt'); m.close(); nachher();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Anlegen')],
    });
  }

  function importDialog() {
    const csv = textArea({ rows: 8, placeholder: 'Nummer;Bezeichnung;Funktion;Flaeche;Hoehe;Raumgruppe;Raumtyp;Bemerkung\n4010.EG.012;MRT-Untersuchungsraum;Untersuchung;45.5;3.2;1;MRT-Untersuchungsraum;' });
    const vorschau = h('div');
    const m = modal({
      title: 'Räume aus CSV importieren (RB-01)',
      wide: true,
      body: h('div', {}, feld('CSV-Inhalt (Spalten: Nummer;Bezeichnung;Funktion;Flaeche;Hoehe;Raumgruppe;Raumtyp;Bemerkung)', csv), vorschau),
      actions: [
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              const r = await post(`/projects/${projektId}/rooms/import`, { csv: csv.value, commit: false });
              clear(vorschau).append(
                h('p', {}, `${r.ok.length} Zeilen gültig, ${r.fehler.length} fehlerhaft.`),
                r.fehler.length ? h('ul', {}, r.fehler.map((f) => h('li', { style: { color: 'var(--rot)' } }, `Zeile ${f.zeile}: ${f.grund}`))) : null);
            } catch (e) { fehlerToast(e); }
          },
        }, 'Vorschau'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            try {
              const r = await post(`/projects/${projektId}/rooms/import`, { csv: csv.value, commit: true });
              toast(`${r.importiert ?? r.ok?.length ?? 0} Räume importiert`);
              m.close(); zeigeRaeume();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Importieren')],
    });
  }

  // ================= Reiter 2: Gewerke-Sicht (RB-03) =================
  async function zeigeGewerkeSicht() {
    const gewerkSel = gewerkSelect({ value: state.gewerke[0]?.kuerzel || '', leer: '— Gewerk wählen —' });
    const matrixBereich = h('div');
    gewerkSel.addEventListener('change', () => ladeMatrix(gewerkSel.value));
    clear(inhalt).append(
      h('div', { class: 'filter-leiste' }, feld('Gewerk', gewerkSel),
        h('span', { class: 'muted' }, 'Tabellarische Massenpflege: Zelle anklicken zum Bearbeiten. Abweichungen sind rot markiert.')),
      matrixBereich);

    async function ladeMatrix(gewerk) {
      if (!gewerk) return clear(matrixBereich).append(leerHinweis('Bitte Gewerk wählen.'));
      clear(matrixBereich).append(laden());
      try {
        const matrix = await get(`/projects/${projektId}/room-matrix?gewerk=${encodeURIComponent(gewerk)}`);
        if (!matrix.zeilen.length) return clear(matrixBereich).append(leerHinweis('Keine Räume vorhanden.'));
        if (!matrix.attribut_namen.length) return clear(matrixBereich).append(leerHinweis(`Für ${gewerk} sind noch keine Attribute in Räumen angelegt (im Raum-Detail „Attribute aus Katalog" wählen).`));
        clear(matrixBereich).append(h('div', { class: 'tabelle-umbruch' }, h('table', { class: 'tabelle' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Raum'), matrix.attribut_namen.map((n) => h('th', {}, n)))),
          h('tbody', {}, matrix.zeilen.map((zeile) => h('tr', {},
            h('td', {}, h('strong', {}, zeile.nummer), h('div', { class: 'muted' }, zeile.bezeichnung)),
            matrix.attribut_namen.map((n) => {
              const wert = zeile.werte[n];
              if (!wert) return h('td', { class: 'muted' }, '·');
              const abweichend = wert.status === 'abweichend' || (wert.soll && wert.ist && wert.soll !== wert.ist);
              return h('td', {
                class: 'zeile-klickbar', style: abweichend ? { background: '#fde2e0' } : {},
                title: `Status: ${label(wert.status)}${wert.quelle ? ' · ' + wert.quelle : ''}`,
                onclick: () => zellenDialog(gewerk, n, zeile, wert, () => ladeMatrix(gewerk)),
              }, h('div', {}, h('span', { class: 'muted' }, 'Soll: '), wert.soll || '—'),
                h('div', {}, h('span', { class: 'muted' }, 'Ist: '), wert.ist || '—'));
            })))))));
      } catch (e) { fehlerToast(e); }
    }
    function zellenDialog(gewerk, attrName, zeile, wert, nachher) {
      const soll = textInput({ value: wert.soll || '' });
      const ist = textInput({ value: wert.ist || '' });
      const status = select(['offen', 'festgelegt', 'bestaetigt', 'abweichend'].map((s) => ({ value: s, label: label(s), selected: wert.status === s })));
      const quelle = textInput({ value: wert.quelle || '' });
      const m = modal({
        title: `${zeile.nummer} · ${gewerk} · ${attrName}`,
        body: h('div', {}, feld('Soll', soll), feld('Ist', ist), feld('Status', status), feld('Quelle/Kommentar', quelle)),
        actions: [readonly ? null : h('button', {
          class: 'btn btn-primary', onclick: async () => {
            try {
              await patch(`/room-attributes/${wert.id}`, { soll: soll.value, ist: ist.value, status: status.value, quelle: quelle.value });
              toast('Gespeichert'); m.close(); nachher();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Speichern')].filter(Boolean),
      });
    }
    if (gewerkSel.value) ladeMatrix(gewerkSel.value);
  }

  // ================= Reiter 3: Planstände (RB-05) =================
  async function zeigePlaene() {
    clear(inhalt).append(laden());
    try {
      const plaene = await get(`/projects/${projektId}/planstaende`);
      const deltaBereich = h('div');
      const vonSel = select(plaene.map((p) => ({ value: String(p.id), label: `${p.name} (${formatDate(p.datum)})` })));
      const bisSel = select([{ value: 'aktuell', label: 'Aktueller Stand' },
        ...plaene.map((p) => ({ value: String(p.id), label: `${p.name} (${formatDate(p.datum)})` }))]);

      clear(inhalt).append(
        readonly ? null : h('div', { style: { marginBottom: '.8rem' } },
          h('button', { class: 'btn btn-primary', onclick: einfrierenDialog }, 'Planstand einfrieren')),
        table([
          { label: 'Name', key: 'name' },
          { label: 'Typ', render: (p) => label(p.typ), class: 'schmal' },
          { label: 'Datum', render: (p) => formatDate(p.datum), class: 'schmal' },
          { label: 'Freigabevermerk', key: 'freigabe_vermerk' },
          { label: 'Export', render: (p) => h('span', {},
            h('a', { href: `/api/projects/${projektId}/raumbuch.pdf?planstand=${p.id}`, target: '_blank', onclick: (e) => e.stopPropagation() }, 'PDF'), ' · ',
            h('a', { href: `/api/projects/${projektId}/raumbuch.csv?planstand=${p.id}`, onclick: (e) => e.stopPropagation() }, 'CSV')), class: 'schmal' },
        ], plaene, { empty: 'Noch keine Planstände eingefroren.' }),
        plaene.length ? h('div', { class: 'karte', style: { marginTop: '1rem' } },
          h('h2', {}, 'Delta-Ansicht'),
          h('div', { class: 'zeile' }, feld('Von (Planstand)', vonSel), feld('Bis', bisSel),
            h('button', {
              class: 'btn', onclick: async () => {
                clear(deltaBereich).append(laden());
                try {
                  const delta = await get(`/projects/${projektId}/planstaende/delta?von=${vonSel.value}&bis=${bisSel.value}`);
                  zeigeDelta(delta);
                } catch (e) { fehlerToast(e); }
              },
            }, 'Vergleichen')),
          deltaBereich) : null);

      function zeigeDelta(delta) {
        clear(deltaBereich);
        const zeilen = [];
        for (const r of delta.neue_raeume || []) zeilen.push({ raum: `${r.nummer} ${r.bezeichnung}`, gewerk: '', attribut: '(Raum neu)', feld: '', von: '—', nach: 'neu angelegt' });
        for (const r of delta.entfallene_raeume || []) zeilen.push({ raum: `${r.nummer} ${r.bezeichnung}`, gewerk: '', attribut: '(Raum entfallen)', feld: '', von: 'vorhanden', nach: '—' });
        for (const g of delta.geaenderte || []) {
          for (const a of g.aenderungen || []) {
            zeilen.push({ raum: g.raum, gewerk: a.gewerk || '', attribut: a.attribut || '(Stammdaten)', feld: a.feld, von: a.von ?? '—', nach: a.nach ?? '—' });
          }
        }
        deltaBereich.append(zeilen.length ? table([
          { label: 'Raum', key: 'raum' }, { label: 'Gewerk', key: 'gewerk', class: 'schmal' },
          { label: 'Attribut', key: 'attribut' }, { label: 'Feld', key: 'feld', class: 'schmal' },
          { label: 'Von', key: 'von' }, { label: 'Nach', key: 'nach' },
        ], zeilen) : leerHinweis('Keine Unterschiede zwischen den gewählten Ständen.'));
      }

      function einfrierenDialog() {
        const name = textInput({ placeholder: 'z. B. Entwurfsplanung freigegeben' });
        const typ = select(['vorplanung', 'entwurf', 'ausfuehrung', 'as_built', 'sonstig'].map((t) => ({ value: t, label: label(t) })));
        const vermerk = textInput({ placeholder: 'z. B. Freigabe Bauherr 07.07.2026' });
        const m = modal({
          title: 'Planstand einfrieren',
          body: h('div', {},
            h('p', { class: 'muted' }, 'Der komplette aktuelle Raumbuch-Stand wird unveränderlich gespeichert (RB-05).'),
            feld('Bezeichnung *', name), feld('Typ', typ), feld('Freigabevermerk', vermerk)),
          actions: [h('button', {
            class: 'btn btn-primary', onclick: async () => {
              try {
                await post(`/projects/${projektId}/planstaende`, { name: name.value, typ: typ.value, freigabe_vermerk: vermerk.value || null });
                toast('Planstand eingefroren'); m.close(); zeigePlaene();
              } catch (e) { fehlerToast(e); }
            },
          }, 'Einfrieren')],
        });
      }
    } catch (e) { fehlerToast(e); }
  }

  zeigeTab();
  if (query.raum) oeffneRaum(Number(query.raum));
}
