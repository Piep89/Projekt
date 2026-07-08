// Gemeinsame UI-Bausteine: DOM-Helfer, Badges, Modale, Tabellen, Formatierung
import { state } from './api.js';

// Hyperscript: h('div', {class: 'x', onclick: fn}, kind1, kind2, ...)
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else if (k === 'disabled') el.disabled = Boolean(v);
    else if (k === 'selected') el.selected = Boolean(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------------- Gewerke-Badges (CHK-04, UX-01/03) ----------------
function textColor(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? '#1a1a1a' : '#ffffff';
}

export function gewerkBadge(kuerzel, { title } = {}) {
  const g = state.gewerkeMap[kuerzel];
  const farbe = g ? g.farbe : '#888888';
  return h('span', {
    class: 'gewerk-badge',
    style: { backgroundColor: farbe, color: textColor(farbe) },
    title: title || (g ? g.name : kuerzel),
  }, kuerzel);
}

// 'ELT,MT' -> Badge-Reihe
export function gewerkeBadges(csv) {
  const list = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
  return h('span', { class: 'gewerk-badges' }, list.map((k) => gewerkBadge(k)));
}

export function badge(text, klass = '') {
  return h('span', { class: `badge ${klass}` }, text);
}

// Status-Kataloge mit deutschen Bezeichnungen (UX-01)
export const STATUS_LABELS = {
  offen: 'Offen', in_bearbeitung: 'In Bearbeitung', erledigt: 'Erledigt',
  nicht_relevant: 'Nicht relevant', blockiert: 'Blockiert',
  unbewertet: 'Unbewertet', relevant: 'Relevant',
  festgelegt: 'Festgelegt', bestaetigt: 'Bestätigt', abweichend: 'Abweichend',
  ja: 'Benötigt', nein: 'Nicht benötigt', entfaellt: 'Entfällt',
  geplant: 'Geplant', entwurf: 'Entwurf', versandt: 'Versandt', festgestellt: 'Festgestellt',
  in_behebung: 'In Behebung', behoben: 'Behoben', abgenommen: 'Abgenommen',
  aktiv: 'Aktiv', pausiert: 'Pausiert', archiviert: 'Archiviert',
  information: 'Information', beschluss: 'Beschluss', aufgabe: 'Aufgabe',
  vorplanung: 'Vorplanung', ausfuehrung: 'Ausführung', as_built: 'As built', sonstig: 'Sonstig',
  baustelle: 'Baustelle', planung: 'Planung', telefonat: 'Telefonat', begehung: 'Begehung',
  bau: 'Baubesprechung', lenkung: 'Lenkungskreis', sonstige: 'Sonstige',
  hoch: 'Hoch', normal: 'Normal', niedrig: 'Niedrig',
};
export const label = (v) => STATUS_LABELS[v] || v || '—';

export function statusBadge(status) {
  return h('span', { class: `status-badge status-${status}` }, label(status));
}

// ---------------- Formatierung ----------------
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function isOverdue(termin, status) {
  return termin && termin < new Date().toISOString().slice(0, 10)
    && !['erledigt', 'abgenommen', 'nicht_relevant'].includes(status);
}
export function terminZelle(termin, status) {
  if (!termin) return h('span', { class: 'muted' }, '—');
  return h('span', { class: isOverdue(termin, status) ? 'ueberfaellig' : '' }, formatDate(termin));
}

// ---------------- Modal ----------------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const overlay = h('div', { class: 'modal-overlay' });
  const close = () => {
    document.removeEventListener('keydown', escSchliessen);
    overlay.remove();
    if (onClose) onClose();
  };
  // Esc schließt den obersten Dialog (UX: Tastaturbedienung)
  const escSchliessen = (e) => {
    if (e.key === 'Escape' && root.lastElementChild === overlay) close();
  };
  document.addEventListener('keydown', escSchliessen);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const dialog = h('div', { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-label': title },
    h('div', { class: 'modal-kopf' },
      h('h2', {}, title),
      h('button', { class: 'btn-icon', title: 'Schließen', onclick: close }, '✕')),
    h('div', { class: 'modal-inhalt' }, body),
    actions.length ? h('div', { class: 'modal-aktionen' }, actions) : null);
  overlay.append(dialog);
  root.append(overlay);
  const focusable = dialog.querySelector('input, select, textarea, button:not(.btn-icon)');
  if (focusable) focusable.focus();
  return { close, dialog };
}

export function confirmModal(text, { okLabel = 'Ja, fortfahren' } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Bestätigung',
      body: h('p', {}, text),
      actions: [
        h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'Abbrechen'),
        h('button', { class: 'btn btn-primary', onclick: () => { m.close(); resolve(true); } }, okLabel),
      ],
      onClose: () => resolve(false),
    });
  });
}

// ---------------- Toast ----------------
export function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: `toast toast-${type}` }, message);
  root.append(el);
  setTimeout(() => { el.classList.add('toast-weg'); setTimeout(() => el.remove(), 400); }, type === 'fehler' ? 6000 : 3000);
}

export function fehlerToast(err) {
  console.error(err);
  toast(err && err.message ? err.message : 'Unbekannter Fehler', 'fehler');
}

// ---------------- Tabelle ----------------
// columns: [{label, render(row) | key, class}]
export function table(columns, rows, { onRowClick, empty = 'Keine Einträge vorhanden.' } = {}) {
  if (!rows.length) return h('div', { class: 'leer-hinweis' }, empty);
  return h('div', { class: 'tabelle-umbruch' },
    h('table', { class: 'tabelle' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.class || '' }, c.label)))),
      h('tbody', {}, rows.map((row) =>
        h('tr', {
          class: onRowClick ? 'zeile-klickbar' : '',
          onclick: onRowClick ? () => onRowClick(row) : null,
        }, columns.map((c) => h('td', { class: c.class || '' }, c.render ? c.render(row) : (row[c.key] ?? '—'))))))));
}

// ---------------- Formular-Helfer ----------------
export function feld(labelText, input, { hinweis } = {}) {
  return h('label', { class: 'feld' },
    h('span', { class: 'feld-label' }, labelText),
    input,
    hinweis ? h('span', { class: 'feld-hinweis' }, hinweis) : null);
}

export function textInput(attrs = {}) { return h('input', { type: 'text', class: 'input', ...attrs }); }
export function dateInput(attrs = {}) { return h('input', { type: 'date', class: 'input', ...attrs }); }
export function textArea(attrs = {}) { return h('textarea', { class: 'input', rows: attrs.rows || 3, ...attrs }); }

export function select(options, attrs = {}) {
  // options: [{value, label, selected}]
  return h('select', { class: 'input', ...attrs },
    options.map((o) => h('option', { value: o.value, selected: o.selected }, o.label)));
}

export function gewerkSelect({ value = '', leer = '— Gewerk —', attrs = {} } = {}) {
  return select([
    { value: '', label: leer, selected: !value },
    ...state.gewerke.map((g) => ({ value: g.kuerzel, label: `${g.kuerzel} – ${g.name}`, selected: g.kuerzel === value })),
  ], attrs);
}

// Mehrfachauswahl Gewerke als Checkbox-Reihe; liefert {element, getValue()}
export function gewerkeMehrfach(csv = '') {
  const selected = new Set(String(csv || '').split(',').map((s) => s.trim()).filter(Boolean));
  const boxes = state.gewerke.map((g) => {
    const cb = h('input', { type: 'checkbox', checked: selected.has(g.kuerzel) });
    return { kuerzel: g.kuerzel, cb, el: h('label', { class: 'gewerk-check', title: g.name }, cb, gewerkBadge(g.kuerzel)) };
  });
  return {
    element: h('div', { class: 'gewerke-mehrfach' }, boxes.map((b) => b.el)),
    getValue: () => boxes.filter((b) => b.cb.checked).map((b) => b.kuerzel).join(','),
  };
}

/**
 * Drag-&-Drop-Zone um einen bestehenden Datei-Input (AP-03).
 * Der Input bleibt sichtbar und funktionsfähig (Fallback, Kamera auf Mobilgeräten);
 * fallengelassene Dateien werden dem Input zugewiesen, sodass die bestehende
 * Absende-Logik unverändert funktioniert.
 */
export function dropzone(input, { hinweis = 'Dateien hierher ziehen – oder unten auswählen' } = {}) {
  const text = h('div', { class: 'dz-text' }, hinweis);
  const zone = h('div', { class: 'dropzone' }, text, input);

  const zeigeAnzahl = () => {
    text.textContent = input.files && input.files.length
      ? `${input.files.length} Datei(en) ausgewählt`
      : hinweis;
  };
  input.addEventListener('change', zeigeAnzahl);

  const uebernehmen = (neue) => {
    const passend = [...neue].filter((f) => {
      if (!input.accept) return true;
      return input.accept.split(',').some((regel) => {
        const r = regel.trim();
        if (r.endsWith('/*')) return f.type.startsWith(r.slice(0, -1));
        return f.type === r || f.name.toLowerCase().endsWith(r.toLowerCase());
      });
    });
    if (!passend.length) { toast('Dateityp passt hier nicht', 'fehler'); return; }
    const dt = new DataTransfer();
    if (input.multiple) for (const f of input.files) dt.items.add(f);
    for (const f of (input.multiple ? passend : passend.slice(0, 1))) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dz-aktiv'); });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dz-aktiv'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dz-aktiv');
    if (e.dataTransfer && e.dataTransfer.files.length) uebernehmen(e.dataTransfer.files);
  });
  // Einfügen aus der Zwischenablage (z. B. Bildschirmfoto mit Strg+V)
  zone.einfuegen = (clipboardData) => {
    const dateien = [...(clipboardData?.files || [])];
    if (dateien.length) { uebernehmen(dateien); return true; }
    return false;
  };
  return zone;
}

export function leerHinweis(text) { return h('div', { class: 'leer-hinweis' }, text); }
export function laden() { return h('div', { class: 'lade-hinweis' }, 'Wird geladen …'); }

// Abschnittsüberschrift mit optionalen Aktionen rechts
export function kopfzeile(titel, ...aktionen) {
  return h('div', { class: 'kopfzeile' }, h('h1', {}, titel), h('div', { class: 'kopf-aktionen' }, aktionen));
}
