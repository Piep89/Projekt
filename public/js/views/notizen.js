// NOT-02 / ROL-05 – Private Notizen: nur für den Ersteller, bewusste Veröffentlichung möglich
import { get, post, patch, del } from '../api.js';
import {
  h, clear, kopfzeile, modal, confirmModal, toast, fehlerToast, feld, textInput, textArea,
  select, formatDateTime, laden, leerHinweis,
} from '../ui.js';
import { hilfeKnopf } from './hilfe.js';

export async function renderNotizen(el) {
  el.append(laden());
  let notizen = [], projekte = [];
  const filter = { q: '', projekt: '' };
  try { projekte = await get('/projects'); } catch { projekte = []; }

  const liste = h('div', { class: 'karten-reihe', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } });

  async function laden_() {
    clear(liste).append(laden());
    try {
      const qs = [filter.q && `q=${encodeURIComponent(filter.q)}`, filter.projekt && `projekt=${filter.projekt}`].filter(Boolean).join('&');
      notizen = await get(`/notes${qs ? '?' + qs : ''}`);
      clear(liste);
      if (!notizen.length) return liste.append(leerHinweis('Keine privaten Notizen.'));
      for (const n of notizen) {
        liste.append(h('div', { class: 'karte zeile-klickbar', style: { cursor: 'pointer' }, onclick: () => editor(n) },
          h('h3', { style: { margin: 0 } }, n.titel),
          h('p', { class: 'muted', style: { whiteSpace: 'pre-line' } }, n.text.length > 180 ? n.text.slice(0, 180) + '…' : n.text),
          h('div', { class: 'muted' }, [n.projekt_name, formatDateTime(n.updated_at)].filter(Boolean).join(' · '))));
      }
    } catch (e) { fehlerToast(e); }
  }

  function editor(n = null) {
    const titel = textInput({ value: n?.titel || '' });
    const text = textArea({ value: n?.text || '', rows: 10 });
    const projekt = select([{ value: '', label: '— ohne Projektbezug —' },
      ...projekte.map((p) => ({ value: String(p.id), label: p.name, selected: n?.project_id === p.id }))]);
    const aktionen = [
      h('button', {
        class: 'btn btn-primary', onclick: async () => {
          try {
            const daten = { titel: titel.value, text: text.value, project_id: projekt.value ? Number(projekt.value) : null };
            if (n) await patch(`/notes/${n.id}`, daten);
            else await post('/notes', daten);
            toast('Notiz gespeichert'); m.close(); laden_();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Speichern'),
    ];
    if (n) {
      aktionen.push(h('button', {
        class: 'btn', onclick: async () => {
          const kannJournal = Boolean(n.project_id || projekt.value);
          const kannKommentar = Boolean(n.object_typ && n.object_id);
          if (!kannJournal && !kannKommentar) return toast('Zum Veröffentlichen braucht die Notiz einen Projekt- oder Objektbezug.', 'fehler');
          const ziel = kannJournal ? 'journal' : 'kommentar';
          if (!(await confirmModal(`Die Notiz wird als offizieller ${ziel === 'journal' ? 'Journaleintrag' : 'Kommentar'} für alle Projektbeteiligten sichtbar und aus Ihren privaten Notizen entfernt. Fortfahren?`, { okLabel: 'Veröffentlichen' }))) return;
          try {
            if (projekt.value && Number(projekt.value) !== n.project_id) {
              await patch(`/notes/${n.id}`, { project_id: Number(projekt.value) });
            }
            await post(`/notes/${n.id}/veroeffentlichen`, { ziel });
            toast('Notiz veröffentlicht'); m.close(); laden_();
          } catch (e) { fehlerToast(e); }
        },
      }, 'Veröffentlichen …'));
      aktionen.push(h('button', {
        class: 'btn btn-gefahr', onclick: async () => {
          if (!(await confirmModal('Notiz endgültig löschen?'))) return;
          try { await del(`/notes/${n.id}`); toast('Gelöscht'); m.close(); laden_(); } catch (e) { fehlerToast(e); }
        },
      }, 'Löschen'));
    }
    const m = modal({
      title: n ? 'Notiz bearbeiten' : 'Neue private Notiz',
      wide: true,
      body: h('div', {}, feld('Titel *', titel), feld('Text', text), feld('Projektbezug (optional)', projekt)),
      actions: aktionen,
    });
  }

  const suche = textInput({ placeholder: 'Notizen durchsuchen … (Enter)' });
  suche.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filter.q = suche.value; laden_(); } });
  const projektFilter = select([{ value: '', label: 'Alle Projekte' }, ...projekte.map((p) => ({ value: String(p.id), label: p.name }))]);
  projektFilter.addEventListener('change', () => { filter.projekt = projektFilter.value; laden_(); });

  clear(el);
  el.append(kopfzeile('Private Notizen', hilfeKnopf('notizen'), h('button', { class: 'btn btn-primary', onclick: () => editor() }, '+ Notiz')));
  el.append(h('div', { class: 'karte hinweis-karte' },
    '🔒 Private Notizen sind ausschließlich für Sie sichtbar – sie erscheinen in keiner Suche, keinem Bericht und keinem Export anderer Nutzer. Auch Administratoren haben keinen Zugriff (ROL-05). Über „Veröffentlichen" können Sie eine Notiz bewusst in die offizielle Projektdokumentation überführen.'));
  el.append(h('div', { class: 'filter-leiste' }, feld('Suche', suche), feld('Projekt', projektFilter)));
  el.append(liste);
  await laden_();
}
