// Querschnitts-Panel für Objektdetails: Kommentare, Anhänge, Verknüpfungen, Verlauf
// Verwendung in Detail-Modalen aller Module (Verknüpfungsprinzip, CHK-05, ROL-06)
import { get, post, del, upload } from './api.js';
import { h, clear, feld, select, textArea, formatDateTime, fehlerToast, toast, confirmModal, label } from './ui.js';

const TYP_LABELS = {
  checkpoint: 'Checkpunkt', room: 'Raum', document: 'Dokument', meeting: 'Besprechung',
  protocol_item: 'Protokollpunkt', task: 'Aufgabe', defect: 'Mangel', journal: 'Journaleintrag',
};

const OBJEKT_ROUTEN = {
  checkpoint: (l, pid) => `#/projekt/${pid}/checkliste?punkt=${l.object_id}`,
  room: (l, pid) => `#/projekt/${pid}/raumbuch?raum=${l.object_id}`,
  document: (l, pid) => `#/projekt/${pid}/dokumente?eintrag=${l.object_id}`,
  meeting: (l, pid) => `#/besprechung/${l.object_id}`,
  protocol_item: (l, pid) => `#/projekt/${pid}/besprechungen?punkt=${l.object_id}`,
  task: (l, pid) => `#/aufgaben?aufgabe=${l.object_id}`,
  defect: (l, pid) => `#/projekt/${pid}/maengel?mangel=${l.object_id}`,
  journal: (l, pid) => `#/projekt/${pid}/journal?eintrag=${l.object_id}`,
};

/**
 * Rendert Reiter mit Kommentaren, Anhängen, Verknüpfungen und Verlauf für ein Objekt.
 * @param {string} typ z. B. 'checkpoint'
 * @param {number} id Objekt-ID
 * @param {object} opts {projectId, readonly}
 */
export function objektZusatz(typ, id, { projectId, readonly = false } = {}) {
  const inhalt = h('div', { class: 'zusatz-inhalt' });
  const tabs = [
    { key: 'kommentare', label: 'Kommentare', render: renderKommentare },
    { key: 'anhaenge', label: 'Anhänge', render: renderAnhaenge },
    { key: 'verknuepfungen', label: 'Verknüpfungen', render: renderVerknuepfungen },
    { key: 'verlauf', label: 'Verlauf', render: renderVerlauf },
  ];
  let aktiv = 'kommentare';
  const tabLeiste = h('div', { class: 'tab-leiste', role: 'tablist' },
    tabs.map((t) => h('button', {
      class: `tab ${t.key === aktiv ? 'tab-aktiv' : ''}`, role: 'tab',
      onclick: (e) => {
        aktiv = t.key;
        tabLeiste.querySelectorAll('.tab').forEach((b) => b.classList.remove('tab-aktiv'));
        e.target.classList.add('tab-aktiv');
        t.render(clear(inhalt), typ, id, { projectId, readonly });
      },
    }, t.label)));
  renderKommentare(inhalt, typ, id, { projectId, readonly });
  return h('div', { class: 'objekt-zusatz' }, tabLeiste, inhalt);
}

async function renderKommentare(el, typ, id, { readonly }) {
  try {
    const kommentare = await get(`/comments?object_typ=${typ}&object_id=${id}`);
    const liste = h('div', { class: 'kommentar-liste' },
      kommentare.length ? kommentare.map((k) => h('div', { class: 'kommentar' },
        h('div', { class: 'kommentar-kopf' }, h('strong', {}, k.user_name || 'Unbekannt'), ' · ', formatDateTime(k.created_at)),
        h('div', {}, k.text))) : h('div', { class: 'leer-hinweis' }, 'Noch keine Kommentare.'));
    el.append(liste);
    if (!readonly) {
      const eingabe = textArea({ placeholder: 'Kommentar hinzufügen …', rows: 2 });
      el.append(h('div', { class: 'kommentar-neu' }, eingabe,
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            if (!eingabe.value.trim()) return;
            try {
              await post('/comments', { object_typ: typ, object_id: id, text: eingabe.value });
              renderKommentare(clear(el), typ, id, { readonly });
            } catch (e) { fehlerToast(e); }
          },
        }, 'Kommentieren')));
    }
  } catch (e) { fehlerToast(e); }
}

async function renderAnhaenge(el, typ, id, { readonly }) {
  try {
    const anhaenge = await get(`/attachments?object_typ=${typ}&object_id=${id}`);
    el.append(h('ul', { class: 'anhang-liste' },
      anhaenge.length ? anhaenge.map((a) => h('li', {},
        h('a', { href: `/api/attachments/${a.id}/download` }, a.filename),
        h('span', { class: 'muted' }, ` (${Math.round((a.size || 0) / 1024)} KB, ${formatDateTime(a.created_at)})`)))
        : h('div', { class: 'leer-hinweis' }, 'Keine Anhänge.')));
    if (!readonly) {
      const datei = h('input', { type: 'file', class: 'input' });
      el.append(h('div', { class: 'anhang-neu' }, datei,
        h('button', {
          class: 'btn', onclick: async () => {
            if (!datei.files[0]) return;
            const fd = new FormData();
            fd.append('object_typ', typ);
            fd.append('object_id', id);
            fd.append('datei', datei.files[0]);
            try { await upload('/attachments', fd); toast('Anhang hochgeladen'); renderAnhaenge(clear(el), typ, id, { readonly }); }
            catch (e) { fehlerToast(e); }
          },
        }, 'Hochladen')));
    }
  } catch (e) { fehlerToast(e); }
}

async function renderVerknuepfungen(el, typ, id, { projectId, readonly }) {
  try {
    const links = await get(`/links?typ=${typ}&id=${id}`);
    el.append(h('ul', { class: 'link-liste' },
      links.length ? links.map((l) => h('li', {},
        h('span', { class: 'muted' }, `${TYP_LABELS[l.typ] || l.typ}: `),
        OBJEKT_ROUTEN[l.typ] && projectId
          ? h('a', { href: OBJEKT_ROUTEN[l.typ](l, projectId) }, l.label)
          : l.label,
        readonly ? null : h('button', {
          class: 'btn-icon', title: 'Verknüpfung entfernen',
          onclick: async (e) => {
            e.preventDefault();
            if (!(await confirmModal('Verknüpfung entfernen?'))) return;
            try { await del(`/links/${l.id}`); renderVerknuepfungen(clear(el), typ, id, { projectId, readonly }); }
            catch (err) { fehlerToast(err); }
          },
        }, '✕')))
        : h('div', { class: 'leer-hinweis' }, 'Keine Verknüpfungen.')));

    if (!readonly && projectId) {
      const zielTyp = select(Object.entries(TYP_LABELS).map(([value, l]) => ({ value, label: l })));
      const suche = h('input', { type: 'text', class: 'input', placeholder: 'Suchbegriff …' });
      const ergebnisse = h('div', { class: 'link-ergebnisse' });
      const suchen = async () => {
        try {
          const rows = await get(`/projects/${projectId}/link-targets?typ=${zielTyp.value}&q=${encodeURIComponent(suche.value)}`);
          clear(ergebnisse).append(rows.length
            ? h('ul', {}, rows.map((r) => h('li', {},
              h('button', {
                class: 'btn-link', onclick: async () => {
                  try {
                    await post('/links', { from_typ: typ, from_id: id, to_typ: zielTyp.value, to_id: r.id });
                    toast('Verknüpft');
                    renderVerknuepfungen(clear(el), typ, id, { projectId, readonly });
                  } catch (e) { fehlerToast(e); }
                },
              }, r.label))))
            : h('div', { class: 'leer-hinweis' }, 'Keine Treffer.'));
        } catch (e) { fehlerToast(e); }
      };
      suche.addEventListener('keydown', (e) => { if (e.key === 'Enter') suchen(); });
      el.append(h('div', { class: 'link-neu' },
        h('div', { class: 'zeile' }, zielTyp, suche, h('button', { class: 'btn', onclick: suchen }, 'Suchen')),
        ergebnisse));
    }
  } catch (e) { fehlerToast(e); }
}

async function renderVerlauf(el, typ, id) {
  try {
    const eintraege = await get(`/audit?object_typ=${typ}&object_id=${id}`);
    el.append(eintraege.length
      ? h('ul', { class: 'verlauf-liste' }, eintraege.map((a) => {
        let details = '';
        try {
          const d = JSON.parse(a.details);
          details = Object.entries(d).map(([feld, wert]) =>
            wert && typeof wert === 'object' && 'nach' in wert
              ? `${feld}: ${label(String(wert.von ?? '—'))} → ${label(String(wert.nach ?? '—'))}`
              : `${feld}: ${JSON.stringify(wert)}`).join('; ');
        } catch { details = a.details || ''; }
        return h('li', {},
          h('span', { class: 'muted' }, `${formatDateTime(a.timestamp)} · ${a.username || 'System'} · `),
          h('strong', {}, label(a.action.replace('status_', 'Status: '))),
          details ? h('div', { class: 'verlauf-details' }, details) : null);
      }))
      : h('div', { class: 'leer-hinweis' }, 'Kein Verlauf vorhanden.'));
  } catch (e) { fehlerToast(e); }
}
