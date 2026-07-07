// M4 – Dokumentenregister: Bereichskacheln A–F, Filter, nach Bereich gruppierte
// Tabelle, Detail-Modal mit Bewertung, Versionshistorie (Datei-Upload ODER
// Ablageverweis) und Vollständigkeitsbericht (DOK-01…DOK-05)
import { get, post, patch, del, upload } from '../api.js';
import {
  h, clear, kopfzeile, table, modal, confirmModal, toast, fehlerToast,
  feld, textInput, textArea, dateInput, select, gewerkSelect, gewerkBadge,
  statusBadge, badge, label, formatDate, formatDateTime, terminZelle,
  laden, leerHinweis,
} from '../ui.js';
import { objektZusatz } from '../objekt.js';

const BEREICHE = ['A', 'B', 'C', 'D', 'E', 'F'];

export async function renderDokumente(el, params, query) {
  const projectId = Number(params.projektId);
  const filter = {
    bereich: query.bereich || '',
    gewerk: query.gewerk || '',
    benoetigt: query.benoetigt || '',
    stand: query.stand || '',
    q: query.q || '',
  };

  el.append(laden());
  let rolle = '';
  let readonly = false;
  try {
    const projekt = await get(`/projects/${projectId}`);
    rolle = projekt.zugriff ? projekt.zugriff.rolle : '';
    readonly = rolle === 'leser' || projekt.status === 'archiviert';
  } catch (e) { clear(el); fehlerToast(e); return; }

  clear(el);
  el.append(kopfzeile('Dokumentenregister',
    h('button', { class: 'btn', onclick: berichtOeffnen }, 'Vollständigkeitsbericht'),
    readonly ? null : h('button', { class: 'btn btn-primary', onclick: neuOeffnen }, '+ Eintrag')));

  const kacheln = h('div', { class: 'karten-reihe' });

  // ---------------- Filterleiste ----------------
  const bereichSel = select([
    { value: '', label: '— Bereich —', selected: !filter.bereich },
    ...BEREICHE.map((b) => ({ value: b, label: `Bereich ${b}`, selected: filter.bereich === b })),
  ]);
  const gewerkSel = gewerkSelect({ value: filter.gewerk });
  const benoetigtSel = select([
    { value: '', label: '— Benötigt —', selected: !filter.benoetigt },
    ...['unbewertet', 'ja', 'nein', 'entfaellt'].map((v) => ({ value: v, label: label(v), selected: filter.benoetigt === v })),
  ]);
  const standSel = select([
    { value: '', label: '— Stand —', selected: !filter.stand },
    { value: 'offen', label: 'Offen (benötigt, nicht erhalten)', selected: filter.stand === 'offen' },
    { value: 'erhalten', label: 'Erhalten', selected: filter.stand === 'erhalten' },
    { value: 'ueberfaellig', label: 'Überfällig', selected: filter.stand === 'ueberfaellig' },
  ]);
  const suchFeld = textInput({ placeholder: 'Nr., Titel, Beschreibung …', value: filter.q });
  const uebernehmen = () => {
    filter.bereich = bereichSel.value;
    filter.gewerk = gewerkSel.value;
    filter.benoetigt = benoetigtSel.value;
    filter.stand = standSel.value;
    filter.q = suchFeld.value.trim();
    neuLaden();
  };
  for (const s of [bereichSel, gewerkSel, benoetigtSel, standSel]) s.addEventListener('change', uebernehmen);
  suchFeld.addEventListener('keydown', (e) => { if (e.key === 'Enter') uebernehmen(); });
  suchFeld.addEventListener('change', uebernehmen);

  const inhalt = h('div', {});
  el.append(kacheln,
    h('div', { class: 'filter-leiste' },
      feld('Bereich', bereichSel), feld('Gewerk', gewerkSel), feld('Benötigt', benoetigtSel),
      feld('Stand', standSel), feld('Suche', suchFeld)),
    inhalt);

  // ---------------- Daten laden und darstellen ----------------
  async function neuLaden() {
    clear(inhalt).append(laden());
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v) qs.set(k, v);
      const [rows, bericht] = await Promise.all([
        get(`/projects/${projectId}/documents${qs.toString() ? `?${qs}` : ''}`),
        get(`/projects/${projectId}/documents/vollstaendigkeit`),
      ]);
      kachelnZeichnen(bericht.nach_bereich);
      clear(inhalt);
      if (!rows.length) { inhalt.append(leerHinweis('Keine Einträge für die gewählten Filter.')); return; }

      const proBereich = new Map();
      for (const r of rows) {
        if (!proBereich.has(r.bereich)) proBereich.set(r.bereich, []);
        proBereich.get(r.bereich).push(r);
      }
      for (const [bereich, liste] of [...proBereich.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        inhalt.append(h('h2', { style: { marginTop: '1rem' } }, `Bereich ${bereich}`));
        inhalt.append(table([
          { label: 'Nr.', key: 'nr', class: 'schmal' },
          {
            label: 'Titel', render: (d) => h('div', {},
              h('strong', {}, d.titel),
              d.is_custom ? [' ', badge('Zusatz')] : null,
              d.beschreibung ? h('div', { class: 'muted' }, kurz(d.beschreibung, 100)) : null),
          },
          { label: 'Gewerk', class: 'schmal', render: (d) => d.gewerk ? gewerkBadge(d.gewerk) : h('span', { class: 'muted' }, '—') },
          { label: 'Benötigt', class: 'schmal', render: (d) => statusBadge(d.benoetigt) },
          {
            label: 'Erhalten', render: (d) => d.erhalten_am
              ? h('span', {}, formatDate(d.erhalten_am),
                h('span', { class: 'muted' }, ` · ${d.version_anzahl} ${d.version_anzahl === 1 ? 'Version' : 'Versionen'}`))
              : h('span', { class: 'muted' }, '—'),
          },
          {
            label: 'Fälligkeit', class: 'schmal',
            render: (d) => terminZelle(d.faelligkeit,
              (d.erhalten_am || d.benoetigt === 'nein' || d.benoetigt === 'entfaellt') ? 'erledigt' : 'offen'),
          },
          { label: 'Verantwortlich', render: (d) => d.verantwortlich_name || h('span', { class: 'muted' }, '—') },
        ], liste, { onRowClick: (d) => detailOeffnen(d.id) }));
      }
    } catch (e) { clear(inhalt); fehlerToast(e); }
  }

  function kachelnZeichnen(nachBereich) {
    clear(kacheln).append(BEREICHE.map((b) => {
      const z = nachBereich[b] || { benoetigt: 0, erhalten: 0, fehlend: 0 };
      const aktiv = filter.bereich === b;
      const kachel = h('div', {
        class: 'karte kennzahl',
        style: { cursor: 'pointer', outline: aktiv ? '2px solid var(--primaer)' : '' },
        title: aktiv ? 'Filter aufheben' : `Nach Bereich ${b} filtern`,
      },
        h('div', { class: `wert ${z.fehlend ? '' : 'gruen'}` }, `${z.erhalten} / ${z.benoetigt}`),
        h('div', { class: 'beschriftung' }, `Bereich ${b} · erhalten / benötigt`));
      kachel.addEventListener('click', () => {
        filter.bereich = aktiv ? '' : b;
        bereichSel.value = filter.bereich;
        neuLaden();
      });
      return kachel;
    }));
  }

  // ---------------- Detail-Modal ----------------
  async function detailOeffnen(id) {
    let d;
    try { d = await get(`/documents/${id}`); } catch (e) { fehlerToast(e); return; }
    // Kontakte für Verantwortlichen-Auswahl (Route entsteht parallel – tolerant laden)
    let kontakte = null;
    try { kontakte = await get(`/projects/${projectId}/contacts`); } catch { kontakte = null; }

    const body = h('div', {});
    const m = modal({ title: `${d.nr} – ${d.titel}`, body, wide: true });

    const bauen = () => {
      clear(body);

      // Kopfinfo
      body.append(h('div', { style: { marginBottom: '.6rem' } },
        d.gewerk ? gewerkBadge(d.gewerk) : null, ' ',
        d.is_custom ? badge('Projektspezifischer Zusatzeintrag') : null,
        d.beschreibung ? h('p', { class: 'muted', style: { margin: '.4rem 0 0' } }, d.beschreibung) : null));

      // ---- Bewertung (DOK-01) ----
      const radios = ['ja', 'nein', 'entfaellt'].map((v) => {
        const input = h('input', { type: 'radio', name: `benoetigt-${d.id}`, value: v, checked: d.benoetigt === v, disabled: readonly });
        return { v, input, el: h('label', { class: 'gewerk-check' }, input, ' ', label(v)) };
      });
      const begruendungFeld = textArea({ rows: 2, value: d.begruendung || '', disabled: readonly });
      const begruendungWrap = feld('Begründung (Pflicht bei „Entfällt“)', begruendungFeld);
      const fehlerText = h('div', { style: { color: 'var(--rot)', minHeight: '1.1rem', fontSize: '.85rem' } });
      const begruendungToggle = () => {
        const gewaehlt = radios.find((r) => r.input.checked);
        begruendungWrap.style.display = gewaehlt && gewaehlt.v === 'entfaellt' ? '' : 'none';
      };
      radios.forEach((r) => r.input.addEventListener('change', () => { fehlerText.textContent = ''; begruendungToggle(); }));

      const faelligkeitInput = dateInput({ value: d.faelligkeit || '', disabled: readonly });
      let verantSel = null;
      const verantElement = kontakte
        ? (verantSel = select([
          { value: '', label: '— Kein Verantwortlicher —', selected: !d.verantwortlich_kontakt_id },
          ...kontakte.map((k) => ({
            value: String(k.id),
            label: k.firma ? `${k.name} (${k.firma})` : k.name,
            selected: k.id === d.verantwortlich_kontakt_id,
          })),
        ], { disabled: readonly }))
        : h('div', { class: 'muted' }, d.verantwortlich_name || 'Kontakte noch nicht verfügbar');

      // Zusatzeinträge: Titel/Beschreibung/Gewerk änderbar (DOK-04)
      const titelInput = d.is_custom ? textInput({ value: d.titel, disabled: readonly }) : null;
      const beschreibungInput = d.is_custom ? textArea({ rows: 2, value: d.beschreibung || '', disabled: readonly }) : null;
      const gewerkEdit = d.is_custom ? gewerkSelect({ value: d.gewerk || '', attrs: { disabled: readonly } }) : null;

      body.append(h('h3', {}, 'Bewertung'),
        h('div', { class: 'formular-spalten' },
          feld('Benötigt', h('div', { class: 'gewerke-mehrfach' }, radios.map((r) => r.el))),
          feld('Fälligkeit', faelligkeitInput),
          feld('Verantwortlich (Einforderung)', verantElement),
          d.is_custom ? feld('Titel', titelInput) : null,
          d.is_custom ? feld('Gewerk', gewerkEdit) : null),
        begruendungWrap,
        d.is_custom ? feld('Beschreibung', beschreibungInput) : null,
        fehlerText);
      begruendungToggle();

      if (!readonly) {
        body.append(h('div', { style: { marginBottom: '1rem' } },
          h('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              const gewaehlt = radios.find((r) => r.input.checked);
              if (gewaehlt && gewaehlt.v === 'entfaellt' && !begruendungFeld.value.trim()) {
                fehlerText.textContent = 'Begründung ist bei „Entfällt“ Pflicht.';
                begruendungFeld.focus();
                return;
              }
              const daten = {
                faelligkeit: faelligkeitInput.value || null,
                begruendung: begruendungFeld.value.trim() || null,
              };
              if (gewaehlt) daten.benoetigt = gewaehlt.v;
              if (verantSel) daten.verantwortlich_kontakt_id = verantSel.value ? Number(verantSel.value) : null;
              if (d.is_custom) {
                daten.titel = titelInput.value.trim();
                daten.beschreibung = beschreibungInput.value.trim() || null;
                daten.gewerk = gewerkEdit.value || null;
              }
              try {
                await patch(`/documents/${d.id}`, daten);
                toast('Eintrag gespeichert');
                await detailNeuLaden();
                neuLaden();
              } catch (e) { fehlerToast(e); }
            },
          }, 'Speichern')));
      }

      // ---- Versionshistorie (DOK-02) ----
      body.append(h('h3', {}, `Versionen (${d.versionen.length})`));
      body.append(d.versionen.length ? table([
        { label: 'Version', key: 'version', class: 'schmal' },
        { label: 'Datum', class: 'schmal', render: (v) => formatDate(v.datum) },
        { label: 'Geliefert von', render: (v) => v.geliefert_von || h('span', { class: 'muted' }, '—') },
        {
          label: 'Ablage', render: (v) => v.attachment_id
            ? h('a', { href: `/api/attachments/${v.attachment_id}/download` }, `📄 ${v.datei_name || 'Datei'}`)
            : (v.link ? h('a', { href: v.link, target: '_blank', rel: 'noopener' }, `🔗 ${kurz(v.link, 60)}`) : '—'),
        },
        { label: 'Kommentar', render: (v) => v.kommentar || h('span', { class: 'muted' }, '—') },
        {
          label: 'Erfasst', render: (v) => h('span', { class: 'muted' },
            `${formatDateTime(v.created_at)}${v.erstellt_von_name ? ' · ' + v.erstellt_von_name : ''}`),
        },
        ...(rolle === 'projektleiter' && !readonly ? [{
          label: '', class: 'schmal',
          render: (v) => h('button', {
            class: 'btn-icon', title: 'Version löschen (nur Projektleiter)',
            onclick: async (e) => {
              e.stopPropagation();
              if (!(await confirmModal(`Version ${v.version} wirklich löschen?`))) return;
              try {
                await del(`/document-versions/${v.id}`);
                toast('Version gelöscht');
                await detailNeuLaden();
                neuLaden();
              } catch (err) { fehlerToast(err); }
            },
          }, '🗑'),
        }] : []),
      ], d.versionen) : leerHinweis('Noch keine Version erhalten.'));

      // ---- Neue Version: Datei-Upload ODER Ablageverweis ----
      if (!readonly) {
        const modusSel = select([
          { value: 'datei', label: 'Datei-Upload' },
          { value: 'link', label: 'Ablageverweis (URL/Pfad)' },
        ]);
        const dateiInput = h('input', { type: 'file', class: 'input' });
        const linkInput = textInput({ placeholder: 'z. B. https://dms.klinik.example/… oder \\\\server\\ablage\\…' });
        const dateiWrap = feld('Datei', dateiInput);
        const linkWrap = feld('Ablageverweis', linkInput);
        const versionInput = textInput({ placeholder: `Standard: ${d.versionen.length + 1}` });
        const datumInput = dateInput({ value: new Date().toISOString().slice(0, 10) });
        const geliefertInput = textInput({ placeholder: 'Firma/Person' });
        const kommentarInput = textInput();
        const versionFehler = h('div', { style: { color: 'var(--rot)', minHeight: '1.1rem', fontSize: '.85rem' } });
        const modusToggle = () => {
          dateiWrap.style.display = modusSel.value === 'datei' ? '' : 'none';
          linkWrap.style.display = modusSel.value === 'link' ? '' : 'none';
        };
        modusSel.addEventListener('change', () => { versionFehler.textContent = ''; modusToggle(); });
        modusToggle();

        body.append(h('h3', { style: { marginTop: '1rem' } }, 'Neue Version'),
          h('div', { class: 'formular-spalten' },
            feld('Ablageart', modusSel), dateiWrap, linkWrap,
            feld('Version', versionInput), feld('Datum', datumInput),
            feld('Geliefert von', geliefertInput), feld('Kommentar', kommentarInput)),
          versionFehler,
          h('div', {}, h('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              try {
                if (modusSel.value === 'datei') {
                  if (!dateiInput.files[0]) { versionFehler.textContent = 'Bitte eine Datei auswählen.'; return; }
                  const fd = new FormData();
                  fd.append('datei', dateiInput.files[0]);
                  if (versionInput.value.trim()) fd.append('version', versionInput.value.trim());
                  if (datumInput.value) fd.append('datum', datumInput.value);
                  if (geliefertInput.value.trim()) fd.append('geliefert_von', geliefertInput.value.trim());
                  if (kommentarInput.value.trim()) fd.append('kommentar', kommentarInput.value.trim());
                  await upload(`/documents/${d.id}/versions`, fd);
                } else {
                  if (!linkInput.value.trim()) { versionFehler.textContent = 'Bitte einen Ablageverweis (URL/Pfad) angeben.'; return; }
                  await post(`/documents/${d.id}/versions`, {
                    link: linkInput.value.trim(),
                    version: versionInput.value.trim() || undefined,
                    datum: datumInput.value || undefined,
                    geliefert_von: geliefertInput.value.trim() || undefined,
                    kommentar: kommentarInput.value.trim() || undefined,
                  });
                }
                toast('Version erfasst');
                await detailNeuLaden();
                neuLaden();
              } catch (e) { fehlerToast(e); }
            },
          }, 'Version speichern')));
      }

      // ---- Querschnitt: Kommentare/Anhänge/Verknüpfungen/Verlauf ----
      body.append(objektZusatz('document', d.id, { projectId, readonly }));
    };

    const detailNeuLaden = async () => {
      try { d = await get(`/documents/${id}`); bauen(); }
      catch (e) { fehlerToast(e); m.close(); }
    };

    bauen();
  }

  // ---------------- Zusatzeintrag anlegen (DOK-04) ----------------
  function neuOeffnen() {
    const bereichNeu = select(BEREICHE.map((b) => ({ value: b, label: `Bereich ${b}`, selected: filter.bereich === b })));
    const titelNeu = textInput({ placeholder: 'z. B. Zusatzgutachten Statik Deckenlast' });
    const gewerkNeu = gewerkSelect();
    const beschreibungNeu = textArea({ rows: 2 });
    const faelligkeitNeu = dateInput();
    const fehlerNeu = h('div', { style: { color: 'var(--rot)', minHeight: '1.1rem', fontSize: '.85rem' } });
    const m = modal({
      title: 'Projektspezifischen Dokumenteintrag anlegen',
      body: h('div', {},
        h('p', { class: 'muted' }, 'Der Eintrag erhält automatisch eine Zusatz-Nummer (z. B. B.Z1) und gilt als benötigt.'),
        h('div', { class: 'formular-spalten' },
          feld('Bereich *', bereichNeu), feld('Titel *', titelNeu),
          feld('Gewerk', gewerkNeu), feld('Fälligkeit', faelligkeitNeu)),
        feld('Beschreibung', beschreibungNeu),
        fehlerNeu),
      actions: [
        h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        h('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            if (!titelNeu.value.trim()) { fehlerNeu.textContent = 'Titel ist Pflicht.'; titelNeu.focus(); return; }
            try {
              const res = await post(`/projects/${projectId}/documents`, {
                bereich: bereichNeu.value,
                titel: titelNeu.value.trim(),
                gewerk: gewerkNeu.value || null,
                beschreibung: beschreibungNeu.value.trim() || null,
                faelligkeit: faelligkeitNeu.value || null,
              });
              m.close();
              toast(`Eintrag ${res.nr} angelegt`);
              neuLaden();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Anlegen'),
      ],
    });
  }

  // ---------------- Vollständigkeitsbericht (DOK-03) ----------------
  async function berichtOeffnen() {
    try {
      const b = await get(`/projects/${projectId}/documents/vollstaendigkeit`);
      const m = modal({
        title: 'Vollständigkeitsbericht Dokumentenregister',
        wide: true,
        body: h('div', {},
          h('p', { class: b.fehlend.length ? '' : 'muted' },
            b.fehlend.length
              ? `${b.fehlend.length} als benötigt markierte Dokumente sind noch nicht erhalten.`
              : 'Alle als benötigt markierten Dokumente liegen vor.',
            b.unbewertet ? h('span', { class: 'muted' }, ` ${b.unbewertet} Einträge sind noch unbewertet.`) : null),
          h('div', { class: 'tabelle-umbruch' }, h('table', { class: 'tabelle' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Bereich'), h('th', {}, 'Benötigt'), h('th', {}, 'Erhalten'), h('th', {}, 'Fehlend'))),
            h('tbody', {}, BEREICHE.map((x) => {
              const z = b.nach_bereich[x] || { benoetigt: 0, erhalten: 0, fehlend: 0 };
              return h('tr', {},
                h('td', {}, `Bereich ${x}`),
                h('td', {}, String(z.benoetigt)),
                h('td', {}, String(z.erhalten)),
                h('td', {}, z.fehlend ? h('span', { class: 'ueberfaellig' }, String(z.fehlend)) : '0'));
            })))),
          h('h3', { style: { marginTop: '1rem' } }, 'Fehlende Dokumente'),
          b.fehlend.length ? table([
            { label: 'Bereich', key: 'bereich', class: 'schmal' },
            { label: 'Nr.', key: 'nr', class: 'schmal' },
            { label: 'Titel', key: 'titel' },
            { label: 'Gewerk', class: 'schmal', render: (f) => f.gewerk ? gewerkBadge(f.gewerk) : h('span', { class: 'muted' }, '—') },
            {
              label: 'Fälligkeit', class: 'schmal',
              render: (f) => f.faelligkeit
                ? h('span', { class: f.ueberfaellig ? 'ueberfaellig' : '' }, formatDate(f.faelligkeit))
                : h('span', { class: 'muted' }, '—'),
            },
            { label: 'Verantwortlich', render: (f) => f.verantwortlich_name || h('span', { class: 'muted' }, '—') },
          ], b.fehlend, { onRowClick: (f) => { m.close(); detailOeffnen(f.id); } })
            : leerHinweis('Keine fehlenden Dokumente.')),
      });
    } catch (e) { fehlerToast(e); }
  }

  await neuLaden();

  // Deep-Link: ?eintrag=ID öffnet direkt das Detail-Modal
  if (query.eintrag) detailOeffnen(Number(query.eintrag));
}

function kurz(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
