// Administration: Nutzer (ROL-01), Gewerke-Katalog, Vorlagen (PRJ-05), Lessons Learned (PRJ-06)
import { api, get, post, patch, state, loadBase } from '../api.js';
import {
  h, clear, kopfzeile, table, modal, toast, fehlerToast, feld, textInput, textArea, select,
  gewerkBadge, statusBadge, label, formatDateTime, laden, leerHinweis,
} from '../ui.js';

export async function renderAdmin(el) {
  if (!state.user || state.user.role !== 'admin') {
    el.append(leerHinweis('Die Administration ist Administratoren vorbehalten.'));
    return;
  }
  let aktiverTab = 'nutzer';
  const inhalt = h('div');
  const tabs = [['nutzer', 'Nutzer'], ['gewerke', 'Gewerke'], ['vorlagen', 'Vorlagen'], ['lessons', 'Lessons Learned'], ['einstellungen', 'Einstellungen']];
  const tabLeiste = h('div', { class: 'tab-leiste' }, tabs.map(([key, text]) => h('button', {
    class: `tab ${key === aktiverTab ? 'tab-aktiv' : ''}`,
    onclick: (e) => {
      aktiverTab = key;
      tabLeiste.querySelectorAll('.tab').forEach((b) => b.classList.remove('tab-aktiv'));
      e.target.classList.add('tab-aktiv');
      zeige();
    },
  }, text)));

  clear(el);
  el.append(kopfzeile('Administration'), tabLeiste, inhalt);

  function zeige() {
    if (aktiverTab === 'nutzer') zeigeNutzer();
    else if (aktiverTab === 'gewerke') zeigeGewerke();
    else if (aktiverTab === 'vorlagen') zeigeVorlagen();
    else if (aktiverTab === 'einstellungen') zeigeEinstellungen();
    else zeigeLessons();
  }

  // ---------------- Einstellungen (REP-05, INT-03) ----------------
  async function zeigeEinstellungen() {
    clear(inhalt).append(laden());
    try {
      const s = await get('/settings');
      const zeile1 = textInput({ value: s.berichtskopf_zeile1 || '', placeholder: 'z. B. Universitätsklinikum Musterstadt' });
      const zeile2 = textInput({ value: s.berichtskopf_zeile2 || '', placeholder: 'z. B. Geschäftsbereich Bau & Technik – Medizintechnik' });
      const absender = textInput({ value: s.absender_email || '', placeholder: 'z. B. medizintechnik@klinik.de', type: 'email' });
      clear(inhalt).append(h('div', { class: 'karte', style: { maxWidth: '640px' } },
        h('h2', {}, 'Berichtskopf (REP-05)'),
        h('p', { class: 'muted' }, 'Erscheint in der Kopfzeile aller PDF-Berichte anstelle des Standardtexts.'),
        feld('Zeile 1 (Klinik/Organisation)', zeile1),
        feld('Zeile 2 (Abteilung/Absender)', zeile2),
        h('h2', { style: { marginTop: '1rem' } }, 'E-Mail-Versand (INT-03)'),
        h('p', { class: 'muted' },
          s.mail_konfiguriert
            ? '✓ SMTP ist über Umgebungsvariablen konfiguriert (GGP_SMTP_HOST).'
            : 'SMTP ist nicht konfiguriert. Für den Protokollversand die Umgebungsvariablen GGP_SMTP_HOST, GGP_SMTP_PORT, ggf. GGP_SMTP_USER/GGP_SMTP_PASS und GGP_MAIL_FROM setzen.'),
        feld('Absenderadresse (falls nicht per GGP_MAIL_FROM gesetzt)', absender),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            try {
              await api('/settings', { method: 'PUT', body: { berichtskopf_zeile1: zeile1.value, berichtskopf_zeile2: zeile2.value, absender_email: absender.value } });
              toast('Einstellungen gespeichert');
            } catch (e) { fehlerToast(e); }
          },
        }, 'Speichern')));
    } catch (e) { fehlerToast(e); }
  }

  // ---------------- Nutzer ----------------
  async function zeigeNutzer() {
    clear(inhalt).append(laden());
    try {
      const nutzer = await get('/users');
      clear(inhalt).append(
        h('div', { style: { marginBottom: '.7rem' } }, h('button', { class: 'btn btn-primary', onclick: () => nutzerDialog() }, '+ Nutzer')),
        table([
          { label: 'Benutzername', key: 'username' },
          { label: 'Name', key: 'display_name' },
          { label: 'E-Mail', key: 'email' },
          { label: 'Rolle', render: (u) => u.role === 'admin' ? 'Administrator' : 'Nutzer', class: 'schmal' },
          { label: 'Aktiv', render: (u) => u.active ? 'ja' : 'nein', class: 'schmal' },
        ], nutzer, { onRowClick: (u) => nutzerDialog(u) }));
    } catch (e) { fehlerToast(e); }
  }

  function nutzerDialog(u = null) {
    const username = textInput({ value: u?.username || '', disabled: Boolean(u) });
    const displayName = textInput({ value: u?.display_name || '' });
    const email = textInput({ value: u?.email || '', type: 'email' });
    const passwort = h('input', { type: 'password', class: 'input', placeholder: u ? 'leer lassen = unverändert' : 'mind. 10 Zeichen' });
    const rolle = select([['user', 'Nutzer'], ['admin', 'Administrator']].map(([v, l]) => ({ value: v, label: l, selected: (u?.role || 'user') === v })));
    const aktiv = h('input', { type: 'checkbox', checked: u ? Boolean(u.active) : true });
    const m = modal({
      title: u ? `Nutzer ${u.username}` : 'Neuer Nutzer',
      body: h('div', {},
        h('div', { class: 'formular-spalten' },
          feld('Benutzername *', username), feld('Anzeigename *', displayName),
          feld('E-Mail', email), feld('Passwort' + (u ? '' : ' *'), passwort), feld('Rolle', rolle)),
        h('label', { class: 'zeile' }, aktiv, ' Konto aktiv')),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            if (u) {
              await patch(`/users/${u.id}`, {
                display_name: displayName.value, email: email.value || null, role: rolle.value,
                active: aktiv.checked, ...(passwort.value ? { password: passwort.value } : {}),
              });
            } else {
              await post('/users', {
                username: username.value, display_name: displayName.value, email: email.value || null,
                password: passwort.value, role: rolle.value,
              });
            }
            toast('Nutzer gespeichert'); m.close(); zeigeNutzer();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Speichern')],
    });
  }

  // ---------------- Gewerke ----------------
  async function zeigeGewerke() {
    clear(inhalt).append(laden());
    try {
      const gewerke = await get('/gewerke');
      const zeilen = gewerke.map((g) => {
        const name = textInput({ value: g.name });
        const farbe = h('input', { type: 'color', value: g.farbe, class: 'input', style: { width: '60px', padding: '2px' } });
        const sort = textInput({ value: String(g.sort_order), type: 'number', style: { width: '70px' } });
        const speichern = async () => {
          try {
            await patch(`/gewerke/${g.id}`, { name: name.value, farbe: farbe.value, sort_order: Number(sort.value) });
            await loadBase();
            toast('Gewerk gespeichert');
          } catch (e) { fehlerToast(e); }
        };
        for (const f of [name, farbe, sort]) f.addEventListener('change', speichern);
        return h('tr', {},
          h('td', { class: 'schmal' }, gewerkBadge(g.kuerzel)),
          h('td', { class: 'schmal' }, g.kuerzel),
          h('td', {}, name), h('td', { class: 'schmal' }, farbe), h('td', { class: 'schmal' }, sort));
      });
      clear(inhalt).append(
        h('p', { class: 'muted' }, 'Der Gewerke-Katalog gilt zentral und projektübergreifend. Farben und Kürzel erscheinen in allen Modulen, Filtern und Berichten.'),
        h('div', { style: { marginBottom: '.7rem' } }, h('button', { class: 'btn btn-primary', onclick: gewerkDialog }, '+ Gewerk')),
        h('div', { class: 'tabelle-umbruch' }, h('table', { class: 'tabelle' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Kürzel'), h('th', {}, 'Name'), h('th', {}, 'Farbe'), h('th', {}, 'Sortierung'))),
          h('tbody', {}, zeilen))));
    } catch (e) { fehlerToast(e); }
  }

  function gewerkDialog() {
    const kuerzel = textInput({ placeholder: 'z. B. FÖR' });
    const name = textInput({ placeholder: 'z. B. Fördertechnik' });
    const farbe = h('input', { type: 'color', value: '#5f6b7a', class: 'input' });
    const m = modal({
      title: 'Neues Gewerk',
      body: h('div', {}, feld('Kürzel *', kuerzel), feld('Name *', name), feld('Farbe *', farbe)),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            await post('/gewerke', { kuerzel: kuerzel.value.trim(), name: name.value.trim(), farbe: farbe.value });
            await loadBase();
            toast('Gewerk angelegt'); m.close(); zeigeGewerke();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Anlegen')],
    });
  }

  // ---------------- Vorlagen (PRJ-05) ----------------
  async function zeigeVorlagen() {
    clear(inhalt).append(laden());
    try {
      const vorlagen = await get('/templates');
      clear(inhalt).append(
        h('p', { class: 'muted' }, 'Vorlagen sind versioniert: Export als JSON → fachliche Überarbeitung → Import als neue Version. Laufende Projekte behalten ihre Version; neue Punkte können projektweise übernommen werden (Projekt-Einstellungen).'),
        h('div', { style: { marginBottom: '.7rem' } }, h('button', { class: 'btn btn-primary', onclick: importDialog }, 'Neue Version importieren')),
        table([
          { label: 'Version', key: 'version', class: 'schmal' },
          { label: 'Name', key: 'name' },
          { label: 'Status', render: (v) => statusBadge(v.status), class: 'schmal' },
          { label: 'Punkte', render: (v) => String(v.punkte ?? v.checkpunkte ?? '—'), class: 'schmal' },
          { label: 'Dokumente', render: (v) => String(v.dokumente ?? '—'), class: 'schmal' },
          { label: 'Attribute', render: (v) => String(v.attribute ?? '—'), class: 'schmal' },
          { label: 'Projekte', render: (v) => String(v.projekte ?? '—'), class: 'schmal' },
        ], vorlagen, { onRowClick: (v) => vorlageDetail(v.id) }));
    } catch (e) { fehlerToast(e); }
  }

  async function vorlageDetail(id) {
    let v;
    try { v = await get(`/templates/${id}`); } catch (e) { return fehlerToast(e); }
    const t = v.template || v;
    const statusSel = select(['entwurf', 'aktiv', 'archiviert'].map((s) => ({ value: s, label: label(s), selected: t.status === s })));
    const punkteJePhase = {};
    for (const c of v.checkpunkte || []) punkteJePhase[c.phase_nr] = (punkteJePhase[c.phase_nr] || 0) + 1;
    const dokumenteJeBereich = {};
    for (const d of v.dokumente || []) dokumenteJeBereich[d.bereich] = (dokumenteJeBereich[d.bereich] || 0) + 1;
    const m = modal({
      title: `Vorlage ${t.version}: ${t.name}`,
      wide: true,
      body: h('div', {},
        h('div', { class: 'zeile', style: { marginBottom: '.8rem' } },
          h('a', { class: 'btn', href: `/api/templates/${t.id}/export` }, 'Als JSON exportieren'),
          feld('Status', statusSel),
          h('button', {
            class: 'btn', onclick: async () => {
              try { await patch(`/templates/${t.id}`, { status: statusSel.value }); toast('Status gespeichert'); }
              catch (e) { fehlerToast(e); }
            },
          }, 'Status speichern')),
        h('h3', {}, `Phasen (${(v.phasen || []).length}) und Checkpunkte (${(v.checkpunkte || []).length})`),
        h('ul', { style: { paddingLeft: '1.1rem' } }, (v.phasen || []).map((ph) =>
          h('li', {}, `${ph.name} – ${punkteJePhase[ph.nr] || 0} Punkte`))),
        h('h3', {}, `Dokumente (${(v.dokumente || []).length})`),
        h('p', {}, Object.entries(dokumenteJeBereich).map(([b, n]) => `Bereich ${b}: ${n}`).join(' · ') || '—'),
        h('h3', {}, `Raumbuch-Attribute (${(v.attribute || []).length}) · Raumtypen (${(v.raumtypen || []).length})`)),
    });
  }

  function importDialog() {
    const json = textArea({ rows: 12, placeholder: '{ "version": "1.1", "name": "…", "phasen": [...], "checkpunkte": [...], "dokumente": [...], "attribute": [...], "raumtypen": [...] }' });
    const m = modal({
      title: 'Neue Vorlagenversion importieren',
      wide: true,
      body: h('div', {},
        h('p', { class: 'muted' }, 'Tipp: Bestehende Version exportieren, im JSON überarbeiten (neue Versionsnummer!) und hier einfügen.'),
        feld('Vorlagen-JSON', json)),
      actions: [h('button', {
        class: 'btn btn-primary', onclick: async () => {
          let daten;
          try { daten = JSON.parse(json.value); } catch { return toast('Ungültiges JSON', 'fehler'); }
          try {
            await post('/templates', daten);
            toast('Vorlagenversion importiert'); m.close(); zeigeVorlagen();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Importieren')],
    });
  }

  // ---------------- Lessons Learned (PRJ-06) ----------------
  async function zeigeLessons() {
    clear(inhalt).append(laden());
    try {
      const vorschlaege = await get('/template-suggestions');
      clear(inhalt).append(
        h('p', { class: 'muted' }, 'Vorschläge aus abgeschlossenen Projekten. Die fachliche Übernahme erfolgt über Export der Vorlage, Einarbeitung im JSON und Import als neue Version.'),
        table([
          { label: 'Projekt', key: 'projekt_name' },
          { label: 'Typ', render: (v) => ({ neuer_punkt: 'Neuer Punkt', aenderung: 'Änderung', neues_dokument: 'Neues Dokument', sonstiges: 'Sonstiges' }[v.typ] || v.typ), class: 'schmal' },
          { label: 'Vorschlag', key: 'text' },
          { label: 'Von', key: 'ersteller_name' },
          { label: 'Datum', render: (v) => formatDateTime(v.created_at), class: 'schmal' },
          { label: 'Status', render: (v) => statusBadge(v.status), class: 'schmal' },
          {
            label: '', class: 'schmal', render: (v) => v.status !== 'offen' ? '' : h('span', { class: 'zeile' },
              h('button', {
                class: 'btn', onclick: async (e) => {
                  e.stopPropagation();
                  try { await patch(`/template-suggestions/${v.id}`, { status: 'uebernommen' }); zeigeLessons(); } catch (err) { fehlerToast(err); }
                },
              }, 'Übernommen'),
              h('button', {
                class: 'btn', onclick: async (e) => {
                  e.stopPropagation();
                  try { await patch(`/template-suggestions/${v.id}`, { status: 'verworfen' }); zeigeLessons(); } catch (err) { fehlerToast(err); }
                },
              }, 'Verworfen')),
          },
        ], vorschlaege, { empty: 'Keine Vorschläge vorhanden.' }));
    } catch (e) { fehlerToast(e); }
  }

  zeige();
}
