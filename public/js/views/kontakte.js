// Kontakte je Projekt inkl. CSV-Import (INT-01)
import { get, post, patch, del } from '../api.js';
import {
  h, clear, kopfzeile, table, modal, confirmModal, toast, fehlerToast, feld, textInput,
  textArea, gewerkSelect, gewerkBadge, laden,
} from '../ui.js';

export async function renderKontakte(el, params) {
  const projektId = Number(params.projektId);
  el.append(laden());
  let projekt;
  try { projekt = await get(`/projects/${projektId}`); } catch (e) { return fehlerToast(e); }
  const readonly = projekt.zugriff.rolle === 'leser' || projekt.status === 'archiviert';
  const filter = { gewerk: '', q: '' };
  const listeBereich = h('div');

  async function ladeListe() {
    clear(listeBereich).append(laden());
    try {
      const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const kontakte = await get(`/projects/${projektId}/contacts${qs ? '?' + qs : ''}`);
      clear(listeBereich).append(table([
        { label: 'Name', render: (k) => h('strong', {}, k.name) },
        { label: 'Firma', key: 'firma' },
        { label: 'Rolle', key: 'rolle' },
        { label: 'Gewerk', render: (k) => k.gewerk ? gewerkBadge(k.gewerk) : '—', class: 'schmal' },
        { label: 'E-Mail', render: (k) => k.email ? h('a', { href: `mailto:${k.email}`, onclick: (e) => e.stopPropagation() }, k.email) : '—' },
        { label: 'Telefon', key: 'telefon' },
      ], kontakte, {
        empty: 'Keine Kontakte. Legen Sie Projektbeteiligte an – sie stehen dann als Verantwortliche und Besprechungsteilnehmer zur Verfügung.',
        onRowClick: readonly ? null : (k) => dialog(k),
      }));
    } catch (e) { fehlerToast(e); }
  }

  function dialog(k = null) {
    const felder = {
      name: textInput({ value: k?.name || '' }),
      firma: textInput({ value: k?.firma || '' }),
      rolle: textInput({ value: k?.rolle || '', placeholder: 'z. B. Fachplaner ELT, Herstellervertreter' }),
      gewerk: gewerkSelect({ value: k?.gewerk || '' }),
      email: textInput({ value: k?.email || '', type: 'email' }),
      telefon: textInput({ value: k?.telefon || '' }),
      notiz: textArea({ value: k?.notiz || '', rows: 2 }),
    };
    const aktionen = [h('button', {
      class: 'btn btn-primary', onclick: async () => {
        const daten = {
          name: felder.name.value, firma: felder.firma.value || null, rolle: felder.rolle.value || null,
          gewerk: felder.gewerk.value || null, email: felder.email.value || null,
          telefon: felder.telefon.value || null, notiz: felder.notiz.value || null,
        };
        try {
          if (k) await patch(`/contacts/${k.id}`, daten);
          else await post(`/projects/${projektId}/contacts`, daten);
          toast('Kontakt gespeichert'); m.close(); ladeListe();
        } catch (e) { fehlerToast(e); }
      },
    }, 'Speichern')];
    if (k) {
      aktionen.unshift(h('button', {
        class: 'btn btn-gefahr', onclick: async () => {
          if (!(await confirmModal(`Kontakt „${k.name}" löschen?`))) return;
          try { await del(`/contacts/${k.id}`); toast('Kontakt gelöscht'); m.close(); ladeListe(); }
          catch (e) { fehlerToast(e); }
        },
      }, 'Löschen'));
    }
    const m = modal({
      title: k ? `Kontakt: ${k.name}` : 'Neuer Kontakt',
      body: h('div', {},
        h('div', { class: 'formular-spalten' },
          feld('Name *', felder.name), feld('Firma', felder.firma), feld('Rolle', felder.rolle),
          feld('Gewerk', felder.gewerk), feld('E-Mail', felder.email), feld('Telefon', felder.telefon)),
        feld('Notiz', felder.notiz)),
      actions: aktionen,
    });
  }

  function importDialog() {
    const csv = textArea({ rows: 8, placeholder: 'Name;Firma;Rolle;Gewerk;E-Mail;Telefon\nDr. Anna Weber;Uniklinik;Fachplanerin MT;MT;a.weber@klinik.de;0123-456' });
    const vorschau = h('div');
    const m = modal({
      title: 'Kontakte aus CSV importieren',
      wide: true,
      body: h('div', {}, feld('CSV-Inhalt (Spalten: Name;Firma;Rolle;Gewerk;E-Mail;Telefon)', csv), vorschau),
      actions: [
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              const r = await post(`/projects/${projektId}/contacts/import`, { csv: csv.value, commit: false });
              clear(vorschau).append(
                h('p', {}, `${r.ok.length} Zeilen gültig, ${r.fehler.length} fehlerhaft.`),
                r.fehler.length ? h('ul', {}, r.fehler.map((f) => h('li', { style: { color: 'var(--rot)' } }, `Zeile ${f.zeile}: ${f.grund}`))) : null);
            } catch (e) { fehlerToast(e); }
          },
        }, 'Vorschau'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            try {
              const r = await post(`/projects/${projektId}/contacts/import`, { csv: csv.value, commit: true });
              toast(`${r.importiert} Kontakte importiert`); m.close(); ladeListe();
            } catch (e) { fehlerToast(e); }
          },
        }, 'Importieren')],
    });
  }

  const gewerkSel = gewerkSelect({ leer: 'Alle Gewerke' });
  const suche = textInput({ placeholder: 'Name, Firma, Rolle … (Enter)' });
  gewerkSel.addEventListener('change', () => { filter.gewerk = gewerkSel.value; ladeListe(); });
  suche.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filter.q = suche.value; ladeListe(); } });

  clear(el);
  el.append(kopfzeile('Kontakte',
    readonly ? null : h('button', { class: 'btn', onclick: importDialog }, 'CSV-Import'),
    readonly ? null : h('button', { class: 'btn btn-primary', onclick: () => dialog() }, '+ Kontakt')));
  el.append(h('div', { class: 'filter-leiste' }, feld('Gewerk', gewerkSel), feld('Suche', suche)));
  el.append(listeBereich);
  await ladeListe();
}
